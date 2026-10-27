// The narrator: one Claude session that runs the world through game tools.
// It never rolls dice and never edits pixels. The rules engine rolls, and scene
// ops change the world state that the browser draws.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { Rng } from "../rules/dice.ts";
import { type Character, type Skill, type Spell, SKILLS, SPELLS, WEAPONS, armorClass, canAct, lifeState } from "../rules/character.ts";
import {
  type CheckResult, applyDamage, attack, castSpell, heal, rest, rollInitiative, savingThrow, skillCheck,
} from "../rules/engine.ts";
import { MONSTERS, spawnMonster } from "../rules/monsters.ts";
import { catalog, type World } from "../scene/world.ts";
import { VOICE_CUES } from "../speech/script.ts";
import { MOTION_HELP } from "../motions.ts";
import { type AgentModel, type AgentSession, NARRATOR_DEFAULT_MODEL, TurnTimeoutError, runAgentTurn } from "./runAgentTurn.ts";

const PROMPT_FILE = join(import.meta.dirname, "..", "..", "personas", "narrator.md");
const TURN_TIMEOUT_MS = 5 * 60_000;
const MAX_TOOL_TURNS = 150;
// Long narration made rounds slow: 9 to 12 sentences, about 65 s of speech each.
const TARGET_NARRATION_WORDS = 80;
const MAX_NARRATION_WORDS = 120;
const NARRATOR_EFFORT = "low";

// A motion as the narrator wrote it; the session checks the id and the action.
type RawMotion = { id: string; action: string; target?: string };

// One part of a narration: plain narration, or one character's spoken line.
export type NarrationBeat = { text: string; speaker?: string; gender?: string; motions?: RawMotion[] };

// What the rules engine just resolved, so the board can show it. Ids are character ids.
export type BoardEffect =
  | { kind: "attack"; attacker: string; target: string; hit: boolean; crit: boolean; damage: number; ranged: boolean }
  | { kind: "spell"; spell: Spell; caster: string; target: string; success: boolean; amount: number; missiles: number }
  | { kind: "damage" | "heal"; target: string; amount: number }
  | { kind: "rest"; ids: string[] };

// What the narrator needs from the game session.
export type NarratorHost = {
  world: World;
  applySceneOps: (rawOps: unknown[]) => void;
  narrate: (beats: NarrationBeat[]) => string[]; // returns notes on motions it skipped
  effect: (effect: BoardEffect) => void;
  log: (text: string, kind: "dice" | "system") => void;
  setObjective: (text: string) => void;
  setPronunciation: (word: string, sayAs: string) => void;
};

// The narrator may send plain text instead of beats.
function readBeats(args: { text?: string; beats?: NarrationBeat[] }): NarrationBeat[] {
  const beats: NarrationBeat[] = (args.beats ?? [])
    .filter((beat) => beat.text.trim())
    .map((beat) => ({ ...beat, speaker: beat.speaker?.trim() || undefined }));
  if (beats.length === 0 && args.text?.trim()) beats.push({ text: args.text });
  return beats;
}

export type Narrator = ReturnType<typeof createNarrator>;

function describeCharacter(c: Character): string {
  return `${c.name} (id:${c.id}) lvl${c.level} ${c.characterClass} hp:${c.hp}/${c.maxHp} ac:${armorClass(c)} ` +
    `weapon:${c.weapon} slots:${c.spellSlots} state:${lifeState(c)}`;
}

const textResult = (text: string) => ({ content: [{ type: "text" as const, text }] });

