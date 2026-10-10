// Draws the current map: tiles, props, sprites with walk animation, name tags,
// torchlight and a fade when the map changes.
const WALK_SPEED_TILES_PER_SECOND = 6;
const FADE_SPEED = 1.6;
const MAX_NAME_TAG_LENGTH = 10;

export function createBoard(canvas, catalog) {
  const context = canvas.getContext("2d");
  const darkness = document.createElement("canvas");
  const tileSize = catalog.tileSize;
  const images = {};
  const shownPositions = {}; // sprite id -> animated {x, y}
  let map = null;
  let fade = 0;
  let partyIds = new Set();

  function image(file) {
    if (!images[file]) {
      images[file] = new Image();
      images[file].src = file;
    }
    return images[file];
  }

  function drawTile(file, x, y) {
    context.drawImage(image(file), x * tileSize, y * tileSize, tileSize, tileSize);
  }

  // Tags alternate above and below by column, so neighbors do not overlap.
  function drawNameTag(name, x, y, column, isPartyMember) {
    const label = name.length > MAX_NAME_TAG_LENGTH ? `${name.slice(0, MAX_NAME_TAG_LENGTH - 1)}…` : name;
    const centerX = x * tileSize + tileSize / 2;
    const baseline = column % 2 === 0 ? y * tileSize - 2 : (y + 1) * tileSize + 9;
    context.font = "10px monospace";
    context.textAlign = "center";
    const width = context.measureText(label).width;
    context.fillStyle = "rgba(0, 0, 0, 0.6)";
    context.fillRect(centerX - width / 2 - 2, baseline - 9, width + 4, 11);
    context.fillStyle = isPartyMember ? "#ffe9a8" : "#ff9b9b";
    context.fillText(label, centerX, baseline);
  }

  function moveTowards(current, target, maxStep) {
    return current + Math.max(-maxStep, Math.min(maxStep, target - current));
  }

  function drawSprites(seconds) {
    const step = WALK_SPEED_TILES_PER_SECOND * seconds;
    for (const sprite of map.sprites) {
      const shown = (shownPositions[sprite.id] ??= { x: sprite.x, y: sprite.y });
      shown.x = moveTowards(shown.x, sprite.x, step);
      shown.y = moveTowards(shown.y, sprite.y, step);
      const art = catalog.sprites[sprite.key];
      if (art) drawTile(art.file, shown.x, shown.y);
    }
  }

  // Drawn after every sprite and after the darkness, so names stay readable.
  function drawNameTags() {
    for (const sprite of map.sprites) {
      const shown = shownPositions[sprite.id];
      if (sprite.name) drawNameTag(sprite.name, shown.x, shown.y, sprite.x, partyIds.has(sprite.id));
    }
  }

  // Torches and party members carry light. A map with no light source stays lit,
  // so the board is never fully black.
  function drawLighting() {
    if (map.lighting === "day") return;
    const lights = [];
    for (const prop of map.props) if (prop.type === "torch") lights.push({ ...prop, radius: 4.5 });
    for (const sprite of map.sprites) {
      if (partyIds.has(sprite.id)) lights.push({ ...(shownPositions[sprite.id] ?? sprite), radius: 3.5 });
    }
    if (lights.length === 0) return;

    const shade = darkness.getContext("2d");
    shade.globalCompositeOperation = "source-over";
    shade.clearRect(0, 0, darkness.width, darkness.height);
    shade.fillStyle = map.lighting === "dark" ? "rgba(0, 0, 0, 0.82)" : "rgba(0, 0, 0, 0.55)";
    shade.fillRect(0, 0, darkness.width, darkness.height);
    shade.globalCompositeOperation = "destination-out";
    for (const light of lights) {
      const centerX = light.x * tileSize + tileSize / 2;
      const centerY = light.y * tileSize + tileSize / 2;
      const radius = light.radius * tileSize;
      const glow = shade.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
      glow.addColorStop(0, "rgba(0, 0, 0, 1)");
      glow.addColorStop(1, "rgba(0, 0, 0, 0)");
      shade.fillStyle = glow;
      shade.beginPath();
      shade.arc(centerX, centerY, radius, 0, Math.PI * 2);
      shade.fill();
    }
    context.drawImage(darkness, 0, 0);
  }

  function resizeToMap() {
    const width = map.w * tileSize;
    const height = map.h * tileSize;
    // Resizing a canvas reallocates it, so only do it when the size really changes.
    if (canvas.width === width && canvas.height === height) return;
    canvas.width = darkness.width = width;
    canvas.height = darkness.height = height;
    context.imageSmoothingEnabled = false;
  }

  function draw(seconds) {
    resizeToMap();
    for (let y = 0; y < map.h; y++) {
      for (let x = 0; x < map.w; x++) {
        const tile = catalog.tiles[map.tiles[y][x]];
        if (tile) drawTile(tile.file, x, y);
      }
    }
    for (const prop of map.props) {
      const art = catalog.props[prop.type];
      if (art) drawTile(art.file, prop.x, prop.y);
    }
    drawSprites(seconds);
    drawLighting();
    drawNameTags();
    if (fade > 0) {
      fade = Math.max(0, fade - seconds * FADE_SPEED);
      context.fillStyle = `rgba(0, 0, 0, ${fade})`;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  let previousTime = performance.now();
  function animate(now) {
    const seconds = Math.min(0.05, (now - previousTime) / 1000);
    previousTime = now;
    if (map) draw(seconds);
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);

  return {
    showMap(newMap) {
      // An empty canvas shows as a black box, so it stays hidden until there is a map.
      canvas.hidden = !newMap;
      if (newMap && newMap.id !== map?.id) {
        fade = 1;
        for (const sprite of newMap.sprites) shownPositions[sprite.id] = { x: sprite.x, y: sprite.y };
      }
      map = newMap;
    },
    setPartyIds(ids) {
      partyIds = new Set(ids);
    },
  };
}
