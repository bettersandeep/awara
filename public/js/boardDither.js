// Ordered-dither looks for the WebGL board, after shirokujaku: an 8x8 Bayer
// threshold at one dot per CSS pixel, with a threshold that jitters over time so
// bright areas shimmer.
//   "dither-light": the light map is dithered between a few levels; art keeps its colour
//   "duotone":      the whole lit board becomes ink and cream dots
//   "palette":      the whole lit board is dithered to the 16 PICO-8 colours
import { Filter, GlProgram } from "/vendor/pixi.mjs";

export const DITHER_LOOKS = ["dither-light", "duotone", "palette"];

const VERTEX = `
in vec2 aPosition;
out vec2 vTextureCoord;
out vec2 vArea; // 0..1 across the filtered area
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
void main(void) {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  gl_Position = vec4(position, 0.0, 1.0);
  vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
  vArea = aPosition;
}`;

const FRAGMENT = `
in vec2 vTextureCoord;
in vec2 vArea;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec2 uSize;   // filtered area in CSS pixels
uniform float uTime;
uniform float uLook;  // 0 dither-light, 1 duotone, 2 palette
uniform vec3 uAmbient; // the unlit level of the light map

float hash(vec2 p) { vec3 q = fract(p.xyx * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + 1.0), f.x), f.y);
}
float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float bayer8(vec2 a) { return bayer2(0.25 * a) * 0.0625 + bayer2(0.5 * a) * 0.25 + bayer2(a); }

// The PICO-8 palette. A function, not an array: WebGL 1 has no array constructors.
vec3 pico(int i) {
  if (i == 0) return vec3(0.0);
  if (i == 1) return vec3(0.114, 0.169, 0.325);
  if (i == 2) return vec3(0.494, 0.145, 0.325);
  if (i == 3) return vec3(0.0, 0.529, 0.318);
  if (i == 4) return vec3(0.671, 0.322, 0.212);
  if (i == 5) return vec3(0.373, 0.341, 0.310);
  if (i == 6) return vec3(0.761, 0.765, 0.780);
  if (i == 7) return vec3(1.0, 0.945, 0.910);
  if (i == 8) return vec3(1.0, 0.0, 0.302);
  if (i == 9) return vec3(1.0, 0.639, 0.0);
  if (i == 10) return vec3(1.0, 0.925, 0.153);
  if (i == 11) return vec3(0.0, 0.894, 0.212);
  if (i == 12) return vec3(0.161, 0.678, 1.0);
  if (i == 13) return vec3(0.514, 0.463, 0.612);
  if (i == 14) return vec3(1.0, 0.467, 0.659);
  return vec3(1.0, 0.8, 0.667);
}

void main() {
  vec4 color = texture(uTexture, vTextureCoord);
  vec2 cell = floor(vArea * uSize); // one dot per CSS pixel
  float luma = dot(color.rgb, vec3(0.299, 0.587, 0.114));
  float jitter = ((noise(cell * 0.15 + uTime * 1.3) - 0.5) * 0.15 + 0.07 * sin(uTime * 2.0 + hash(cell * 0.2) * 6.28))
    * smoothstep(0.45, 0.9, luma);
  float threshold = clamp(bayer8(cell) + jitter, 0.001, 0.999);
  if (uLook < 0.5) {
    // each dot is either unlit (ambient) or fully lit in the light's own colour
    float ambient = dot(uAmbient, vec3(0.299, 0.587, 0.114));
    float lit = step(threshold, clamp((luma - ambient) / (1.0 - ambient), 0.0, 1.0));
    vec3 hue = color.rgb / max(max(color.r, max(color.g, color.b)), 0.001);
    finalColor = vec4(mix(uAmbient, hue, lit), 1.0);
  } else if (uLook < 1.5) {
    float ink = step(threshold, pow(luma, 0.85) * 1.15);
    finalColor = vec4(mix(vec3(0.067), vec3(0.91, 0.835, 0.718), ink), color.a);
  } else {
    vec3 target = color.rgb + (threshold - 0.5) * 0.22;
    vec3 best = pico(0);
    float bestDistance = 9.0;
    for (int i = 0; i < 16; i++) {
      vec3 d = target - pico(i);
      float distance = dot(d, d);
      if (distance < bestDistance) { bestDistance = distance; best = pico(i); }
    }
    finalColor = vec4(best, color.a);
  }
}`;

export function createDitherFilter(look) {
  const filter = new Filter({
    glProgram: GlProgram.from({ vertex: VERTEX, fragment: FRAGMENT, name: "awara-dither" }),
    resources: {
      ditherUniforms: {
        uSize: { value: new Float32Array([1, 1]), type: "vec2<f32>" },
        uTime: { value: 0, type: "f32" },
        uLook: { value: DITHER_LOOKS.indexOf(look), type: "f32" },
        uAmbient: { value: new Float32Array([0.42, 0.42, 0.52]), type: "vec3<f32>" },
      },
    },
  });
  // The dithered light multiplies the scene, as the smooth light map does.
  if (look === "dither-light") filter.blendMode = "multiply";
  const uniforms = filter.resources.ditherUniforms.uniforms;
  filter.update = (seconds, widthCss, heightCss, ambient = 0x6b6b85) => {
    uniforms.uTime = seconds;
    uniforms.uAmbient[0] = ((ambient >> 16) & 255) / 255;
    uniforms.uAmbient[1] = ((ambient >> 8) & 255) / 255;
    uniforms.uAmbient[2] = (ambient & 255) / 255;
    uniforms.uSize[0] = widthCss;
    uniforms.uSize[1] = heightCss;
  };
  return filter;
}
