// Entry point: connects to the server and wires the board, seats, story log,
// speech and action bar together.
import { createBoard } from "./board.js";
import { createSeats } from "./seats.js";
import { createSpeech } from "./speech.js";
import { createStoryLog } from "./storyLog.js";
import { showCharacterCreation } from "./characterCreation.js";
import { createQuickActions } from "./quickActions.js";
import { createStoryMotions } from "./storyMotions.js";

const RECONNECT_DELAY_MS = 2000;
const BOARD_LOOK_KEY = "awara.look";
const BOARD_MOTION_KEY = "awara.motion";
const BOARD_MOTIONS = { hop: "🦘 hop", glide: "〰 glide" };
// The canvas board, or the WebGL board with one of its looks (see boardDither.js).
const BOARD_LOOKS = {
  smooth: "✨ smooth", "dither-light": "░ dithered light", duotone: "▓ duotone", palette: "▒ palette", canvas: "▦ canvas",
};

const catalog = await fetch("catalog.json").then((response) => response.json());

const mapName = document.getElementById("map-name");
const objective = document.getElementById("objective");
const doInput = document.getElementById("do-input");
const sayInput = document.getElementById("say-input");
const speechToggle = document.getElementById("speech-toggle");

let socket = null;
let party = null;
let busyTimer = null;

const send = (message) => socket.send(JSON.stringify(message));

const boardLook = readChoice("look", BOARD_LOOK_KEY, BOARD_LOOKS, "smooth");
const boardMotion = readChoice("motion", BOARD_MOTION_KEY, BOARD_MOTIONS, "hop");
const board = await createChosenBoard(boardLook);
const seats = createSeats({ catalog, onSeatChange: (seat, change) => send({ type: "seat", seat, ...change }) });
const speech = createSpeech({
  onSpeakerChange: (speaker, isSpeaking) => seats.setSpeaking(speaker, isSpeaking),
  onPosition: (audioId, seconds) => {
    storyLog.showSpokenPosition(audioId, seconds);
    if (seconds === null) storyMotions.clipStopped(audioId); // ended, stopped or failed
  },
});
const storyLog = createStoryLog(document.getElementById("story-log"), {
  nameOf: (id) => party?.members.find((member) => member.id === id)?.name ?? id,
  onReplay: (audioId, speaker) => speech.playNow(audioId, speaker),
  onPieceSpoken: (logIndex, pieceIndex) => storyMotions.pieceSpoken(logIndex, pieceIndex),
});

// A board choice comes from the URL (?look=, ?motion=), then the player's last choice, then the default.
function readChoice(param, storageKey, choices, fallback) {
  const fromUrl = new URLSearchParams(location.search).get(param);
  let saved = null;
  try {
    saved = localStorage.getItem(storageKey);
  } catch {}
  return [fromUrl, saved].find((choice) => Object.hasOwn(choices, choice ?? "")) ?? fallback;
}

function saveChoice(storageKey, value) {
  try {
    localStorage.setItem(storageKey, value);
  } catch {}
}

// Without WebGL in the browser, the canvas board is used.
async function createChosenBoard(look) {
  const options = { onSelectSprite: (sprite) => selectTarget(sprite) };
  if (look !== "canvas") {
    try {
      const { createWebglBoard } = await import("./boardWebgl.js");
      return await createWebglBoard(document.getElementById("board-frame"), catalog, { ...options, look, motion: boardMotion });
    } catch (error) {
      console.warn("WebGL board failed, using the canvas board:", error);
    }
  }
  return createBoard(document.getElementById("board"), catalog, options);
}

const lookPicker = document.getElementById("board-look");
// A browser without WebGL got the canvas board, so the picker shows canvas.
const shownLook = board.setLook ? boardLook : "canvas";
for (const [look, label] of Object.entries(BOARD_LOOKS)) lookPicker.add(new Option(label, look, false, look === shownLook));
lookPicker.onchange = () => {
  const next = lookPicker.value;
  saveChoice(BOARD_LOOK_KEY, next);
  // WebGL looks switch in place. The canvas board is another renderer, so the page
  // reloads; the server replays the game to every new page, so the game continues.
  if (next === "canvas" || !board.setLook) {
    location.href = location.pathname;
    return;
  }
  board.setLook(next);
};

