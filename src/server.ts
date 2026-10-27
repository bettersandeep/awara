// Awara server: serves the browser client and relays game messages over a WebSocket.
// Usage: npm start, then open http://localhost:8420
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { type ClientRequest, type ServerMessage, createGameSession } from "./session.ts";
import { getSpeechClip } from "./speech/synthesizer.ts";

const PORT = 8420;
// Local play only: the agents run on your own Claude login.
const HOST = "127.0.0.1";
const ALLOWED_ORIGINS = [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`];
const PUBLIC_DIR = resolve(import.meta.dirname, "..", "public");
// Browser libraries come from node_modules, so package.json pins their versions.
const VENDOR_FILES: Record<string, string> = {
  "/vendor/pixi.mjs": resolve(import.meta.dirname, "..", "node_modules", "pixi.js", "dist", "pixi.min.mjs"),
};

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
};

function serveSpeechClip(response: ServerResponse, clipId: number) {
  const wav = getSpeechClip(clipId);
  if (!wav) return response.writeHead(404).end();
  response.writeHead(200, { "content-type": "audio/wav" }).end(wav);
}

async function serveStaticFile(response: ServerResponse, urlPath: string) {
  let filePath: string;
  try {
    filePath = Object.hasOwn(VENDOR_FILES, urlPath) ? VENDOR_FILES[urlPath] : resolve(PUBLIC_DIR, `.${decodeURIComponent(urlPath)}`);
  } catch {
    return response.writeHead(400).end();
  }
  if (!Object.hasOwn(VENDOR_FILES, urlPath) && !filePath.startsWith(PUBLIC_DIR + sep)) return response.writeHead(403).end();
  try {
    const body = await readFile(filePath);
    // No ETag or Last-Modified is sent, so the browser must revalidate on every load.
    response.writeHead(200, {
      "content-type": CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream",
      "cache-control": "no-cache",
    }).end(body);
  } catch {
    response.writeHead(404).end("not found");
  }
}

async function handleHttpRequest(request: IncomingMessage, response: ServerResponse) {
  const path = URL.parse(request.url ?? "/", "http://localhost")?.pathname;
  if (!path) return response.writeHead(400).end();
  const clip = path.match(/^\/audio\/(\d+)\.wav$/);
  if (clip) return serveSpeechClip(response, Number(clip[1]));
  await serveStaticFile(response, path === "/" ? "/index.html" : path);
}

const httpServer = createServer((request, response) => void handleHttpRequest(request, response));

// Other websites in the same browser must not drive the game.
const socketServer = new WebSocketServer({
  server: httpServer,
  verifyClient: ({ origin }: { origin?: string }) => !origin || ALLOWED_ORIGINS.includes(origin),
});

function send(socket: WebSocket, message: ServerMessage) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function broadcast(message: ServerMessage) {
  for (const socket of socketServer.clients) send(socket, message);
}

const session = createGameSession(broadcast);

function handleClientMessage(text: string) {
  let request: ClientRequest;
  try {
    request = JSON.parse(text);
  } catch {
    return;
  }
  if (!request || typeof request !== "object") return;
  // One bad message must not stop the server and end the game for everyone.
  try {
    if (request.type === "start") session.start(request);
    else if (request.type === "action") session.playRound(request);
    else if (request.type === "seat") session.configureSeat(request);
  } catch (error) {
    console.error(`client message "${String(request.type)}" failed:`, error);
  }
}

socketServer.on("connection", (socket) => {
  for (const message of session.snapshotMessages()) send(socket, message);
  socket.on("message", (data) => handleClientMessage(String(data)));
});

httpServer.listen(PORT, HOST, () => console.log(`Awara is running at http://localhost:${PORT}`));
