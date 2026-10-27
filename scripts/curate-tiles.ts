// One-time asset build: copies the chosen Dungeon Crawl Stone Soup tiles (CC0,
// 32x32) into public/tiles, draws the wood floor (the pack has none), and writes
// public/catalog.json.
// Source: https://opengameart.org/sites/default/files/crawl-tiles%20Oct-5-2010.zip
// Usage: node scripts/curate-tiles.ts <path to the extracted crawl-tiles folder>
// Then run scripts/detail-tiles.ts, which doubles every file to 64 pixels with more detail.
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import type { Catalog } from "../src/scene/world.ts";

const sourceRoot = process.argv[2];
if (!sourceRoot || !existsSync(sourceRoot)) throw new Error("Pass the extracted crawl-tiles folder as the first argument.");

const publicDir = join(import.meta.dirname, "..", "public");
const tilesDir = join(publicDir, "tiles");
const TILE_SIZE = 32;

// Every file in `folder` whose name matches `pattern`, in natural order.
function filesMatching(folder: string, pattern: RegExp): string[] {
  const names = readdirSync(join(sourceRoot, folder)).filter((name) => pattern.test(name));
  return names.sort((a, b) => a.localeCompare(b, "en", { numeric: true })).map((name) => `${folder}/${name}`);
}

// Tiles: several files are variants; the board picks one per cell.
const TILES: Record<string, { sources: string[] | "draw-wood"; walkable: boolean }> = {
  "floor.stone": { sources: filesMatching("dc-dngn/floor", /^pebble_brown\d+\.png$/), walkable: true },
  "floor.dirt": { sources: filesMatching("dc-dngn/floor", /^dirt\d+\.png$/), walkable: true },
  "floor.grass": { sources: filesMatching("dc-dngn/floor/grass", /^grass\d(-dirt-mix\d)?\.png$/), walkable: true },
  "floor.marble": { sources: filesMatching("dc-dngn/floor", /^marble_floor\d+\.png$/), walkable: true },
  "floor.sand": { sources: filesMatching("dc-dngn/floor", /^sandstone_floor\d+\.png$/), walkable: true },
  "floor.wood": { sources: "draw-wood", walkable: true },
  "floor.slate": { sources: filesMatching("dc-dngn/floor", /^rect_gray\d+\.png$/), walkable: true },
  "floor.cobble": { sources: filesMatching("dc-dngn/floor", /^grey_dirt\d+\.png$/), walkable: true },
  "floor.swamp": { sources: filesMatching("dc-dngn/floor", /^bog_green\d+\.png$/), walkable: true },
  "floor.crystal": { sources: filesMatching("dc-dngn/floor", /^crystal_floor\d+\.png$/), walkable: true },
  "water.shallow": { sources: filesMatching("dc-dngn/water", /^dngn_shallow_water\d?\.png$/), walkable: true },
  "water.deep": { sources: filesMatching("dc-dngn/water", /^dngn_deep_water\d?\.png$/), walkable: false },
  "wall.brick": { sources: filesMatching("dc-dngn/wall", /^brick_brown\d+\.png$/), walkable: false },
  "wall.stone": { sources: filesMatching("dc-dngn/wall", /^stone_brick\d+\.png$/), walkable: false },
  "wall.dark": { sources: filesMatching("dc-dngn/wall", /^brick_dark\d+\.png$/), walkable: false },
  "wall.crystal": { sources: filesMatching("dc-dngn/wall", /^crystal_wall\d+\.png$/), walkable: false },
  tree: { sources: filesMatching("dc-dngn/wall", /^tree\d_yellow\.png$/), walkable: false },
};

// Props: several files are animation frames, played in order and looped.
const PROPS: Record<string, string[]> = {
  "door.closed": ["dc-dngn/dngn_closed_door.png"],
  "door.open": ["dc-dngn/dngn_open_door.png"],
  "stairs.down": ["dc-dngn/gateways/stone_stairs_down.png"],
  "stairs.up": ["dc-dngn/gateways/stone_stairs_up.png"],
  torch: [1, 2, 3, 4].map((frame) => `dc-dngn/wall/torches/torch${frame}.png`), // torch0 is unlit
  fire: [0, 1, 2, 1].map((frame) => `effect/cloud_fire${frame}.png`),
  chest: ["UNUSED/other/chest2_closed.png"],
  "chest.open": ["UNUSED/other/chest2_open.png"],
  fountain: ["dc-dngn/dngn_blue_fountain.png"],
  statue: ["dc-dngn/dngn_granite_statue.png"],
  altar: ["dc-dngn/altars/dngn_altar_zin.png"],
  column: ["dc-dngn/crumbled_column.png"],
  corpse: ["dc-misc/blood_red.png"],
};

// Sprites: one file each; the first existing candidate wins.
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

// ---- the drawn wood floor ----------------------------------------------------

