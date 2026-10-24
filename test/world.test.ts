import { test } from "node:test";
import assert from "node:assert/strict";
import { type World, applyOp, catalog, makeWorld } from "../src/scene/world.ts";
import { CLASS_BUILDS } from "../src/party.ts";
import { MONSTERS } from "../src/rules/monsters.ts";
import { applySceneOps } from "../src/scene/sceneOps.ts";

function makeRoom(): World {
  const world = makeWorld();
  applyOp(world, { op: "create_map", id: "room", name: "Room", w: 10, h: 8, fill: "floor.stone" });
  applyOp(world, { op: "paint_rect", map: "room", x: 0, y: 0, w: 10, h: 1, tile: "wall.brick" });
  return world;
}

test("create, paint, add and move a sprite", () => {
  const world = makeRoom();
  applyOp(world, { op: "add_sprite", map: "room", id: "thorin", key: "fighter", x: 2, y: 3 });
  applyOp(world, { op: "move_sprite", id: "thorin", x: 3, y: 3 });
  assert.equal(world.maps.room.sprites[0].x, 3);
  assert.equal(world.currentMap, "room");
});

test("rejects unknown keys, out of bounds positions and walls", () => {
  const world = makeRoom();
  const paintGold = () => applyOp(world, { op: "paint_rect", map: "room", x: 0, y: 0, w: 2, h: 2, tile: "floor.gold" });
  assert.throws(paintGold, /unknown tile/);
  assert.throws(() => applyOp(world, { op: "add_sprite", map: "room", id: "x", key: "balrog", x: 1, y: 1 }), /unknown sprite key/);
  assert.throws(() => applyOp(world, { op: "add_sprite", map: "room", id: "x", key: "goblin", x: 99, y: 1 }), /out of bounds/);
  applyOp(world, { op: "add_sprite", map: "room", id: "goblin", key: "goblin", x: 1, y: 1 });
  assert.throws(() => applyOp(world, { op: "move_sprite", id: "goblin", x: 1, y: 0 }), /not walkable/);
  assert.throws(() => applyOp(world, { op: "add_sprite", map: "room", id: "goblin", key: "goblin", x: 2, y: 2 }), /already exists/);
});

test("change_map moves sprites and keeps the old map intact", () => {
  const world = makeRoom();
  applyOp(world, { op: "add_sprite", map: "room", id: "thorin", key: "fighter", x: 2, y: 3 });
  applyOp(world, { op: "create_map", id: "cave", name: "Cave", w: 12, h: 10, fill: "floor.dirt" });
  applyOp(world, { op: "change_map", map: "cave", positions: { thorin: { x: 1, y: 1 } } });
  assert.equal(world.currentMap, "cave");
  assert.equal(world.maps.room.sprites.length, 0);
  assert.equal(world.maps.cave.sprites[0].id, "thorin");
  assert.equal(world.maps.room.tiles[0][0], "wall.brick");
});

test("translates the field dialect that haiku actually emits", () => {
  const world = makeWorld();
  // Taken verbatim from a real narrator batch that the strict validator rejected.
  applySceneOps(world, [
    { type: "create_map", name: "Scholar's Study", width: 20, height: 15 },
    { type: "paint_rect", x: 0, y: 0, width: 20, height: 15, tile: "floor.wood" },
    { type: "paint_rect", x: 5, y: 3, width: 6, height: 6, tile: "floor.marble" },
    { type: "set_tiles", x: 0, y: 0, width: 1, height: 15, tile: "wall.stone" },
    { type: "add_prop", x: 2, y: 2, prop: "door.closed" },
    { type: "add_prop", x: 3, y: 7, prop: "torch" },
    { type: "set_lighting", mode: "torch" },
    { type: "add_sprite", x: 4, y: 8, sprite: "fighter", name: "Tester" },
    { type: "add_sprite", x: 14, y: 8, sprite: "wizard", name: "Mira" },
  ]);
  const map = world.maps[world.currentMap];
  assert.equal(map.name, "Scholar's Study");
  assert.equal(map.w, 20);
  assert.equal(map.tiles[7][3], "floor.wood");
  assert.equal(map.tiles[7][0], "wall.stone");
  assert.equal(map.props.length, 2);
  assert.equal(map.sprites.length, 2);
  assert.equal(map.sprites[0].key, "fighter");

  applySceneOps(world, [{ add_sprite: { x: 5, y: 8, sprite: "rogue", name: "Pip" } }]);
  applySceneOps(world, [{ command: "move_sprite", id: "pip", x: 6.2, y: 8 }]);
  assert.equal(map.sprites.find((s) => s.id === "pip")?.x, 6);

  applySceneOps(world, [{ op: "set_lighting", lighting: "candlelight" }]);
  assert.equal(map.lighting, "torch");
});

