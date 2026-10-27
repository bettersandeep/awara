// The WebGL board (PixiJS). Same job as board.js, with motion: characters walk
// tile by tile around walls with a hop, breathe while idle, lunge, flinch and fall
// in combat, and act out the motions the narrator gives each story beat.
// Light is a soft light map multiplied over the world, with flickering flames.
// A tile is 32 world units; the world is scaled by a whole number to fit.
// Finer art (catalog tileSize 64) loads at a higher resolution, so a 2x screen shows every pixel.
import { Application, Assets, Container, Graphics, Rectangle, RenderTexture, Sprite, Text, Texture, TextureSource } from "/vendor/pixi.mjs";
import { findPath } from "./boardPath.js";
import { groundAt } from "./boardGround.js";
import { createDitherFilter } from "./boardDither.js";

const STEP_SECONDS = 0.17; // hop: one tile of walking
const GLIDE_TILES_PER_SECOND = 3.2; // glide: average speed of a whole walk
const MIN_GLIDE_SECONDS = 0.45;
const HOP = 3; // pixels of lift per step
const ANIMATION_FPS = 6; // prop frames
const LIGHT_TEXELS = 8; // light map texels per tile; smooth light
const AMBIENT = { torch: 0x6b6b85, dark: 0x262638 }; // what an unlit tile keeps
const LIGHTS = { torch: { radius: 4.5, tint: 0xffd6a8 }, fire: { radius: 5.5, tint: 0xffc890 }, party: { radius: 3.5, tint: 0xc8d2ff, alpha: 0.6 } };
const ARCANE = new Set(["wizard", "sorcerer", "necromancer", "lich", "bard"]);
const DIVINE = new Set(["cleric", "druid", "paladin"]);
const MAX_NAME_TAG_LENGTH = 10;
const IRIS_SECONDS = 0.8;

const cellHash = (x, y) => (Math.imul(x + 1, 73856093) ^ Math.imul(y + 1, 19349663)) >>> 0;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const bump = (p) => Math.sin(Math.PI * clamp(p));
const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);

// Each body motion: how long it lasts, and how it moves the body at progress p (0..1).
// These are the board's own motions; src/motions.ts lists the ones the narrator may use.
// `out` holds offsets in tile pixels: x, y, sx, sy, rot, alpha, flash, aura.
const BODY_MOTIONS = {
  talk: { seconds: 0.7, move: (p, out) => { out.y -= Math.abs(Math.sin(p * 3 * Math.PI)) * 1.5; out.sy += Math.sin(p * 6 * Math.PI) * 0.03; } },
  lunge: { seconds: 0.42, move: (p, out, m) => {
    const e = p < 0.35 ? 1 - (1 - p / 0.35) ** 3 : 1 - ease((p - 0.35) / 0.65);
    out.x += m.dir.x * 14 * e; out.y += m.dir.y * 14 * e; out.sx += 0.08 * e;
  } },
  recoil: { seconds: 0.25, move: (p, out, m) => { out.x -= m.dir.x * 3 * bump(p); out.y -= m.dir.y * 3 * bump(p); } },
  hurt: { seconds: 0.4, move: (p, out) => { out.x += Math.sin(p * 45) * 2.5 * (1 - p); out.flash = Math.max(out.flash, 1 - p); } },
  dodge: { seconds: 0.35, move: (p, out, m) => { out.x -= m.dir.y * 7 * bump(p); out.y += m.dir.x * 7 * bump(p) - 2 * bump(p); } },
  jump: { seconds: 0.5, move: (p, out) => { out.y -= bump(p) * 14; out.sy += p < 0.12 || p > 0.88 ? -0.12 : 0.06; } },
  cheer: { seconds: 0.85, move: (p, out) => { out.y -= Math.abs(Math.sin(p * 2 * Math.PI)) * 8; out.rot += Math.sin(p * 4 * Math.PI) * 0.12; } },
  cower: { seconds: 1.0, move: (p, out) => { out.sy -= 0.18 * bump(p); out.sx += 0.06 * bump(p); out.x += Math.sin(p * 55) * 0.9 * bump(p); } },
  shake: { seconds: 0.7, move: (p, out) => { out.x += Math.sin(p * 60) * 1.8 * (1 - p); out.rot += Math.sin(p * 40) * 0.05 * (1 - p); } },
  bow: { seconds: 0.9, move: (p, out, m) => { out.rot += 0.4 * bump(p) * m.facing; out.sy -= 0.08 * bump(p); } },
  spin: { seconds: 0.6, move: (p, out) => { out.sx *= Math.cos(2 * Math.PI * p); } },
  sneak: { seconds: 1.8, move: (p, out) => { out.sy -= 0.14 * bump(p); out.alpha *= 1 - 0.45 * bump(p); } },
  glow: { seconds: 1.4, move: (p, out) => { out.aura = Math.max(out.aura, bump(p)); out.y -= bump(p) * 2; } },
  vanish: { seconds: 2.2, move: (p, out) => { out.alpha *= p < 0.25 ? 1 - p / 0.25 : p > 0.8 ? (p - 0.8) / 0.2 : 0; } },
  appear: { seconds: 0.6, move: (p, out) => { out.alpha *= p; out.y -= (1 - ease(p)) * 18; } },
  land: { seconds: 0.12, move: (p, out) => { out.sy -= 0.14 * bump(p); out.sx += 0.1 * bump(p); } },
};

