// One-time asset curation: copies the chosen Dungeon Crawl Stone Soup tiles
// (CC0, 32x32) into public/tiles and writes public/catalog.json.
// Source: https://opengameart.org/sites/default/files/crawl-tiles%20Oct-5-2010.zip
// Usage: node scripts/curate-tiles.ts <path to the extracted crawl-tiles folder>
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const sourceRoot = process.argv[2];
if (!sourceRoot || !existsSync(sourceRoot)) throw new Error("Pass the extracted crawl-tiles folder as the first argument.");

const publicDir = join(import.meta.dirname, "..", "public");
const tilesDir = join(publicDir, "tiles");

// Catalog key -> candidate source files. The first file that exists wins.
const TILES: Record<string, { sources: string[]; walkable: boolean }> = {
  "floor.stone": { sources: ["dc-dngn/floor/pebble_brown0.png"], walkable: true },
  "floor.dirt": { sources: ["dc-dngn/floor/dirt0.png"], walkable: true },
  "floor.grass": { sources: ["dc-dngn/floor/grass/grass0.png"], walkable: true },
  "floor.marble": { sources: ["dc-dngn/floor/marble_floor1.png"], walkable: true },
  "floor.sand": { sources: ["dc-dngn/floor/sandstone_floor0.png", "dc-dngn/floor/sand1.png"], walkable: true },
  "floor.wood": { sources: ["dc-dngn/floor/rect_gray0.png", "dc-dngn/floor/grey_dirt0.png"], walkable: true },
  "water.shallow": { sources: ["dc-dngn/water/dngn_shallow_water.png"], walkable: true },
  "water.deep": { sources: ["dc-dngn/water/dngn_deep_water.png", "dc-dngn/water/deep_water.png"], walkable: false },
  "wall.brick": { sources: ["dc-dngn/wall/brick_brown0.png"], walkable: false },
  "wall.stone": { sources: ["dc-dngn/wall/stone_brick1.png", "dc-dngn/wall/stone2_brown0.png"], walkable: false },
  "wall.dark": { sources: ["dc-dngn/wall/brick_dark0.png"], walkable: false },
  "wall.crystal": { sources: ["dc-dngn/wall/crystal_wall00.png", "dc-dngn/wall/crystal_wall0.png"], walkable: false },
  tree: { sources: ["dc-dngn/wall/tree1_green.png", "dc-dngn/wall/tree1_yellow.png"], walkable: false },
  "floor.cobble": { sources: ["dc-dngn/floor/grey_dirt0.png"], walkable: true },
  "floor.swamp": { sources: ["dc-dngn/floor/bog_green0.png"], walkable: true },
  "floor.crystal": { sources: ["dc-dngn/floor/crystal_floor0.png"], walkable: true },
};

const PROPS: Record<string, string[]> = {
  "door.closed": ["dc-dngn/dngn_closed_door.png"],
  "door.open": ["dc-dngn/dngn_open_door.png"],
  "stairs.down": ["dc-dngn/gateways/stone_stairs_down.png"],
  "stairs.up": ["dc-dngn/gateways/stone_stairs_up.png"],
  torch: ["dc-dngn/wall/torches/torch0.png"],
  fountain: ["dc-dngn/dngn_blue_fountain.png"],
  statue: ["dc-dngn/dngn_granite_statue.png"],
  altar: ["dc-dngn/altars/dngn_altar_zin.png"],
  column: ["dc-dngn/crumbled_column.png"],
  corpse: ["dc-misc/blood_red.png"],
};

