// Posing the toy figure: joint angles for a pose (walk, idle, sit, cycle, browse) and the
// matrices of every part. Pure maths on three.js matrices (no scene, no GPU), so crowds,
// the player and tests share it. Angles in radians: a positive hip/shoulder angle swings the
// limb forward (-z), a negative knee bends the shin back, a positive elbow bends forward,
// a positive head pitch lifts the chin.
import { BODY, LO_HAIR } from './parts.js';

export const MODE = { WALK: 0, IDLE: 1, SIT: 2, CYCLE: 3, BROWSE: 4 };
export const SEAT_H = 0.46; // chair seat height (m)
export const SADDLE = { h: 0.93, back: 0.17, bbH: 0.3, crank: 0.17 }; // bike: saddle height, saddle behind the bottom bracket

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function set2(o, k, a, b) { const p = o[k] || (o[k] = [0, 0]); p[0] = a; p[1] = b; }

/** Two-link leg IK in the side plane: hip angle and knee angle reaching (fwd, down) from the hip. */
export function legIK(fwd, down, T = BODY.thigh, S = BODY.shin) {
  const d = clamp(Math.hypot(fwd, down), Math.abs(T - S) + 1e-3, T + S - 1e-4);
  const a0 = Math.atan2(fwd, down);
  const alpha = Math.acos(clamp((T * T + d * d - S * S) / (2 * T * d), -1, 1));
  const beta = Math.acos(clamp((T * T + S * S - d * d) / (2 * T * S), -1, 1));
  return [a0 + alpha, -(Math.PI - beta)];
}

/**
 * Joint angles for a variant in a pose. pose: { mode, phase (walk/pedal cycle, radians),
 * speed (m/s), t (seconds, for idle motion), look (head yaw), seed }. Returns
 * { pelvisY (local units), bob, lean, headPitch, headYaw, hip: [l, r], knee: [l, r], ankle: [l, r],
 *   sh: [l, r], abd: [l, r], elbow: [l, r] }.
 */
export function jointAngles(v, pose, out = {}) {
  const s = v.scale, t = pose.t || 0, seed = (v.seed % 97) * 0.37;
  const mode = pose.mode ?? MODE.WALK;
  out.pelvisY = BODY.pelvisY; out.bob = 0; out.lean = v.stoop; out.headPitch = v.stoop * 0.7; out.headYaw = pose.look || 0; // positive pitch = chin up
  set2(out, 'hip', 0, 0); set2(out, 'knee', -0.04, -0.04); set2(out, 'ankle', 0.04, 0.04);
  set2(out, 'sh', 0, 0); set2(out, 'abd', 0.07, 0.07); set2(out, 'elbow', 0.12, 0.12);
  if (mode === MODE.WALK) {
    const k = clamp((pose.speed ?? 1.2) / 1.2, 0, 1.25) * (v.kind === 'older' ? 0.75 : 1);
    const ph = pose.phase || 0, sn = Math.sin(ph);
    set2(out, 'hip', 0.42 * k * sn, -0.42 * k * sn);
    set2(out, 'knee', -(0.06 + 0.75 * k * Math.max(0, Math.cos(ph))), -(0.06 + 0.75 * k * Math.max(0, -Math.cos(ph))));
    set2(out, 'ankle', -(out.hip[0] + out.knee[0]) * 0.7, -(out.hip[1] + out.knee[1]) * 0.7);
    set2(out, 'sh', -0.5 * k * sn, 0.5 * k * sn);
    set2(out, 'elbow', 0.15 + 0.5 * Math.max(0, out.sh[0]), 0.15 + 0.5 * Math.max(0, out.sh[1]));
    out.bob = 0.02 * k * Math.cos(2 * ph);
    out.lean = v.stoop + 0.05 * k;
    if ((pose.speed ?? 0) > 2.2) { // running: lean in, elbows bent, bigger bounce
      out.lean += 0.14; set2(out, 'elbow', 1.25 + 0.3 * Math.max(0, out.sh[0]), 1.25 + 0.3 * Math.max(0, out.sh[1]));
      out.bob *= 1.8;
    }
  } else if (mode === MODE.IDLE || mode === MODE.BROWSE) {
    const sway = Math.sin(t * 1.1 + seed);
    out.bob = 0.004 * Math.sin(t * 2.2 + seed);
    set2(out, 'hip', 0.03 * sway, -0.03 * sway);
    set2(out, 'sh', 0.04 * Math.sin(t * 1.3 + seed), 0.04 * Math.sin(t * 1.3 + seed + 2));
    out.headYaw += 0.25 * Math.sin(t * 0.37 + seed);
    if (mode === MODE.BROWSE) {
      set2(out, 'sh', 0.38 + 0.08 * sway, 0.3 - 0.06 * sway); set2(out, 'elbow', 0.95, 1.05); set2(out, 'abd', 0.12, 0.12);
      out.headPitch -= 0.25; out.lean += 0.06;
    }
  } else if (mode === MODE.SIT) {
    out.pelvisY = SEAT_H / s + 0.075;
    set2(out, 'hip', 1.5, 1.5); set2(out, 'knee', -1.48, -1.48); set2(out, 'ankle', 0, 0);
    out.lean = -0.04 + v.stoop * 0.5; out.headPitch = -0.05;
    set2(out, 'sh', 0.5, 0.5); set2(out, 'elbow', 0.95, 0.95); set2(out, 'abd', 0.14, 0.14);
    const sip = ((t + seed * 5) % 11) / 11; // every 11 s: lift the right hand to drink
    if (sip > 0.85) { const u = Math.sin(((sip - 0.85) / 0.15) * Math.PI); out.sh[1] = 0.5 + 0.6 * u; out.elbow[1] = 0.95 + 1.2 * u; out.headPitch += 0.2 * u; }
    out.headYaw += 0.45 * Math.sin(t * 0.3 + seed);
  } else if (mode === MODE.CYCLE) {
    out.pelvisY = SADDLE.h / s + 0.03;
    out.lean = 0.42; out.headPitch = 0.36;
    const down = (SADDLE.h - SADDLE.bbH) / s - 0.02, fwd = SADDLE.back / s, r = SADDLE.crank / s;
    for (let q = 0; q < 2; q++) {
      const a = (pose.phase || 0) + q * Math.PI;
      const [hip, knee] = legIK(fwd + Math.sin(a) * r, down - 0.09 / s + Math.cos(a) * r);
      out.hip[q] = hip; out.knee[q] = knee; out.ankle[q] = -(hip + knee) + 0.1;
    }
    set2(out, 'sh', 0.95, 0.95); set2(out, 'elbow', 0.35, 0.35); set2(out, 'abd', 0.1, 0.1);
  }
  return out;
}

