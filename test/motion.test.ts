import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeMotion } from "../src/motions.ts";
import { buildSpeechPieces } from "../src/speech/script.ts";
import { findPath } from "../public/js/boardPath.js";

test("motions accept known words and synonyms, and drop the rest", () => {
  assert.equal(normalizeMotion("Lunge"), "lunge");
  assert.equal(normalizeMotion("attack"), "lunge");
  assert.equal(normalizeMotion(" collapse "), "fall");
  assert.equal(normalizeMotion("moonwalk"), undefined);
  assert.equal(normalizeMotion("constructor"), undefined);
});

test("a beat's motions ride on its first speech piece", () => {
  const pieces = buildSpeechPieces([
    { text: "The door bursts open, and wind howls in.", voice: "bm_fable" },
    { text: "Back, all of you!", voice: "am_onyx", speaker: "Thorin", motions: [{ id: "thorin", action: "shake" }] },
  ], new Map());
  const withMotions = pieces.filter((piece) => piece.motions);
  assert.equal(withMotions.length, 1);
  assert.equal(withMotions[0].speaker, "Thorin");
});

test("walking paths go around walls and fall back to a straight line", () => {
  // 5x3 map with a wall in the middle column except the bottom row
  const walls = new Set(["2,0", "2,1"]);
  const map = { w: 5, h: 3 };
  const isWalkable = (x: number, y: number) => !walls.has(`${x},${y}`);
  const path = findPath(map, isWalkable, { x: 0, y: 0 }, { x: 4, y: 0 });
  assert.deepEqual(path[0], { x: 0, y: 0 });
  assert.deepEqual(path.at(-1), { x: 4, y: 0 });
  assert.ok(path.every((cell: { x: number; y: number }) => isWalkable(cell.x, cell.y)));
  assert.ok(path.some((cell: { x: number; y: number }) => cell.y === 2), "goes through the gap in the bottom row");
  const boxedIn = findPath(map, (x: number) => x !== 2, { x: 0, y: 1 }, { x: 4, y: 1 });
  assert.equal(boxedIn.length, 5, "straight line when no path exists");
});