const SPRITES: Record<string, string[]> = {
  // playable classes
  fighter: ["dc-mon/dwarf.png"],
  wizard: ["dc-mon/wizard.png"],
  rogue: ["dc-mon/halfling.png"],
  cleric: ["dc-mon/deep_elf_priest.png", "dc-mon/orc_priest.png", "dc-mon/human.png"],
  human: ["dc-mon/human.png"],
  elf: ["dc-mon/elf.png"],
  barbarian: ["dc-mon/unique/grum.png", "dc-mon/minotaur.png"],
  ranger: ["dc-mon/deep_elf_master_archer.png", "dc-mon/centaur.png"],
  paladin: ["dc-mon/holy/paladin.png", "dc-mon/deep_elf_knight.png"],
  monk: ["dc-mon/unique/norris.png", "dc-mon/human.png"],
  bard: ["dc-mon/unique/rupert.png", "dc-mon/spriggan/spriggan.png"],
  sorcerer: ["dc-mon/deep_elf_sorcerer.png", "dc-mon/deep_elf_mage.png"],
  druid: ["dc-mon/spriggan/spriggan_druid.png"],
  // monsters
  goblin: ["dc-mon/goblin.png"],
  hobgoblin: ["dc-mon/hobgoblin.png"],
  kobold: ["dc-mon/kobold.png"],
  orc: ["dc-mon/orc.png"],
  orc_warrior: ["dc-mon/orc_warrior.png"],
  gnoll: ["dc-mon/gnoll.png"],
  ogre: ["dc-mon/ogre.png"],
  troll: ["dc-mon/troll.png"],
  necromancer: ["dc-mon/necromancer.png"],
  wolf: ["dc-mon/animals/wolf.png", "dc-mon/animals/war_dog.png", "dc-mon/animals/hound.png"],
  rat: ["dc-mon/animals/grey_rat.png", "dc-mon/animals/rat.png"],
  bat: ["dc-mon/animals/giant_bat.png", "dc-mon/animals/bat.png"],
  snake: ["dc-mon/animals/snake.png", "dc-mon/animals/adder.png", "dc-mon/animals/anaconda.png"],
  spider: ["dc-mon/animals/wolf_spider.png", "dc-mon/animals/redback.png"],
  bear: ["dc-mon/animals/bear.png"],
  skeleton: ["dc-mon/undead/skeletons/skeleton_humanoid_small.png", "dc-mon/undead/skeletons/skeleton_small.png"],
  ghost: ["dc-mon/undead/ghost.png"],
  dragon: ["dc-mon/dragon.png"],
  hill_giant: ["dc-mon/hill_giant.png"],
  // demons and greater undead
  imp: ["dc-mon/demons/imp.png", "dc-mon/demons/blue_devil.png"],
  demon: ["dc-mon/demons/red_devil.png", "dc-mon/demons/hellion.png", "dc-mon/demons/fiend.png"],
  balrug: ["dc-mon/demons/balrug.png"],
  efreet: ["dc-mon/demons/efreet.png"],
  abomination: ["dc-mon/demons/abomination_small.png"],
  lich: ["dc-mon/undead/ancient_lich.png"],
  bone_dragon: ["dc-mon/undead/bone_dragon.png"],
  wraith: ["dc-mon/undead/freezing_wraith.png", "dc-mon/undead/ghost.png"],
  // generic NPCs, chosen by look from the DCSS unique monsters
  "npc.man": ["dc-mon/unique/edmund.png"],
  "npc.woman": ["dc-mon/unique/erica.png"],
  "npc.elder": ["dc-mon/unique/joseph.png"],
  "npc.guard": ["dc-mon/unique/harold.png"],
  "npc.merchant": ["dc-mon/unique/donald.png"],
  "npc.noblewoman": ["dc-mon/unique/josephine.png"],
  "npc.hermit": ["dc-mon/unique/crazy_yiuf.png"],
  "npc.witch": ["dc-mon/unique/kirke.png"],
};

const missing: string[] = [];

// Copies the first existing source and returns its public path.
function copyFirstExisting(key: string, sources: string[]): string | null {
  const source = sources.map((path) => join(sourceRoot, path)).find(existsSync);
  if (!source) {
    missing.push(`${key}: ${sources.join(", ")}`);
    return null;
  }
  const fileName = `${key.replace(/\./g, "_")}.png`;
  copyFileSync(source, join(tilesDir, fileName));
  return `tiles/${fileName}`;
}

mkdirSync(tilesDir, { recursive: true });

const catalog = {
  tileSize: 32,
  tiles: {} as Record<string, { file: string; walkable: boolean }>,
  props: {} as Record<string, { file: string }>,
  sprites: {} as Record<string, { file: string }>,
};
for (const [key, { sources, walkable }] of Object.entries(TILES)) {
  const file = copyFirstExisting(key, sources);
  if (file) catalog.tiles[key] = { file, walkable };
}
for (const [key, sources] of Object.entries(PROPS)) {
  const file = copyFirstExisting(key, sources);
  if (file) catalog.props[key] = { file };
}
for (const [key, sources] of Object.entries(SPRITES)) {
  const file = copyFirstExisting(key, sources);
  if (file) catalog.sprites[key] = { file };
}

writeFileSync(join(publicDir, "catalog.json"), JSON.stringify(catalog, null, 2));
const counts = Object.entries(catalog).filter(([, value]) => typeof value === "object").map(([name, value]) => `${name}: ${Object.keys(value).length}`);
console.log(counts.join(", "));
if (missing.length) console.log(`MISSING:\n${missing.join("\n")}`);