function createToolServer(host: NarratorHost, characters: Record<string, Character>, rng: Rng) {
  const getCharacter = (id: string): Character => {
    const character = characters[id];
    if (!character) throw new Error(`unknown character id "${id}". Known: ${Object.keys(characters).join(", ")}`);
    return character;
  };
  const logRoll = (log: string) => {
    host.log(log, "dice");
    return textResult(log);
  };
  const logCheck = (result: CheckResult, dc: number) => {
    host.log(result.log, "dice");
    return textResult(`${result.success ? "SUCCESS" : "FAIL"} (${result.total} vs DC ${dc})`);
  };

  return createSdkMcpServer({
    name: "dnd",
    version: "1.0.0",
    tools: [
      tool("narrate",
        "Show and speak story text. Send `beats` in order: a beat without `speaker` is narration; " +
        "a beat with `speaker` is that character's spoken line, written without quote marks, and is spoken in their own voice. " +
        "Give `gender` (female or male) the first time an NPC speaks. " +
        `Voice cues inside any text: ${VOICE_CUES}. ` +
        "Give a beat `motions` when a being on the map visibly moves in it: [{id, action, target?}]; " +
        `id and target are sprite ids or names; actions: ${MOTION_HELP}. The board plays them as the beat is spoken.`,
        {
          beats: z.array(z.object({
            text: z.string(), speaker: z.string().optional(), gender: z.string().optional(),
            motions: z.array(z.object({ id: z.string(), action: z.string(), target: z.string().optional() })).optional(),
          })).optional(),
          text: z.string().optional(),
        },
        async (args) => {
          const beats = readBeats(args);
          if (beats.length === 0) return textResult("REJECTED: send beats (or text) with something to say.");
          const words = beats.reduce((count, beat) => count + beat.text.split(/\s+/).filter(Boolean).length, 0);
          if (words > MAX_NARRATION_WORDS) {
            console.error(`narrate REJECTED: ${words} words`);
            return textResult(
              `REJECTED (not shown): ${words} words. The limit is ${MAX_NARRATION_WORDS}; aim for ${TARGET_NARRATION_WORDS}. ` +
              "Keep the one most important moment and the choices, cut the rest, and send it again.");
          }
          const skipped = host.narrate(beats);
          // Echo what the map shows, so the narrator draws anything it just described.
          const map = host.world.maps[host.world.currentMap];
          const visible = map ? map.sprites.map((s) => s.id).join(", ") : "NOTHING";
          return textResult(
            `shown. Map "${host.world.currentMap}" currently shows ${visible}. ` +
            "If your narration mentioned any visible being not in that list, add its sprite NOW (spawn_monster first if it can fight)." +
            (skipped.length ? ` Motions skipped: ${skipped.join("; ")}.` : ""),
          );
        }),
      // The schema stays loose on purpose: sceneOps.ts translates and validates.
      // A strict schema made haiku fail with errors it could not read.
      tool("scene_ops", "Apply scene ops to the world. Batch MANY ops per call. All-or-nothing: on error nothing is applied; read the REJECTED message, fix, retry.",
        { ops: z.array(z.any()) },
        async ({ ops }) => {
          try {
            host.applySceneOps(ops);
            return textResult("applied");
          } catch (error) {
            const reason = (error as Error).message;
            console.error(`scene_ops REJECTED: ${reason}\nops: ${JSON.stringify(ops)}`);
            return textResult(`REJECTED (nothing applied): ${reason}. Fix that op and resend the whole batch.`);
          }
        }),
      tool("skill_check",
        "Roll an SRD skill check for a character; trained skills add their ranks. The skill sets the ability; " +
        "give `ability` only to override it. For a plain ability check (break a door), give `ability` and no skill.",
        {
          characterId: z.string(),
          skill: z.enum(Object.keys(SKILLS) as [Skill, ...Skill[]]).optional(),
          ability: z.enum(["str", "dex", "con", "int", "wis", "cha"]).optional(),
          dc: z.number().int(),
        },
        async (args) => logCheck(skillCheck(rng, getCharacter(args.characterId), args.skill, args.ability, args.dc), args.dc)),
      tool("saving_throw", "Roll a saving throw for a character.",
        { characterId: z.string(), save: z.enum(["fort", "ref", "will"]), dc: z.number().int() },
        async (args) => logCheck(savingThrow(rng, getCharacter(args.characterId), args.save, args.dc), args.dc)),
      tool("attack", "Resolve one attack. Handles to-hit, crits, damage and hp.",
        { attackerId: z.string(), targetId: z.string() },
        async (args) => {
          const attacker = getCharacter(args.attackerId);
          const result = attack(rng, attacker, getCharacter(args.targetId));
          const reply = logRoll(result.log);
          const { hit, crit, damage } = result;
          // An attacker who cannot act made no attack, so the board shows nothing.
          if (canAct(attacker)) host.effect({ kind: "attack", attacker: args.attackerId, target: args.targetId, hit, crit, damage, ranged: Boolean(WEAPONS[attacker.weapon].ranged) });
          return reply;
        }),
      tool("cast_spell", "Cast a spell using one spell slot.",
        { casterId: z.string(), spell: z.enum(SPELLS), targetId: z.string() },
        async (args) => {
          const result = castSpell(rng, getCharacter(args.casterId), args.spell, getCharacter(args.targetId));
          const reply = logRoll(result.log);
          host.effect({ kind: "spell", spell: args.spell, caster: args.casterId, target: args.targetId, success: result.success, amount: result.amount, missiles: result.missiles ?? 0 });
          return reply;
        }),
      tool("roll_initiative", "Roll initiative. Returns the turn order.",
        { characterIds: z.array(z.string()) },
        async (args) => {
          const result = rollInitiative(rng, args.characterIds.map(getCharacter));
          host.log(`Initiative: ${result.log}`, "dice");
          return textResult(result.order.join(","));
        }),
      tool("damage_or_heal", "Apply damage without an attack roll (traps, falls) or healing. Positive amount = damage.",
        { characterId: z.string(), amount: z.number().int(), reason: z.string() },
        async (args) => {
          const character = getCharacter(args.characterId);
          if (args.amount >= 0) applyDamage(character, args.amount);
          else heal(character, -args.amount);
          const verb = args.amount >= 0 ? "takes" : "recovers";
          const reply = logRoll(`${character.name} ${verb} ${Math.abs(args.amount)} (${args.reason}): ${character.hp}/${character.maxHp} ${lifeState(character)}`);
          host.effect({ kind: args.amount >= 0 ? "damage" : "heal", target: args.characterId, amount: Math.abs(args.amount) });
          return reply;
        }),
      tool("rest", "A full night's rest (8 hours) in a safe place: restores spell slots and heals 1 hp per level.",
        { characterIds: z.array(z.string()) },
        async (args) => {
          const reply = logRoll(args.characterIds.map((id) => rest(getCharacter(id))).join("; "));
          host.effect({ kind: "rest", ids: args.characterIds });
          return reply;
        }),
      tool("set_pronunciation",
        "Teach the voice how to say an invented name. sayAs is a plain English respelling, not IPA. Example: word Hrothgar, sayAs Roth-gar.",
        { word: z.string(), sayAs: z.string() },
        async ({ word, sayAs }) => {
          if (!word.trim() || !sayAs.trim()) return textResult("REJECTED: word and sayAs must not be empty.");
          host.setPronunciation(word.trim(), sayAs.trim());
          return textResult(`The voice now says "${word.trim()}" as "${sayAs.trim()}".`);
        }),
      tool("set_objective", "Set or update the party's current quest, shown in the UI. One sentence.",
        { text: z.string() },
        async ({ text }) => {
          host.setObjective(text);
          return textResult("set");
        }),
      tool("spawn_monster", "Create a monster so it can fight. Then add_sprite it via scene_ops with the returned sprite key.",
        { id: z.string(), name: z.string(), kind: z.enum(Object.keys(MONSTERS) as [string, ...string[]]) },
        async (args) => {
          if (characters[args.id]) return textResult(`REJECTED: id "${args.id}" already exists`);
          const monster = spawnMonster(rng, args.id, args.name, args.kind);
          characters[args.id] = monster;
          return textResult(`spawned: ${describeCharacter(monster)} sprite:${monster.sprite}`);
        }),
      tool("get_state", "Current character sheets and the live map (tiles, props, sprites).",
        {},
        async () => {
          const map = host.world.maps[host.world.currentMap];
          return textResult(JSON.stringify({ characters: Object.values(characters).map(describeCharacter), map }, null, 1));
        }),
    ],
  });
}

