// Painted surfaces for the comic look (test flag #look=verse): plain plastic reads as a toy, the
// reference reads as a painted film set. Each opaque surface gets, in world space (so it sticks to
// the city, not the screen): a small value shift per brick (no two bricks quite alike), soft
// large stains (weather, dirt) and faint vertical run-off streaks on walls, all darkening and
// slightly greying the surface's own colour (never a new hue). Matte, no clearcoat sheen.
// installSurface(material, key) chains onto any onBeforeCompile the material already has.
export const SURFACE = { brick: 0.08, stain: 0.2, streak: 0.1, cell: [0.8, 0.48, 0.8] };

const GLSL = `
  varying vec3 vSurfP; varying vec3 vSurfN;
  float sHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
  float sNoise(vec3 p) { // value noise
    vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(sHash(i), sHash(i + vec3(1, 0, 0)), f.x), mix(sHash(i + vec3(0, 1, 0)), sHash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(sHash(i + vec3(0, 0, 1)), sHash(i + vec3(1, 0, 1)), f.x), mix(sHash(i + vec3(0, 1, 1)), sHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  vec3 paintSurface(vec3 c) {
    vec3 p = vSurfP;
    float jit = (sHash(floor(p / vec3(${SURFACE.cell.join(', ')}) + 0.01)) - 0.5) * 2.0 * ${SURFACE.brick.toFixed(3)};
    float stain = smoothstep(0.45, 0.85, sNoise(p * 0.22) * 0.65 + sNoise(p * 0.9) * 0.35) * ${SURFACE.stain.toFixed(3)};
    float wall = 1.0 - abs(vSurfN.y);
    float streak = smoothstep(0.55, 0.9, sNoise(vec3(p.x * 2.3 + p.z * 2.3, p.y * 0.12, 0.0))) * wall * ${SURFACE.streak.toFixed(3)};
    float dark = clamp(stain + streak, 0.0, 0.3);
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(c, vec3(l) * vec3(0.95, 0.9, 0.82), dark * 0.6); // dirt greys the colour a little
    return c * (1.0 + jit) * (1.0 - dark);
  }`;

export function installSurface(m, key) {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    if (prev) prev.call(m, sh, r);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSurfP; varying vec3 vSurfN;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 surfP = vec4(transformed, 1.0); vec3 surfN = objectNormal;
        #ifdef USE_INSTANCING
          surfP = instanceMatrix * surfP; surfN = mat3(instanceMatrix) * surfN;
        #endif
        vSurfP = (modelMatrix * surfP).xyz; vSurfN = normalize(mat3(modelMatrix) * surfN);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${GLSL}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = paintSurface(diffuseColor.rgb);');
  };
  const prevKey = m.customProgramCacheKey?.bind(m);
  m.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}|surface:${key}`;
  if ('clearcoat' in m) m.clearcoat = 0;
  m.roughness = Math.max(m.roughness, 0.72);
  return m;
}
