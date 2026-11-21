// Painted, textured surfaces for the comic look (test flag #look=verse). Plain plastic reads as a
// toy; the reference reads as a painted film set, every surface with its own texture. In world
// space (so it sticks to the city, not the screen), by what the surface is made of:
//   brick    courses of small bricks (stretcher bond) with light mortar, each brick its own tone
//   stone    marl / limestone blocks with fine joints and a soft mottle
//   plaster  fine grain and a broad mottle, no joints
//   setts    paving setts with dark joints and rounded edges
//   asphalt  speckle and patches
//   roof     (any sloped face) rows of tiles with a shadow line under each row
//   foliage  leaf clusters with dark gaps; bark furrows; grass blades; soil clods; copper verdigris runs
// The material is found by matching the surface colour against the palette colours of those
// materials (registered as palette entries are used: registerSurfaceEntry); anything else (cars,
// signs, glass frames) only gets the weathering: a value shift per toy brick, large soft stains
// and run-off streaks on walls, greying the surface's own colour. Texture fades out where a pixel
// covers more than half a course (no shimmer far away). Matte, no clearcoat sheen.
// installSurface(material, key) chains onto any onBeforeCompile the material already has.
import * as THREE from 'three';
import { POOL_GLSL, poolUniforms } from './pools.js';
import { seasonUniforms } from './season.js';

export const SURFACE = { brick: 0.06, stain: 0.18, streak: 0.09, cell: [0.8, 0.48, 0.8] };
export const KINDS = { brick: 1, stone: 2, plaster: 3, setts: 4, asphalt: 5, roof: 6, foliage: 7, bark: 8, grass: 9, soil: 10, copper: 11 };
// palette names -> kind (names, not colours: the palette's colours may be tuned)
export const KIND_OF = {
  brick_red: 'brick', brick_dark_red: 'brick', brick_orange: 'brick', brick_brown: 'brick',
  mergel: 'stone', mergel_light: 'stone', mergel_dark: 'stone', limestone: 'stone', limestone_dark: 'stone',
  plaster_white: 'plaster', plaster_cream: 'plaster', plaster_grey: 'plaster',
  cobble_grey: 'setts', cobble_dark: 'setts', pavement: 'setts', asphalt: 'asphalt',
  roof_tile_red: 'roof', roof_tile_dark: 'roof', slate: 'roof', tower_red: 'plaster',
  leaf: 'foliage', leaf_light: 'foliage', trunk: 'bark', grass: 'grass', grass_dark: 'grass', soil: 'soil', copper_green: 'copper',
};
const MAX = 32;
/** The weather on the ground (render/weatherfx.js): uWet 0..1 (sheen, puddles), uSnowCover 0..1. */
export const weatherUniforms = { uWet: { value: 0 }, uSnowCover: { value: 0 } };
export const surfaceUniforms = { uSurfKey: { value: Array.from({ length: MAX }, () => new THREE.Vector4(0, 0, -1, 0)) } };
const seen = new Set();
let used = 0;

/** Chromaticity key of a linear colour: (r, g) / (r + g + b), luma. */
export function surfaceKey(c) {
  const s = Math.max(1e-4, c.r + c.g + c.b);
  return [c.r / s, c.g / s, 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b];
}

/** Leaf colours (every look: the season turns and drops them), found by chromaticity like the kinds. */
export const leafUniforms = { uLeafKey: { value: Array.from({ length: 4 }, () => new THREE.Vector3(0, 0, -1)) } };
let leaves = 0;
const leafSeen = new Set();
/** Note a palette entry in use: a leaf colour is registered for the season. */
export function registerLeafEntry(entry) {
  if (!/^leaf/.test(entry?.name || '') || leafSeen.has(entry.name) || leaves >= 4) return;
  leafSeen.add(entry.name);
  const [r, g, L] = surfaceKey(new THREE.Color(entry.srgb));
  leafUniforms.uLeafKey.value[leaves++].set(r, g, L);
}

