// The seat cards around the board: narrator on top, companions on the sides,
// the player at the bottom. Each seat can change its model and voice.

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// options: plain strings, or { key, label } pairs
function dropdown(label, options, selected, onChange) {
  const select = element("select");
  select.title = label;
  for (const option of options) {
    const { key, label: optionLabel } = typeof option === "string" ? { key: option, label: option } : option;
    const item = element("option", null, `${label}: ${optionLabel}`);
    item.value = key;
    select.appendChild(item);
  }
  select.value = selected;
  select.onchange = () => onChange(select.value);
  return select;
}

export function createSeats({ catalog, onSeatChange }) {
  const seatElements = {}; // seat id -> element

  function renderSeat(container, seat, party) {
    container.replaceChildren();
    seatElements[seat.id] = container;

    const header = element("div", "seat-header");
    if (seat.sprite) {
      const portrait = element("img");
      portrait.src = catalog.sprites[seat.sprite]?.file ?? "";
      portrait.alt = "";
      header.appendChild(portrait);
    }
    const titles = element("div");
    titles.append(element("div", "seat-name", seat.title), element("div", "seat-detail", seat.subtitle));
    header.appendChild(titles);
    container.appendChild(header);

    if (seat.member) {
      const { hp, maxHp, ac, spellSlots, powers } = seat.member;
      const bar = element("div", "hp-bar");
      const fill = element("div", "hp-fill");
      fill.style.width = `${Math.max(0, (hp / maxHp) * 100)}%`;
      bar.appendChild(fill);
      container.append(bar, element("div", "seat-detail", `${hp}/${maxHp} hp · AC ${ac}`));
      if (spellSlots > 0) {
        container.appendChild(element("div", "seat-detail", `${spellSlots} spell slot${spellSlots === 1 ? "" : "s"} left`));
      }
      container.appendChild(element("div", "seat-detail", powers));
    }
    if (seat.model) {
      container.appendChild(dropdown("model", party.modelOptions, seat.model, (model) => onSeatChange(seat.id, { model })));
    }
    container.appendChild(dropdown("voice", party.voiceOptions, seat.voice, (voice) => onSeatChange(seat.id, { voice })));
  }

  return {
    render(party) {
      const { narrator, members } = party;
      renderSeat(document.getElementById("seat-narrator"), {
        id: narrator.id, title: "Narrator", subtitle: "dungeon master", model: narrator.model, voice: narrator.voice,
      }, party);

      members.filter((member) => !member.isPlayer).forEach((member, index) => {
        renderSeat(document.getElementById(`seat-companion-${index + 1}`), {
          id: member.id, title: member.name, subtitle: `${member.characterClass} ${member.level}`,
          sprite: member.sprite, member, model: member.model, voice: member.voice,
        }, party);
      });

      const player = members.find((member) => member.isPlayer);
      if (player) {
        renderSeat(document.getElementById("seat-player"), {
          id: player.id, title: `${player.name} (you)`, subtitle: `${player.characterClass} ${player.level}`,
          sprite: player.sprite, member: player, voice: player.voice,
        }, party);
      }
    },
    setSpeaking(seatId, isSpeaking) {
      seatElements[seatId]?.classList.toggle("speaking", isSpeaking);
    },
  };
}
