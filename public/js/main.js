// Entry point: connects to the server and wires the board, seats, story log,
// speech and action bar together.
import { createBoard } from "./board.js";
import { createSeats } from "./seats.js";
import { createSpeech } from "./speech.js";
import { createStoryLog } from "./storyLog.js";
import { showCharacterCreation } from "./characterCreation.js";

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

const board = createBoard(document.getElementById("board"), catalog);
const seats = createSeats({ catalog, onSeatChange: (seat, change) => send({ type: "seat", seat, ...change }) });
const speech = createSpeech({ onSpeakerChange: (speaker, isSpeaking) => seats.setSpeaking(speaker, isSpeaking) });
const storyLog = createStoryLog(document.getElementById("story-log"), {
  nameOf: (id) => party?.members.find((member) => member.id === id)?.name ?? id,
  onReplay: (audioId, speaker) => speech.playNow(audioId, speaker),
});

function actionPrompt() {
  const player = party?.members.find((member) => member.isPlayer);
  return player ? `⚔ what does ${player.name} do?` : "⚔ what do you do?";
}

function setBusy(busy) {
  doInput.disabled = sayInput.disabled = busy;
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
  world({ map }) {
    board.showMap(map);
    mapName.textContent = map ? map.name : "Awara";
  },
  party(message) {
    party = message;
    seats.render(party);
    board.setPartyIds(party.members.map((member) => member.id));
    if (!doInput.disabled) doInput.placeholder = actionPrompt();
  },
  log: (entry) => storyLog.add(entry),
  audio({ audioId, speaker, logIndex }) {
    storyLog.addReplayButton(logIndex, audioId, speaker);
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
    storyLog.clear();
    setTimeout(connect, RECONNECT_DELAY_MS);
  };
}

document.getElementById("action-bar").onsubmit = (event) => {
  event.preventDefault();
  const action = doInput.value.trim();
  const dialogue = sayInput.value.trim();
  if (doInput.disabled || (!action && !dialogue)) return;
  send({ type: "action", do: action, say: dialogue });
  doInput.value = sayInput.value = "";
};

speechToggle.onclick = () => {
  speechToggle.textContent = speech.toggleAutoplay() ? "🔊" : "🔇";
};

connect();
