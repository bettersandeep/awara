// The story log in the side panel. Spoken lines get a replay button.
const PREFIX_BY_KIND = { speech: "💬 ", intent: "⚔ ", dice: "🎲 " };

export function createStoryLog(container, { nameOf, onReplay }) {
  const lines = []; // log index -> paragraph

  function addReplayButton(logIndex, audioId, speaker) {
    const line = lines[logIndex];
    if (!line || line.querySelector(".replay-button")) return;
    const button = document.createElement("button");
    button.className = "replay-button";
    button.textContent = "▶";
    button.title = "Play this line";
    button.onclick = () => onReplay(audioId, speaker);
    line.appendChild(button);
  }

  return {
    add(entry) {
      const line = document.createElement("p");
      line.className = entry.kind;
      if (entry.speaker) {
        const name = document.createElement("b");
        name.textContent = `${nameOf(entry.speaker)}: `;
        line.appendChild(name);
      }
      const text = entry.kind === "speech" ? `"${entry.text}"` : entry.text;
      line.appendChild(document.createTextNode((PREFIX_BY_KIND[entry.kind] ?? "") + text));
      lines[entry.logIndex] = line;
      container.appendChild(line);
      if (entry.audioId !== undefined) addReplayButton(entry.logIndex, entry.audioId, entry.speaker ?? "narrator");
      container.scrollTop = container.scrollHeight;
    },
    addReplayButton,
    clear() {
      container.replaceChildren();
      lines.length = 0;
    },
  };
}
