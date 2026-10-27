import { test } from "node:test";
import assert from "node:assert/strict";
import { effectForBoard, findSprite, resolveMotions } from "../src/boardEvents.ts";
import { makeRng } from "../src/rules/dice.ts";
import { makeCharacter } from "../src/rules/character.ts";
import { castSpell } from "../src/rules/engine.ts";
import type { MapState } from "../src/scene/world.ts";
import { createStoryMotions } from "../public/js/storyMotions.js";

const hero = makeCharacter(makeRng(1), {
  id: "hero", name: "Rowan", characterClass: "rogue", sprite: "rogue",
  abilities: { str: 10, dex: 16, con: 12, int: 12, wis: 10, cha: 10 }, armor: "leather", shield: false, weapon: "shortsword",
});
const characters = { hero };
const map: MapState = {
  id: "hall", name: "Hall", w: 4, h: 4, lighting: "torch", props: [],
  tiles: Array.from({ length: 4 }, () => Array(4).fill("floor.wood")),
  sprites: [
    { id: "rowan_sprite", key: "rogue", x: 1, y: 1, name: "Rowan" },
    { id: "grimwick", key: "npc.man", x: 2, y: 2, name: "Grimwick" },
  ],
};
const find = (idOrName?: string) => findSprite(map, characters, idOrName);

test("sprites are found by sprite id, name or character id, never by inherited keys", () => {
  assert.equal(find("grimwick")?.id, "grimwick");
  assert.equal(find(" GRIMWICK ")?.id, "grimwick");
  assert.equal(find("Rowan")?.id, "rowan_sprite");
  assert.equal(find("hero")?.id, "rowan_sprite"); // character id -> its sprite by name
  assert.equal(find("constructor"), undefined);
  assert.equal(find(undefined), undefined);
});

test("motions are checked, mapped to sprite ids, and every drop is reported", () => {
  const skipped: string[] = [];
  const motions = resolveMotions({
    text: "Grimwick lunges at Rowan.",
    motions: [
      { id: "Grimwick", action: "attack", target: "hero" },
      { id: "dragon", action: "jump" },
      { id: "hero", action: "moonwalk" },
    ],
  }, find, skipped);
  assert.deepEqual(motions, [{ id: "grimwick", action: "lunge", target: "rowan_sprite" }]);
  assert.deepEqual(skipped, ["dragon jump (no such sprite on the map)", "hero moonwalk (unknown action)"]);
});

test("a speaker talks on the board, and a beat with no words carries no motions", () => {
  const skipped: string[] = [];
  assert.deepEqual(resolveMotions({ text: "Back, all of you!", speaker: "Grimwick" }, find, skipped), [{ id: "grimwick", action: "talk" }]);
  assert.deepEqual(resolveMotions({ text: "(whisper) ...", motions: [{ id: "grimwick", action: "cower" }] }, find, skipped), []);
  assert.deepEqual(skipped, ["grimwick cower (the beat has no spoken words)"]);
});

test("rule effects reach the board with sprite ids", () => {
  const spriteId = (id: string) => find(id)?.id;
  const attack = effectForBoard({ kind: "attack", attacker: "hero", target: "grimwick", hit: true, crit: false, damage: 3, ranged: false }, spriteId);
  assert.ok(attack.kind === "attack");
  assert.equal(attack.type, "effect");
  assert.deepEqual([attack.attacker, attack.target], ["rowan_sprite", "grimwick"]);
  const rest = effectForBoard({ kind: "rest", ids: ["hero", "nobody"] }, spriteId);
  assert.ok(rest.kind === "rest");
  assert.deepEqual(rest.ids, ["rowan_sprite"]);
});

test("magic missile reports how many missiles it fired", () => {
  const wizard = makeCharacter(makeRng(2), {
    id: "mira", name: "Mira", characterClass: "wizard", sprite: "wizard", level: 5,
    abilities: { str: 8, dex: 14, con: 12, int: 16, wis: 10, cha: 10 }, armor: "none", shield: false, weapon: "quarterstaff",
  });
  assert.equal(castSpell(makeRng(3), wizard, "magic missile", hero).missiles, 3); // level 5: 1 + floor(4 / 2)
});

// ---- story motions follow the voice ----

function fakeTimers() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    setTimer: (fn: () => void, ms: number) => (timers.set(nextId, { at: now + ms, fn }), nextId++),
    clearTimer: (id: number) => timers.delete(id),
    // Moves the clock to each due timer in turn, so timers started by timers run on time.
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const due = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = Math.max(now, due[1].at);
        due[1].fn();
      }
      now = end;
    },
  };
}

const line = (logIndex: number, replay = false) => ({
  logIndex, replay,
  pieces: [
    { text: "The door bursts open.", motions: [{ id: "grimwick", action: "cower" }] },
    { text: "Wind howls in." },
    { text: "Back!", motions: [{ id: "hero", action: "shake" }] },
  ],
});

function setup(voiceOn: boolean) {
  const clock = fakeTimers();
  const played: string[] = [];
  const motions = createStoryMotions({
    playMotions: (list: { id: string; action: string }[]) => played.push(...list.map((m) => `${m.id}:${m.action}`)),
    isVoiceOn: () => voiceOn,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  return { clock, played, motions };
}

test("with the voice on, motions wait for the clip however long it takes, then follow the voice", () => {
  const { clock, played, motions } = setup(true);
  motions.lineAdded(line(4));
  clock.advance(15_000); // Kokoro is still generating a long narration
  assert.deepEqual(played, []);
  motions.clipReady(4, 99);
  motions.pieceSpoken(4, 0);
  assert.deepEqual(played, ["grimwick:cower"]);
  motions.pieceSpoken(4, 2);
  motions.pieceSpoken(4, 2);
  assert.deepEqual(played, ["grimwick:cower", "hero:shake"]);
});

test("a clip that stops early plays the motions it did not reach", () => {
  const { clock, played, motions } = setup(true);
  motions.lineAdded(line(5));
  motions.clipReady(5, 7);
  motions.pieceSpoken(5, 0);
  motions.clipStopped(7);
  clock.advance(2000);
  assert.deepEqual(played, ["grimwick:cower", "hero:shake"]);
});

test("without the voice, or with no clip at all, motions play one beat after another", () => {
  const off = setup(false);
  off.motions.lineAdded(line(1));
  off.clock.advance(0);
  assert.deepEqual(off.played, ["grimwick:cower"]);
  off.clock.advance(1600);
  assert.deepEqual(off.played, ["grimwick:cower", "hero:shake"]);

  const noClip = setup(true);
  noClip.motions.lineAdded(line(2));
  noClip.clock.advance(29_000);
  assert.deepEqual(noClip.played, []);
  noClip.clock.advance(3000);
  assert.deepEqual(noClip.played, ["grimwick:cower", "hero:shake"]);
});

test("turning the voice off plays what waited for it; replayed history never plays", () => {
  const { clock, played, motions } = setup(true);
  motions.lineAdded(line(3, true));
  motions.lineAdded(line(6));
  motions.voiceOff();
  clock.advance(5000);
  assert.deepEqual(played, ["grimwick:cower", "hero:shake"]);
});
