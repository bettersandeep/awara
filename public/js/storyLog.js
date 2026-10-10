// The story log in the side panel. Spoken lines are drawn piece by piece, with
// speaker labels, voice-cue tags, emphasis and pronunciation hints. While a line
// plays, the piece being spoken is highlighted.
const PREFIX_BY_KIND = { speech: "💬 ", intent: "⚔ ", dice: "🎲 " };

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Wraps each word that has a custom pronunciation, so hovering shows how it is said.
function appendWithPronunciationHints(container, text, pronunciations) {
  const words = Object.keys(pronunciations ?? {});
  if (words.length === 0) return container.append(text);
  const pattern = new RegExp(`\\b(${words.map(escapeRegExp).join("|")})\\b`, "gi");
  let position = 0;
  for (const match of text.matchAll(pattern)) {
    container.append(text.slice(position, match.index));
    const hint = document.createElement("abbr");
    const key = words.find((word) => word.toLowerCase() === match[0].toLowerCase());
    hint.title = `said: ${pronunciations[key]}`;
    hint.textContent = match[0];
    container.append(hint);
    position = match.index + match[0].length;
  }
  container.append(text.slice(position));
}

const lineBreak = () => document.createElement("br");

// A character's line inside the narration gets its own row, a label and quote
// marks, like a play script, so it is clear where it starts and ends.
function renderPieces(line, pieces) {
  return pieces.map((piece, index) => {
    const next = pieces[index + 1];
    const endsDialogue = piece.dialogue && (!next || next.speaker || !next.dialogue);
    if (piece.speaker) {
      const label = document.createElement("span");
      label.className = "speaker-label";
      label.textContent = piece.speaker;
      if (index > 0) line.append(lineBreak());
      line.append(label, " ");
    } else if (index > 0) {
      line.append(" ");
    }
    if (piece.cue) {
      const tag = document.createElement("span");
      tag.className = "cue-tag";
      tag.textContent = piece.cue;
      line.append(tag, piece.text ? " " : "");
    }
    if (piece.speaker) line.append("“");
    const span = document.createElement(piece.emphasis ? "em" : "span");
    span.className = piece.dialogue ? "piece dialogue" : "piece";
    appendWithPronunciationHints(span, piece.text, piece.pronunciations);
    line.append(span);
    if (endsDialogue) line.append("”");
    if (piece.breakAfter) line.append(lineBreak(), lineBreak());
    else if (endsDialogue && next) line.append(lineBreak());
    return span;
  });
}

export function createStoryLog(container, { nameOf, onReplay }) {
  const lines = []; // log index -> { element, pieceSpans, audioId, timings }
  const lineByAudioId = new Map();
  let highlighted = null;

  function attachAudio(logIndex, audioId, timings, speaker) {
    const line = lines[logIndex];
    if (!line || line.audioId !== undefined) return;
    Object.assign(line, { audioId, timings });
    lineByAudioId.set(audioId, line);
    const button = document.createElement("button");
    button.className = "replay-button";
    button.textContent = "▶";
    button.title = "Play this line";
    button.onclick = () => onReplay(audioId, speaker);
    line.element.appendChild(button);
  }

  return {
    add(entry) {
      const element = document.createElement("p");
      element.className = entry.kind;
      if (entry.speaker && entry.kind !== "story") {
        const name = document.createElement("b");
        name.textContent = `${nameOf(entry.speaker)}: `;
        element.appendChild(name);
      }
      element.append(PREFIX_BY_KIND[entry.kind] ?? "");
      let pieceSpans = [];
      if (entry.pieces) {
        if (entry.kind === "speech") element.append("“");
        pieceSpans = renderPieces(element, entry.pieces);
        if (entry.kind === "speech") element.append("”");
      } else {
        element.append(entry.text);
      }
      lines[entry.logIndex] = { element, pieceSpans };
      container.appendChild(element);
      if (entry.audioId !== undefined) attachAudio(entry.logIndex, entry.audioId, entry.timings, entry.speaker ?? "narrator");
      container.scrollTop = container.scrollHeight;
    },

    attachAudio,

    // Called on every animation frame while a clip plays; seconds is null when it stops.
    showSpokenPosition(audioId, seconds) {
      const line = lineByAudioId.get(audioId);
      let current = null;
      if (line && seconds !== null) {
        // During a pause the piece just spoken stays lit.
        const index = line.timings.findLastIndex((timing) => timing.start <= seconds);
        current = line.pieceSpans[index] ?? null;
      }
      if (current === highlighted) return;
      highlighted?.classList.remove("now-speaking");
      current?.classList.add("now-speaking");
      highlighted = current;
    },

    clear() {
      container.replaceChildren();
      lines.length = 0;
      lineByAudioId.clear();
      highlighted = null;
    },
  };
}