test("translates set_tiles with a shared tile and [x, y] pairs (Opus 5.5)", () => {
  const world = makeRoom();
  // Taken verbatim from a real narrator batch that the validator rejected.
  applySceneOps(world, [{ op: "set_tiles", map: "room", tile: "tree", cells: [[4, 3], [6, 2]] }]);
  assert.equal(world.maps.room.tiles[3][4], "tree");
  assert.equal(world.maps.room.tiles[2][6], "tree");
  // Opus 5.5 also names the list "tiles"
  applySceneOps(world, [{ op: "set_tiles", map: "room", tiles: [{ x: 5, y: 4, tile: "water.shallow" }] }]);
  assert.equal(world.maps.room.tiles[4][5], "water.shallow");
});

test("a batch with one bad op changes nothing", () => {
  const world = makeRoom();
  const badBatch = [
    { op: "add_sprite", map: "room", id: "a", key: "goblin", x: 1, y: 1 },
    { op: "add_sprite", map: "room", id: "b", key: "nope", x: 2, y: 2 },
  ];
  assert.throws(() => applySceneOps(world, badBatch));
  assert.equal(world.maps.room.sprites.length, 0);
});

test("ops without a map id go to the map the batch created, not the old one", () => {
  const world = makeWorld();
  const party = new Map([["thorin", "thorin"]]);
  applySceneOps(world, [
    { op: "create_map", name: "Tavern", w: 10, h: 8 },
    { op: "add_sprite", x: 2, y: 2, sprite: "fighter", name: "Thorin" },
  ], party);
  applySceneOps(world, [
    { op: "create_map", name: "Forest", w: 10, h: 8, fill: "floor.grass" },
    { op: "paint_rect", x: 0, y: 0, w: 10, h: 1, tile: "tree" },
    { op: "add_sprite", x: 3, y: 3, sprite: "wolf", name: "Wolf" },
  ], party);
  assert.equal(world.maps.tavern.tiles[0][0], "floor.stone");
  assert.equal(world.maps.forest.tiles[0][0], "tree");
  assert.deepEqual(world.maps.tavern.sprites.map((s) => s.id), ["thorin"]);
  assert.deepEqual(world.maps.forest.sprites.map((s) => s.id), ["wolf"]);
  // An op that names no map still goes to the current map when the batch made none.
  applySceneOps(world, [{ op: "set_lighting", lighting: "dark" }]);
  assert.equal(world.maps.tavern.lighting, "dark");
});

test("an unknown map id and a party member added twice are errors, two goblins are not", () => {
  const world = makeRoom();
  const party = new Map([["thorin", "thorin"]]);
  assert.throws(() => applySceneOps(world, [{ op: "add_prop", map: "roon", type: "torch", x: 1, y: 1 }]), /unknown map "roon"/);
  assert.throws(() => applySceneOps(world, [{ op: "add_prop", map: "constructor", type: "torch", x: 1, y: 1 }]), /unknown map/);
  applySceneOps(world, [{ op: "add_sprite", x: 2, y: 2, sprite: "fighter", name: "Thorin" }], party);
  const addThorinAgain = () => applySceneOps(world, [{ op: "add_sprite", x: 3, y: 3, sprite: "fighter", name: "Thorin" }], party);
  assert.throws(addThorinAgain, /already exists on map "room". Use move_sprite/);
  applySceneOps(world, [
    { op: "add_sprite", x: 4, y: 4, sprite: "goblin", name: "Goblin" },
    { op: "add_sprite", x: 5, y: 4, sprite: "goblin", name: "Goblin" },
  ], party);
  assert.deepEqual(world.maps.room.sprites.map((s) => s.id), ["thorin", "goblin", "goblin_2"]);
});

test("a sprite placed on a wall moves to the closest walkable cell", () => {
  const world = makeRoom();
  applyOp(world, { op: "add_sprite", map: "room", id: "pip", key: "rogue", x: 4, y: 0 });
  assert.deepEqual([world.maps.room.sprites[0].x, world.maps.room.sprites[0].y], [3, 1]);
  applyOp(world, { op: "create_map", id: "cave", name: "Cave", w: 5, h: 5, fill: "wall.dark" });
  applyOp(world, { op: "paint_rect", map: "cave", x: 4, y: 4, w: 1, h: 1, tile: "floor.dirt" });
  applyOp(world, { op: "change_map", map: "cave", positions: { pip: { x: 0, y: 0 } } });
  assert.deepEqual([world.maps.cave.sprites[0].x, world.maps.cave.sprites[0].y], [4, 4]);
});

test("change_map without positions says what it needs", () => {
  const world = makeRoom();
  const op = { op: "change_map", map: "room" } as Parameters<typeof applyOp>[1];
  assert.throws(() => applyOp(world, op), /change_map requires positions/);
});

test("every class and monster has a sprite in the catalog", () => {
  const keys = [...Object.values(CLASS_BUILDS).map((build) => build.sprite), ...Object.values(MONSTERS).map((m) => m.sprite)];
  assert.deepEqual(keys.filter((key) => !catalog.sprites[key]), []);
});
