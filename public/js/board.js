// Draws the current map: tile variants, animated props, sprites with walk
// animation and shadows, HP bars, stepped torchlight, name tags, the selected
// target and a fade when the map changes. Clicking a character selects it.
const WALK_SPEED_TILES_PER_SECOND = 6;
const FADE_SPEED = 1.6;
const MAX_NAME_TAG_LENGTH = 10;
const ANIMATION_FPS = 6;
const LIGHT_LEVELS = 4; // stepped light suits pixel art better than a smooth gradient
const DARKNESS = { torch: 0.55, dark: 0.82 };
const LIGHT_RADIUS = { torch: 4.5, fire: 5.5, partyMember: 3.5 }; // in tiles

// Stable pseudo-random number per position, so each cell keeps its variant.
const cellHash = (x, y) => (Math.imul(x + 1, 73856093) ^ Math.imul(y + 1, 19349663)) >>> 0;

export function createBoard(canvas, catalog, { onSelectSprite }) {
  const context = canvas.getContext("2d");
  const tileSize = catalog.tileSize;
  const lightCell = tileSize / 2;
  const images = {};
  const shownPositions = {}; // sprite id -> animated {x, y}
  let map = null;
  let health = {}; // sprite id -> hp as a fraction of max hp
  let fade = 0;
  let partyIds = new Set();
  let selectedId = null;

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

  function drawFloorAndWalls() {
    for (let y = 0; y < map.h; y++) {
      for (let x = 0; x < map.w; x++) {
        const tile = catalog.tiles[map.tiles[y][x]];
        if (tile) drawTile(tile.files[cellHash(x, y) % tile.files.length], x, y);
      }
    }
  }

  function drawProps(seconds) {
    for (const prop of map.props) {
      const art = catalog.props[prop.type];
      if (!art) continue;
      // Each prop starts at its own frame, so torches do not flicker in step.
      const frame = (Math.floor(seconds * ANIMATION_FPS) + cellHash(prop.x, prop.y)) % art.files.length;
      drawTile(art.files[frame], prop.x, prop.y);
    }
  }

  function moveTowards(current, target, maxStep) {
    return current + Math.max(-maxStep, Math.min(maxStep, target - current));
  }

  // A small stepped pixel shadow grounds each sprite.
  function drawShadow(x, y) {
    const left = x * tileSize;
    const bottom = (y + 1) * tileSize;
    context.fillStyle = "rgba(0, 0, 0, 0.35)";
    context.fillRect(left + 9, bottom - 6, 14, 1);
    context.fillRect(left + 7, bottom - 5, 18, 2);
    context.fillRect(left + 9, bottom - 3, 14, 1);
  }

  // A dark outline keeps the bar readable on any floor.
  function drawHealthBar(fraction, x, y) {
    const left = Math.round(x * tileSize) + 5;
    const top = Math.round((y + 1) * tileSize) - 5;
    context.fillStyle = "#000000";
    context.fillRect(left - 1, top - 1, 24, 6);
    context.fillStyle = "#3a1820";
    context.fillRect(left, top, 22, 4);
    context.fillStyle = fraction > 0.5 ? "#7bc96f" : fraction > 0.25 ? "#e3c35a" : "#e0483e";
    context.fillRect(left, top, Math.round(22 * Math.max(0, fraction)), 4);
  }

  function drawSprites(frameSeconds) {
    const step = WALK_SPEED_TILES_PER_SECOND * frameSeconds;
    for (const sprite of map.sprites) {
      const shown = (shownPositions[sprite.id] ??= { x: sprite.x, y: sprite.y });
      shown.x = moveTowards(shown.x, sprite.x, step);
      shown.y = moveTowards(shown.y, sprite.y, step);
      const art = catalog.sprites[sprite.key];
      drawShadow(shown.x, shown.y);
      if (art) drawTile(art.file, shown.x, shown.y);
      if (health[sprite.id] !== undefined && health[sprite.id] < 1) drawHealthBar(health[sprite.id], shown.x, shown.y);
    }
  }

  function lightSources(seconds) {
    const lights = [];
    const flicker = (x, y) => Math.sin(seconds * 7 + cellHash(x, y)) * 0.25;
    for (const prop of map.props) {
      if (prop.type === "torch" || prop.type === "fire") {
        lights.push({ x: prop.x + 0.5, y: prop.y + 0.5, radius: LIGHT_RADIUS[prop.type] + flicker(prop.x, prop.y), warm: true });
      }
    }
    for (const sprite of map.sprites) {
      if (!partyIds.has(sprite.id)) continue;
      const position = shownPositions[sprite.id] ?? sprite;
      lights.push({ x: position.x + 0.5, y: position.y + 0.5, radius: LIGHT_RADIUS.partyMember, warm: false });
    }
    return lights;
  }

  // Darkness in half-tile cells with a few light levels; warm light near flames.
  // A map with no light source stays lit, so the board is never fully black.
  function drawLighting(seconds) {
    if (map.lighting === "day") return;
    const lights = lightSources(seconds);
    if (lights.length === 0) return;
    const darkness = DARKNESS[map.lighting] ?? DARKNESS.torch;
    const cells = tileSize / lightCell;
    for (let cy = 0; cy < map.h * cells; cy++) {
      for (let cx = 0; cx < map.w * cells; cx++) {
        const x = (cx + 0.5) / cells;
        const y = (cy + 0.5) / cells;
        let level = 0;
        let warmLevel = 0;
        for (const light of lights) {
          const strength = 1 - Math.hypot(x - light.x, y - light.y) / light.radius;
          if (strength <= 0) continue;
          level = Math.max(level, strength);
          if (light.warm) warmLevel = Math.max(warmLevel, strength);
        }
        const stepped = Math.ceil(level * LIGHT_LEVELS) / LIGHT_LEVELS;
        const shadow = darkness * (1 - stepped);
        if (shadow > 0.01) {
          context.fillStyle = `rgba(0, 0, 0, ${shadow.toFixed(3)})`;
          context.fillRect(cx * lightCell, cy * lightCell, lightCell, lightCell);
        }
        const warmth = Math.ceil(warmLevel * LIGHT_LEVELS) / LIGHT_LEVELS;
        if (warmth > 0) {
          context.fillStyle = `rgba(255, 150, 60, ${(0.1 * warmth).toFixed(3)})`;
          context.fillRect(cx * lightCell, cy * lightCell, lightCell, lightCell);
        }
      }
    }
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

  // Drawn after the darkness, so names stay readable.
  function drawNameTags() {
    for (const sprite of map.sprites) {
      const shown = shownPositions[sprite.id];
      if (sprite.name) drawNameTag(sprite.name, shown.x, shown.y, sprite.x, partyIds.has(sprite.id));
    }
  }

  // Gold corner brackets around the selected target, gently pulsing.
  function drawSelection(seconds) {
    const sprite = map.sprites.find((s) => s.id === selectedId);
    if (!sprite) return;
    const shown = shownPositions[sprite.id] ?? sprite;
    const left = shown.x * tileSize;
    const top = shown.y * tileSize;
    const arm = 7;
    context.fillStyle = `rgba(255, 215, 90, ${0.65 + 0.35 * Math.sin(seconds * 5)})`;
    for (const [cornerX, cornerY, dx, dy] of [[0, 0, 1, 1], [tileSize, 0, -1, 1], [0, tileSize, 1, -1], [tileSize, tileSize, -1, -1]]) {
      context.fillRect(left + cornerX - (dx < 0 ? arm : 0), top + cornerY - (dy < 0 ? 2 : 0), arm, 2);
      context.fillRect(left + cornerX - (dx < 0 ? 2 : 0), top + cornerY - (dy < 0 ? arm : 0), 2, arm);
    }
  }

  // Whole-number scaling keeps pixels square; a map bigger than the frame shrinks.
  function fitToFrame() {
    if (!map) return;
    const frame = canvas.parentElement;
    const scale = Math.floor(Math.min(frame.clientWidth / canvas.width, frame.clientHeight / canvas.height));
    canvas.style.width = scale >= 1 ? `${canvas.width * scale}px` : "";
    canvas.style.height = scale >= 1 ? `${canvas.height * scale}px` : "";
  }

  function resizeToMap() {
    const width = map.w * tileSize;
    const height = map.h * tileSize;
    // Resizing a canvas reallocates it, so only do it when the size really changes.
    if (canvas.width === width && canvas.height === height) return;
    canvas.width = width;
    canvas.height = height;
    context.imageSmoothingEnabled = false;
    fitToFrame();
  }

  function spriteAt(event) {
    if (!map) return null;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * map.w);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * map.h);
    return map.sprites.find((sprite) => sprite.x === x && sprite.y === y) ?? null;
  }

  canvas.addEventListener("click", (event) => onSelectSprite(spriteAt(event)));
  canvas.addEventListener("mousemove", (event) => {
    canvas.style.cursor = spriteAt(event) ? "pointer" : "default";
  });
  window.addEventListener("resize", fitToFrame);

  function draw(frameSeconds, seconds) {
    resizeToMap();
    drawFloorAndWalls();
    drawProps(seconds);
    drawSprites(frameSeconds);
    drawLighting(seconds);
    drawSelection(seconds);
    drawNameTags();
    if (fade > 0) {
      fade = Math.max(0, fade - frameSeconds * FADE_SPEED);
      context.fillStyle = `rgba(0, 0, 0, ${fade})`;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
  }

  let previousTime = performance.now();
  function animate(now) {
    const frameSeconds = Math.min(0.05, (now - previousTime) / 1000);
    previousTime = now;
    if (map) draw(frameSeconds, now / 1000);
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);

  return {
    showMap(newMap, newHealth = {}) {
      // An empty canvas shows as a black box, so it stays hidden until there is a map.
      canvas.hidden = !newMap;
      if (newMap && newMap.id !== map?.id) {
        fade = 1;
        for (const sprite of newMap.sprites) shownPositions[sprite.id] = { x: sprite.x, y: sprite.y };
      }
      map = newMap;
      health = newHealth;
    },
    setPartyIds(ids) {
      partyIds = new Set(ids);
    },
    setSelected(spriteId) {
      selectedId = spriteId;
    },
  };
}