/** Note a palette entry in use; its colour gets its material's texture. Returns the kind or null. */
export function registerSurfaceEntry(entry) {
  const kind = KIND_OF[entry?.name];
  if (!kind || seen.has(entry.name) || used >= MAX) return kind || null;
  seen.add(entry.name);
  const [r, g, L] = surfaceKey(new THREE.Color(entry.srgb));
  surfaceUniforms.uSurfKey.value[used++].set(r, g, L, KINDS[kind]);
  return kind;
}

const GLSL = `
  varying vec3 vSurfP; varying vec3 vSurfN;
  uniform vec4 uSurfKey[${MAX}]; uniform float uWet; uniform float uSnowCover;
  uniform vec3 uLeafKey[4]; uniform float uLeafTurn; uniform float uLeafBare; uniform float uLitter; uniform float uLeafFresh;
  float sHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  float sNoise(vec3 p) { // value noise
    vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(sHash(i), sHash(i + vec3(1, 0, 0)), f.x), mix(sHash(i + vec3(0, 1, 0)), sHash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(sHash(i + vec3(0, 0, 1)), sHash(i + vec3(1, 0, 1)), f.x), mix(sHash(i + vec3(0, 1, 1)), sHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float puddleAt(vec3 p) { return smoothstep(0.52, 0.66, sNoise(p * 0.32) * 0.7 + sNoise(p * 1.4) * 0.3); }
  // the weather on a surface: wet ground darker (puddles more), snow settling on what faces up
  vec3 weatherSurface(vec3 c) {
    float up = smoothstep(0.55, 0.9, normalize(vSurfN).y);
    float pud = puddleAt(vSurfP) * up;
    c *= 1.0 - uWet * (0.22 * up + 0.25 * pud);
    float snow = uSnowCover * smoothstep(0.35, 0.8, normalize(vSurfN).y) * (0.75 + 0.25 * sNoise(vSurfP * 3.0));
    return mix(c, vec3(0.92, 0.94, 0.97), clamp(snow, 0.0, 1.0));
  }
  // the season (render/season.js): is this a leaf brick? (its colour, before any treatment)
  float isLeafColour(vec3 c) {
    float s = max(c.r + c.g + c.b, 1e-4), L = dot(c, vec3(0.2126, 0.7152, 0.0722));
    vec2 ch = c.rg / s;
    for (int i = 0; i < 4; i++) {
      vec3 k = uLeafKey[i];
      if (k.z < 0.0) break;
      if (distance(ch, k.xy) < 0.012 && L > k.z * 0.7 && L < k.z * 1.35) return 1.0;
    }
    return 0.0;
  }
  // leaves turn (each leaf-brick cell on its own day: yellow, orange, brown) and fall (bare: the
  // cell is not drawn); fresh light green in spring
  vec3 seasonLeaf(vec3 c, float leaf) {
    if (leaf < 0.5) return c;
    vec3 cell = floor(vSurfP / vec3(0.5, 0.4, 0.5) + 0.01);
    float h = sHash(cell), h2 = sHash(cell + 7.3);
    if (h2 < uLeafBare) discard;
    float L = dot(c, vec3(0.2126, 0.7152, 0.0722));
    vec3 tone = h < 0.55 ? vec3(0.62, 0.45, 0.05) : h < 0.85 ? vec3(0.62, 0.24, 0.04) : vec3(0.3, 0.15, 0.05);
    float turned = step(h * 0.9 + 0.05, uLeafTurn);
    c = mix(c, tone * (0.6 + 1.6 * L), turned);
    return mix(c, c * vec3(1.15, 1.3, 0.8), uLeafFresh * 0.6);
  }
  // fallen leaves on the ground in autumn: scattered leaf-sized flecks in the season's colours
  vec3 litter(vec3 c) {
    if (uLitter < 0.01) return c;
    float up = smoothstep(0.85, 0.97, normalize(vSurfN).y);
    vec2 q = vSurfP.xz * 12.0;
    q = mat2(0.8, -0.6, 0.6, 0.8) * q; // not along the bricks
    vec3 cell = vec3(floor(q), 0.0);
    vec2 f = fract(q) - 0.5 - (vec2(sHash(cell), sHash(cell + 1.7)) - 0.5) * 0.4;
    float h = sHash(cell + 5.1), clump = smoothstep(0.35, 0.75, sNoise(vSurfP * 0.25));
    float leafShape = 1.0 - smoothstep(0.18, 0.26, length(f * vec2(1.0, 1.6)));
    float on = step(h, uLitter * (0.06 + 0.32 * clump)) * leafShape * up * (1.0 - smoothstep(0.06, 0.18, fwidth(q.x)));
    vec3 tone = mix(vec3(0.5, 0.34, 0.05), vec3(0.32, 0.14, 0.04), sHash(cell + 3.0));
    return mix(c, tone, on * 0.8);
  }
  float surfKind(vec3 c) {
    float s = max(c.r + c.g + c.b, 1e-4), L = dot(c, vec3(0.2126, 0.7152, 0.0722));
    vec2 ch = c.rg / s;
    for (int i = 0; i < ${MAX}; i++) {
      vec4 k = uSurfKey[i];
      if (k.z < 0.0) break;
      if (distance(ch, k.xy) < 0.008 && L > k.z * 0.82 && L < k.z * 1.2) return k.w;
    }
    return 0.0;
  }
  // a bond of w x h units in (u, v): x = joint (0 in a unit, 1 in the joint), y = the unit's hash,
  // z = distance to the unit's edge (0..0.5, for rounded setts); joint width j (same units)
  vec3 bond(vec2 uv, vec2 size, float j, float seed) {
    float row = floor(uv.y / size.y);
    vec2 q = vec2(uv.x / size.x + 0.5 * mod(row, 2.0), uv.y / size.y);
    vec2 f = fract(q), id = floor(q);
    vec2 jw = vec2(j / size.x, j / size.y), aa = fwidth(q) * 0.75 + 1e-4;
    vec2 m = smoothstep(jw - aa, jw + aa, f) * smoothstep(jw - aa, jw + aa, 1.0 - f);
    return vec3(1.0 - m.x * m.y, sHash(vec3(id, seed)), min(min(f.x, 1.0 - f.x) * size.x, min(f.y, 1.0 - f.y) * size.y));
  }
  vec3 texture3(vec3 c, float kind) {
    vec3 p = vSurfP, n = normalize(vSurfN);
    float up = n.y;
    vec2 t = normalize(abs(n.x) + abs(n.z) > 1e-3 ? vec2(-n.z, n.x) : vec2(1.0, 0.0));
    vec2 wall = vec2(dot(p.xz, t), p.y); // along the wall, up
    float L = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float grain = (sNoise(p * 37.0) - 0.5);
    if (kind > 6.5) { // living and weathered stuff: its own texture at any angle
      if (kind < 7.5) { // foliage: clusters of leaves, dark gaps, sunlit tops
        vec3 q = p * 14.0; vec3 cell = floor(q); vec3 f = fract(q) - 0.5;
        float r = length(f + (vec3(sHash(cell), sHash(cell + 3.1), sHash(cell + 7.7)) - 0.5) * 0.5);
        float gap = smoothstep(0.32, 0.55, r);
        float fade = 1.0 - smoothstep(0.3, 0.7, fwidth(q.y));
        return c * (1.0 + ((sHash(cell + 1.3) - 0.5) * 0.36 - gap * 0.35 + up * 0.08) * fade + (sNoise(p * 2.0) - 0.5) * 0.2);
      }
      if (kind < 8.5) { // bark: vertical furrows
        float fur = sNoise(vec3(p.x * 34.0, p.y * 3.0, p.z * 34.0));
        return c * (1.0 - smoothstep(0.45, 0.75, fur) * 0.4 + grain * 0.12);
      }
      if (kind < 9.5) { // grass: blades, lighter tips, clumps
        float blade = sNoise(vec3(p.x * 90.0, p.y * 8.0, p.z * 90.0));
        float fade = 1.0 - smoothstep(0.3, 0.7, fwidth(p.x * 90.0));
        return c * (1.0 + (blade - 0.5) * 0.4 * fade + (sNoise(p * 1.5) - 0.5) * 0.25);
      }
      if (kind < 10.5) return c * (1.0 + (sNoise(p * 9.0) - 0.5) * 0.3 + grain * 0.15); // soil: clods
      // copper: verdigris run-off (lighter streaks) and darker weathered patches
      float run = smoothstep(0.5, 0.85, sNoise(vec3(p.x * 6.0 + p.z * 6.0, p.y * 0.6, 1.0)));
      return c * (1.0 + run * 0.22 - smoothstep(0.55, 0.8, sNoise(p * 1.2)) * 0.2 + grain * 0.06);
    }
    if (up > 0.25 && up < 0.9) { // sloped: roof tiles, rows down the slope
      vec2 r = vec2(dot(p.xz, t), p.y / max(1.0 - up * up, 0.1) * 1.0);
      vec3 b = bond(vec2(r.x, r.y), vec2(0.22, 0.13), 0.004, 3.0);
      float under = 1.0 - smoothstep(0.0, 0.035, fract(r.y / 0.13) * 0.13);
      float fade = 1.0 - smoothstep(0.3, 0.6, fwidth(r.y) / 0.13);
      return c * (1.0 + ((b.y - 0.5) * 0.16 - under * 0.32 - b.x * 0.15 + grain * 0.06) * fade);
    }
    if (kind < 0.5) return c * (1.0 + grain * 0.04);
    if (up >= 0.9) { // ground
      if (kind > 4.5) { // asphalt: speckle and patches
        float sp = step(0.82, sHash(floor(p * 40.0))) * 0.25 - step(0.9, sHash(floor(p * 33.0) + 7.0)) * 0.2;
        float fade = 1.0 - smoothstep(0.02, 0.05, fwidth(p.x));
        return c * (1.0 + (sp * fade + (sNoise(p * 1.3) - 0.5) * 0.18 + grain * 0.08));
      }
      // setts (and stone or brick laid flat): small blocks, dark joints, rounded edges
      vec2 size = kind > 3.5 ? vec2(0.2, 0.1) : vec2(0.4, 0.3);
      vec3 b = bond(p.xz, size, 0.008, 5.0);
      float fade = 1.0 - smoothstep(0.3, 0.6, max(fwidth(p.x), fwidth(p.z)) / size.y); // (grazing angles too)
      float edge = 1.0 - smoothstep(0.0, 0.025, b.z);
      return c * (1.0 + ((b.y - 0.5) * 0.24 - b.x * 0.45 - edge * 0.12 + grain * 0.07) * fade);
    }
    // walls
    if (kind < 1.5) { // brick: stretcher bond, light mortar, a tone per brick
      vec3 b = bond(wall, vec2(0.22, 0.068), 0.006, 1.0);
      float fade = 1.0 - smoothstep(0.3, 0.6, max(fwidth(wall.x) * 0.31, fwidth(wall.y)) / 0.068);
      vec3 brick = c * (1.0 + (b.y - 0.5) * 0.3 + grain * 0.1) * mix(vec3(1.0), vec3(0.9, 0.92, 1.05), step(0.85, b.y));
      vec3 mortar = vec3(max(L, 0.04) * 2.6) * vec3(1.0, 0.96, 0.9);
      return mix(c * (1.0 + grain * 0.04), mix(brick, mortar, b.x * 0.8), fade);
    }
    if (kind < 2.5) { // marl / limestone blocks
      vec3 b = bond(wall, vec2(0.5, 0.26), 0.005, 2.0);
      float fade = 1.0 - smoothstep(0.3, 0.6, max(fwidth(wall.x) * 0.52, fwidth(wall.y)) / 0.26);
      float mottle = sNoise(p * 4.0) - 0.5;
      return c * (1.0 + ((b.y - 0.5) * 0.12 - b.x * 0.22) * fade + mottle * 0.12 + grain * 0.07);
    }
    // plaster: grain and a broad mottle
    return c * (1.0 + (sNoise(p * 1.7) - 0.5) * 0.1 + grain * 0.06);
  }
  vec3 paintSurface(vec3 c) {
    vec3 p = vSurfP;
    c = texture3(c, surfKind(c));
    float jit = (sHash(floor(p / vec3(${SURFACE.cell.join(', ')}) + 0.01)) - 0.5) * 2.0 * ${SURFACE.brick.toFixed(3)};
    float stain = smoothstep(0.45, 0.85, sNoise(p * 0.22) * 0.65 + sNoise(p * 0.9) * 0.35) * ${SURFACE.stain.toFixed(3)};
    float wallness = 1.0 - abs(normalize(vSurfN).y);
    float streak = smoothstep(0.55, 0.9, sNoise(vec3(p.x * 2.3 + p.z * 2.3, p.y * 0.12, 0.0))) * wallness * ${SURFACE.streak.toFixed(3)};
    float dark = clamp(stain + streak, 0.0, 0.3);
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(c, vec3(l) * vec3(0.95, 0.9, 0.82), dark * 0.6); // dirt greys the colour a little
    return max(c * (1.0 + jit) * (1.0 - dark), 0.0);
  }`;

