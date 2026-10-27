// Turns story text into speech pieces: one piece per clause, each with its own
// voice, speed, volume and the pause that follows it.
// Kokoro barely pauses at a comma (about 50 ms) and cuts long input at 510 tokens,
// so the text is split at punctuation and the pauses are added as real silence.
// The same pieces drive the follow-along highlight in the browser.
//
// Voice cues the writer can use inside the text:
//   (pause) (long pause)              silence at that point
//   (whisper) (slowly) (quickly)      style until the end of the sentence
//   *words*                           emphasis: a short beat, then slower words
// Models also invent stage directions such as "(quietly)" or "(firmly)". Known
// synonyms map to a cue; any other short direction is shown as a tag, not spoken.
import type { Motion } from "../motions.ts";
import type { Voice } from "./voices.ts";

// Silence after each kind of break, in milliseconds. Tune these by ear.
export const PAUSE_MS = {
  comma: 250,
  semicolon: 350,
  dash: 300,
  sentence: 500,
  ellipsis: 700,
  paragraph: 900,
  speakerChange: 350,
  cuePause: 800,
  cueLongPause: 1600,
  emphasisBeat: 120,
};

const MAX_WORDS_PER_PIECE = 40; // keeps every piece far below Kokoro's 510-token limit

const STYLES = {
  whisper: { speed: 0.92, volume: 0.5 },
  slowly: { speed: 0.8, volume: 1 },
  quickly: { speed: 1.15, volume: 1 },
} as const;
type StyleCue = keyof typeof STYLES;
const NORMAL_STYLE = { speed: 1, volume: 1 };
const EMPHASIS_SPEED = 0.88;

export type Beat = {
  text: string;
  voice: Voice;
  speaker?: string; // display label for a character's line inside the narration
  motions?: Motion[]; // played on the board when this beat is spoken
};

export type SpeechPiece = {
  text: string; // shown in the story log
  speak: string; // sent to the voice model; empty for a pure pause
  voice: Voice;
  speed: number;
  volume: number;
  pauseAfterMs: number;
  speaker?: string; // set on the first piece of a character's line
  dialogue?: boolean; // set on every piece of a character's line
  cue?: string; // shown as a small tag before the piece
  emphasis?: boolean;
  pronunciations?: Record<string, string>; // word -> how it is said, for the hover hint
  breakAfter?: boolean; // paragraph end
  motions?: Motion[]; // set on the first piece of a beat
};

type Cue = "pause" | "long pause" | StyleCue;

// The cue list as the agents read it in their prompts and tool descriptions.
export const VOICE_CUES = "(pause), (long pause), (whisper), (slowly), (quickly), *emphasis*";

const CUE_SYNONYMS: Record<string, Cue> = {
  pause: "pause", beat: "pause", "long pause": "long pause", silence: "long pause",
  whisper: "whisper", whispers: "whisper", whispering: "whisper", quietly: "whisper", softly: "whisper", hushed: "whisper",
  slowly: "slowly", gravely: "slowly", solemnly: "slowly", deliberately: "slowly",
  quickly: "quickly", urgently: "quickly", hurriedly: "quickly", excitedly: "quickly",
};

const MAX_DIRECTION_WORDS = 3; // a longer parenthesis is ordinary prose and is spoken