function buildSystemPrompt(characters: Record<string, Character>, playerId: string): string {
  const player = characters[playerId];
  const injected = [
    `tiles: ${Object.keys(catalog.tiles).join(", ")}`,
    `props: ${Object.keys(catalog.props).join(", ")}`,
    `sprites: ${Object.keys(catalog.sprites).join(", ")}`,
    "",
    `The human player controls ${player.name} (id:${playerId}).`,
    `Party:\n${Object.values(characters).map(describeCharacter).join("\n")}`,
    "",
    `End every turn with narrate() describing what ${player.name} can do or see next.`,
    "Your final text reply is not shown to anyone; all player-visible output goes through narrate().",
  ].join("\n");
  return readFileSync(PROMPT_FILE, "utf8")
    .replace("{{VOICE_CUES}}", VOICE_CUES)
    .replace("{{MOTIONS}}", MOTION_HELP)
    .replace("{{CATALOG_AND_PARTY}}", injected);
}

export function createNarrator(host: NarratorHost, characters: Record<string, Character>, rng: Rng, playerId: string) {
  const toolServer = createToolServer(host, characters, rng);
  const systemPrompt = buildSystemPrompt(characters, playerId);
  const session: AgentSession = {};
  let model: AgentModel = NARRATOR_DEFAULT_MODEL;

  return {
    setModel(newModel: AgentModel) { model = newModel; },

    async takeTurn(prompt: string): Promise<void> {
      let announcedWorldBuilding = false;
      try {
        await runAgentTurn({
          prompt, systemPrompt, model, session, effort: NARRATOR_EFFORT,
          toolServer, maxToolTurns: MAX_TOOL_TURNS, timeoutMs: TURN_TIMEOUT_MS,
          onMessage(message) {
            if (message.type === "assistant" && !announcedWorldBuilding) {
              const buildsScene = message.message.content.some((block) => block.type === "tool_use" && block.name.endsWith("scene_ops"));
              if (buildsScene) {
                host.log("~ the narrator shapes the world...", "system");
                announcedWorldBuilding = true;
              }
            }
            if (message.type === "result" && message.subtype !== "success") {
              console.error("narrator result:", message.subtype, JSON.stringify(message).slice(0, 500));
              host.log(`narrator error: ${message.subtype}`, "system");
            }
          },
        });
      } catch (error) {
        // A timeout is not fatal: the caller may still send a corrective turn.
        if (!(error instanceof TurnTimeoutError)) throw error;
        console.error(`narrator: ${error.message}`);
        host.log("The narrator timed out. Try your action again.", "system");
      }
    },
  };
}
