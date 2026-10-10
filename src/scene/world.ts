// World state and the strict scene operations. Every operation is checked against
// the tile catalog; an invalid one throws with a message the narrator can act on.
// LLM output enters through sceneOps.ts, not through applyOp directly.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type Catalog = {
  tileSize: number;
  tiles: Record<string, { file: string; walkable: boolean }>;
  props: Record<string, { file: string }>;
  sprites: Record<string, { file: string }>;
};

export const catalog: Catalog = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "..", "public", "catalog.json"), "utf8"),
);

export type Lighting = "day" | "torch" | "dark";
export const LIGHTING_OPTIONS: readonly Lighting[] = ["day", "torch", "dark"];

export type Prop = { id: string; type: string; x: number; y: number };
export type Sprite = { id: string; key: string; x: number; y: number; name?: string };

export type MapState = {
  id: string;
  name: string;
  w: number;
  h: number;
  tiles: string[][]; // tiles[y][x] = tile key
  props: Prop[];
  sprites: Sprite[];
  lighting: Lighting;
};

export type World = { maps: Record<string, MapState>; currentMap: string };

type Position = { x: number; y: number };

export type Op =
  | { op: "create_map"; id: string; name: string; w: number; h: number; fill: string; lighting?: Lighting }
  | { op: "paint_rect"; map: string; x: number; y: number; w: number; h: number; tile: string }
  | { op: "set_tiles"; map: string; cells: (Position & { tile: string })[] }
  | { op: "add_prop"; map: string; id: string; type: string; x: number; y: number }
  | { op: "remove_prop"; map: string; id: string }
  | { op: "add_sprite"; map: string; id: string; key: string; x: number; y: number; name?: string }
  | { op: "remove_sprite"; id: string }
  | { op: "move_sprite"; id: string; x: number; y: number }
  | { op: "change_map"; map: string; positions: Record<string, Position> }
  | { op: "set_lighting"; map: string; lighting: Lighting };

export const MAX_MAP_WIDTH = 60;
export const MAX_MAP_HEIGHT = 40;

export const makeWorld = (): World => ({ maps: {}, currentMap: "" });

function getMap(world: World, mapId: string): MapState {
  const map = world.maps[mapId];
  if (!map) throw new Error(`unknown map "${mapId}". Maps: ${Object.keys(world.maps).join(", ") || "(none)"}`);
  return map;
}

function checkTile(tileKey: string) {
  if (!catalog.tiles[tileKey]) throw new Error(`unknown tile "${tileKey}". Valid: ${Object.keys(catalog.tiles).join(", ")}`);
}

function checkInBounds(map: MapState, x: number, y: number) {
  const inside = Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < map.w && y < map.h;
  if (!inside) throw new Error(`(${x},${y}) out of bounds for map "${map.id}" (${map.w}x${map.h})`);
}

function findSprite(world: World, spriteId: string): { map: MapState; sprite: Sprite } {
  for (const map of Object.values(world.maps)) {
    const sprite = map.sprites.find((s) => s.id === spriteId);
    if (sprite) return { map, sprite };
  }
  throw new Error(`unknown sprite id "${spriteId}"`);
}

export function applyOp(world: World, operation: Op): void {
  switch (operation.op) {
    case "create_map": {
      const { id, name, w, h, fill, lighting } = operation;
      if (!id) throw new Error("create_map requires an id");
      if (world.maps[id]) throw new Error(`map "${id}" already exists`);
      checkTile(fill);
      const validSize = Number.isInteger(w) && Number.isInteger(h) && w >= 3 && h >= 3 && w <= MAX_MAP_WIDTH && h <= MAX_MAP_HEIGHT;
      if (!validSize) throw new Error(`map size w/h must be integers in 3x3..${MAX_MAP_WIDTH}x${MAX_MAP_HEIGHT}`);
      world.maps[id] = {
        id, name, w, h,
        tiles: Array.from({ length: h }, () => Array(w).fill(fill)),
        props: [], sprites: [], lighting: lighting ?? "torch",
      };
      if (!world.currentMap) world.currentMap = id;
      return;
    }
    case "paint_rect": {
      const map = getMap(world, operation.map);
      const { x, y, w, h, tile } = operation;
      checkTile(tile);
      checkInBounds(map, x, y);
      checkInBounds(map, x + w - 1, y + h - 1);
      for (let row = y; row < y + h; row++) for (let col = x; col < x + w; col++) map.tiles[row][col] = tile;
      return;
    }
    case "set_tiles": {
      const map = getMap(world, operation.map);
      for (const cell of operation.cells) {
        checkTile(cell.tile);
        checkInBounds(map, cell.x, cell.y);
        map.tiles[cell.y][cell.x] = cell.tile;
      }
      return;
    }
    case "add_prop": {
      const map = getMap(world, operation.map);
      const { id, type, x, y } = operation;
      if (!catalog.props[type]) throw new Error(`unknown prop "${type}". Valid: ${Object.keys(catalog.props).join(", ")}`);
      if (map.props.some((p) => p.id === id)) throw new Error(`prop id "${id}" already on map`);
      checkInBounds(map, x, y);
      map.props.push({ id, type, x, y });
      return;
    }
    case "remove_prop": {
      const map = getMap(world, operation.map);
      const index = map.props.findIndex((p) => p.id === operation.id);
      if (index < 0) throw new Error(`no prop "${operation.id}" on map "${operation.map}"`);
      map.props.splice(index, 1);
      return;
    }
    case "add_sprite": {
      const map = getMap(world, operation.map);
      const { id, key, x, y, name } = operation;
      if (!catalog.sprites[key]) throw new Error(`unknown sprite key "${key}". Valid: ${Object.keys(catalog.sprites).join(", ")}`);
      const idTaken = Object.values(world.maps).some((m) => m.sprites.some((s) => s.id === id));
      if (idTaken) throw new Error(`sprite id "${id}" already exists`);
      checkInBounds(map, x, y);
      map.sprites.push({ id, key, x, y, name });
      return;
    }
    case "remove_sprite": {
      const { map, sprite } = findSprite(world, operation.id);
      map.sprites.splice(map.sprites.indexOf(sprite), 1);
      return;
    }
    case "move_sprite": {
      const { map, sprite } = findSprite(world, operation.id);
      const { x, y } = operation;
      checkInBounds(map, x, y);
      const tile = map.tiles[y][x];
      if (!catalog.tiles[tile].walkable) throw new Error(`(${x},${y}) is "${tile}", not walkable`);
      sprite.x = x;
      sprite.y = y;
      return;
    }
    case "change_map": {
      const destination = getMap(world, operation.map);
      for (const [spriteId, position] of Object.entries(operation.positions)) {
        const { map, sprite } = findSprite(world, spriteId);
        checkInBounds(destination, position.x, position.y);
        map.sprites.splice(map.sprites.indexOf(sprite), 1);
        destination.sprites.push({ ...sprite, ...position });
      }
      world.currentMap = destination.id;
      return;
    }
    case "set_lighting": {
      getMap(world, operation.map).lighting = operation.lighting;
      return;
    }
  }
}
