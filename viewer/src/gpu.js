// What kind of GPU is drawing: picks the starting quality tier in 'auto' mode, and spots a
// browser rendering without the graphics card (hardware acceleration off), which is the usual
// reason a laptop that should cope crawls. Pure classification (gpuClass) is tested; gpuInfo
// reads the WebGL renderer string.

/** 'software' | 'integrated' | 'mobile' | 'discrete' | 'unknown' from a WebGL renderer string. */
export function gpuClass(renderer = '') {
  const r = renderer.toLowerCase();
  if (!r) return 'unknown';
  if (/swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/.test(r)) return 'software';
  if (/adreno|mali|powervr|apple gpu|apple m\d|xclipse|immortalis/.test(r)) return 'mobile';
  if (/nvidia|geforce|quadro|rtx|radeon rx|radeon pro|radeon\(tm\) rx|arc\(tm\) a\d|intel\(r\) arc/.test(r)) return 'discrete';
  if (/intel|uhd|iris|hd graphics|radeon\(tm\) graphics|radeon graphics|vega \d/.test(r)) return 'integrated';
  return 'unknown';
}

/** Starting tier for 'auto' on a big (streamed) world, by GPU class. */
export function autoTierFor(cls) {
  return { software: 'lite', integrated: 'low', mobile: 'medium', discrete: 'medium', unknown: 'medium' }[cls] || 'medium';
}

/** { renderer, cls } for a three.js WebGLRenderer (or a raw WebGL context). */
export function gpuInfo(renderer) {
  try {
    const gl = renderer.getContext ? renderer.getContext() : renderer;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || '');
    return { renderer: name, cls: gpuClass(name) };
  } catch {
    return { renderer: '', cls: 'unknown' };
  }
}
