// Entry point: connects to the server and wires the board, seats, story log,
// speech and action bar together.
import { createBoard } from "./board.js";
import { createSeats } from "./seats.js";
import { createSpeech } from "./speech.js";
import { createStoryLog } from "./storyLog.js";
import { showCharacterCreation } from "./characterCreation.js";
import { createQuickActions } from "./quickActions.js";

const RECONNECT_DELAY_MS = 2000;

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

const board = createBoard(document.getElementById("board"), catalog, { onSelectSprite: (sprite) => selectTarget(sprite) });
const seats = createSeats({ catalog, onSeatChange: (seat, change) => send({ type: "seat", seat, ...change }) });
const speech = createSpeech({
  onSpeakerChange: (speaker, isSpeaking) => seats.setSpeaking(speaker, isSpeaking),
  onPosition: (audioId, seconds) => storyLog.showSpokenPosition(audioId, seconds),
});
const storyLog = createStoryLog(document.getElementById("story-log"), {
  nameOf: (id) => party?.members.find((member) => member.id === id)?.name ?? id,
  onReplay: (audioId, speaker) => speech.playNow(audioId, speaker),
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
  world({ map, health }) {
    board.showMap(map, health);
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
  log: (entry) => storyLog.add(entry),
  audio({ audioId, timings, speaker, logIndex }) {
    storyLog.attachAudio(logIndex, audioId, timings, speaker);
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
  speechToggle.textContent = speech.toggleAutoplay() ? "🔊" : "🔇";
};

connect();
