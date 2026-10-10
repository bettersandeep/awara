// One game at the table: the world, the story log, the party and the round loop.
// The session knows nothing about sockets. It sends plain messages to `broadcast`.
import { makeRng } from "./rules/dice.ts";
import { type Character, armorClass } from "./rules/character.ts";
import { makeWorld } from "./scene/world.ts";
import { applySceneOps } from "./scene/sceneOps.ts";
import { type Narrator, type NarratorHost, createNarrator } from "./agents/narrator.ts";
import { type CompanionAgent, type Declaration, createCompanionAgent } from "./agents/companion.ts";
import { AGENT_MODELS, type AgentModel, isAgentModel } from "./agents/runAgentTurn.ts";
import { CLASS_BUILDS, PLAYER_ID, createParty, isCharacterClass } from "./party.ts";
import { SCENARIOS, chooseScenario } from "./scenarios.ts";
import { KOKORO_VOICES, NARRATOR_VOICE, type Voice, isVoice, synthesizeSpeech } from "./tts.ts";

export type ServerMessage = { type: string; [field: string]: unknown };
export type ClientRequest = Record<string, unknown>;

type LogKind = "story" | "dice" | "system" | "speech" | "intent";
type LogEntry = { text: string; kind: LogKind; speaker?: string; audioId?: number };

const NARRATOR_SEAT = "narrator";
const MAX_NAME_LENGTH = 24;
const MAX_EVENTS_FOR_COMPANIONS = 25;

const WELCOME =
  "Welcome to Awara. Choose your class, your name and an opening to start. " +
  "Three AI companions play with you, and the narrator runs the world. " +
  "In each round, write what you do and, if you want, what you say. " +
  "Your companions then declare their actions, and the narrator resolves all of them. " +
  "Blue 🎲 lines are real d20 SRD rolls: d20 + modifiers against a target number (AC for attacks, DC for checks). Higher is better. " +
  "The engine rolls for every character, friend or foe, when an outcome is not certain.";

const BLACK_SCREEN_CORRECTION =
  "The players see a BLACK SCREEN: you have not successfully created any map. " +
  "Call scene_ops NOW: create_map, paint the terrain, add props, and add_sprite all four party members. " +
  "If an op is REJECTED, read the error, fix it, and resend.";