// look: "smooth" (soft light), or a dither look from boardDither.js
// motion: "hop" (a hop per tile) or "glide" (one eased glide along the whole path)
export async function createWebglBoard(frame, catalog, { onSelectSprite, look, motion }) {
  let motionStyle = motion;
  TextureSource.defaultOptions.scaleMode = "nearest";
  const app = new Application();
  await app.init({ width: 64, height: 64, background: 0x000000, antialias: false, resolution: window.devicePixelRatio || 1, autoDensity: true, preference: ["webgl"] });
  // Only WebGL: on WebGPU or canvas the dither filters would not run, and main.js
  // falls back to the canvas board when this throws.
  const canvas = app.canvas;
  canvas.id = "board-webgl";
  canvas.hidden = true;
  frame.appendChild(canvas);

  const files = [
    ...Object.values(catalog.tiles).flatMap((t) => t.files),
    ...Object.values(catalog.props).flatMap((p) => p.files),
    ...Object.values(catalog.sprites).map((s) => s.file),
  ];
  const T = 32;
  // Absolute URLs, so loading does not depend on the page path; the catalog path stays the name.
  const resolution = catalog.tileSize / T;
  await Assets.load(files.map((file) => ({ alias: file, src: new URL(file, document.baseURI).href, data: { resolution } })));
  const radial = radialTexture();

  // ---- layers ----
  const world = new Container();
  const floor = new Container();
  const props = new Container();
  const actorsLayer = new Container();
  actorsLayer.sortableChildren = true;
  const effects = new Container();
  const lightScene = new Container();
  let lightTexture = null;
  const lightSprite = new Sprite();
  lightSprite.blendMode = "multiply";
  const glows = new Container(); // added after the light: flames, magic and sparkles shine
  const flameGlows = new Container(); // rebuilt with the lights
  glows.addChild(flameGlows);
  world.addChild(floor, props, actorsLayer, effects, lightSprite, glows);
  const overlay = new Container(); // screen space: names, bars, numbers, selection
  const selection = new Graphics();
  const iris = new Graphics();
  overlay.addChild(selection);
  app.stage.addChild(world, overlay, iris);
  // Dithered light replaces the smooth light map; duotone and palette dither the whole lit board.
  // One filter serves every dither look; only its uniforms change.
  let ditherFilter = null;
  let dither = null; // the filter in use, or null for the smooth look
  function setLook(next) {
    if (next !== "smooth") (ditherFilter ??= createDitherFilter()).setLook(next);
    dither = next === "smooth" ? null : ditherFilter;
    const isLightOnly = next === "dither-light";
    lightSprite.blendMode = isLightOnly ? "normal" : "multiply"; // with the filter, the filter multiplies
    lightSprite.filters = isLightOnly ? [dither] : null;
    world.filters = dither && !isLightOnly ? [dither] : null;
  }
  setLook(look);

  let map = null;
  let tilesKey = "";
  let scale = 1;
  let partyIds = new Set();
  let selectedId = null;
  let irisStart = -1;
  let now = 0;
  const actors = new Map(); // sprite id -> actor
  const propSprites = []; // { sprite, art, seed, born }
  const lights = []; // { sprite, glow?, x, y, radius, tint, alpha, seed, actorId? }
  const particles = [];
  const timers = [];
  const floaters = []; // floating texts

  const later = (seconds, fn) => timers.push({ at: now + seconds, fn });
  const isWalkable = (x, y) => catalog.tiles[map.tiles[y]?.[x]]?.walkable ?? false;

  // ---- building the scene ----

  function rebuildFloor() {
    floor.removeChildren().forEach((c) => c.destroy());
    for (let y = 0; y < map.h; y++) {
      for (let x = 0; x < map.w; x++) {
        const tile = catalog.tiles[map.tiles[y][x]];
        if (!tile) continue;
        const ground = !tile.walkable && catalog.tiles[groundAt(catalog, map, x, y)];
        for (const art of ground ? [ground, tile] : [tile]) {
          const sprite = new Sprite(Texture.from(art.files[cellHash(x, y) % art.files.length]));
          sprite.position.set(x * T, y * T);
          floor.addChild(sprite);
        }
      }
    }
  }

  function rebuildProps(previousIds) {
    props.removeChildren().forEach((c) => c.destroy());
    propSprites.length = 0;
    for (const prop of map.props) {
      const art = catalog.props[prop.type];
      if (!art) continue;
      const sprite = new Sprite(Texture.from(art.files[0]));
      sprite.anchor.set(0.5, 1);
      sprite.position.set(prop.x * T + T / 2, prop.y * T + T);
      props.addChild(sprite);
      const isNew = previousIds && !previousIds.has(`${prop.id}:${prop.type}`);
      propSprites.push({ sprite, art, seed: cellHash(prop.x, prop.y), born: isNew ? now : -10 });
      if (isNew) puff(prop.x + 0.5, prop.y + 0.6, 0xcfc6b8, 8);
    }
  }

  function rebuildLights() {
    lightScene.removeChildren().forEach((c) => c.destroy());
    flameGlows.removeChildren().forEach((c) => c.destroy());
    lights.length = 0;
    for (const prop of map.props) {
      const kind = LIGHTS[prop.type];
      if (!kind) continue;
      const glow = new Sprite(radial);
      glow.anchor.set(0.5);
      glow.blendMode = "add";
      glow.tint = 0xff8a30;
      flameGlows.addChild(glow);
      addLight({ x: prop.x + 0.5, y: prop.y + 0.5, ...kind, glow, seed: cellHash(prop.x, prop.y) % 100 });
    }
    for (const id of partyIds) if (actors.has(id)) addLight({ ...LIGHTS.party, actorId: id, seed: 0 });
  }

  function addLight(light) {
    const sprite = new Sprite(radial);
    sprite.anchor.set(0.5);
    sprite.blendMode = "add";
    sprite.tint = light.tint;
    lightScene.addChild(sprite);
    lights.push({ alpha: 1, ...light, sprite });
  }

  function resize() {
    if (!map) return;
    const width = map.w * T;
    const height = map.h * T;
    scale = Math.max(1, Math.floor(Math.min(frame.clientWidth / width, frame.clientHeight / height)));
    app.renderer.resize(width * scale, height * scale);
    world.scale.set(scale);
    lightTexture?.destroy(true);
    lightTexture = RenderTexture.create({ width: map.w * LIGHT_TEXELS, height: map.h * LIGHT_TEXELS, scaleMode: "linear" });
    lightSprite.texture = lightTexture;
    lightSprite.scale.set(T / LIGHT_TEXELS);
    lightSprite.filterArea = world.filterArea = new Rectangle(0, 0, width * scale, height * scale);
  }

  // ---- actors ----

  function createActor(sprite, appearDelay) {
    const art = catalog.sprites[sprite.key];
    const root = new Container();
    const shadow = new Graphics().ellipse(0, -3, 10, 3.5).fill({ color: 0x000000, alpha: 0.38 });
    const body = new Sprite(art ? Texture.from(art.file) : Texture.WHITE);
    body.anchor.set(0.5, 0.5);
    const flash = new Sprite(body.texture);
    flash.anchor.set(0.5, 0.5);
    flash.blendMode = "add";
    flash.alpha = 0;
    root.addChild(shadow, body, flash);
    actorsLayer.addChild(root);
    const aura = new Sprite(radial);
    aura.anchor.set(0.5);
    aura.blendMode = "add";
    aura.tint = ARCANE.has(sprite.key) ? 0xa070ff : DIVINE.has(sprite.key) ? 0xffd77a : 0x9ad0ff;
    aura.alpha = 0;
    glows.addChild(aura);
    const tag = new Text({ text: "", style: { fontFamily: "monospace", fontSize: 10, fill: 0xffe9a8 } });
    tag.anchor.set(0.5, 1);
    const tagBack = new Graphics();
    const bar = new Graphics();
    overlay.addChild(tagBack, tag, bar);
    const actor = {
      id: sprite.id, key: sprite.key, tile: { x: sprite.x, y: sprite.y }, pos: { x: sprite.x, y: sprite.y },
      path: [], along: 0, glide: null, facing: 1, motions: [], phase: (cellHash(sprite.x, sprite.y) % 1000) / 1000,
      lying: 0, pose: null, state: "up", health: undefined, removing: -1, name: sprite.name,
      isCaster: ARCANE.has(sprite.key) || DIVINE.has(sprite.key), root, shadow, body, flash, aura, tag, tagBack, bar,
    };
    actors.set(sprite.id, actor);
    startMotion(actor, "appear", { delay: appearDelay });
    return actor;
  }

  function removeActor(actor) {
    actor.removing = now;
    puff(actor.pos.x + 0.5, actor.pos.y + 0.6, 0x9a90b0, 10);
  }

  function destroyActor(actor) {
    for (const node of [actor.root, actor.aura, actor.tag, actor.tagBack, actor.bar]) node.destroy();
    actors.delete(actor.id);
  }

  function startMotion(actor, name, { target, delay = 0 } = {}) {
    if (!actor || !BODY_MOTIONS[name]) return;
    const dir = directionTo(actor, target);
    if (target && Math.abs(dir.x) > 0.2) actor.facing = Math.sign(dir.x);
    actor.motions.push({ name, start: now + delay, duration: BODY_MOTIONS[name].seconds, dir, facing: actor.facing });
  }

  function directionTo(actor, target) {
    if (!target) return { x: actor.facing, y: 0 };
    const dx = target.pos.x - actor.pos.x;
    const dy = target.pos.y - actor.pos.y;
    const length = Math.hypot(dx, dy) || 1;
    return { x: dx / length, y: dy / length };
  }

  // A walk is `path` (the tiles) and `along`, how far along it the character is:
  // 2.25 is a quarter of the way from path[2] to path[3]. Hop and glide differ only
  // in how `along` grows, so switching style in the middle of a walk keeps the place.
  function walkTo(actor, x, y) {
    if (actor.tile.x === x && actor.tile.y === y) return;
    const from = actor.path.length ? actor.path.at(-1) : { x: Math.round(actor.pos.x), y: Math.round(actor.pos.y) };
    const path = findPath(map, isWalkable, from, { x, y });
    actor.path = actor.path.length ? [...actor.path, ...path.slice(1)] : path;
    actor.tile = { x, y };
    actor.pose = null; // a walking character is standing
    if (motionStyle === "glide") startGlide(actor);
  }

  // Glide: `along` follows an ease-in-out curve over the rest of the walk, so the
  // character sets off, travels and settles, like the moon in shirokujaku.
  // It stays on the path, so it never cuts through a wall.
  function startGlide(actor) {
    const tiles = actor.path.length - 1 - actor.along;
    actor.glide = { from: actor.along, start: now, duration: Math.max(MIN_GLIDE_SECONDS, tiles / GLIDE_TILES_PER_SECOND) };
  }

  function setMotion(next) {
    motionStyle = next;
    for (const actor of actors.values()) {
      actor.glide = null;
      if (next === "glide" && actor.path.length > 1) startGlide(actor);
    }
  }

  // Moves the character along its path; returns the hop height in tile pixels.
  function walk(actor, dt) {
    const last = actor.path.length - 1;
    let hop = 0;
    if (actor.glide) {
      const { from, start, duration } = actor.glide;
      const p = clamp((now - start) / duration);
      const eased = 0.5 - 0.5 * Math.cos(Math.PI * p);
      actor.along = from * (1 - eased) + last * eased; // exactly `last` at the end
    } else {
      // Hop: one tile per STEP_SECONDS; a hop stops on its tile, so every tile gets a landing.
      const step = Math.floor(actor.along);
      actor.along = Math.min(step + 1, actor.along + dt / STEP_SECONDS);
      hop = bump(actor.along - step) * HOP;
      if (actor.along === step + 1) {
        startMotion(actor, "land");
        if (Math.random() < 0.6) puff(actor.path[step + 1].x + 0.5, actor.path[step + 1].y + 0.95, 0xa89070, 3);
      }
    }
    // On a tile, the step that ended there sets the facing.
    const index = Math.max(0, Math.ceil(actor.along) - 1);
    const a = actor.path[index];
    const b = actor.path[index + 1];
    const t = actor.along - index;
    if (b.x !== a.x) actor.facing = Math.sign(b.x - a.x);
    actor.pos.x = a.x + (b.x - a.x) * t;
    actor.pos.y = a.y + (b.y - a.y) * t;
    if (actor.along >= last) {
      actor.path = [];
      actor.along = 0;
      actor.glide = null;
    }
    return hop;
  }

  function updateActor(actor, dt) {
    const out = { x: 0, y: 0, sx: 1, sy: 1, rot: 0, alpha: 1, flash: 0, aura: 0 };
    // walking
    let hop = 0;
    if (actor.path.length > 1) {
      hop = walk(actor, dt);
    } else {
      // idle: breathing and a slow bob, each actor on its own rhythm
      const t = now * 2.2 + actor.phase * 6.28;
      out.y += Math.sin(t) * 0.7 * (1 - actor.lying);
      out.sy += Math.sin(t) * 0.025 * (1 - actor.lying);
      out.sx -= Math.sin(t) * 0.012 * (1 - actor.lying);
    }
    out.y -= hop;
    // motions
    actor.motions = actor.motions.filter((m) => now < m.start + m.duration);
    for (const m of actor.motions) {
      if (now < m.start) {
        if (m.name === "appear") out.alpha = 0; // hidden until it appears
        continue;
      }
      if (!m.begun) {
        m.begun = true;
        if (m.name === "vanish" || m.name === "appear") puff(actor.pos.x + 0.5, actor.pos.y + 0.6, 0xcfc6b8, 12);
      }
      BODY_MOTIONS[m.name].move((now - m.start) / m.duration, out, m);
    }
    // lying down: dying, dead, or told to fall
    const lie = actor.pose === "lying" || actor.state === "dying" || actor.state === "dead" ? 1 : 0;
    actor.lying += clamp(lie - actor.lying, -dt * 3, dt * 3);
    const dead = actor.state === "dead";
    // removal fade
    if (actor.removing >= 0) {
      const p = (now - actor.removing) / 0.4;
      if (p >= 1) return destroyActor(actor);
      out.alpha *= 1 - p;
    }
    // apply
    const { root, body, flash, shadow, aura } = actor;
    root.position.set((actor.pos.x + 0.5) * T + out.x, (actor.pos.y + 1) * T);
    root.zIndex = actor.pos.y * 100 + actor.pos.x;
    root.alpha = out.alpha * (dead ? 0.6 : 1);
    const sx = out.sx * actor.facing;
    body.scale.set(sx, out.sy);
    body.rotation = out.rot + actor.lying * (Math.PI / 2) * actor.facing;
    body.position.set(0, -T / 2 * out.sy + out.y + actor.lying * 8);
    body.tint = dead ? 0x8a8090 : 0xffffff;
    flash.scale.copyFrom(body.scale);
    flash.rotation = body.rotation;
    flash.position.copyFrom(body.position);
    flash.alpha = out.flash * 0.85;
    shadow.scale.set(1 - hop / 10 + 0.3 * actor.lying, 1);
    shadow.alpha = 1 - hop / 8;
    // caster aura: a faint idle pulse, bright while casting
    const idleAura = actor.isCaster ? 0.1 + 0.05 * Math.sin(now * 3 + actor.phase * 6) : 0;
    aura.position.set(root.position.x, root.position.y - T / 2 + out.y);
    aura.scale.set((T * 1.6) / radial.width);
    aura.alpha = Math.max(idleAura, out.aura * 0.7) * out.alpha * (1 - actor.lying);
    updateLabels(actor, out);
  }

  // Name tag above or below by column, and the HP bar under a hurt character.
  function updateLabels(actor, out) {
    const sx = ((actor.pos.x + 0.5) * T + out.x) * scale;
    const top = actor.pos.y * T * scale;
    const bottom = (actor.pos.y + 1) * T * scale;
    const name = actor.name ?? "";
    const label = name.length > MAX_NAME_TAG_LENGTH ? `${name.slice(0, MAX_NAME_TAG_LENGTH - 1)}…` : name;
    const fontSize = 10 * Math.max(1, scale * 0.75);
    const isParty = partyIds.has(actor.id);
    if (actor.tag.text !== label || actor.tag.style.fontSize !== fontSize) {
      actor.tag.text = label;
      actor.tag.style.fontSize = fontSize;
      actor.tag.style.fill = isParty ? 0xffe9a8 : 0xff9b9b;
    }
    const below = actor.tile.x % 2 === 1;
    actor.tag.position.set(sx, below ? bottom + fontSize + 3 : top - 2);
    actor.tag.alpha = label ? Math.min(1, out.alpha + 0.2) : 0;
    const w = actor.tag.width + 6;
    actor.tagBack.clear();
    if (label) actor.tagBack.rect(sx - w / 2, actor.tag.y - fontSize - 2, w, fontSize + 3).fill({ color: 0x000000, alpha: 0.6 * actor.tag.alpha });
    const health = actor.health;
    actor.bar.clear();
    if (health !== undefined && health < 1) {
      const width = 22 * scale;
      const left = sx - width / 2;
      const y = bottom - 5 * scale;
      const color = health > 0.5 ? 0x7bc96f : health > 0.25 ? 0xe3c35a : 0xe0483e;
      actor.bar.rect(left - scale, y - scale, width + 2 * scale, 6 * scale).fill(0x000000)
        .rect(left, y, width, 4 * scale).fill(0x3a1820)
        .rect(left, y, Math.round(width * Math.max(0, health)), 4 * scale).fill(color);
      actor.bar.alpha = out.alpha;
    }
  }

  // ---- particles, projectiles and floating text ----

  function puff(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 6 + Math.random() * 16;
      spawnParticle({ x: x * T, y: y * T, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed * 0.5 - 6, color, size: 2 + Math.random() * 2, life: 0.5 + Math.random() * 0.3, layer: effects, gravity: -8 });
    }
  }

  function sparkle(x, y, color, count, layer = glows) {
    for (let i = 0; i < count; i++) {
      spawnParticle({ x: x * T + (Math.random() - 0.5) * T * 0.8, y: y * T - Math.random() * T * 0.6, vx: (Math.random() - 0.5) * 8, vy: -14 - Math.random() * 18, color, size: 1.5 + Math.random() * 1.5, life: 0.8 + Math.random() * 0.6, layer, gravity: 0, add: true });
    }
  }

  function spawnParticle(p) {
    const sprite = new Sprite(Texture.WHITE);
    sprite.anchor.set(0.5);
    sprite.tint = p.color;
    sprite.width = sprite.height = p.size;
    if (p.add) sprite.blendMode = "add";
    p.layer.addChild(sprite);
    particles.push({ ...p, sprite, age: 0 });
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.age += dt;
      if (p.age >= p.life) {
        p.sprite.destroy();
        particles.splice(i, 1);
        continue;
      }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.sprite.position.set(Math.round(p.x), Math.round(p.y));
      p.sprite.alpha = 1 - p.age / p.life;
    }
  }

  // A glowing orb (magic) or an arrow flying from one actor to another.
  function projectile(from, to, { kind, seconds, onHit }) {
    const node = kind === "arrow" ? new Graphics().rect(-6, -0.75, 12, 1.5).fill(0xe8dcc0).rect(4, -1.5, 3, 3).fill(0xcfd6e0) : new Sprite(radial);
    if (kind !== "arrow") {
      node.anchor.set(0.5);
      node.blendMode = "add";
      node.tint = kind === "heal" ? 0x8dffa0 : 0xc49bff;
      node.scale.set(14 / radial.width);
    }
    (kind === "arrow" ? effects : glows).addChild(node);
    const start = now;
    const sx = (from.pos.x + 0.5) * T, sy = (from.pos.y + 0.4) * T;
    const ex = (to.pos.x + 0.5) * T, ey = (to.pos.y + 0.4) * T;
    const arc = kind === "arrow" ? 6 : 14;
    const fly = () => {
      const p = clamp((now - start) / seconds);
      const x = sx + (ex - sx) * p;
      const y = sy + (ey - sy) * p - bump(p) * arc;
      node.position.set(x, y);
      // the arrow points along the slope of its flight path
      if (kind === "arrow") node.rotation = Math.atan2(ey - sy - Math.PI * arc * Math.cos(Math.PI * p), ex - sx);
      else sparkle(x / T, y / T + 0.2, node.tint, 1);
      if (p >= 1) {
        node.destroy();
        onHit?.();
        return true;
      }
      return false;
    };
    timers.push({ at: now, fn: fly, repeat: true });
  }

  function floatText(text, x, y, color, size = 12) {
    const node = new Text({ text, style: { fontFamily: "monospace", fontSize: size * Math.max(1, scale * 0.8), fontWeight: "bold", fill: color, stroke: { color: 0x000000, width: 3 } } });
    node.anchor.set(0.5, 1);
    overlay.addChild(node);
    floaters.push({ node, x, y, age: 0 });
  }

  function updateFloaters(dt) {
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      f.age += dt;
      if (f.age > 1.1) {
        f.node.destroy();
        floaters.splice(i, 1);
        continue;
      }
      f.node.position.set((f.x + 0.5) * T * scale, (f.y * T - f.age * 18 - 4) * scale);
      f.node.alpha = f.age < 0.8 ? 1 : 1 - (f.age - 0.8) / 0.3;
    }
  }

  // ---- rule effects ----

  function hurt(target, attacker, damage, crit) {
    startMotion(target, "hurt", { target: attacker });
    floatText(crit ? `CRIT -${damage}` : `-${damage}`, target.pos.x, target.pos.y, crit ? 0xffd75a : 0xff6b5b, crit ? 15 : 12);
    for (let i = 0; i < Math.min(10, 3 + damage); i++) {
      spawnParticle({ x: (target.pos.x + 0.5) * T, y: (target.pos.y + 0.5) * T, vx: (Math.random() - 0.5) * 40, vy: -20 - Math.random() * 20, color: 0xb02030, size: 2, life: 0.5, layer: effects, gravity: 90 });
    }
  }

  function heal(target, amount) {
    target.pose = null;
    sparkle(target.pos.x + 0.5, target.pos.y + 0.9, 0x8dffa0, 14);
    floatText(`+${amount}`, target.pos.x, target.pos.y, 0x8dffa0);
  }

  function playEffect(effect) {
    if (!map) return;
    const get = (id) => (id ? actors.get(id) : undefined);
    if (effect.kind === "attack") {
      const attacker = get(effect.attacker);
      const target = get(effect.target);
      const impact = () => {
        if (!target) return;
        if (effect.hit) hurt(target, attacker, effect.damage, effect.crit);
        else {
          startMotion(target, "dodge", { target: attacker });
          floatText("miss", target.pos.x, target.pos.y, 0xb8b0c8, 10);
        }
      };
      if (attacker && target && effect.ranged) {
        startMotion(attacker, "recoil", { target });
        projectile(attacker, target, { kind: "arrow", seconds: 0.3, onHit: impact });
      } else {
        startMotion(attacker, "lunge", { target });
        later(attacker ? 0.15 : 0, impact);
      }
    } else if (effect.kind === "spell") {
      const caster = get(effect.caster);
      const target = get(effect.target);
      if (!effect.success) {
        if (caster) {
          puff(caster.pos.x + 0.5, caster.pos.y + 0.4, 0x777777, 8);
          floatText("fizzle", caster.pos.x, caster.pos.y, 0xb8b0c8, 10);
        }
        return;
      }
      startMotion(caster, "glow");
      if (effect.spell === "magic missile" && caster && target) {
        const count = effect.missiles;
        for (let i = 0; i < count; i++) {
          later(0.25 + i * 0.12, () => projectile(caster, target, { kind: "magic", seconds: 0.45, onHit: () => (i === count - 1 ? hurt(target, caster, effect.amount, false) : startMotion(target, "hurt")) }));
        }
      } else if (target) {
        later(0.35, () => heal(target, effect.amount));
      }
    } else if (effect.kind === "damage") {
      const target = get(effect.target);
      if (target) hurt(target, null, effect.amount, false);
    } else if (effect.kind === "heal") {
      const target = get(effect.target);
      if (target) heal(target, effect.amount);
    } else if (effect.kind === "rest") {
      for (const id of effect.ids) {
        const actor = get(id);
        if (!actor) continue;
        floatText("z z", actor.pos.x, actor.pos.y, 0xc8d2ff, 10);
        sparkle(actor.pos.x + 0.5, actor.pos.y + 0.9, 0xb48cf0, 6);
      }
    }
  }

  // Motions from the narration: [{ id, action, target }].
  function playMotions(motions) {
    for (const { id, action, target } of motions ?? []) {
      const actor = actors.get(id);
      if (!actor) continue;
      if (action === "fall") actor.pose = "lying";
      else if (action === "rise") actor.pose = null;
      else startMotion(actor, action, { target: actors.get(target) });
    }
  }

  // ---- frame ----

  function updateLights() {
    lightSprite.visible = map.lighting !== "day";
    for (const light of lights) {
      const actor = light.actorId ? actors.get(light.actorId) : null;
      if (light.actorId && !actor) {
        light.sprite.visible = false;
        continue;
      }
      const x = actor ? actor.pos.x + 0.5 : light.x;
      const y = actor ? actor.pos.y + 0.5 : light.y;
      const flicker = actor ? 1 : 1 + 0.06 * Math.sin(now * 9 + light.seed) + 0.04 * Math.sin(now * 23 + light.seed * 2);
      light.sprite.visible = true;
      light.sprite.position.set(x * LIGHT_TEXELS, y * LIGHT_TEXELS);
      light.sprite.scale.set((light.radius * 2 * LIGHT_TEXELS * flicker) / radial.width);
      light.sprite.alpha = light.alpha * (0.92 + 0.08 * flicker);
      if (light.glow) {
        light.glow.position.set(x * T, y * T);
        light.glow.scale.set((T * 2.6 * flicker) / radial.width);
        light.glow.alpha = (map.lighting === "day" ? 0.12 : 0.28) * flicker;
      }
    }
    if (lightSprite.visible) {
      app.renderer.render({ container: lightScene, target: lightTexture, clear: true, clearColor: AMBIENT[map.lighting] ?? AMBIENT.torch });
    }
  }

  function updateProps() {
    for (const p of propSprites) {
      const frameIndex = (Math.floor(now * ANIMATION_FPS) + p.seed) % p.art.files.length;
      p.sprite.texture = Texture.from(p.art.files[frameIndex]);
      const grow = clamp((now - p.born) / 0.3);
      p.sprite.scale.set(grow < 1 ? 0.6 + 0.4 * ease(grow) + 0.1 * bump(grow) : 1);
    }
  }

  function updateSelection() {
    selection.clear();
    const actor = actors.get(selectedId);
    if (!actor || actor.removing >= 0) return;
    const left = actor.pos.x * T * scale;
    const top = actor.pos.y * T * scale;
    const size = T * scale;
    const arm = 7 * scale;
    const thick = 2 * scale;
    const alpha = 0.65 + 0.35 * Math.sin(now * 5);
    for (const [cx, cy, dx, dy] of [[0, 0, 1, 1], [size, 0, -1, 1], [0, size, 1, -1], [size, size, -1, -1]]) {
      selection.rect(left + cx - (dx < 0 ? arm : 0), top + cy - (dy < 0 ? thick : 0), arm, thick)
        .rect(left + cx - (dx < 0 ? thick : 0), top + cy - (dy < 0 ? arm : 0), thick, arm);
    }
    selection.fill({ color: 0xffd75a, alpha });
  }

  // A circle opens from the player when the party enters a new map.
  function updateIris() {
    iris.clear();
    if (irisStart < 0) return;
    const p = (now - irisStart) / IRIS_SECONDS;
    if (p >= 1) {
      irisStart = -1;
      return;
    }
    const width = map.w * T * scale;
    const height = map.h * T * scale;
    const hero = [...actors.values()].find((a) => partyIds.has(a.id)) ?? { pos: { x: map.w / 2, y: map.h / 2 } };
    const cx = (hero.pos.x + 0.5) * T * scale;
    const cy = (hero.pos.y + 0.5) * T * scale;
    iris.rect(0, 0, width, height).fill(0x000000).circle(cx, cy, Math.hypot(width, height) * ease(p)).cut();
  }

  app.ticker.add((ticker) => {
    const dt = Math.min(0.05, ticker.deltaMS / 1000);
    now += dt;
    if (!map) return;
    for (let i = timers.length - 1; i >= 0; i--) {
      const timer = timers[i];
      if (now < timer.at) continue;
      const done = timer.fn();
      if (!timer.repeat || done) timers.splice(i, 1);
    }
    updateProps();
    for (const actor of [...actors.values()]) updateActor(actor, dt);
    updateParticles(dt);
    updateFloaters(dt);
    updateLights();
    dither?.update(now, map.w * T * scale, map.h * T * scale, AMBIENT[map.lighting] ?? AMBIENT.torch);
    updateSelection();
    updateIris();
  });

  // ---- input ----

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
  window.addEventListener("resize", resize);

  return {
    showMap(newMap, health = {}, states = {}) {
      canvas.hidden = !newMap;
      if (!newMap) {
        map = null;
        return;
      }
      const isNewMap = newMap.id !== map?.id;
      const previousProps = map && !isNewMap ? new Set(map.props.map((p) => `${p.id}:${p.type}`)) : null;
      map = newMap;
      if (isNewMap) {
        for (const actor of [...actors.values()]) destroyActor(actor);
        // Effects still flying belong to the old map.
        timers.length = 0;
        for (const p of particles.splice(0)) p.sprite.destroy();
        for (const f of floaters.splice(0)) f.node.destroy();
        resize();
        irisStart = now;
      }
      const newTilesKey = JSON.stringify(newMap.tiles);
      if (isNewMap || newTilesKey !== tilesKey) rebuildFloor();
      tilesKey = newTilesKey;
      rebuildProps(previousProps);
      const seen = new Set();
      newMap.sprites.forEach((sprite, index) => {
        seen.add(sprite.id);
        let actor = actors.get(sprite.id);
        // The same id with other art (removed and added back): a new actor shows the new art.
        if (actor && actor.key !== sprite.key) {
          destroyActor(actor);
          actor = undefined;
        }
        actor ??= createActor(sprite, isNewMap ? 0.25 + index * 0.08 : 0);
        actor.name = sprite.name;
        actor.health = health[sprite.id];
        actor.state = states[sprite.id] ?? "up";
        if (actor.removing >= 0) actor.removing = -1;
        walkTo(actor, sprite.x, sprite.y);
      });
      for (const actor of actors.values()) if (!seen.has(actor.id) && actor.removing < 0) removeActor(actor);
      rebuildLights();
    },
    setPartyIds(ids) {
      partyIds = new Set(ids);
      if (map) rebuildLights();
    },
    setSelected(spriteId) {
      selectedId = spriteId;
    },
    playEffect,
    playMotions,
    setLook,
    setMotion,
  };
}

// A soft white disc that fades to transparent; tinted for lights, glows and orbs.
function radialTexture() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.45, "rgba(255,255,255,0.65)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = Texture.from(canvas);
  texture.source.scaleMode = "linear";
  return texture;
}