// Walking style on the WebGL board; the canvas board has its own simple glide.
const motionPicker = document.getElementById("board-motion");
for (const [motion, label] of Object.entries(BOARD_MOTIONS)) motionPicker.add(new Option(label, motion, false, motion === boardMotion));
motionPicker.hidden = !board.setMotion;
motionPicker.onchange = () => {
  saveChoice(BOARD_MOTION_KEY, motionPicker.value);
  board.setMotion(motionPicker.value);
};

const storyMotions = createStoryMotions({
  playMotions: (motions) => board.playMotions?.(motions),
  isVoiceOn: () => speech.isAutoplay(),
});

const quickActions = createQuickActions({
  doInput,
  sayInput,
  onActionWritten: () => fitToText(doInput),
  onClearTarget: () => selectTarget(null),
});

let targetId = null;
function selectTarget(sprite) {
  targetId = sprite?.id ?? null;
  board.setSelected(targetId);
  quickActions.setTarget(sprite);
}

function actionPrompt() {
  const player = party?.members.find((member) => member.isPlayer);
  return player ? `⚔️ what does ${player.name} do?` : "⚔️ what do you do?";
}

function setBusy(busy) {
  doInput.disabled = sayInput.disabled = busy;
  quickActions.setBusy(busy);
  clearInterval(busyTimer);
  if (!busy) {
    doInput.placeholder = actionPrompt();
    doInput.focus();
    return;
  }
  const startedAt = Date.now();
  busyTimer = setInterval(() => {
    doInput.placeholder = `the table is playing... ${Math.round((Date.now() - startedAt) / 1000)}s`;
  }, 1000);
}

const messageHandlers = {
  world({ map, health, states }) {
    board.showMap(map, health, states);
    // A target that left the board (or died) is no longer a target.
    if (targetId && !map?.sprites.some((sprite) => sprite.id === targetId)) selectTarget(null);
    mapName.textContent = map ? map.name : "Awara";
  },
  party(message) {
    party = message;
    seats.render(party);
    board.setPartyIds(party.members.map((member) => member.id));
    quickActions.setPlayer(party.members.find((member) => member.isPlayer));
    if (!doInput.disabled) doInput.placeholder = actionPrompt();
  },
  log(entry) {
    storyLog.add(entry);
    storyMotions.lineAdded(entry);
  },
  effect: (effect) => board.playEffect?.(effect),
  audio({ audioId, timings, speaker, logIndex }) {
    storyLog.attachAudio(logIndex, audioId, timings, speaker);
    storyMotions.clipReady(logIndex, audioId);
    speech.clipReady(audioId, speaker);
  },
  busy: ({ busy }) => setBusy(busy),
  objective: ({ text }) => (objective.textContent = `⚑ ${text}`),
  setup: ({ classes, scenarios }) =>
    showCharacterCreation({ classes, scenarios, catalog, onStart: (choice) => send({ type: "start", ...choice }) }),
};

// The server replays the whole game on every connection, so a reconnect simply
// starts from a clean log.
function connect() {
  socket = new WebSocket(`ws://${location.host}`);
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    messageHandlers[message.type]?.(message);
  };
  socket.onclose = () => {
    mapName.textContent = "reconnecting...";
    setBusy(true);
    storyLog.clear();
    storyMotions.clear();
    setTimeout(connect, RECONNECT_DELAY_MS);
  };
}

const actionBar = document.getElementById("action-bar");

// The fields grow with the text (style.css caps them at four lines), so a long
// action stays readable while you type.
function fitToText(field) {
  field.style.height = "auto";
  field.style.height = `${field.scrollHeight}px`;
}

for (const field of [sayInput, doInput]) {
  field.addEventListener("input", () => fitToText(field));
  // Enter sends the round; Shift+Enter starts a new line.
  field.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    actionBar.requestSubmit();
  });
}

actionBar.onsubmit = (event) => {
  event.preventDefault();
  const action = doInput.value.trim();
  const dialogue = sayInput.value.trim();
  // A round sent while the socket reconnects would be lost, so the text stays.
  if (doInput.disabled || socket?.readyState !== WebSocket.OPEN || (!action && !dialogue)) return;
  send({ type: "action", do: action, say: dialogue });
  doInput.value = sayInput.value = "";
  fitToText(doInput);
  fitToText(sayInput);
};

speechToggle.onclick = () => {
  const voiceOn = speech.toggleAutoplay();
  speechToggle.textContent = voiceOn ? "🔊" : "🔇";
  if (!voiceOn) storyMotions.voiceOff();
};

connect();
