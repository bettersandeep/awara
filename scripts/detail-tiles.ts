// One-time detail pass over public/tiles, run after curate-tiles.ts. Every file
// doubles from 32 to 64 pixels with Scale2x (a pixel-art scaler that keeps edges
// hard), then:
//   sprites and props: a rim light from the top left, a form shadow on the bottom
//                      right and fine texture, inside the original dark outline
//   walls:             relief on every stone
//   floors:            lighter relief, so characters stay on top
// The boards keep 32 units per tile, so the extra pixels show on 2x screens.
// Usage: node scripts/detail-tiles.ts
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import type { Catalog } from "../src/scene/world.ts";

const publicDir = join(import.meta.dirname, "..", "public");
const catalogPath = join(publicDir, "catalog.json");
const catalog: Catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
if (catalog.tileSize !== 32) throw new Error(`Tiles are already ${catalog.tileSize} pixels. Run curate-tiles.ts first.`);

type Kind = "sprite" | "wall" | "floor";
const OUTLINE_LUMA = 45; // darker pixels are the DCSS outline or a baked shadow

const clamp = (value: number) => (value < 0 ? 0 : value > 255 ? 255 : value);
const luma = (data: Buffer, i: number) => 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
// Stable per-pixel noise in [-0.5, 0.5), so a run gives the same files every time.
const grain = (x: number, y: number, seed: number) =>
  ((Math.imul(x * 73856093 ^ y * 19349663 ^ seed * 83492791, 2654435761) >>> 0) % 1000) / 1000 - 0.5;

function scale2x(source: Buffer, width: number, height: number): Buffer {
  const out = Buffer.alloc(width * height * 16);
  const at = (x: number, y: number) => (Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))) * 4;
  const same = (a: number, b: number) => source.readUInt32LE(a) === source.readUInt32LE(b);
  const put = (x: number, y: number, from: number) => source.copy(out, (y * width * 2 + x) * 4, from, from + 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = at(x, y), up = at(x, y - 1), right = at(x + 1, y), left = at(x - 1, y), down = at(x, y + 1);
      put(2 * x, 2 * y, same(left, up) && !same(left, down) && !same(up, right) ? up : p);
      put(2 * x + 1, 2 * y, same(up, right) && !same(up, left) && !same(right, down) ? right : p);
      put(2 * x, 2 * y + 1, same(down, left) && !same(down, right) && !same(left, up) ? left : p);
      put(2 * x + 1, 2 * y + 1, same(right, down) && !same(right, up) && !same(down, left) ? down : p);
    }
  }
  return out;
}

// Unsharp mask with a 3x3 box blur over opaque pixels; alpha is kept.
function sharpen(data: Buffer, width: number, height: number, amount: number) {
  const source = Buffer.from(data);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (source[i + 3] === 0) continue;
      for (let c = 0; c < 3; c++) {
        let sum = 0, count = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const j = (ny * width + nx) * 4;
            if (source[j + 3] === 0) continue;
            sum += source[j + c];
            count++;
          }
        }
        data[i + c] = clamp(source[i + c] + amount * (source[i + c] - sum / count));
      }
    }
  }
}

function detailSprite(data: Buffer, width: number, height: number, seed: number) {
  sharpen(data, width, height, 0.8);
  const source = Buffer.from(data);
  const solid = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < width && y < height && source[(y * width + x) * 4 + 3] > 0 && luma(source, (y * width + x) * 4) > OUTLINE_LUMA;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!solid(x, y)) continue;
      // distance (1 or 2) to the outline above or left, and below or right
      let lit = 0, shaded = 0;
      for (let k = 1; k <= 2; k++) {
        if (!lit && (!solid(x, y - k) || !solid(x - k, y))) lit = k;
        if (!shaded && (!solid(x, y + k) || !solid(x + k, y))) shaded = k;
      }
      let factor = 1 + grain(x, y, seed) * 0.07;
      if (lit) factor += lit === 1 ? 0.32 : 0.14;
      else if (shaded) factor -= shaded === 1 ? 0.24 : 0.1;
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        data[i + c] = clamp(factor > 1 ? source[i + c] + (255 - source[i + c]) * (factor - 1) : source[i + c] * factor);
      }
    }
  }
}

// Emboss lit from the top left: the slope from the upper-left to the lower-right
// neighbour lightens or darkens each pixel. Neighbours wrap, so tiles stay seamless.
function detailTile(data: Buffer, width: number, height: number, seed: number, relief: number) {
  sharpen(data, width, height, relief === 1 ? 0.5 : 0.2);
  const source = Buffer.from(data);
  const lumaAt = (x: number, y: number) => luma(source, (((y + height) % height) * width + ((x + width) % width)) * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const slope = lumaAt(x - 1, y - 1) - lumaAt(x + 1, y + 1);
      const light = Math.max(-0.22, Math.min(0.22, slope / 160)) * relief;
      const factor = 1 + light + grain(x, y, seed) * 0.08;
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) data[i + c] = clamp(source[i + c] * factor);
    }
  }
}

async function detail(file: string, kind: Kind, seed: number) {
  const path = join(publicDir, file);
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const width = info.width * 2, height = info.height * 2;
  const big = scale2x(data, info.width, info.height);
  if (kind === "sprite") detailSprite(big, width, height, seed);
  else detailTile(big, width, height, seed, kind === "wall" ? 1 : 0.4);
  await sharp(big, { raw: { width, height, channels: 4 } }).png().toFile(path);
}

let seed = 0;
for (const [key, tile] of Object.entries(catalog.tiles)) {
  for (const file of tile.files) await detail(file, key.startsWith("wall") ? "wall" : "floor", seed++);
}
for (const prop of Object.values(catalog.props)) for (const file of prop.files) await detail(file, "sprite", seed++);
for (const sprite of Object.values(catalog.sprites)) await detail(sprite.file, "sprite", seed++);

catalog.tileSize *= 2;
writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Added detail to ${seed} files; tiles are now ${catalog.tileSize} pixels.`);
