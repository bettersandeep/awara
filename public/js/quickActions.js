// The quick-action buttons and the target chip. A button writes a full action
// into the "do" field, so the player sees it and can change it before sending.
const ARCANE_CLASSES = new Set(["wizard", "sorcerer"]);

export function createQuickActions({ doInput, sayInput, onActionWritten, onClearTarget }) {
  const chip = document.getElementById("target-chip");
  const buttons = [...document.querySelectorAll("#quick-buttons button")];
  let targetName = null;
  let player = null;
  let busy = false;

  const actions = {
    attack: () => (targetName ? `I attack ${targetName}.` : "I attack the nearest enemy."),
    cast: () => {
      if (ARCANE_CLASSES.has(player?.characterClass)) {
        return targetName ? `I cast magic missile at ${targetName}.` : "I cast magic missile at the nearest enemy.";
      }
      return targetName ? `I cast cure light wounds on ${targetName}.` : "I cast cure light wounds on the most wounded of us.";
    },
    search: () => "I search the area carefully.",
    talk: () => (targetName ? `I talk to ${targetName}.` : "I speak to everyone here."),
  };

  function renderChip() {
    chip.replaceChildren();
    chip.classList.toggle("has-target", Boolean(targetName));
    if (!targetName) {
      chip.textContent = "click someone on the board to target them";
      return;
    }
    const clear = document.createElement("button");
    clear.type = "button";
    clear.textContent = "✕";
    clear.title = "Clear the target";
    clear.onclick = onClearTarget;
    chip.append(`🎯 ${targetName}`, clear);
  }

  for (const button of buttons) {
    button.onclick = () => {
      const action = button.dataset.action;
      doInput.value = actions[action]();
      onActionWritten();
      (action === "talk" ? sayInput : doInput).focus();
    };
  }

  function renderButtons() {
    const hasSlots = player?.spellSlots > 0;
    for (const button of buttons) {
      button.disabled = busy || (button.dataset.action === "cast" && !hasSlots);
      if (button.dataset.action === "cast") button.title = hasSlots ? "Cast a spell on the target" : "No spell slots left";
    }
  }

  renderChip();
  renderButtons();

  return {
    setTarget(sprite) {
      targetName = sprite ? sprite.name ?? sprite.id : null;
      renderChip();
    },
    setPlayer(newPlayer) {
      player = newPlayer;
      renderButtons();
    },
    setBusy(isBusy) {
      busy = isBusy;
      renderButtons();
    },
  };
}
