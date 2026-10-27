// Short body motions that the board can play for a being on the map. The
// narrator attaches them to story beats; the board plays each one when the voice
// reaches its beat. Models invent words, so known synonyms map to a motion and
// any other word is dropped, never rejected.
export const MOTIONS = [
  "talk", "lunge", "jump", "cheer", "cower", "shake", "bow", "spin",
  "fall", "rise", "sneak", "glow", "vanish", "appear",
] as const;
export type MotionName = (typeof MOTIONS)[number];

// One motion for one sprite; `target` is the sprite it turns toward (lunge).
export type Motion = { id: string; action: MotionName; target?: string };

const SYNONYMS: Record<string, MotionName> = {
  speak: "talk", say: "talk", shout: "talk", laugh: "talk", whisper: "talk",
  attack: "lunge", strike: "lunge", charge: "lunge", swing: "lunge", stab: "lunge",
  leap: "jump", hop: "jump",
  celebrate: "cheer", dance: "cheer",
  flinch: "cower", cringe: "cower", hide: "cower", fear: "cower",
  tremble: "shake", rage: "shake", stomp: "shake",
  kneel: "bow", nod: "bow",
  twirl: "spin", turn: "spin",
  collapse: "fall", die: "fall", faint: "fall", sleep: "fall",
  stand: "rise", wake: "rise",
  creep: "sneak", stealth: "sneak",
  cast: "glow", pray: "glow", shimmer: "glow", magic: "glow",
  disappear: "vanish", teleport: "vanish",
  arrive: "appear", materialize: "appear",
};

// Built from MOTIONS, so a new motion always reaches the narrator's prompt.
export const MOTION_HELP = MOTIONS.map((m) => (m === "lunge" ? "lunge (with target)" : m)).join(", ");

export function normalizeMotion(action: string): MotionName | undefined {
  const word = action.trim().toLowerCase();
  if ((MOTIONS as readonly string[]).includes(word)) return word as MotionName;
  return Object.hasOwn(SYNONYMS, word) ? SYNONYMS[word] : undefined;
}
