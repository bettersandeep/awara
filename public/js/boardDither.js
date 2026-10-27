// Ordered-dither looks for the WebGL board, after shirokujaku: an 8x8 Bayer
// threshold at one dot per CSS pixel, with a threshold that jitters over time so
// bright areas shimmer.
//   "dither-light": the light map is dithered between a few levels; art keeps its colour
//   "duotone":      the whole lit board becomes ink and cream dots
//   "palette":      the whole lit board is dithered to 16 colours (DawnBringer 16)
import { Filter, GlProgram } from "/vendor/pixi.mjs";

const DITHER_LOOKS = ["dither-light", "duotone", "palette"];

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

// DawnBringer's 16-colour palette, made for pixel art: it has the browns, ember
// orange and muted greens of these tiles. A function, not an array: WebGL 1 has no
// array constructors.
vec3 palette(int i) {
  if (i == 0) return vec3(0.078, 0.047, 0.110);
  if (i == 1) return vec3(0.267, 0.141, 0.204);
  if (i == 2) return vec3(0.188, 0.204, 0.427);
  if (i == 3) return vec3(0.306, 0.290, 0.306);
  if (i == 4) return vec3(0.522, 0.298, 0.188);
  if (i == 5) return vec3(0.204, 0.396, 0.141);
  if (i == 6) return vec3(0.816, 0.275, 0.282);
  if (i == 7) return vec3(0.459, 0.443, 0.380);
  if (i == 8) return vec3(0.349, 0.490, 0.808);
  if (i == 9) return vec3(0.824, 0.490, 0.173);
  if (i == 10) return vec3(0.522, 0.584, 0.631);
  if (i == 11) return vec3(0.427, 0.667, 0.173);
  if (i == 12) return vec3(0.824, 0.667, 0.600);
  if (i == 13) return vec3(0.427, 0.761, 0.792);
  if (i == 14) return vec3(0.855, 0.831, 0.369);
  return vec3(0.871, 0.933, 0.839);
}

// Oklab: distances follow what the eye sees, so a brown matches brown, not grey.
vec3 oklab(vec3 c) {
  c = pow(c, vec3(2.2));
  vec3 lms = vec3(
    dot(c, vec3(0.4122214708, 0.5363325363, 0.0514459929)),
    dot(c, vec3(0.2119034982, 0.6806995451, 0.1073969566)),
    dot(c, vec3(0.0883024619, 0.2817188376, 0.6299787005)));
  lms = pow(lms, vec3(1.0 / 3.0));
  return vec3(
    dot(lms, vec3(0.2104542553, 0.7936177850, -0.0040720468)),
    dot(lms, vec3(1.9779984951, -2.4285922050, 0.4505937099)),
    dot(lms, vec3(0.0259040371, 0.7827717662, -0.8086757660)));
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
    // a contrast curve: dark ground is mostly ink, lit figures mostly cream
    float ink = step(threshold, smoothstep(0.03, 0.6, luma));
    finalColor = vec4(mix(vec3(0.067), vec3(0.91, 0.835, 0.718), ink), color.a);
  } else {
    vec3 target = oklab(clamp(color.rgb + (threshold - 0.5) * 0.22, 0.0, 1.0));
    vec3 best = palette(0);
    float bestDistance = 9.0;
    for (int i = 0; i < 16; i++) {
      vec3 d = target - oklab(palette(i));
      float distance = dot(d, d);
      if (distance < bestDistance) { bestDistance = distance; best = palette(i); }
    }
    finalColor = vec4(best, color.a);
  }
}`;

// One filter for all looks; setLook changes the look in place.
export function createDitherFilter() {
  const filter = new Filter({
    glProgram: GlProgram.from({ vertex: VERTEX, fragment: FRAGMENT, name: "awara-dither" }),
    resources: {
      ditherUniforms: {
        uSize: { value: new Float32Array([1, 1]), type: "vec2<f32>" },
        uTime: { value: 0, type: "f32" },
        uLook: { value: 0, type: "f32" },
        uAmbient: { value: new Float32Array(3), type: "vec3<f32>" }, // set by update before the first frame
      },
    },
  });
  const uniforms = filter.resources.ditherUniforms.uniforms;
  filter.setLook = (look) => {
    uniforms.uLook = DITHER_LOOKS.indexOf(look);
    // The dithered light multiplies the scene, as the smooth light map does.
    filter.blendMode = look === "dither-light" ? "multiply" : "normal";
  };
  filter.update = (seconds, widthCss, heightCss, ambient) => {
    uniforms.uTime = seconds;
    uniforms.uAmbient[0] = ((ambient >> 16) & 255) / 255;
    uniforms.uAmbient[1] = ((ambient >> 8) & 255) / 255;
    uniforms.uAmbient[2] = (ambient & 255) / 255;
    uniforms.uSize[0] = widthCss;
    uniforms.uSize[1] = heightCss;
  };
  return filter;
}