const readText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export function createGameSession(broadcast: (message: ServerMessage) => void) {
  const rng = makeRng(Date.now() >>> 0);
  const world = makeWorld();
  const storyLog: LogEntry[] = [];
  const characters: Record<string, Character> = {};
  const voices: Record<string, Voice> = { [NARRATOR_SEAT]: NARRATOR_VOICE };
  const partyIds: string[] = [];
  let companions: CompanionAgent[] = [];
  let narrator: Narrator | null = null;
  let narratorModel: AgentModel = "haiku";
  let objective = "";
  let roundInProgress = false;
  let companionsHaveRead = 0; // story log entries the companions have already seen

  // ---- story log -----------------------------------------------------------

  function log(rawText: string, kind: LogKind, speaker?: string) {
    // Models use em and en dashes even when told not to; the story uses plain hyphens.
    const text = rawText.replace(/\s*[\u2013\u2014]\s*/g, " - ");
    const entry: LogEntry = { text, kind, speaker };
    const logIndex = storyLog.push(entry) - 1;
    broadcast({ type: "log", ...entry, logIndex });
    const voiceOwner = kind === "story" ? NARRATOR_SEAT : kind === "speech" ? speaker : undefined;
    if (!voiceOwner || !voices[voiceOwner]) return;
    synthesizeSpeech(text, voices[voiceOwner], (audioId) => {
      entry.audioId = audioId;
      broadcast({ type: "audio", audioId, speaker: voiceOwner, logIndex });
    });
  }

  function describeEvent(entry: LogEntry): string {
    const name = entry.speaker ? characters[entry.speaker]?.name ?? entry.speaker : "";
    if (entry.kind === "speech") return `${name} says: "${entry.text}"`;
    if (entry.kind === "intent") return `${name} does: ${entry.text}`;
    return entry.text;
  }

  function readNewEventsForCompanions(): string {
    const events = storyLog.slice(companionsHaveRead).filter((entry) => entry.kind !== "system");
    companionsHaveRead = storyLog.length;
    return events.slice(-MAX_EVENTS_FOR_COMPANIONS).map(describeEvent).join("\n");
  }

  // ---- messages for the browser --------------------------------------------

  const worldMessage = (): ServerMessage => ({ type: "world", map: world.maps[world.currentMap] ?? null });

  function partyMessage(): ServerMessage {
    return {
      type: "party",
      modelOptions: AGENT_MODELS,
      voiceOptions: KOKORO_VOICES,
      narrator: { id: NARRATOR_SEAT, model: narratorModel, voice: voices[NARRATOR_SEAT] },
      members: partyIds.map((id) => {
        const c = characters[id];
        return {
          id, name: c.name, characterClass: c.characterClass, level: c.level,
          hp: c.hp, maxHp: c.maxHp, ac: armorClass(c), spellSlots: c.spellSlots, sprite: c.sprite,
          powers: CLASS_BUILDS[c.characterClass].powers,
          isPlayer: id === PLAYER_ID,
          model: companions.find((agent) => agent.id === id)?.model ?? null,
          voice: voices[id],
        };
      }),
    };
  }

  const setupMessage = (): ServerMessage => ({
    type: "setup",
    classes: Object.entries(CLASS_BUILDS).map(([key, build]) => ({ key, label: build.label, sprite: build.sprite, summary: build.summary })),
    scenarios: Object.entries(SCENARIOS).map(([key, scenario]) => ({ key, title: scenario.title, pitch: scenario.pitch })),
  });

  // Everything a newly connected browser needs to show the current game.
  function snapshotMessages(): ServerMessage[] {
    const messages: ServerMessage[] = [partyMessage(), worldMessage()];
    storyLog.forEach((entry, logIndex) => messages.push({ type: "log", ...entry, logIndex }));
    messages.push({ type: "busy", busy: roundInProgress });
    if (objective) messages.push({ type: "objective", text: objective });
    if (!narrator) messages.push(setupMessage());
    return messages;
  }

  // ---- turns ---------------------------------------------------------------

  // Only one round runs at a time; the browser input is locked while it runs.
  async function runExclusively(work: () => Promise<void>) {
    if (roundInProgress) {
      log("The table is still resolving the last round.", "system");
      return;
    }
    roundInProgress = true;
    broadcast({ type: "busy", busy: true });
    try {
      await work();
    } catch (error) {
      log(`The narrator failed: ${(error as Error).message}`, "system");
    } finally {
      roundInProgress = false;
      broadcast(partyMessage());
      broadcast({ type: "busy", busy: false });
    }
  }

  async function openAdventure(activeNarrator: Narrator, openingPrompt: string) {
    await activeNarrator.takeTurn(openingPrompt);
    // A black screen is the worst failure, so the narrator gets one corrective turn.
    if (!world.currentMap) {
      log("~ the narrator gathers the scene...", "system");
      await activeNarrator.takeTurn(BLACK_SCREEN_CORRECTION);
    }
  }

  function describeDeclaration(id: string, { action, dialogue }: Declaration, note = ""): string {
    const parts = [dialogue && `says: "${dialogue}"`, action && `does: ${action}`].filter(Boolean);
    return `${characters[id].name}${note} ${parts.join(" - ")}`;
  }

  async function resolveRound(activeNarrator: Narrator, action: string, dialogue: string) {
    if (dialogue) log(dialogue, "speech", PLAYER_ID);
    if (action) log(action, "intent", PLAYER_ID);

    const recentEvents = `Recent events:\n${readNewEventsForCompanions()}`;
    const activeCompanions = companions.filter((agent) => characters[agent.id].hp > 0);
    const results = await Promise.all(activeCompanions.map(async (agent) => {
      try {
        return { id: agent.id, declaration: await agent.declare(recentEvents) };
      } catch (error) {
        log(`${characters[agent.id].name} is lost in thought (${(error as Error).message})`, "system");
        return { id: agent.id, declaration: null };
      }
    }));

    const declarations = [describeDeclaration(PLAYER_ID, { action, dialogue }, " (the human player)")];
    for (const { id, declaration } of results) {
      if (!declaration) continue;
      if (declaration.dialogue) log(declaration.dialogue, "speech", id);
      if (declaration.action) log(declaration.action, "intent", id);
      declarations.push(describeDeclaration(id, declaration));
    }

    await activeNarrator.takeTurn(
      `Party declarations this round:\n${declarations.join("\n")}\n` +
      "Resolve the round. Every being the party can now see must be a sprite on the map.",
    );
  }

  // ---- requests from the browser -------------------------------------------

  function start(request: ClientRequest) {
    const playerClass = request.characterClass;
    if (narrator || !isCharacterClass(playerClass)) return;
    const playerName = readText(request.name).slice(0, MAX_NAME_LENGTH) || "Hero";

    const { player, companions: companionMembers } = createParty(rng, playerName, playerClass);
    for (const member of [player, ...companionMembers]) {
      characters[member.character.id] = member.character;
      voices[member.character.id] = member.voice;
      partyIds.push(member.character.id);
    }
    companions = companionMembers.map((member) => createCompanionAgent(member.character, member.persona));
    const activeNarrator = createNarrator(narratorHost, characters, rng, PLAYER_ID);
    activeNarrator.setModel(narratorModel);
    narrator = activeNarrator;
    broadcast(partyMessage());

    const scenario = chooseScenario(rng, request.scenario);
    const openingPrompt =
      `Begin a level-1 adventure. ${scenario.prompt}\n` +
      `Place all four party members in the opening scene and set the objective. ` +
      `The human player is ${playerName} the ${playerClass}.`;
    void runExclusively(() => openAdventure(activeNarrator, openingPrompt));
  }

  function playRound(request: ClientRequest) {
    const activeNarrator = narrator;
    const action = readText(request.do);
    const dialogue = readText(request.say);
    if (!activeNarrator || (!action && !dialogue)) return;
    void runExclusively(() => resolveRound(activeNarrator, action, dialogue));
  }

  function configureSeat(request: ClientRequest) {
    const seat = request.seat;
    if (typeof seat !== "string" || (seat !== NARRATOR_SEAT && !partyIds.includes(seat))) return;
    if (isAgentModel(request.model)) {
      if (seat === NARRATOR_SEAT) {
        narratorModel = request.model;
        narrator?.setModel(request.model);
      } else {
        companions.find((agent) => agent.id === seat)?.setModel(request.model);
      }
    }
    if (isVoice(request.voice)) voices[seat] = request.voice;
    broadcast(partyMessage());
  }

  const narratorHost: NarratorHost = {
    world,
    applySceneOps(rawOps) {
      applySceneOps(world, rawOps);
      broadcast(worldMessage());
    },
    log,
    setObjective(text) {
      objective = text;
      broadcast({ type: "objective", text });
    },
  };

  log(WELCOME, "system");

  return { snapshotMessages, start, playRound, configureSeat };
}
