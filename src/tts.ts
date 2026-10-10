// Local text-to-speech with Kokoro-82M (kokoro-js, ONNX on CPU).
// The model downloads once on first use. Clips are generated one at a time and
// kept in memory, where the HTTP server serves them by id.
import type { KokoroTTS } from "kokoro-js";

export const KOKORO_VOICES = [
  "af_heart", "af_alloy", "af_aoede", "af_bella", "af_jessica", "af_kore", "af_nicole", "af_nova",
  "af_river", "af_sarah", "af_sky", "am_adam", "am_echo", "am_eric", "am_fenrir", "am_liam",
  "am_michael", "am_onyx", "am_puck", "am_santa", "bf_alice", "bf_emma", "bf_isabella", "bf_lily",
  "bm_daniel", "bm_fable", "bm_george", "bm_lewis",
] as const;
export type Voice = (typeof KOKORO_VOICES)[number];

export const isVoice = (value: unknown): value is Voice => KOKORO_VOICES.includes(value as Voice);

export const NARRATOR_VOICE: Voice = "bm_fable";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const MAX_CACHED_CLIPS = 200; // about 2 MB per clip

let engineLoading: Promise<KokoroTTS | null> | null = null;

function loadEngine(): Promise<KokoroTTS | null> {
  engineLoading ??= import("kokoro-js")
    .then(({ KokoroTTS }) => KokoroTTS.from_pretrained(MODEL_ID, { dtype: "q8", device: "cpu" }))
    .catch((error) => {
      console.error("Kokoro failed to load, speech is off:", (error as Error).message);
      return null;
    });
  return engineLoading;
}

const clips = new Map<number, Buffer>();
let nextClipId = 1;
let generationQueue: Promise<void> = Promise.resolve();

export const getSpeechClip = (clipId: number): Buffer | undefined => clips.get(clipId);

// Queues speech generation and calls onReady with the clip id when it can play.
export function synthesizeSpeech(text: string, voice: Voice, onReady: (clipId: number) => void): void {
  const clipId = nextClipId++;
  generationQueue = generationQueue.then(async () => {
    const engine = await loadEngine();
    if (!engine) return;
    try {
      const audio = await engine.generate(text, { voice });
      clips.set(clipId, Buffer.from(audio.toWav()));
      if (clips.size > MAX_CACHED_CLIPS) clips.delete(clips.keys().next().value!);
      onReady(clipId);
    } catch (error) {
      console.error("Speech generation failed:", (error as Error).message);
    }
  });
}
