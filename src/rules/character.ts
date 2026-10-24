// SRD 3.5 character model: classes, weapons, armor and derived stats.
import { type Rng, roll } from "./dice.ts";

export type Ability = "str" | "dex" | "con" | "int" | "wis" | "cha";
export type Abilities = Record<Ability, number>;
export type Save = "fort" | "ref" | "will";

export const abilityModifier = (score: number) => Math.floor((score - 10) / 2);

export type CharacterClass =
  | "fighter" | "barbarian" | "paladin" | "monk"
  | "rogue" | "ranger" | "bard"
  | "wizard" | "sorcerer"
  | "cleric" | "druid";

// SRD skills with their key ability. "knowledge" stands for every knowledge field.
export const SKILLS = {
  appraise: "int", balance: "dex", bluff: "cha", climb: "str", concentration: "con", craft: "int",
  "decipher script": "int", diplomacy: "cha", "disable device": "int", disguise: "cha",
  "escape artist": "dex", forgery: "int", "gather information": "cha", "handle animal": "cha",
  heal: "wis", hide: "dex", intimidate: "cha", jump: "str", knowledge: "int", listen: "wis",
  "move silently": "dex", "open lock": "dex", perform: "cha", profession: "wis", ride: "dex",
  search: "int", "sense motive": "wis", "sleight of hand": "dex", spellcraft: "int", spot: "wis",
  survival: "wis", swim: "str", tumble: "dex", "use magic device": "cha", "use rope": "dex",
} as const satisfies Record<string, Ability>;
export type Skill = keyof typeof SKILLS;

export const SPELLS = ["magic missile", "cure light wounds"] as const;
export type Spell = (typeof SPELLS)[number];

type ClassRules = {
  hitDie: number;
  baseAttackBonus: (level: number) => number;
  goodSaves: Save[];
  spellcasting?: { ability: Ability; spells: readonly Spell[] };
};

const fullProgression = (level: number) => level;
const threeQuarterProgression = (level: number) => Math.floor((level * 3) / 4);
const halfProgression = (level: number) => Math.floor(level / 2);

const CLASS_RULES: Record<CharacterClass, ClassRules> = {
  fighter: { hitDie: 10, baseAttackBonus: fullProgression, goodSaves: ["fort"] },
  barbarian: { hitDie: 12, baseAttackBonus: fullProgression, goodSaves: ["fort"] },
  paladin: { hitDie: 10, baseAttackBonus: fullProgression, goodSaves: ["fort"] },
  monk: { hitDie: 8, baseAttackBonus: threeQuarterProgression, goodSaves: ["fort", "ref", "will"] },
  rogue: { hitDie: 6, baseAttackBonus: threeQuarterProgression, goodSaves: ["ref"] },
  ranger: { hitDie: 8, baseAttackBonus: fullProgression, goodSaves: ["fort", "ref"] },
  bard: { hitDie: 6, baseAttackBonus: threeQuarterProgression, goodSaves: ["ref", "will"], spellcasting: { ability: "cha", spells: ["cure light wounds"] } },
  wizard: { hitDie: 4, baseAttackBonus: halfProgression, goodSaves: ["will"], spellcasting: { ability: "int", spells: ["magic missile"] } },
  sorcerer: { hitDie: 4, baseAttackBonus: halfProgression, goodSaves: ["will"], spellcasting: { ability: "cha", spells: ["magic missile"] } },
  cleric: { hitDie: 8, baseAttackBonus: threeQuarterProgression, goodSaves: ["fort", "will"], spellcasting: { ability: "wis", spells: ["cure light wounds"] } },
  druid: { hitDie: 8, baseAttackBonus: threeQuarterProgression, goodSaves: ["fort", "will"], spellcasting: { ability: "wis", spells: ["cure light wounds"] } },
};

export type Weapon = {
  name: string;
  damage: string; // dice expression without the ability modifier, for example "1d8"
  critRangeStart: number; // 19 means a threat on 19-20
  critMultiplier: number;
  ranged?: boolean;
  twoHanded?: boolean; // SRD: adds 1.5 times the strength bonus to damage
};

