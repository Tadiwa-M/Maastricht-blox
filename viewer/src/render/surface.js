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
export const surfaceUniforms = { uSurfKey: { value: Array.from({ length: MAX }, () => new THREE.Vector4(0, 0, -1, 0)) } };
const seen = new Set();
let used = 0;

/** Chromaticity key of a linear colour: (r, g) / (r + g + b), luma. */
export function surfaceKey(c) {
  const s = Math.max(1e-4, c.r + c.g + c.b);
  return [c.r / s, c.g / s, 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b];
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
  uniform vec4 uSurfKey[${MAX}];
  float sHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  float sNoise(vec3 p) { // value noise
    vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(sHash(i), sHash(i + vec3(1, 0, 0)), f.x), mix(sHash(i + vec3(0, 1, 0)), sHash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(sHash(i + vec3(0, 0, 1)), sHash(i + vec3(1, 0, 1)), f.x), mix(sHash(i + vec3(0, 1, 1)), sHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
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

export function installSurface(m, key) {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    if (prev) prev.call(m, sh, r);
    Object.assign(sh.uniforms, surfaceUniforms, poolUniforms);
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
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = paintSurface(diffuseColor.rgb);');
  };
  const prevKey = m.customProgramCacheKey?.bind(m);
  m.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}|surface:${key}`;
  if ('clearcoat' in m) m.clearcoat = 0;
  m.roughness = Math.max(m.roughness, 0.72);
  return m;
}