// Minimal PNG writer: 8-bit RGB, no filtering.
function encodePng(width: number, height: number, rgb: Uint8Array): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(typeAndData));
    return Buffer.concat([length, typeAndData, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // bit depth 8, colour type RGB
  const rows = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) rows.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Four rows of planks with grain, staggered end joints and dark seams, in the
// muted palette of the DCSS floors. Each variant uses its own seed.
function drawWoodFloor(variant: number): Buffer {
  let seed = 7919 * (variant + 1);
  const random = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const randomInt = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
  const SEAM = [43, 28, 17];
  const WOOD = [104, 71, 42];
  const PLANK_HEIGHT = 8;
  const pixels = new Uint8Array(TILE_SIZE * TILE_SIZE * 3);
  const put = (x: number, y: number, [r, g, b]: number[]) => pixels.set([r, g, b], (y * TILE_SIZE + x) * 3);
  const shade = ([r, g, b]: number[], amount: number) => [r, g, b].map((c) => Math.max(0, Math.min(255, Math.round(c + amount))));

  for (let row = 0; row < TILE_SIZE / PLANK_HEIGHT; row++) {
    const top = row * PLANK_HEIGHT;
    const seamRow = top + PLANK_HEIGHT - 1;
    const joint = (row * 13 + variant * 7 + randomInt(0, 5)) % TILE_SIZE;
    // Planks differ only a little, so no colour edge shows where tiles meet.
    const leftPlank = shade(WOOD, randomInt(-5, 5));
    const rightPlank = shade(WOOD, randomInt(-5, 5));
    for (let y = top; y <= seamRow; y++) {
      for (let x = 0; x < TILE_SIZE; x++) {
        const plank = x < joint ? leftPlank : rightPlank;
        let color = shade(plank, (random() - 0.5) * 8);
        if (y === top) color = shade(plank, 16); // lit top edge
        if (y === seamRow) color = SEAM; // gap between planks
        else if (x === joint) color = SEAM; // end joint
        else if (x === (joint + 1) % TILE_SIZE) color = shade(plank, 20);
        put(x, y, color);
      }
    }
    // Two irregular grain streaks per plank row.
    for (let streak = 0; streak < 2; streak++) {
      const y = top + randomInt(2, 5);
      const start = randomInt(0, TILE_SIZE - 1);
      for (let i = 0; i < randomInt(5, 13); i++) {
        const x = (start + i) % TILE_SIZE;
        if (x !== joint && x !== (joint + 1) % TILE_SIZE) put(x, y, shade(WOOD, -16 - randomInt(0, 4)));
      }
    }
    if (random() < 0.3) put(randomInt(2, 29), top + randomInt(2, 5), SEAM); // knot
  }
  return encodePng(TILE_SIZE, TILE_SIZE, pixels);
}

const WOOD_VARIANTS = 4;

// ---- build -------------------------------------------------------------------

const missing: string[] = [];
const outputName = (key: string, index: number) => `tiles/${key.replace(/\./g, "_")}_${index}.png`;

function copyAll(key: string, sources: string[]): string[] {
  const existing = sources.filter((source) => existsSync(join(sourceRoot, source)));
  if (existing.length === 0) missing.push(`${key}: ${sources.join(", ")}`);
  return existing.map((source, index) => {
    const file = outputName(key, index);
    copyFileSync(join(sourceRoot, source), join(publicDir, file));
    return file;
  });
}

rmSync(tilesDir, { recursive: true, force: true });
mkdirSync(tilesDir, { recursive: true });

const catalog: Catalog = { tileSize: TILE_SIZE, tiles: {}, props: {}, sprites: {} };

for (const [key, { sources, walkable }] of Object.entries(TILES)) {
  const files = sources === "draw-wood"
    ? Array.from({ length: WOOD_VARIANTS }, (_, variant) => {
      const file = outputName(key, variant);
      writeFileSync(join(publicDir, file), drawWoodFloor(variant));
      return file;
    })
    : copyAll(key, sources);
  if (files.length > 0) catalog.tiles[key] = { files, walkable };
}
for (const [key, sources] of Object.entries(PROPS)) {
  const files = copyAll(key, sources);
  if (files.length > 0) catalog.props[key] = { files };
}
for (const [key, candidates] of Object.entries(SPRITES)) {
  const source = candidates.find((candidate) => existsSync(join(sourceRoot, candidate)));
  if (!source) {
    missing.push(`${key}: ${candidates.join(", ")}`);
    continue;
  }
  const file = `tiles/${key.replace(/\./g, "_")}.png`;
  copyFileSync(join(sourceRoot, source), join(publicDir, file));
  catalog.sprites[key] = { file };
}

writeFileSync(join(publicDir, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);
const count = (group: Record<string, unknown>) => Object.keys(group).length;
console.log(`tiles: ${count(catalog.tiles)}, props: ${count(catalog.props)}, sprites: ${count(catalog.sprites)}`);
if (missing.length) console.log(`MISSING:\n${missing.join("\n")}`);