export const WEAPONS: Record<string, Weapon> = {
  longsword: { name: "longsword", damage: "1d8", critRangeStart: 19, critMultiplier: 2 },
  shortsword: { name: "shortsword", damage: "1d6", critRangeStart: 19, critMultiplier: 2 },
  dagger: { name: "dagger", damage: "1d4", critRangeStart: 19, critMultiplier: 2 },
  mace: { name: "mace", damage: "1d8", critRangeStart: 20, critMultiplier: 2 },
  quarterstaff: { name: "quarterstaff", damage: "1d6", critRangeStart: 20, critMultiplier: 2, twoHanded: true },
  greataxe: { name: "greataxe", damage: "1d12", critRangeStart: 20, critMultiplier: 3, twoHanded: true },
  scimitar: { name: "scimitar", damage: "1d6", critRangeStart: 18, critMultiplier: 2 },
  longbow: { name: "longbow", damage: "1d8", critRangeStart: 20, critMultiplier: 3, ranged: true },
  unarmed: { name: "unarmed strike", damage: "1d6", critRangeStart: 20, critMultiplier: 2 },
  claw: { name: "claw", damage: "1d4", critRangeStart: 20, critMultiplier: 2 },
};

type Armor = { armorBonus: number; maxDexBonus: number };

const ARMORS: Record<string, Armor> = {
  none: { armorBonus: 0, maxDexBonus: 99 },
  leather: { armorBonus: 2, maxDexBonus: 6 },
  scalemail: { armorBonus: 4, maxDexBonus: 3 },
  chainmail: { armorBonus: 5, maxDexBonus: 2 },
};

const SHIELD_BONUS = 2;

export type Character = {
  id: string;
  name: string;
  characterClass: CharacterClass;
  level: number;
  abilities: Abilities;
  maxHp: number;
  hp: number;
  armor: string;
  shield: boolean;
  weapon: string;
  skillRanks: Partial<Record<Skill, number>>;
  spellSlots: number; // level-1 slots left today
  sprite: string; // sprite key in public/catalog.json
};

export type CharacterSpec = Pick<
  Character, "id" | "name" | "characterClass" | "abilities" | "armor" | "shield" | "weapon" | "sprite"
> & { level?: number; skillRanks?: Character["skillRanks"] };

const baseAttackBonus = (c: Character) => CLASS_RULES[c.characterClass].baseAttackBonus(c.level);

export function saveBonus(c: Character, save: Save): number {
  const isGood = CLASS_RULES[c.characterClass].goodSaves.includes(save);
  const base = isGood ? 2 + Math.floor(c.level / 2) : Math.floor(c.level / 3);
  const ability: Ability = save === "fort" ? "con" : save === "ref" ? "dex" : "wis";
  return base + abilityModifier(c.abilities[ability]);
}

export function armorClass(c: Character): number {
  const armor = ARMORS[c.armor];
  const dexBonus = Math.min(abilityModifier(c.abilities.dex), armor.maxDexBonus);
  // SRD monk: wisdom adds to AC when unarmored
  const monkBonus = c.characterClass === "monk" && c.armor === "none" ? Math.max(0, abilityModifier(c.abilities.wis)) : 0;
  return 10 + armor.armorBonus + (c.shield ? SHIELD_BONUS : 0) + dexBonus + monkBonus;
}

export function attackBonus(c: Character): number {
  const weapon = WEAPONS[c.weapon];
  return baseAttackBonus(c) + abilityModifier(c.abilities[weapon.ranged ? "dex" : "str"]);
}

export const canCast = (c: Character, spell: Spell) => CLASS_RULES[c.characterClass].spellcasting?.spells.includes(spell) ?? false;

// Simplified: 1 slot, plus 1 when the spell ability modifier is positive. Enough for level 1.
export function spellSlotsPerDay(c: Pick<Character, "characterClass" | "abilities">): number {
  const spellcasting = CLASS_RULES[c.characterClass].spellcasting;
  if (!spellcasting) return 0;
  return abilityModifier(c.abilities[spellcasting.ability]) >= 1 ? 2 : 1;
}

export function makeCharacter(rng: Rng, spec: CharacterSpec): Character {
  const level = spec.level ?? 1;
  const { hitDie } = CLASS_RULES[spec.characterClass];
  const conModifier = abilityModifier(spec.abilities.con);
  // Level 1 gets the full hit die; later levels roll. At least 1 hp per level.
  let maxHp = hitDie + conModifier;
  for (let l = 2; l <= level; l++) maxHp += Math.max(1, roll(rng, 1, hitDie)[0] + conModifier);
  maxHp = Math.max(1, maxHp);
  return {
    ...spec,
    abilities: { ...spec.abilities },
    level,
    maxHp,
    hp: maxHp,
    skillRanks: { ...spec.skillRanks },
    spellSlots: spellSlotsPerDay(spec),
  };
}

export type LifeState = "up" | "disabled" | "dying" | "dead";

export function lifeState(c: Character): LifeState {
  if (c.hp <= -10) return "dead";
  if (c.hp < 0) return "dying";
  if (c.hp === 0) return "disabled";
  return "up";
}

// SRD: a dying or dead character takes no actions. A disabled one still can.
export const canAct = (c: Character) => c.hp >= 0;
