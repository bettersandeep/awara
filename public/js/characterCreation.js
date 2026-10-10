// The character creation screen: name, class and opening scenario.
const SURPRISE_ME = { key: "", title: "Surprise me", pitch: "The narrator picks an opening at random." };

function renderCards(container, items, selectedKey, renderCard, onSelect) {
  container.replaceChildren();
  for (const item of items) {
    const card = document.createElement("div");
    card.className = "card";
    card.classList.toggle("selected", item.key === selectedKey);
    renderCard(card, item);
    card.onclick = () => {
      for (const other of container.children) other.classList.remove("selected");
      card.classList.add("selected");
      onSelect(item.key);
    };
    container.appendChild(card);
  }
}

function cardContent(card, title, text, imageFile) {
  const heading = document.createElement("div");
  heading.className = "card-title";
  if (imageFile) {
    const portrait = document.createElement("img");
    portrait.src = imageFile;
    portrait.alt = "";
    heading.appendChild(portrait);
  }
  heading.append(title);
  const body = document.createElement("div");
  body.className = "card-text";
  body.textContent = text;
  card.append(heading, body);
}

export function showCharacterCreation({ classes, scenarios, catalog, onStart }) {
  const screen = document.getElementById("character-creation");
  const nameInput = document.getElementById("player-name");
  let characterClass = classes[0].key;
  let scenario = SURPRISE_ME.key;

  renderCards(document.getElementById("class-cards"), classes, characterClass,
    (card, option) => cardContent(card, option.label, option.summary, catalog.sprites[option.sprite]?.file),
    (key) => (characterClass = key));
  renderCards(document.getElementById("scenario-cards"), [SURPRISE_ME, ...scenarios], scenario,
    (card, option) => cardContent(card, option.title, option.pitch),
    (key) => (scenario = key));

  document.getElementById("start-button").onclick = () => {
    screen.hidden = true;
    onStart({ name: nameInput.value.trim() || "Hero", characterClass, scenario });
  };
  screen.hidden = false;
  nameInput.focus();
}
