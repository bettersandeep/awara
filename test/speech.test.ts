import { test } from "node:test";
import assert from "node:assert/strict";
import { PAUSE_MS, buildSpeechPieces, stripVoiceCues } from "../src/speech/script.ts";
import { encodeWav, trimSilence } from "../src/speech/synthesizer.ts";
import { type Voice, chooseNpcVoice } from "../src/speech/voices.ts";

const NARRATOR: Voice = "bm_fable";
const narrate = (text: string, pronunciations = new Map<string, string>()) =>
  buildSpeechPieces([{ text, voice: NARRATOR }], pronunciations);

test("splits at punctuation and pauses after every clause", () => {
  const pieces = narrate("Smoke curls above the road, and the wagon sits askew. Two goblins wait; nobody moves. Wait...");
  assert.deepEqual(pieces.map((p) => p.text), [
    "Smoke curls above the road,", "and the wagon sits askew.", "Two goblins wait;", "nobody moves.", "Wait...",
  ]);
  assert.deepEqual(pieces.map((p) => p.pauseAfterMs), [
    PAUSE_MS.comma, PAUSE_MS.sentence, PAUSE_MS.semicolon, PAUSE_MS.sentence, PAUSE_MS.ellipsis,
  ]);
});

test("a spaced dash is shown, not spoken, and pauses", () => {
  const [first] = narrate("He ran - fast.");
  assert.equal(first.text, "He ran -");
  assert.equal(first.speak, "He ran");
  assert.equal(first.pauseAfterMs, PAUSE_MS.dash);
});

test("pause cues become silent pieces with a tag", () => {
  const pieces = narrate("The door opens. (long pause) Nothing.");
  const pause = pieces[1];
  assert.equal(pause.speak, "");
  assert.equal(pause.cue, "long pause");
  assert.equal(pause.pauseAfterMs, PAUSE_MS.cueLongPause);
});

test("style cues last until the end of the sentence", () => {
  const pieces = narrate("(whisper) Stay low, all of you. Now run.");
  assert.equal(pieces[0].cue, "whisper");
  assert.ok(pieces[0].volume < 1 && pieces[1].volume < 1, "whisper covers both clauses of the sentence");
  assert.equal(pieces[2].volume, 1, "the next sentence is normal again");
});

test("invented stage directions: synonyms style the voice, unknown ones are tags only", () => {
  // Taken from real Haiku 5.5 companion lines.
  const quiet = narrate("(quietly) Bones don't settle into a neat ring by accident.");
  assert.equal(quiet[0].cue, "quietly");
  assert.ok(quiet[0].volume < 1, "quietly is spoken as a whisper");
  assert.ok(!quiet[0].speak.includes("quietly"));

  const firm = narrate("I'll hear it first. (firmly) Who pays it?");
  const tagged = firm.find((p) => p.cue === "firmly");
  assert.equal(tagged?.text, "Who pays it?");
  assert.equal(tagged?.volume, 1);
  assert.ok(firm.every((p) => !p.speak.includes("firmly")));

  const prose = narrate("The crone (the one with the crooked staff) laughs.");
  assert.ok(prose.some((p) => p.speak.includes("the one with the crooked staff")), "a long parenthesis is prose");
});

test("emphasis gets its own slower piece, a beat before, and keeps its punctuation", () => {
  const pieces = narrate("Something *breathes*. Then silence.");
  assert.deepEqual(pieces.map((p) => p.text), ["Something", "breathes.", "Then silence."]);
  assert.equal(pieces[0].pauseAfterMs, PAUSE_MS.emphasisBeat);
  assert.ok(pieces[1].emphasis && pieces[1].speed < 1);
  assert.equal(pieces[1].pauseAfterMs, PAUSE_MS.sentence);
});

test("dialogue beats use the speaker's voice, label and a turn pause", () => {
  const pieces = buildSpeechPieces([
    { text: "The barkeep leans in.", voice: NARRATOR },
    { text: "The caravan never arrived.", voice: "am_onyx", speaker: "Grimwick" },
  ], new Map());
  assert.equal(pieces[0].pauseAfterMs, Math.max(PAUSE_MS.sentence, PAUSE_MS.speakerChange));
  assert.equal(pieces[1].speaker, "Grimwick");
  assert.equal(pieces[1].voice, "am_onyx");
  assert.equal(pieces[0].dialogue, undefined);
  assert.equal(pieces[1].dialogue, true);
});

test("pronunciations change what is spoken, not what is shown", () => {
  const [piece] = narrate("Hrothgar raises his cup.", new Map([["Hrothgar", "Roth-gar"]]));
  assert.equal(piece.text, "Hrothgar raises his cup.");
  assert.equal(piece.speak, "Roth-gar raises his cup.");
  assert.deepEqual(piece.pronunciations, { Hrothgar: "Roth-gar" });
});

test("pronunciations also apply to names with accents", () => {
  const [piece] = narrate("Éowyn rides past Zoë.", new Map([["Éowyn", "Ay-oh-win"], ["Zoë", "Zo-ee"]]));
  assert.equal(piece.speak, "Ay-oh-win rides past Zo-ee.");
  assert.deepEqual(narrate("Éowyna waits.", new Map([["Éowyn", "Ay-oh-win"]]))[0].speak, "Éowyna waits.");
});

test("numbers and titles do not end a clause", () => {
  const pieces = narrate("Mr. Grim paid 2.5 gold, then 1,000 more. Dr. Vey left.");
  assert.deepEqual(pieces.map((p) => p.text), ["Mr. Grim paid 2.5 gold,", "then 1,000 more.", "Dr. Vey left."]);
});

test("a long clause is split so Kokoro never truncates it", () => {
  const longClause = Array(100).fill("word").join(" ");
  const pieces = narrate(longClause);
  assert.equal(pieces.length, 3);
  assert.ok(pieces.every((p) => p.speak.split(" ").length <= 40));
});

test("paragraph breaks pause longer and break the line", () => {
  const pieces = narrate("First part.\n\nSecond part.");
  assert.equal(pieces[0].pauseAfterMs, PAUSE_MS.paragraph);
  assert.equal(pieces[0].breakAfter, true);
});

test("stripVoiceCues leaves readable text", () => {
  assert.equal(stripVoiceCues("(whisper) Something *breathes* (pause) here. (firmly) Go."), "Something breathes here. Go.");
});

test("NPC voices are stable, follow gender, and avoid voices in use", () => {
  const inUse = new Set<Voice>(["bm_fable", "am_onyx"]);
  const voice = chooseNpcVoice("Grimwick", "male", inUse);
  assert.equal(voice, chooseNpcVoice("Grimwick", "male", inUse));
  assert.equal(voice[1], "m");
  assert.ok(!inUse.has(voice));
  assert.equal(chooseNpcVoice("Agnes", "female", inUse)[1], "f");
});

test("trimSilence removes quiet edges but keeps a margin", () => {
  const rate = 24000;
  const samples = new Float32Array(rate); // 1 s of silence...
  samples.fill(0.5, 9600, 14400); // ...with sound from 0.4 s to 0.6 s
  const trimmed = trimSilence(samples);
  const seconds = trimmed.length / rate;
  assert.ok(seconds > 0.2 && seconds < 0.3, `trimmed to ${seconds}s`);
  assert.equal(trimSilence(new Float32Array(rate)).length, 0);
});

test("encodeWav writes a 16-bit mono PCM header", () => {
  const wav = encodeWav(new Float32Array([0, 1, -1]));
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.readUInt32LE(40), 6);
  assert.equal(wav.readInt16LE(46), 32767);
  assert.equal(wav.readInt16LE(48), -32767);
});