// Affine 4x4 matrices as Float32Array(16), column-major like three.js. Right-multiplying by a
// translation or an axis rotation touches only a few columns: much cheaper than general
// Matrix4 products (a crowd poses ~15 parts x 1000 figures every frame).
const mat = () => new Float32Array(16); // same type as the instance buffers: copying is a memcpy
const M = Array.from({ length: 10 }, mat);
function copy(d, s) { d.set(s); return d; }
function tr(m, x, y, z) { for (let r = 0; r < 3; r++) m[12 + r] += x * m[r] + y * m[4 + r] + z * m[8 + r]; return m; }
function rx(m, a) {
  if (!a) return m;
  const c = Math.cos(a), s = Math.sin(a);
  for (let r = 0; r < 3; r++) { const u = m[4 + r], w = m[8 + r]; m[4 + r] = c * u + s * w; m[8 + r] = -s * u + c * w; }
  return m;
}
function ry(m, a) {
  if (!a) return m;
  const c = Math.cos(a), s = Math.sin(a);
  for (let r = 0; r < 3; r++) { const u = m[r], w = m[8 + r]; m[r] = c * u - s * w; m[8 + r] = s * u + c * w; }
  return m;
}
function rz(m, a) {
  if (!a) return m;
  const c = Math.cos(a), s = Math.sin(a);
  for (let r = 0; r < 3; r++) { const u = m[r], w = m[4 + r]; m[r] = c * u + s * w; m[4 + r] = -s * u + c * w; }
  return m;
}
function sc(m, x, y, z) { for (let r = 0; r < 3; r++) { m[r] *= x; m[4 + r] *= y; m[8 + r] *= z; } return m; }
function root(m, x, y, z, rotY, s) {
  const c = Math.cos(rotY), n = Math.sin(rotY);
  m.fill(0);
  m[0] = c * s; m[2] = -n * s; m[5] = s; m[8] = n * s; m[10] = c * s;
  m[12] = x; m[13] = y; m[14] = z; m[15] = 1;
  return m;
}

