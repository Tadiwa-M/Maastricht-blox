// Walk-mode URL hash: #mode=walk&at=x,z[&yaw=deg][&camyaw=deg][&pitch=deg][&dist=m]
// at = Unity metres (x east, z north; CONTRACT 1). Returns null unless mode=walk with a valid at.
export function parseWalkHash(hash) {
  const p = new URLSearchParams(String(hash).replace(/^#/, ''));
  if (p.get('mode') !== 'walk' || !p.has('at')) return null;
  const [x, z] = p.get('at').split(',').map(Number);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  const num = (k) => (p.has(k) && Number.isFinite(+p.get(k)) ? +p.get(k) : null);
  return { x, z, yaw: num('yaw'), camYaw: num('camyaw'), pitch: num('pitch'), dist: num('dist') };
}