/** textured: the painted looks (textures, weathering, matte); otherwise only the night pools. */
export function installSurface(m, key, textured = true) {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    if (prev) prev.call(m, sh, r);
    Object.assign(sh.uniforms, surfaceUniforms, poolUniforms, weatherUniforms, leafUniforms, seasonUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSurfP; varying vec3 vSurfN;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 surfP = vec4(transformed, 1.0); vec3 surfN = objectNormal;
        #ifdef USE_INSTANCING
          surfP = instanceMatrix * surfP; surfN = mat3(instanceMatrix) * surfN;
        #endif
        vSurfP = (modelMatrix * surfP).xyz; vSurfN = normalize(mat3(modelMatrix) * surfN);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL}\n${POOL_GLSL}`)
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.directDiffuse += diffuseColor.rgb * poolLight(vSurfP, normalize(vSurfN));')
      .replace('#include <color_fragment>', `#include <color_fragment>\nfloat leafK = (uLeafTurn + uLeafBare + uLeafFresh) > 0.001 ? isLeafColour(diffuseColor.rgb) : 0.0;\n${textured ? 'diffuseColor.rgb = paintSurface(diffuseColor.rgb);' : ''}\ndiffuseColor.rgb = seasonLeaf(diffuseColor.rgb, leafK);\nif (leafK < 0.5) diffuseColor.rgb = litter(diffuseColor.rgb);\ndiffuseColor.rgb = weatherSurface(diffuseColor.rgb);`)
      // wet: a sheen on the ground, puddles nearly mirror (they catch the sky and the lamps)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n{ float upW = smoothstep(0.55, 0.9, normalize(vSurfN).y); roughnessFactor = mix(roughnessFactor, mix(0.32, 0.05, puddleAt(vSurfP)), uWet * upW * (1.0 - uSnowCover)); }')
  };
  const prevKey = m.customProgramCacheKey?.bind(m);
  m.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}|surface:${key}:${textured ? 'paint' : 'pools'}`;
  if (!textured) return m;
  if ('clearcoat' in m) m.clearcoat = 0;
  m.roughness = Math.max(m.roughness, 0.72);
  return m;
}
