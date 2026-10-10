// Playable classes and the pool of AI companions.
// A party always covers four roles. The player's role has no AI companion; every
// other role gets one companion, drawn at random from the pool for each adventure.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Rng, pickRandom } from "./rules/dice.ts";
import { type Abilities, type Character, type CharacterClass, makeCharacter } from "./rules/character.ts";
import type { Voice } from "./tts.ts";

const PERSONAS_DIR = join(import.meta.dirname, "..", "personas");

export const PLAYER_ID = "hero";
const PLAYER_VOICE: Voice = "am_onyx";

type PartyRole = "martial" | "skirmish" | "arcane" | "divine";

type ClassBuild = {
  label: string;
  role: PartyRole;
  abilities: Abilities;
  armor: string;
  shield: boolean;
  weapon: string;
  sprite: string;
  summary: string; // shown in character creation
  powers: string; // short line on the seat card
};

const abilities = ([str, dex, con, int, wis, cha]: number[]): Abilities => ({ str, dex, con, int, wis, cha });

export const CLASS_BUILDS: Record<CharacterClass, ClassBuild> = {
  fighter: {
    label: "Fighter", role: "martial", abilities: abilities([16, 14, 14, 10, 12, 8]),
    armor: "chainmail", shield: true, weapon: "longsword", sprite: "fighter",
    summary: "Front line tank. Longsword 1d8 (crit 19-20), heavy shield, chainmail. AC 19, 12 hp. Best attack bonus.",
    powers: "front line · longsword 1d8 (crit 19-20) · heavy shield",
  },
  barbarian: {
    label: "Barbarian", role: "martial", abilities: abilities([17, 13, 16, 8, 10, 8]),
    armor: "leather", shield: false, weapon: "greataxe", sprite: "barbarian",
    summary: "Raging brute. Greataxe 1d12 (crit x3), 15 hp, the hardest hitter. Light armor, no fear.",
    powers: "rage & fury · greataxe 1d12 (crit x3) · toughest hp",
  },
  paladin: {
    label: "Paladin", role: "martial", abilities: abilities([15, 10, 13, 8, 10, 14]),
    armor: "chainmail", shield: true, weapon: "longsword", sprite: "paladin",
    summary: "Holy knight. Longsword 1d8, shield and chainmail, AC 17. Strong presence, unshakable against evil.",
    powers: "holy front line · longsword 1d8 · shield",
  },
  monk: {
    label: "Monk", role: "martial", abilities: abilities([13, 15, 12, 10, 15, 8]),
    armor: "none", shield: false, weapon: "unarmed", sprite: "monk",
    summary: "Unarmed 1d6 strikes, wisdom-guided dodge (AC without armor), the best saving throws in the game.",
    powers: "unarmed 1d6 · wisdom dodge AC · best saves",
  },
  rogue: {
    label: "Rogue", role: "skirmish", abilities: abilities([10, 17, 12, 13, 10, 14]),
    armor: "leather", shield: false, weapon: "shortsword", sprite: "rogue",
    summary: "Stealth, scouting, locks and traps. Shortsword 1d6 (crit 19-20), leather armor. High dexterity and reflexes.",
    powers: "stealth & scouting · shortsword 1d6 (crit 19-20)",
  },
  ranger: {
    label: "Ranger", role: "skirmish", abilities: abilities([14, 16, 12, 10, 13, 8]),
    armor: "leather", shield: false, weapon: "longbow", sprite: "ranger",
    summary: "Tracker and archer. Longbow 1d8 (crit x3) from range, good in the wilds, solid in melee too.",
    powers: "tracking & archery · longbow 1d8 (crit x3)",
  },
  bard: {
    label: "Bard", role: "skirmish", abilities: abilities([10, 14, 12, 13, 8, 16]),
    armor: "leather", shield: false, weapon: "shortsword", sprite: "bard",
    summary: "Talker, lorekeeper, charmer. Shortsword 1d6, spell slots, the best face for negotiations.",
    powers: "song, lore & charm · shortsword 1d6",
  },
  wizard: {
    label: "Wizard", role: "arcane", abilities: abilities([8, 14, 12, 16, 10, 10]),
    armor: "none", shield: false, weapon: "quarterstaff", sprite: "wizard",
    summary: "Magic missile: auto-hit 1d4+1, no roll needed. 2 spell slots per day. Fragile (5 hp) but decisive.",
    powers: "magic missile (auto-hit 1d4+1)",
  },
  sorcerer: {
    label: "Sorcerer", role: "arcane", abilities: abilities([8, 14, 14, 10, 10, 16]),
    armor: "none", shield: false, weapon: "dagger", sprite: "sorcerer",
    summary: "Innate caster. Magic missile 1d4+1 auto-hit, tougher than a wizard, charisma to burn.",
    powers: "magic missile (auto-hit 1d4+1) · innate magic",
  },
  cleric: {
    label: "Cleric", role: "divine", abilities: abilities([12, 10, 14, 10, 16, 12]),
    armor: "scalemail", shield: true, weapon: "mace", sprite: "cleric",
    summary: "Cure light wounds 1d8+1 (2 slots). Mace 1d8, scale mail and shield. The party lives longer with you.",
    powers: "cure light wounds (1d8+1) · mace 1d8",
  },
  druid: {
    label: "Druid", role: "divine", abilities: abilities([12, 12, 14, 10, 16, 10]),
    armor: "leather", shield: false, weapon: "scimitar", sprite: "druid",
    summary: "Nature's voice. Cure light wounds, scimitar 1d6, at home in every wilderness.",
    powers: "cure light wounds (1d8+1) · scimitar 1d6",
  },
};

