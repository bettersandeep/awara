// Local speech with Kokoro-82M (kokoro-js, ONNX on CPU). The model downloads once
// on first use. Each piece is generated separately, its edge silence is trimmed,
// and the planned pause is added, so punctuation is heard. Clips are kept in
// memory, where the HTTP server serves them by id.
import type { KokoroTTS } from "kokoro-js";
import type { SpeechPiece } from "./script.ts";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const SAMPLE_RATE = 24000;
const MAX_CACHED_CLIPS = 300;
const SILENCE_LEVEL = 0.01; // RMS below this counts as silence
const EDGE_MARGIN_MS = 40; // keep a little air when trimming, so words are not clipped

export type PieceTiming = { start: number; end: number }; // seconds into the clip

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

const samplesFor = (milliseconds: number) => Math.round((milliseconds / 1000) * SAMPLE_RATE);

// Kokoro adds about 250 ms of silence at both ends of every clip. Removing it
// makes the planned pauses the real pauses.
export function trimSilence(samples: Float32Array): Float32Array {
  const frame = samplesFor(10);
  const isLoud = (frameIndex: number) => {
    let sumOfSquares = 0;
    for (let i = frameIndex * frame; i < Math.min(samples.length, (frameIndex + 1) * frame); i++) sumOfSquares += samples[i] ** 2;
    return Math.sqrt(sumOfSquares / frame) >= SILENCE_LEVEL;
  };
  const frameCount = Math.ceil(samples.length / frame);
  let first = 0;
  while (first < frameCount && !isLoud(first)) first++;
  if (first === frameCount) return new Float32Array(0);
  let last = frameCount - 1;
  while (last > first && !isLoud(last)) last--;
  const margin = samplesFor(EDGE_MARGIN_MS);
  return samples.slice(Math.max(0, first * frame - margin), Math.min(samples.length, (last + 1) * frame + margin));
}

// 16-bit mono PCM WAV.
export function encodeWav(samples: Float32Array): Buffer {
  const dataBytes = samples.length * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write("WAVE", 8);
  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16); // format chunk size
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(SAMPLE_RATE, 24);
  wav.writeUInt32LE(SAMPLE_RATE * 2, 28); // byte rate
  wav.writeUInt16LE(2, 32); // block align
  wav.writeUInt16LE(16, 34); // bits per sample
  wav.write("data", 36);
  wav.writeUInt32LE(dataBytes, 40);
  samples.forEach((sample, i) => wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 32767), 44 + i * 2));
  return wav;
}

async function renderPieces(engine: KokoroTTS, pieces: SpeechPiece[]) {
  const chunks: Float32Array[] = [];
  const timings: PieceTiming[] = [];
  let position = 0; // samples
  for (const piece of pieces) {
    let audio: Float32Array = new Float32Array(0);
    if (piece.speak.trim()) {
      const generated = await engine.generate(piece.speak, { voice: piece.voice, speed: piece.speed });
      audio = trimSilence(generated.audio);
      if (piece.volume !== 1) audio = audio.map((sample) => sample * piece.volume);
    }
    timings.push({ start: position / SAMPLE_RATE, end: (position + audio.length) / SAMPLE_RATE });
    const pause = new Float32Array(samplesFor(piece.pauseAfterMs));
    chunks.push(audio, pause);
    position += audio.length + pause.length;
  }
  const clip = new Float32Array(position);
  let offset = 0;
  for (const chunk of chunks) {
    clip.set(chunk, offset);
    offset += chunk.length;
  }
  return { wav: encodeWav(clip), timings };
}

const clips = new Map<number, Buffer>();
let nextClipId = 1;
let generationQueue: Promise<void> = Promise.resolve();

export const getSpeechClip = (clipId: number): Buffer | undefined => clips.get(clipId);

// Queues speech generation; calls onReady when the clip can play.
export function synthesizeSpeech(pieces: SpeechPiece[], onReady: (clipId: number, timings: PieceTiming[]) => void): void {
  if (!pieces.some((piece) => piece.speak.trim())) return;
  const clipId = nextClipId++;
  generationQueue = generationQueue.then(async () => {
    const engine = await loadEngine();
    if (!engine) return;
    try {
      const { wav, timings } = await renderPieces(engine, pieces);
      clips.set(clipId, wav);
      if (clips.size > MAX_CACHED_CLIPS) clips.delete(clips.keys().next().value!);
      onReady(clipId, timings);
    } catch (error) {
      console.error("Speech generation failed:", (error as Error).message);
    }
  });
}
