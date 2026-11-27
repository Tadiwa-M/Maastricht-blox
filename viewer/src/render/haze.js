// Haze with sun scattering: the distance fog brightens and warms toward the sun (forward
// scattering), so the far city glows on the sun side and stays cool-blue on the other.
//
// One global patch of three.js's fog shader chunks (no per-material code): every built-in
// material gets a view-space position varying, and two shared uniforms are added to the
// built-in shader libraries. Their values are Float32Arrays, which three.js passes by
// reference when it copies a library's uniforms into a material, so one update per frame
// (setHazeSun) reaches every material. Shader materials without the uniforms read zero:
// plain fog, as before. Costs a dot product and a pow per fogged pixel.
import * as THREE from 'three';

export const hazeSun = new Float32Array(3); // view-space direction to the sun
export const hazeSunColor = new Float32Array(3); // scattered light added at full fog

const LIBS = ['basic', 'lambert', 'phong', 'standard', 'physical', 'toon', 'matcap'];
let installed = false;

/** Patch the fog chunks and shader libraries once, before any material compiles. */
export function installHaze() {
  if (installed) return;
  installed = true;
  const C = THREE.ShaderChunk;
  C.fog_pars_vertex = C.fog_pars_vertex.replace('varying float vFogDepth;', 'varying float vFogDepth;\n\tvarying vec3 vHazeView;');
  C.fog_vertex = C.fog_vertex.replace('vFogDepth = - mvPosition.z;', 'vFogDepth = - mvPosition.z;\n\tvHazeView = mvPosition.xyz;');
  C.fog_pars_fragment = C.fog_pars_fragment.replace('varying float vFogDepth;',
    'varying float vFogDepth;\n\tvarying vec3 vHazeView;\n\tuniform vec3 hazeSun;\n\tuniform vec3 hazeSunColor;');
  C.fog_fragment = C.fog_fragment.replace('gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );', `
    float hazeS = max(dot(normalize(vHazeView), hazeSun), 0.0);
    vec3 hazeC = fogColor + hazeSunColor * (hazeS * hazeS * 0.35 + pow(hazeS, 12.0) * 0.65);
    gl_FragColor.rgb = mix( gl_FragColor.rgb, hazeC, fogFactor );`);
  for (const lib of LIBS) {
    const u = THREE.ShaderLib[lib]?.uniforms;
    if (!u) continue;
    u.hazeSun = { value: hazeSun };
    u.hazeSunColor = { value: hazeSunColor };
  }
}

const tmp = new THREE.Vector3();
/** Per frame: sun direction (world) into view space; colour = scattered light (linear rgb). */
export function setHazeSun(camera, sunDirWorld, color, strength) {
  tmp.copy(sunDirWorld).transformDirection(camera.matrixWorldInverse);
  hazeSun[0] = tmp.x; hazeSun[1] = tmp.y; hazeSun[2] = tmp.z;
  hazeSunColor[0] = color.r * strength; hazeSunColor[1] = color.g * strength; hazeSunColor[2] = color.b * strength;
}