export const isCharacterClass = (value: unknown): value is CharacterClass =>
  typeof value === "string" && value in CLASS_BUILDS;

// Every companion id has a persona file at personas/<id>.md.
type CompanionTemplate = { id: string; name: string; characterClass: CharacterClass; voice: Voice };

const COMPANION_POOL: Record<PartyRole, CompanionTemplate[]> = {
  martial: [
    { id: "thorin", name: "Thorin", characterClass: "fighter", voice: "am_onyx" },
    { id: "serka", name: "Serka", characterClass: "barbarian", voice: "am_fenrir" },
    { id: "aldwin", name: "Aldwin", characterClass: "paladin", voice: "bm_george" },
    { id: "kestrel", name: "Kestrel", characterClass: "monk", voice: "am_echo" },
  ],
  skirmish: [
    { id: "pip", name: "Pip", characterClass: "rogue", voice: "am_puck" },
    { id: "wren", name: "Wren", characterClass: "ranger", voice: "bf_lily" },
    { id: "lorenzo", name: "Lorenzo", characterClass: "bard", voice: "bm_lewis" },
  ],
  arcane: [
    { id: "mira", name: "Mira", characterClass: "wizard", voice: "bf_emma" },
    { id: "vesper", name: "Vesper", characterClass: "wizard", voice: "bf_alice" },
    { id: "zephyrine", name: "Zephyrine", characterClass: "sorcerer", voice: "af_nova" },
  ],
  divine: [
    { id: "brenna", name: "Brenna", characterClass: "cleric", voice: "af_sarah" },
    { id: "thistle", name: "Thistle", characterClass: "druid", voice: "af_river" },
  ],
};

export type PartyMember = { character: Character; voice: Voice };
export type Companion = PartyMember & { persona: string };

function buildCharacter(rng: Rng, id: string, name: string, characterClass: CharacterClass): Character {
  const build = CLASS_BUILDS[characterClass];
  return makeCharacter(rng, {
    id, name, characterClass,
    abilities: { ...build.abilities }, armor: build.armor, shield: build.shield, weapon: build.weapon, sprite: build.sprite,
  });
}

export function createParty(rng: Rng, playerName: string, playerClass: CharacterClass): { player: PartyMember; companions: Companion[] } {
  const player = { character: buildCharacter(rng, PLAYER_ID, playerName, playerClass), voice: PLAYER_VOICE };
  const playerRole = CLASS_BUILDS[playerClass].role;
  const companions = Object.entries(COMPANION_POOL)
    .filter(([role]) => role !== playerRole)
    .map(([, templates]) => {
      const template = pickRandom(rng, templates);
      return {
        character: buildCharacter(rng, template.id, template.name, template.characterClass),
        voice: template.voice,
        persona: readFileSync(join(PERSONAS_DIR, `${template.id}.md`), "utf8"),
      };
    });
  return { player, companions };
}
