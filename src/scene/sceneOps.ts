// The entry point for scene ops written by an LLM.
// normalizeOp translates the field-name dialects that models actually emit into
// canonical ops. Haiku in particular writes "type" for "op", "width" for "w",
// "sprite" for "key", skips ids, and invents lighting values. Translating is more
// reliable than asking the model to self-correct from rejection messages.
import { LIGHTING_OPTIONS, applyOp, type Lighting, type Op, type World } from "./world.ts";

const OP_NAMES = [
  "create_map", "paint_rect", "set_tiles", "add_prop", "remove_prop",
  "add_sprite", "remove_sprite", "move_sprite", "change_map", "set_lighting",
] as const;
type OpName = (typeof OP_NAMES)[number];

const OPS_ON_A_MAP: OpName[] = ["paint_rect", "set_tiles", "add_prop", "remove_prop", "add_sprite", "set_lighting"];

// Raw model output: any field may be present, missing, or misspelled.
type LooseOp = Record<string, any>;

const isOpName = (value: unknown): value is OpName => OP_NAMES.includes(value as OpName);

const toSlug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

function uniqueId(takenIds: Set<string>, base: string): string {
  let id = base || "x";
  for (let n = 2; takenIds.has(id); n++) id = `${base}_${n}`;
  return id;
}

function readOpName(raw: LooseOp): { name: OpName; fields: LooseOp } {
  if (isOpName(raw.op)) return { name: raw.op, fields: raw };
  // {"create_map": {...}}
  for (const name of OP_NAMES) {
    if (raw[name] && typeof raw[name] === "object") return { name, fields: raw[name] };
  }
  // {"type": "create_map", ...} or {"command": "create_map", ...}
  const { type, command, ...rest } = raw;
  if (isOpName(type)) return { name: type, fields: rest };
  if (isOpName(command)) return { name: command, fields: rest };
  throw new Error(`unknown op "${raw.op}". Use "op": ${OP_NAMES.join("|")}`);
}

const toLighting = (value: unknown): Lighting =>
  LIGHTING_OPTIONS.includes(value as Lighting) ? (value as Lighting) : "torch";

// The context a batch gives each op: the map that ops without a map id go to, and
// the party, so a party member added by name gets its own character id.
type BatchContext = { defaultMap: string; partyIdsByName: Map<string, string> };

function normalizeOp(world: World, raw: unknown, context: BatchContext): Op {
  const { name, fields } = readOpName(raw as LooseOp);
  const op: LooseOp = { ...fields, op: name };

  op.w ??= op.width;
  op.h ??= op.height;
  for (const axis of ["x", "y", "w", "h"]) if (typeof op[axis] === "number") op[axis] = Math.round(op[axis]);

  // Only a missing map id gets the default. An unknown id is an error, so a typo
  // never paints the wrong map.
  if (OPS_ON_A_MAP.includes(name) && !op.map) op.map = context.defaultMap;

  switch (name) {
    case "create_map":
      op.fill ??= op.tile ?? "floor.stone";
      op.id ??= op.name ? toSlug(op.name) : uniqueId(new Set(Object.keys(world.maps)), "map");
      op.name ??= op.id;
      op.lighting = toLighting(op.lighting);
      break;
    case "set_tiles": {
      const cells = [op.cells, op.coords, op.tiles, op.positions, op.points].find(Array.isArray);
      if (!Array.isArray(cells)) {
        // rectangle-shaped set_tiles is a paint_rect
        return { op: "paint_rect", map: op.map, x: op.x, y: op.y, w: op.w ?? 1, h: op.h ?? 1, tile: op.tile };
      }
      // cells may be {x, y, tile} objects or [x, y] pairs; a shared tile may sit on the op
      op.cells = cells.map((cell: LooseOp | number[]) => {
        const [x, y, tile] = Array.isArray(cell) ? [cell[0], cell[1], undefined] : [cell.x, cell.y, cell.tile];
        return { x: Math.round(x), y: Math.round(y), tile: tile ?? op.tile };
      });
      break;
    }
    case "add_prop": {
      op.type ??= op.prop ?? op.kind;
      const takenIds = new Set((world.maps[op.map]?.props ?? []).map((p) => p.id));
      op.id ??= uniqueId(takenIds, toSlug(String(op.type ?? "prop")));
      break;
    }
    case "add_sprite": {
      op.key ??= op.sprite;
      // A party member keeps its character id, so adding it twice is an error, not a
      // copy. Other beings with the same name (two goblins) get numbered ids.
      if (typeof op.name === "string") op.id ??= context.partyIdsByName.get(op.name.toLowerCase());
      const takenIds = new Set(Object.values(world.maps).flatMap((m) => m.sprites.map((s) => s.id)));
      op.id ??= uniqueId(takenIds, toSlug(String(op.name ?? op.key ?? "sprite")));
      break;
    }
    case "set_lighting":
      op.lighting = toLighting(op.lighting ?? op.mode);
      break;
  }
  return op as Op;
}

// Applies a batch atomically: every operation applies, or the world stays unchanged.
// Operations are normalized one at a time, so later operations can refer to maps
// that earlier operations in the same batch created. An op without a map id goes
// to the map that the batch created last, else to the current map.
export function applySceneOps(world: World, rawOps: unknown[], partyIdsByName = new Map<string, string>()): void {
  const backup = structuredClone(world);
  const context: BatchContext = { defaultMap: world.currentMap || Object.keys(world.maps)[0], partyIdsByName };
  try {
    for (const rawOp of rawOps) {
      const op = normalizeOp(world, rawOp, context);
      applyOp(world, op);
      if (op.op === "create_map") context.defaultMap = op.id;
    }
  } catch (error) {
    Object.assign(world, backup);
    throw error;
  }
}
