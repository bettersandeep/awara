// What the board needs from the story and the rules, with character ids and
// names turned into sprite ids. Pure functions, so they are easy to test.
import type { BoardEffect, NarrationBeat } from "./agents/narrator.ts";
import type { Character } from "./rules/character.ts";
import type { MapState, Sprite } from "./scene/world.ts";
import { stripVoiceCues } from "./speech/script.ts";
import { type Motion, normalizeMotion } from "./motions.ts";

// The narrator may give a sprite another id than its character, so names match too.
export const characterOfSprite = (sprite: Sprite, characters: Record<string, Character>): Character | undefined =>
  (Object.hasOwn(characters, sprite.id) ? characters[sprite.id] : undefined)
  ?? Object.values(characters).find((c) => sprite.name && c.name.toLowerCase() === sprite.name.toLowerCase());

// A sprite on the map, by sprite id, name or character id.
export function findSprite(map: MapState | undefined, characters: Record<string, Character>, idOrName: string | undefined): Sprite | undefined {
  if (!map || !idOrName) return undefined;
  const key = idOrName.trim().toLowerCase();
  return map.sprites.find((s) => s.id.toLowerCase() === key)
    ?? map.sprites.find((s) => s.name?.toLowerCase() === key)
    ?? map.sprites.find((s) => characterOfSprite(s, characters)?.id.toLowerCase() === key);
}

// Checks the narrator's motions for one beat; a speaker on the map talks when it
// has no motion. Every motion that cannot play adds a note to `skipped`.
export function resolveMotions(beat: NarrationBeat, find: (idOrName?: string) => Sprite | undefined, skipped: string[]): Motion[] {
  const hasWords = /[\p{L}\p{N}]/u.test(stripVoiceCues(beat.text));
  const motions: Motion[] = [];
  for (const raw of beat.motions ?? []) {
    const action = normalizeMotion(raw.action);
    const sprite = find(raw.id);
    const problem = !hasWords ? "the beat has no spoken words" : !sprite ? "no such sprite on the map" : !action ? "unknown action" : "";
    if (problem || !sprite || !action) {
      skipped.push(`${raw.id} ${raw.action} (${problem})`);
      continue;
    }
    motions.push({ id: sprite.id, action, target: find(raw.target)?.id });
  }
  const speaker = hasWords ? find(beat.speaker) : undefined;
  if (speaker && !motions.some((m) => m.id === speaker.id)) motions.push({ id: speaker.id, action: "talk" });
  return motions;
}

// A rules effect as the board message, with sprite ids in place of character ids.
export function effectForBoard(effect: BoardEffect, spriteId: (characterId: string) => string | undefined) {
  switch (effect.kind) {
    case "attack":
      return { type: "effect", ...effect, attacker: spriteId(effect.attacker), target: spriteId(effect.target) };
    case "spell":
      return { type: "effect", ...effect, caster: spriteId(effect.caster), target: spriteId(effect.target) };
    case "rest":
      return { type: "effect", ...effect, ids: effect.ids.map(spriteId).filter(Boolean) };
    default:
      return { type: "effect", ...effect, target: spriteId(effect.target) };
  }
}