/** Part keys of a variant (cached strings, no allocation per frame). */
function keys(v) {
  const k = v._k;
  if (!k || k.h !== v.hair || k.t !== v.top || k.a !== v.acc) {
    v._k = { h: v.hair, t: v.top, a: v.acc, hair: `hair:${v.hair}`, top: `top:${v.top}`, shirt: 'top:shirt', acc: `acc:${v.acc}`,
      hairCol: v.colours.hairTint ? 'hairTint' : 'hair',
      loHair: `lo:hair:${LO_HAIR[v.hair]}`, loTop: v.top === 'dress' || v.top === 'coat' ? 'lo:top:long' : 'lo:top:short' };
  }
  return v._k;
}

/**
 * Emit the world matrix of every part: emit(key, matrix (Float32Array(16), column-major),
 * colourKey). key: 'head', 'hair:<style>', 'top:<style>', 'hips', 'upperArm', 'foreArm', 'hand',
 * 'thigh', 'shin', 'shoe', 'acc:<kind>'. colourKey: which of v.colours paints it.
 * pose: { x, y, z (three.js), rotY, ...the jointAngles pose }. A dress or coat is drawn as a
 * shirt (same colour) when sitting or cycling, so the skirt does not cut through the seat.
 * lo: far level of detail ('lo:*' keys; no separate hands, shoes or bags; umbrellas stay).
 */
export function poseFigure(v, pose, emit, J = jointAngles(v, pose), lo = false) {
  const s = v.scale, w = v.width, K = keys(v), mode = pose.mode ?? MODE.WALK;
  const base = root(M[0], pose.x, pose.y, pose.z, pose.rotY || 0, s);
  const pelvis = tr(copy(M[1], base), 0, J.pelvisY + J.bob, 0);
  emit(lo ? 'lo:hips' : 'hips', sc(copy(M[2], pelvis), w, 1, w), 'bottom');
  const chest = rx(copy(M[3], pelvis), -J.lean);
  const torso = sc(copy(M[4], chest), w, 1, w);
  const longTop = v.top === 'dress' || v.top === 'coat', seated = mode === MODE.SIT || mode === MODE.CYCLE;
  emit(lo ? (seated ? 'lo:top:short' : K.loTop) : longTop && seated ? K.shirt : K.top, torso, 'top');
  if (v.acc === 'backpack') emit(lo ? 'lo:backpack' : K.acc, torso, 'acc');
  const hs = v.headScale;
  const head = sc(ry(rx(tr(copy(M[5], chest), 0, BODY.neckY, 0), J.headPitch), J.headYaw), hs, hs, hs);
  emit(lo ? 'lo:head' : 'head', head, 'skin');
  emit(lo ? K.loHair : K.hair, head, K.hairCol);
  for (let q = 0; q < 2; q++) {
    const sg = q === 0 ? -1 : 1; // 0 = left (-x), 1 = right (+x)
    let sh = J.sh[q], el = J.elbow[q];
    if (q === 1 && v.acc === 'umbrella' && mode !== MODE.CYCLE) { sh = 0.7; el = 1.5; }
    const arm = rz(rx(tr(copy(M[6], chest), sg * BODY.shoulderX * w, BODY.shoulderY, 0), sh), sg * J.abd[q]);
    emit(lo ? 'lo:upperArm' : 'upperArm', arm, 'top');
    const fore = rx(tr(copy(M[7], arm), 0, -BODY.upperArm, 0), el);
    emit(lo ? 'lo:foreArm' : 'foreArm', fore, 'top');
    const hand = tr(copy(M[8], fore), 0, -BODY.foreArm, 0);
    if (!lo) emit('hand', hand, 'skin');
    if (q === 1 && ((v.acc === 'bag' && !lo) || v.acc === 'umbrella') && !seated) {
      // hangs straight down (bag) / stands straight up (umbrella) from the hand, turned like the body;
      // umbrellas show at any distance (rain is visible from afar), bags only near
      emit(K.acc, root(M[9], hand[12], hand[13], hand[14], pose.rotY || 0, s), 'acc');
    }
    const thigh = rx(tr(copy(M[6], pelvis), sg * BODY.hipX * w, 0, 0), J.hip[q]);
    emit(lo ? 'lo:thigh' : 'thigh', thigh, 'bottom');
    const shin = rx(tr(copy(M[7], thigh), 0, -BODY.thigh, 0), J.knee[q]);
    emit(lo ? 'lo:shin' : 'shin', shin, 'bottom');
    if (!lo) emit('shoe', rx(tr(copy(M[8], shin), 0, -BODY.shin, 0), J.ankle[q]), 'shoe');
  }
}

/** Instances per figure of a variant (for pool sizing): 14 + accessory. */
export const PARTS_PER_FIGURE = 15;
