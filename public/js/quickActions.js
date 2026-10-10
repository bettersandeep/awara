// The quick-action buttons and the target chip. A button writes a full action
// into the "do" field, so the player sees it and can change it before sending.
const ARCANE_CLASSES = new Set(["wizard", "sorcerer", "bard"]);

export function createQuickActions({ doInput, sayInput, onActionWritten, onClearTarget }) {
  const chip = document.getElementById("target-chip");
  const buttons = [...document.querySelectorAll("#quick-buttons button")];
  let target = null; // { id, name }
  let player = null;

  const actions = {
    attack: () => (target ? `I attack ${target.name}.` : "I attack the nearest enemy."),
    cast: () => {
      if (ARCANE_CLASSES.has(player?.characterClass)) {
        return target ? `I cast magic missile at ${target.name}.` : "I cast magic missile at the nearest enemy.";
      }
      return target ? `I cast cure light wounds on ${target.name}.` : "I cast cure light wounds on the most wounded of us.";
    },
    search: () => "I search the area carefully.",
    talk: () => (target ? `I talk to ${target.name}.` : "I speak to everyone here."),
  };

  function renderChip() {
    chip.replaceChildren();
    chip.classList.toggle("has-target", Boolean(target));
    if (!target) {
      chip.textContent = "click someone on the board to target them";
      return;
    }
    const clear = document.createElement("button");
    clear.type = "button";
    clear.textContent = "✕";
    clear.title = "Clear the target";
    clear.onclick = onClearTarget;
    chip.append(`🎯 ${target.name}`, clear);
  }

  for (const button of buttons) {
    button.onclick = () => {
      const action = button.dataset.action;
      doInput.value = actions[action]();
      onActionWritten();
      (action === "talk" ? sayInput : doInput).focus();
    };
  }

  renderChip();

  return {
    setTarget(sprite) {
      target = sprite ? { id: sprite.id, name: sprite.name ?? sprite.id } : null;
      renderChip();
    },
    setPlayer(newPlayer) {
      player = newPlayer;
      const cast = buttons.find((button) => button.dataset.action === "cast");
      cast.title = player?.spellSlots > 0 ? "Cast a spell on the target" : "No spell slots left";
      cast.dataset.noSlots = player?.spellSlots > 0 ? "" : "true";
    },
    setBusy(busy) {
      for (const button of buttons) button.disabled = busy || button.dataset.noSlots === "true";
    },
  };
}
