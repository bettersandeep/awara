// The Kokoro voices, and stable voice choice for NPCs that speak in the narration.
export const KOKORO_VOICES = [
  "af_heart", "af_alloy", "af_aoede", "af_bella", "af_jessica", "af_kore", "af_nicole", "af_nova",
  "af_river", "af_sarah", "af_sky", "am_adam", "am_echo", "am_eric", "am_fenrir", "am_liam",
  "am_michael", "am_onyx", "am_puck", "am_santa", "bf_alice", "bf_emma", "bf_isabella", "bf_lily",
  "bm_daniel", "bm_fable", "bm_george", "bm_lewis",
] as const;
export type Voice = (typeof KOKORO_VOICES)[number];

export const isVoice = (value: unknown): value is Voice => KOKORO_VOICES.includes(value as Voice);

export const NARRATOR_VOICE: Voice = "bm_fable";

// The second letter of a Kokoro voice id is its gender: af_heart is female, bm_lewis is male.
const isFemaleVoice = (voice: Voice) => voice[1] === "f";

function hashName(name: string): number {
  let hash = 0;
  for (const char of name.toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash;
}

// Gives each NPC one voice for the whole game. Voices that the narrator or the
// party use are avoided while other voices are still free.
export function chooseNpcVoice(name: string, gender: string | undefined, voicesInUse: Set<Voice>): Voice {
  const genderHint = gender?.trim().toLowerCase();
  const wantsFemale = genderHint?.startsWith("f") || genderHint === "woman" || genderHint === "girl";
  const wantsMale = genderHint?.startsWith("m") || genderHint === "boy";
  const sameGender = KOKORO_VOICES.filter((voice) =>
    wantsFemale ? isFemaleVoice(voice) : wantsMale ? !isFemaleVoice(voice) : true);
  const unused = sameGender.filter((voice) => !voicesInUse.has(voice));
  const candidates = unused.length > 0 ? unused : sameGender;
  return candidates[hashName(name) % candidates.length];
}
