// Monster stat blocks, approximated with SRD class levels instead of the exact
// Monster Manual entries. Close enough for level-1 play.
import type { Rng } from "./dice.ts";
import { type Character, type CharacterSpec, makeCharacter } from "./character.ts";

type MonsterTemplate = Omit<CharacterSpec, "id" | "name">;

const monster = (
  characterClass: CharacterSpec["characterClass"], level: number,
  [str, dex, con, int, wis, cha]: number[],
  armor: string, shield: boolean, weapon: string, sprite: string,
): MonsterTemplate => ({
  characterClass, level, abilities: { str, dex, con, int, wis, cha }, armor, shield, weapon, sprite,
});

export const MONSTERS: Record<string, MonsterTemplate> = {
  goblin: monster("rogue", 1, [11, 13, 12, 10, 9, 6], "leather", false, "shortsword", "goblin"),
  kobold: monster("rogue", 1, [9, 13, 10, 10, 9, 8], "leather", false, "dagger", "kobold"),
  orc: monster("fighter", 1, [15, 11, 12, 8, 8, 8], "scalemail", false, "longsword", "orc"),
  orc_warrior: monster("fighter", 2, [15, 11, 12, 8, 8, 8], "scalemail", true, "longsword", "orc_warrior"),
  gnoll: monster("fighter", 2, [15, 10, 13, 8, 11, 8], "leather", true, "mace", "gnoll"),
  hobgoblin: monster("fighter", 1, [13, 13, 14, 10, 10, 9], "leather", true, "longsword", "hobgoblin"),
  skeleton: monster("fighter", 1, [13, 13, 10, 10, 10, 1], "none", false, "claw", "skeleton"),
  wolf: monster("fighter", 2, [13, 15, 15, 2, 12, 6], "none", false, "claw", "wolf"),
  rat: monster("rogue", 1, [4, 15, 10, 2, 12, 4], "none", false, "claw", "rat"),
  spider: monster("rogue", 1, [7, 17, 10, 1, 10, 2], "none", false, "claw", "spider"),
  ogre: monster("fighter", 4, [21, 8, 15, 6, 10, 7], "leather", false, "mace", "ogre"),
  troll: monster("fighter", 6, [23, 14, 23, 6, 9, 6], "none", false, "claw", "troll"),
  necromancer: monster("wizard", 3, [9, 12, 12, 15, 12, 10], "none", false, "quarterstaff", "necromancer"),
  imp: monster("rogue", 2, [6, 17, 10, 10, 12, 14], "none", false, "claw", "imp"),
  demon: monster("fighter", 4, [17, 15, 15, 8, 10, 10], "none", false, "claw", "demon"),
  balrug: monster("fighter", 8, [25, 12, 20, 12, 12, 14], "none", false, "mace", "balrug"),
  wraith: monster("rogue", 4, [14, 16, 10, 11, 13, 15], "none", false, "claw", "wraith"),
  lich: monster("wizard", 8, [11, 14, 10, 18, 14, 14], "none", false, "quarterstaff", "lich"),
};

export function spawnMonster(rng: Rng, id: string, name: string, kind: string): Character {
  const template = MONSTERS[kind];
  if (!template) throw new Error(`unknown monster kind "${kind}". Valid: ${Object.keys(MONSTERS).join(", ")}`);
  return makeCharacter(rng, { id, name, ...template, abilities: { ...template.abilities } });
}