// A short stage direction in parentheses, emphasis in asterisks, or a paragraph break.
const MARKUP = /\(([a-z][a-z' -]*)\)|\*([^*\n]+)\*|\n\s*\n/gi;

// A clause ends after , ; : ... ! ? . (with closing quotes), or before a spaced dash.
// Punctuation inside a word or number ("2.5", "1,000", "Node.js", "localhost:8420")
// and the dot of a title ("Mr.") do not end it.
const TITLE = String.raw`\b(?:Mrs?|Ms|Dr|St|Mt)`;
const CLAUSE = new RegExp(
  String.raw`(?:[^,;:.!?…]|[.,:](?=[\p{L}\p{N}])|(?<=${TITLE})\.)+?` +
  String.raw`(?:\.\.\.|…|(?<!${TITLE})[,;:.!?]+["'”’)\]]*(?![\p{L}\p{N}])|\s+-\s+|$)`,
  "gu",
);

function pauseAfterClause(clause: string): { pauseMs: number; endsSentence: boolean } {
  const ending = clause.trimEnd().replace(/["'”’)\]]+$/, "");
  if (/(\.\.\.|…)$/.test(ending)) return { pauseMs: PAUSE_MS.ellipsis, endsSentence: true };
  if (/[.!?]$/.test(ending)) return { pauseMs: PAUSE_MS.sentence, endsSentence: true };
  if (/[;:]$/.test(ending)) return { pauseMs: PAUSE_MS.semicolon, endsSentence: false };
  if (/,$/.test(ending)) return { pauseMs: PAUSE_MS.comma, endsSentence: false };
  if (/\s-\s*$/.test(clause)) return { pauseMs: PAUSE_MS.dash, endsSentence: false };
  return { pauseMs: 0, endsSentence: false };
}

function splitLongClause(clause: string): string[] {
  const words = clause.split(/\s+/).filter(Boolean);
  if (words.length <= MAX_WORDS_PER_PIECE) return [clause];
  const parts: string[] = [];
  for (let i = 0; i < words.length; i += MAX_WORDS_PER_PIECE) parts.push(words.slice(i, i + MAX_WORDS_PER_PIECE).join(" "));
  return parts;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A whole-word match that also works for names with accents, such as Éowyn (\b does not).
const wholeWord = (pattern: string) => new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, "giu");

function applyPronunciations(text: string, pronunciations: Map<string, string>) {
  let speak = text;
  const used: Record<string, string> = {};
  for (const [word, sayAs] of pronunciations) {
    const pattern = wholeWord(escapeRegExp(word));
    if (!pattern.test(speak)) continue;
    speak = speak.replace(pattern, sayAs);
    used[word] = sayAs;
  }
  return { speak, pronunciations: Object.keys(used).length > 0 ? used : undefined };
}

function piecesForBeat(beat: Beat, pronunciations: Map<string, string>): SpeechPiece[] {
  const pieces: SpeechPiece[] = [];
  let style: { speed: number; volume: number } = NORMAL_STYLE;
  let pendingCue: string | undefined;

  const lastPiece = () => pieces[pieces.length - 1];
  const addPiece = (text: string, options: Partial<SpeechPiece> = {}, spokenText = text) => {
    const { speak, pronunciations: used } = applyPronunciations(spokenText, pronunciations);
    pieces.push({
      text, speak, voice: beat.voice, speed: style.speed, volume: style.volume, pauseAfterMs: 0,
      cue: pendingCue, pronunciations: used, ...options,
    });
    pendingCue = undefined;
  };

  const addPlainText = (run: string) => {
    let text = run.replace(/\s+/g, " ");
    // Punctuation right after an emphasis belongs to the emphasized piece.
    const leadingPunctuation = text.match(/^[,;:.!?…]+["'”’)\]]*/)?.[0];
    const previous = lastPiece();
    if (leadingPunctuation && previous?.emphasis) {
      previous.text += leadingPunctuation;
      previous.speak += leadingPunctuation;
      previous.pauseAfterMs = pauseAfterClause(previous.text).pauseMs;
      text = text.slice(leadingPunctuation.length);
    }
    for (const clause of text.match(CLAUSE) ?? []) {
      const trimmed = clause.trim();
      if (!/[\p{L}\p{N}]/u.test(trimmed)) continue;
      const { pauseMs, endsSentence } = pauseAfterClause(clause);
      const parts = splitLongClause(trimmed);
      parts.forEach((part, index) => {
        const isLast = index === parts.length - 1;
        // A spaced dash is shown but not spoken; the pause stands in for it.
        addPiece(part, { pauseAfterMs: isLast ? pauseMs : 0 }, part.replace(/\s+-$/, ""));
      });
      if (endsSentence) style = NORMAL_STYLE;
    }
  };

  let position = 0;
  for (const match of beat.text.matchAll(MARKUP)) {
    const direction = match[1]?.trim().toLowerCase();
    if (direction && direction.split(/\s+/).length > MAX_DIRECTION_WORDS) continue; // prose: stays in the text
    addPlainText(beat.text.slice(position, match.index));
    position = match.index + match[0].length;
    const emphasized = match[2];
    const cue = direction ? CUE_SYNONYMS[direction] : undefined;

    if (emphasized) {
      const previous = lastPiece();
      if (previous) previous.pauseAfterMs = Math.max(previous.pauseAfterMs, PAUSE_MS.emphasisBeat);
      addPiece(emphasized.trim(), { emphasis: true, speed: style.speed * EMPHASIS_SPEED });
    } else if (cue === "pause" || cue === "long pause") {
      addPiece("", { cue: direction, pauseAfterMs: cue === "pause" ? PAUSE_MS.cuePause : PAUSE_MS.cueLongPause });
    } else if (cue) {
      style = STYLES[cue];
      pendingCue = direction;
    } else if (direction) {
      pendingCue = direction; // unknown direction: shown as a tag, never spoken
    } else {
      const previous = lastPiece();
      if (previous) {
        previous.pauseAfterMs = Math.max(previous.pauseAfterMs, PAUSE_MS.paragraph);
        previous.breakAfter = true;
      }
      style = NORMAL_STYLE;
    }
  }
  addPlainText(beat.text.slice(position));

  if (beat.speaker && pieces.length > 0) {
    pieces[0].speaker = beat.speaker;
    for (const piece of pieces) piece.dialogue = true;
  }
  return pieces;
}

export function buildSpeechPieces(beats: Beat[], pronunciations: Map<string, string>): SpeechPiece[] {
  const pieces: SpeechPiece[] = [];
  for (const beat of beats) {
    const beatPieces = piecesForBeat(beat, pronunciations);
    if (beat.motions?.length && beatPieces.length > 0) beatPieces[0].motions = beat.motions;
    const previous = pieces[pieces.length - 1];
    if (previous && beatPieces.length > 0 && beatPieces[0].voice !== previous.voice) {
      previous.pauseAfterMs = Math.max(previous.pauseAfterMs, PAUSE_MS.speakerChange);
    }
    pieces.push(...beatPieces);
  }
  return pieces;
}

// The text without voice cues, for the story history that the agents read.
export function stripVoiceCues(text: string): string {
  return text
    .replace(/\(([a-z][a-z' -]*)\)\s*/gi, (direction, words: string) =>
      words.trim().split(/\s+/).length > MAX_DIRECTION_WORDS ? direction : "")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
