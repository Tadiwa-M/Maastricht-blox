// Posing the toy figure: joint angles for a pose (walk, idle, sit, cycle, browse) and the
// matrices of every part. Pure maths on three.js matrices (no scene, no GPU), so crowds,
// the player and tests share it. Angles in radians: a positive hip/shoulder angle swings the
// limb forward (-z), a negative knee bends the shin back, a positive elbow bends forward,
// a positive head pitch lifts the chin.
import { BODY, LO_HAIR } from './parts.js';
import { gaitPose } from './gait.js';

/** Share of the hip drop (pelvisRoll) the trunk follows: a real walker's trunk stays nearly upright. */
export const TRUNK_ROLL = 0.15;

export const MODE = { WALK: 0, IDLE: 1, SIT: 2, CYCLE: 3, BROWSE: 4 };
/** What a standing figure does (pose.idle; pose.idleK 0..1 eases it in): crowds pick one per stop. */
export const IDLE = { NONE: 0, PHONE: 1, TALK: 2, LOOK: 3, HIPS: 4, POSE: 5 };

/**
 * Body proportions (1 = the toy figure). The manga look (render/figuresurface.js sets it) gives
 * everyone the heroic build of that world: broad shoulders over a narrow waist, longer legs, a
 * smaller head. Shared by every figure; standing and walking only (seats and saddles keep the
 * plain legs so feet stay on pedals and floors).
 */
export const PROPORTION = { shoulder: 1, chest: 1, waist: 1, leg: 1, head: 1, arm: 1, pose: false, swag: false, spine: false }; // spine: the torso drawn in two (abdomen, chest) so the trunk bends (the manga figure) // swag: the Spider-Verse look's bouncing street swagger // pose: the player strikes a stand-your-ground pose when still
export function setProportions(p) { Object.assign(PROPORTION, p); }
const SPINE_AT = 0.27; // where the torso bends (figure/animeparts.js SPLIT)
const HEM_AT = 0.03; // where coat tails and skirts hang from (animeparts.js, verseparts.js)

/**
 * Stand-your-ground poses (pose.idle = IDLE.POSE, pose.poseKind 0..2): our own sculptural poses in
 * the spirit of the fashion-plate posing of bizarre-adventure manga: weight on one hip, the trunk
 * twisted against the hips, the neck bent, an arm across the face, a pointing hand, a hand at the
 * temple. The whole skeleton takes part.
 */
// legs (owner: the poses must be dramatic in the legs too): legAbd spreads a leg out (+) or pinches
// the knee in across the body (-), legYaw turns the knee out (+) or in (-); the pelvis sinks so the
// lowest foot stays on the ground however deep the knees bend
export const STAND_POSES = [
  { pelvisYaw: -0.55, chestYaw: 0.75, lean: -0.22, roll: -0.3, headYaw: -0.55, headPitch: 0.1, hip: [-0.3, 0.75], knee: [-0.15, -1.15],
    legAbd: [0.28, -0.22], legYaw: [0.35, -0.4], sh: [0.1, 1.55], abd: [0.35, 0.05], elbow: [0.3, 0.05] }, // the accusation: weight thrown back on a straight leg, the front knee driving across, an arm aimed straight out
  { pelvisYaw: 0.7, chestYaw: -1.05, lean: -0.18, roll: 0.13, headYaw: 0.75, headPitch: -0.35, hip: [0.55, -0.1], knee: [-1.0, -0.2],
    legAbd: [-0.3, 0.12], legYaw: [-0.45, 0.2], sh: [3.05, 0.9], abd: [0.25, -0.5], elbow: [2.0, 2.3] }, // the twist: an arm thrown over the head, hips cocked hard, knees pinched in
  { pelvisYaw: -0.4, chestYaw: 0.9, lean: 0.18, roll: -0.12, headYaw: -0.7, headPitch: 0.2, hip: [1.05, -0.55], knee: [-1.45, -0.25],
    legAbd: [0.4, 0.35], legYaw: [0.4, 0.5], sh: [0.4, 2.2], abd: [0.3, -0.3], elbow: [1.6, 0.1] }, // the deep lunge, wide, pointing up and ahead
  { pelvisYaw: 0.35, chestYaw: -0.8, lean: -0.48, roll: 0.24, headYaw: 0.6, headPitch: 0.55, hip: [0.2, -0.12], knee: [-0.35, -0.1],
    legAbd: [-0.32, -0.26], legYaw: [-0.2, 0.3], sh: [-0.4, 2.7], abd: [1.1, 0.6], elbow: [2.1, 2.5] }, // legs crossed at the shin, arched back, a hand splayed across the face
  { pelvisYaw: -0.8, chestYaw: 1.1, lean: 0.35, roll: -0.2, headYaw: -0.95, headPitch: -0.2, hip: [1.3, 0.35], knee: [-2.0, -1.0],
    legAbd: [0.5, 0.3], legYaw: [0.6, 0.2], sh: [1.5, 1.3], abd: [1.4, 1.3], elbow: [0.4, 0.4] }, // a crouch on one heel, twisted, both arms flung wide
  { pelvisYaw: -0.25, chestYaw: 0.45, lean: 0.55, spineLean: 0.35, spineYaw: 0.3, roll: -0.08, headYaw: -0.2, headPitch: 0.75, hip: [1.05, -1.3], knee: [-1.75, -0.05],
    legAbd: [0.3, 0.12], legYaw: [0.3, 0.1], toe: [0, 0.7], sh: [1.55, -1.0], abd: [0.15, 0.5], elbow: [0.15, 0.7], wrist: [-0.5, 0], foreRoll: [0.6, 0] }, // the reach: flung low over a folded knee, the back leg out straight, a hand driving at you
  { pelvisYaw: 0.35, chestYaw: -0.6, lean: -0.42, spineLean: -0.8, spineRoll: 0.22, roll: 0.14, hipShift: 0.05, hipThrust: 0.15, pelvisPitch: -0.3, waistRoll: -0.12,
    headYaw: 0.5, headPitch: -0.85, headRoll: 0.25, hip: [-0.1, 0.55], knee: [0, -1.0], legAbd: [0.08, -0.18], legYaw: [0.25, -0.3], toe: [0, 0.95],
    sh: [2.2, 0.35], abd: [0.25, -0.35], elbow: [2.45, 1.65], wrist: [0.65, 0.45], foreRoll: [0.3, 0.9] }, // the backbend: hips thrust, the chest arched back, chin curled to the hand at the brow, up on one toe
];
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
  set2(out, 'sh', 0, 0); set2(out, 'abd', 0.07, 0.07); set2(out, 'elbow', 0.12, 0.12); set2(out, 'legAbd', 0, 0); set2(out, 'legYaw', 0, 0); set2(out, 'shY', 0, 0); set2(out, 'wrist', 0, 0); set2(out, 'toe', 0, 0); set2(out, 'foreRoll', 0, 0); set2(out, 'armTwist', 0, 0); // armTwist: the upper arm turned in, so the forearm folds across the body
  out.spineLean = 0; out.spineRoll = 0; out.spineYaw = 0; out.pelvisPitch = 0; out.hipThrust = 0; out.tailFlare = 0.02; out.tailSide = 0; // the hem: flared back, swept sideways // the mid-spine bend; the pelvis tipped and pushed forward
  out.hipShift = 0; out.waistRoll = 0; out.headRoll = 0; // the S-curve: hips pushed sideways, a side bend at the waist, the neck tilted
  out.pelvisYaw = 0; out.chestYaw = 0; out.pelvisRoll = 0;
  if (mode === MODE.WALK) { // motion-captured gait (gait.js), blended walk -> run by speed
    const speed = (pose.speed ?? 1.2) * (v.kind === 'older' ? 0.8 : 1);
    gaitPose(pose.phase || 0, speed, out);
    out.lean += v.stoop;
    const g = v.gait;
    if (g) { // each person's own way of walking (variants.js): arm swing, bounce, shoulder roll
      const mid = (out.sh[0] + out.sh[1]) / 2;
      out.sh[0] = mid + (out.sh[0] - mid) * g.arms; out.sh[1] = mid + (out.sh[1] - mid) * g.arms;
      out.bob *= g.bounce; out.chestYaw *= g.roll;
    }
    if (v.acc === 'bag') { out.sh[1] *= 0.3; out.elbow[1] = 0.1; } // the hand with the bag hangs
    const ph0 = pose.phase || 0; // the hem lifts behind with speed and sways with each step
    out.tailFlare = Math.min(0.6, 0.05 + speed * 0.08) + 0.05 * Math.sin(ph0 * 2); out.tailSide = 0.08 * Math.sin(ph0);
    if (PROPORTION.pose) { // the manga look: a looser, swaggering walk
      out.chestYaw *= 2.4; out.pelvisYaw = (out.pelvisYaw || 0) * 2.0; out.pelvisRoll *= 2.0; out.lean -= 0.06;
      for (let q = 0; q < 2; q++) { out.sh[q] *= 1.25; out.elbow[q] += 0.3; out.abd[q] += 0.06; }
      out.headYaw -= out.chestYaw * 0.4;
    }
    if (PROPORTION.swag) { // the Spider-Verse look: a bouncing street swagger: a deep dip on every step,
      // shoulders rolling, leaning back, loose arms hanging wide, the head nodding to the beat, a wide step
      const ph = pose.phase || 0, step = Math.sin(ph * 2);
      out.bob = out.bob * 1.8 - 0.035 * Math.max(0, -step); out.lean -= 0.17;
      out.chestYaw *= 3.0; out.pelvisRoll = out.pelvisRoll * 2.6 + 0.06 * Math.sin(ph); out.pelvisYaw = (out.pelvisYaw || 0) * 2.2;
      for (let q = 0; q < 2; q++) { out.sh[q] *= 0.8; out.elbow[q] = 0.5 + 0.3 * Math.max(0, out.sh[q]); out.abd[q] += 0.2 + 0.1 * Math.sin(ph + q * Math.PI); out.legAbd[q] = 0.09; out.legYaw[q] = 0.25; out.knee[q] -= 0.22; out.hip[q] += 0.08; }
      out.headPitch += 0.09 * Math.max(0, step) - 0.05; out.headYaw -= out.chestYaw * 0.5;
    }
  } else if (mode === MODE.IDLE || mode === MODE.BROWSE) {
    // standing: breathing, the weight shifting slowly from one leg to the other, the head wandering
    const sway = Math.sin(t * 1.1 + seed), shift = Math.sin(t * 0.43 + seed * 1.7);
    const breath = Math.sin(t * 1.7 + seed);
    out.bob = 0.004 * breath - 0.006 * Math.abs(shift);
    out.pelvisRoll = 0.035 * shift;
    out.lean += 0.012 * breath;
    set2(out, 'hip', 0.03 * sway, -0.03 * sway);
    set2(out, 'knee', -0.04 - 0.1 * Math.max(0, -shift), -0.04 - 0.1 * Math.max(0, shift)); // the free leg's knee gives
    set2(out, 'sh', 0.04 * Math.sin(t * 1.3 + seed), 0.04 * Math.sin(t * 1.3 + seed + 2));
    out.headYaw += 0.25 * Math.sin(t * 0.37 + seed);
    if (mode === MODE.BROWSE) {
      set2(out, 'sh', 0.38 + 0.08 * sway, 0.3 - 0.06 * sway); set2(out, 'elbow', 0.95, 1.05); set2(out, 'abd', 0.12, 0.12);
      out.headPitch -= 0.25; out.lean += 0.06;
    } else if (pose.idle) { out.poseKind = pose.poseKind; idleAct(pose.idle, pose.idleK ?? 1, t + seed * 3, out); }
    else if (PROPORTION.pose) relaxed(out, seed, t); // the manga look: everyone stands at ease, never straight
    else if (PROPORTION.swag) street(out, seed, t); // the Spider-Verse look: a loose street stance
  } else if (mode === MODE.SIT) {
    out.pelvisY = SEAT_H / s + 0.075;
    set2(out, 'hip', 1.5, 1.5); set2(out, 'knee', -1.48, -1.48); set2(out, 'ankle', 0, 0);
    out.lean = -0.04 + v.stoop * 0.5; out.headPitch = -0.05;
    set2(out, 'sh', 0.5, 0.5); set2(out, 'elbow', 0.95, 0.95); set2(out, 'abd', 0.14, 0.14);
    const sip = ((t + seed * 5) % 11) / 11; // every 11 s: lift the right hand to drink
    if (sip > 0.85) { const u = Math.sin(((sip - 0.85) / 0.15) * Math.PI); out.sh[1] = 0.5 + 0.6 * u; out.elbow[1] = 0.95 + 1.2 * u; out.headPitch += 0.2 * u; }
    out.headYaw += 0.45 * Math.sin(t * 0.3 + seed);
  } else if (mode === MODE.CYCLE) {
    const up = Math.max(0, Math.min(1, pose.stand || 0)); // out of the saddle, pushing hard
    out.pelvisY = SADDLE.h / s + 0.03 + up * 0.13 / s;
    out.lean = 0.42 + up * 0.18; out.headPitch = 0.36 - up * 0.1;
    const down = (SADDLE.h - SADDLE.bbH) / s - 0.02, fwd = SADDLE.back / s, r = SADDLE.crank / s;
    for (let q = 0; q < 2; q++) {
      const a = (pose.phase || 0) + q * Math.PI;
      const [hip, knee] = legIK(fwd + Math.sin(a) * r, down - 0.09 / s + Math.cos(a) * r);
      out.hip[q] = hip; out.knee[q] = knee; out.ankle[q] = -(hip + knee) + 0.1;
    }
    set2(out, 'sh', 0.95, 0.95); set2(out, 'elbow', 0.35, 0.35); set2(out, 'abd', 0.1, 0.1);
  }
  if (pose.blend !== undefined || pose.air || pose.dip || pose.lean) motion(v, pose, out);
  if (pose.twist) { out.chestYaw = (out.chestYaw || 0) + pose.twist; out.headYaw -= pose.twist * 0.15; } // chest toward the aim, legs where they go
  if (pose.aim) holdGun(pose.aim, pose.aimPitch || 0, out, { sprint: pose.aimSprint || 0, ready: pose.aimReady ?? 1, phase: pose.phase || 0, speed: mode === MODE.WALK ? pose.speed || 0 : 0 });
  return out;
}

/**
 * Holding a long gun (the shooting mode): the right arm raised forward to the grip, the left
 * reaching across under the barrel, both following the aim's pitch (radians, + = up). k 0..1
 * blends from whatever the body was doing (walking legs keep walking).
 */
export function holdGun(k, pitch, out, { sprint = 0, ready = 1, phase = 0, speed = 0 } = {}) {
  // three holds, blended: LOW READY (at the hip, barrel down: the default), SHOULDERED (ready = 1:
  // aiming or just fired, follows the aim's pitch) and the SPRINT CARRY (across the chest, swinging)
  const p = Math.max(-0.9, Math.min(0.9, pitch)), r = ready * (1 - sprint);
  const m = Math.min(1, speed / 5), bob = Math.sin(phase * 2) * 0.05 * m, swing = Math.sin(phase) * (0.05 + 0.1 * sprint) * m;
  const low = { rSh: 0.32, rEl: 0.95, rAbd: -0.08, lSh: 0.72, lEl: 1.15, lAbd: -0.55, chest: 0.12 };
  const aim = { rSh: 1.25 + p, rEl: 0.55, rAbd: -0.18, lSh: 1.38 + p, lEl: 0.25, lAbd: -0.5, chest: -0.12 };
  const run = { rSh: 0.55, rEl: 1.45, rAbd: -0.05, lSh: 0.95, lEl: 1.25, lAbd: -0.62, chest: 0.1 };
  const lowRun = (key) => mix(low[key], run[key], sprint);
  const at = (key) => mix(lowRun(key), aim[key], r);
  out.sh[1] = mix(out.sh[1], at('rSh') + bob + swing * (1 - r), k); out.elbow[1] = mix(out.elbow[1], at('rEl'), k); out.abd[1] = mix(out.abd[1], at('rAbd'), k);
  out.sh[0] = mix(out.sh[0], at('lSh') + bob - swing * (1 - r), k); out.elbow[0] = mix(out.elbow[0], at('lEl'), k); out.abd[0] = mix(out.abd[0], at('lAbd'), k);
  out.chestYaw = mix(out.chestYaw || 0, (out.chestYaw || 0) + at('chest') + swing * 0.6, k); // keeps the stance twist
  out.lean += k * (0.06 * m + 0.12 * sprint); // lean into the run, more in a sprint
  if (r > 0.5) out.headPitch = mix(out.headPitch, p * 0.6, k * r); // eyes down the sights
  return out;
}

const mix = (a, b, k) => a + (b - a) * k;

/** Standing at ease (the manga look): weight on one hip, the free knee bent, a hand in a pocket, the chest turned against the hips, the head tilted. */
// the manga look's default stance (owner: in the manga even just standing is dramatic): a wide
// stance with the feet turned out, the weight on one straight leg and that hip pushed out and up,
// the shoulders tilted the other way (an S through the whole body), the chin down and the head
// tilted; one hand up at the brow or in a pocket, the other hanging in a loose fist
function relaxed(out, seed, t) {
  const side = Math.sin(seed * 7.3) > 0 ? 1 : -1, b = 0.015 * Math.sin(t * 1.3 + seed);
  const st = side > 0 ? 1 : 0, free = 1 - st, sgS = st === 1 ? 1 : -1; // the standing leg and its side (+x = 1)
  out.hipShift += sgS * 0.075; out.pelvisRoll += sgS * 0.17; out.waistRoll -= sgS * 0.3;
  out.pelvisYaw = (out.pelvisYaw || 0) + 0.3 * side; out.chestYaw = (out.chestYaw || 0) - 0.12 * side;
  out.legAbd[st] = 0.06; out.legAbd[free] = 0.26; out.legYaw[st] = 0.3; out.legYaw[free] = 0.45;
  out.knee[st] = -0.02; out.hip[st] = -0.04; out.knee[free] = -0.32; out.hip[free] = 0.18;
  // nonchalant, as far as the manga allows: most stand with their hands in their pockets (both, or
  // one with the other hanging loose); now and then one raises a hand to the brow
  const h = Math.sin(seed * 12.9898) * 43758.5453, pick = h - Math.floor(h), brow = pick > 0.86, both = pick < 0.5; // (even spread: about one in seven raises a hand)
  for (let q = 0; q < 2; q++) {
    const pocket = both || q === st; // (the standing side's hand goes in first)
    if (brow && q === free) { out.sh[q] = 1.85; out.abd[q] = 0.42; out.elbow[q] = 2.15; out.wrist[q] = 0.55; out.shY[q] = 0.025; }
    else if (pocket) { out.sh[q] = 0.12; out.abd[q] = 0.3; out.elbow[q] = 0.9; out.armTwist[q] = 0.75; out.wrist[q] = 0.3; } // a hand in the front pocket, the elbow out
    else { out.sh[q] = 0.1; out.abd[q] = 0.3; out.elbow[q] = 0.5; out.wrist[q] = -0.3; } // hanging, a loose fist
  }
  out.spineLean -= 0.06; // the chest out
  out.shY[st] -= 0.015; out.spineRoll += sgS * 0.12; out.spineLean -= 0.1; // the S continues up through the trunk, the chest lifted
  out.tailFlare = 0.1; out.tailSide = sgS * 0.22; // the coat swept out to one side
  out.headRoll += sgS * 0.14; out.headYaw += 0.35 * side; out.headPitch += (brow ? -0.14 : 0.1) + b; out.lean -= 0.07; // chin up, looking down the nose
  ground(out, 1);
}

// the Spider-Verse look's stance (owner: only Classic stays stiff): loose and lived-in, not posed:
// the weight dropped on one leg with the hip out, the chest sunk and the shoulders rounded, the
// head tilted and nodding to a beat; hands in the hoodie pocket, arms crossed leaning back, or one
// hand in a pocket and the other hanging loose
function street(out, seed, t) {
  const side = Math.sin(seed * 5.7) > 0 ? 1 : -1, st = side > 0 ? 1 : 0, free = 1 - st, sgS = st === 1 ? 1 : -1;
  const nod = Math.max(0, Math.sin(t * 4.2 + seed)) ** 2, kind = Math.floor(((Math.sin(seed * 11.3) + 1) / 2) * 2.999);
  out.hipShift += sgS * 0.06; out.pelvisRoll += sgS * 0.12; out.waistRoll -= sgS * 0.1; out.spineRoll -= sgS * 0.06;
  out.pelvisYaw = (out.pelvisYaw || 0) + 0.22 * side; out.chestYaw = (out.chestYaw || 0) - 0.1 * side;
  out.spineLean += 0.14; out.lean -= 0.04; out.shY[0] += 0.012; out.shY[1] += 0.012; // a sunk chest, shoulders up and round
  out.legAbd[st] = 0.05; out.legAbd[free] = 0.2; out.legYaw[st] = 0.25; out.legYaw[free] = 0.4;
  out.knee[st] = -0.04; out.knee[free] = -0.38; out.hip[free] = 0.16; out.toe[free] = 0.15;
  if (kind === 0) for (let q = 0; q < 2; q++) { out.sh[q] = 0.12; out.abd[q] = 0.1; out.armTwist[q] = 1.0; out.elbow[q] = 1.15; out.wrist[q] = 0.1; } // hands in the front pocket
  else if (kind === 1) { // arms crossed, leaning back
    for (let q = 0; q < 2; q++) { out.sh[q] = 0.32; out.abd[q] = 0.12; out.armTwist[q] = 1.25; out.elbow[q] = 1.75; }
    out.sh[0] = 0.4; out.elbow[0] = 1.85; out.spineLean -= 0.3; out.lean -= 0.06;
  } else { out.sh[st] = -0.1; out.abd[st] = 0.32; out.elbow[st] = 0.85; out.sh[free] = 0.12; out.abd[free] = 0.22; out.elbow[free] = 0.5; out.wrist[free] = -0.3; }
  out.headRoll += sgS * 0.15; out.headYaw += 0.25 * side; out.headPitch += -0.04 + 0.07 * nod;
  ground(out, 1);
}

/** Sink the pelvis so the lowest foot stays planted (deep knees, spread legs, a tilted pelvis); feet flat. */
function ground(out, k) {
  let reach = -Infinity;
  for (let q = 0; q < 2; q++) {
    const sg = q === 0 ? -1 : 1;
    const toe = out.toe ? out.toe[q] : 0; // on the toes: the heel up, the leg reaching further
    const r = (BODY.thigh * Math.cos(out.hip[q]) + BODY.shin * Math.cos(out.hip[q] + out.knee[q])) * Math.cos(out.legAbd[q]) - sg * BODY.hipX * Math.sin(out.pelvisRoll || 0) + 0.11 * Math.sin(toe);
    reach = Math.max(reach, r);
    out.ankle[q] = mix(out.ankle[q], -(out.hip[q] + out.knee[q]) + toe, k);
  }
  out.pelvisY -= (BODY.thigh + BODY.shin - reach) * k;
}

/** Standing activities (IDLE): k 0..1 eases the pose in over the plain idle; t: the person's own clock. */
function idleAct(kind, k, t, out) {
  if (kind === IDLE.PHONE) { // reading a phone in the right hand; a thumb scroll and a glance up now and then
    const up = Math.max(0, Math.sin(t * 0.21)) ** 8;
    out.sh[1] = mix(out.sh[1], 0.5, k); out.elbow[1] = mix(out.elbow[1], 1.75 + 0.05 * Math.sin(t * 2.3), k);
    out.abd[1] = mix(out.abd[1], -0.08, k);
    out.headPitch -= 0.42 * k * (1 - up); out.headYaw *= 1 - k * (1 - up);
  } else if (kind === IDLE.TALK) { // telling something: the hands come up in bursts, the head nods along
    const burst = Math.max(0, Math.sin(t * 0.9)) ** 2, beat = Math.sin(t * 5.2);
    out.sh[1] = mix(out.sh[1], 0.35 + 0.12 * beat, k * burst); out.elbow[1] = mix(out.elbow[1], 1.5 + 0.25 * beat, k * burst);
    out.sh[0] = mix(out.sh[0], 0.2 - 0.08 * beat, k * burst * 0.6); out.elbow[0] = mix(out.elbow[0], 1.1, k * burst * 0.6);
    out.abd[1] += 0.12 * k * burst;
    out.headPitch += 0.07 * k * Math.sin(t * 2.6) * burst; out.headYaw *= 1 - 0.7 * k;
  } else if (kind === IDLE.LOOK) { // looking around: long slow sweeps with holds, a little from the shoulders
    const a = Math.sin(t * 0.33) + 0.5 * Math.sin(t * 0.71 + 1);
    const sweep = Math.max(-1, Math.min(1, a * 1.6)); // holds at the ends
    out.headYaw += 0.6 * k * sweep; out.chestYaw += 0.15 * k * sweep;
    out.headPitch += 0.1 * k * Math.max(0, Math.sin(t * 0.17));
  } else if (kind === IDLE.POSE) { // a stand-your-ground pose (STAND_POSES), with a slow breath in it
    const P = STAND_POSES[(out.poseKind ?? 0) % STAND_POSES.length], b = 0.02 * Math.sin(t * 1.4);
    out.pelvisYaw = mix(out.pelvisYaw, P.pelvisYaw, k); out.chestYaw = mix(out.chestYaw, P.chestYaw, k);
    out.lean = mix(out.lean, P.lean + b, k); out.pelvisRoll = mix(out.pelvisRoll, P.roll, k);
    out.headYaw = mix(out.headYaw, P.headYaw, k); out.headPitch = mix(out.headPitch, P.headPitch, k);
    for (const key of ['hip', 'knee', 'sh', 'abd', 'elbow', 'legAbd', 'legYaw', 'toe', 'foreRoll', 'wrist', 'shY', 'armTwist']) if (P[key] || ['hip', 'knee', 'sh', 'abd', 'elbow'].includes(key)) for (let q = 0; q < 2; q++) out[key][q] = mix(out[key][q], (P[key] || [0, 0])[q], k);
    for (const key of SCALARS) out[key] = mix(out[key], P[key] ?? out[key], k);
    out.tailFlare = mix(out.tailFlare, P.tailFlare ?? 0.3, k); out.tailSide = mix(out.tailSide, P.tailSide ?? 0.35 * Math.sign(P.roll || 1), k); // a pose throws the coat out
    out.pelvisY = BODY.pelvisY; ground(out, k); // (re-grounded from scratch: the stance's own drop is replaced)
  } else if (kind === IDLE.HIPS) { // hands on the hips, waiting
    for (let q = 0; q < 2; q++) { out.sh[q] = mix(out.sh[q], -0.25, k); out.abd[q] = mix(out.abd[q], 0.55, k); out.elbow[q] = mix(out.elbow[q], 1.45, k); }
    out.headYaw *= 1 + 0.6 * k;
  }
}

const IDLE_J = {};
const PAIRS = ['hip', 'knee', 'ankle', 'sh', 'abd', 'elbow', 'legAbd', 'legYaw', 'shY', 'wrist', 'toe', 'foreRoll', 'armTwist'];
const SCALARS = ['hipShift', 'waistRoll', 'headRoll', 'spineLean', 'spineRoll', 'spineYaw', 'pelvisPitch', 'hipThrust', 'tailFlare', 'tailSide'];

/**
 * Optional motion layer (the player; crowds leave these unset): pose.blend 0..1 mixes the idle
 * pose into the walk by speed, so starting and stopping ease instead of snapping between modes;
 * pose.lean adds forward lean (rad, + = forward: acceleration); pose.air 0..1 tucks the legs and
 * lifts the arms (jumping, falling); pose.dip 0..1 bends the knees and lowers the hips (landing).
 * pose.bank (roll into turns) is applied by poseFigure.
 */
function motion(v, pose, out) {
  if (pose.blend !== undefined && (pose.mode ?? MODE.WALK) === MODE.WALK && pose.blend < 1) {
    const idle = jointAngles(v, { ...pose, mode: MODE.IDLE, blend: undefined, air: 0, dip: 0, lean: 0 }, IDLE_J);
    const b = Math.max(0, pose.blend);
    for (const k of PAIRS) for (let q = 0; q < 2; q++) out[k][q] = idle[k][q] + (out[k][q] - idle[k][q]) * b;
    for (const k of ['bob', 'lean', 'headPitch', 'headYaw', 'pelvisYaw', 'chestYaw', 'pelvisRoll', 'pelvisY', ...SCALARS]) out[k] = idle[k] + (out[k] - idle[k]) * b;
  }
  if (pose.lean) out.lean += pose.lean;
  const a = Math.min(1, Math.max(0, pose.air || 0));
  if (a) {
    // pose.rise 1 (going up) .. -1 (coming down): push-off with one knee driving and the arms
    // thrown up, then the legs reach for the ground and the arms spread for balance
    const r = Math.min(1, Math.max(-1, pose.rise ?? 0)), up = Math.max(0, r), dn = Math.max(0, -r);
    out.hip[0] += (0.75 * up + 0.35 * dn + 0.3 * (1 - up - dn)) * a; out.hip[1] += (-0.2 * up + 0.3 * dn + 0.2 * (1 - up - dn)) * a;
    out.knee[0] -= (1.15 * up + 0.4 * dn + 0.8 * (1 - up - dn)) * a; out.knee[1] -= (0.35 * up + 0.3 * dn + 0.5 * (1 - up - dn)) * a;
    out.ankle[0] += 0.3 * a; out.ankle[1] += (0.2 - 0.5 * up) * a; // the trailing foot points on the push-off
    const spread = 0.3 + 0.35 * dn + 0.15 * up;
    out.abd[0] += spread * a; out.abd[1] += spread * a;
    out.sh[0] += (0.9 * up + 0.15 * dn + 0.3 * (1 - up - dn)) * a; out.sh[1] += (0.9 * up + 0.15 * dn + 0.3 * (1 - up - dn)) * a;
    out.lean += (0.1 * up - 0.06 * dn) * a;
  }
  const d = Math.min(1, Math.max(0, pose.dip || 0));
  if (d) { // absorb a landing: hips drop, knees bend, chest leans in
    const [hip, knee] = legIK(0.05, BODY.thigh + BODY.shin - 0.16 * d);
    for (let q = 0; q < 2; q++) { out.hip[q] += hip * d; out.knee[q] += knee * d; out.ankle[q] -= (hip + knee) * d * 0.8; }
    out.bob -= 0.16 * d; out.lean += 0.15 * d;
  }
}

// Affine 4x4 matrices as Float32Array(16), column-major like three.js. Right-multiplying by a
// translation or an axis rotation touches only a few columns: much cheaper than general
// Matrix4 products (a crowd poses ~15 parts x 1000 figures every frame).
const mat = () => new Float32Array(16); // same type as the instance buffers: copying is a memcpy
const M = Array.from({ length: 13 }, mat);
const T1 = mat(); // a scratch matrix for stretched parts (PROPORTION)
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
    v._k = { h: v.hair, t: v.top, a: v.acc, hair: `hair:${v.hair}`, top: `top:${v.top}`, shirt: 'top:shirt', acc: `acc:${v.acc}`, belly: `belly:${v.top}`, tail: `tail:${v.top}`,
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
  const seated = mode === MODE.SIT || mode === MODE.CYCLE, PR = PROPORTION, leg = seated ? 1 : PR.leg;
  const base = root(M[0], pose.x, pose.y, pose.z, pose.rotY || 0, s);
  if (pose.bank) rz(base, pose.bank); // roll about the feet: lean into a turn
  const pp = J.pelvisPitch || 0; // (the legs keep their angles: hip angles are measured from upright)
  const pelvis = rx(rz(ry(tr(copy(M[1], base), J.hipShift || 0, (J.pelvisY + J.bob) * (seated ? 1 : 1 + (leg - 1) * 0.92), -(J.hipThrust || 0)), J.pelvisYaw || 0), J.pelvisRoll || 0), pp);
  emit(lo ? 'lo:hips' : 'hips', sc(copy(M[2], pelvis), w * PR.waist, 1, w * PR.waist), 'bottom');
  // the trunk counter-tilts against the hip drop (people stay upright; only TRUNK_ROLL of it shows)
  const belly = rx(ry(rz(copy(M[3], pelvis), -(J.pelvisRoll || 0) * (1 - TRUNK_ROLL) + (J.waistRoll || 0)), (J.chestYaw || 0) - (J.pelvisYaw || 0)), -J.lean - pp);
  // the mid-spine: the chest bends about the waist (arched back, curled forward, bent sideways, twisted)
  const sl = J.spineLean || 0, sr = J.spineRoll || 0, sy = J.spineYaw || 0;
  const chest = sl || sr || sy ? tr(rx(rz(ry(tr(copy(M[10], belly), 0, SPINE_AT, 0), sy), sr), -sl), 0, -SPINE_AT, 0) : belly;
  const tsx = w * PR.chest, tsz = w * (0.5 + 0.5 * PR.chest);
  const torso = sc(copy(M[4], chest), tsx, 1, tsz);
  const split = PR.spine && !lo;
  const longTop = v.top === 'dress' || v.top === 'coat';
  emit(lo ? (seated ? 'lo:top:short' : K.loTop) : longTop && seated ? K.shirt : K.top, torso, 'top');
  if (split) {
    emit(longTop && seated ? 'belly:shirt' : K.belly, sc(copy(M[11], belly), tsx, 1, tsz), 'top');
    if (longTop && !seated) { // the hem: hung from the hips, flared back and swept sideways
      const tm = tr(rx(rz(tr(copy(M[12], belly), 0, HEM_AT, 0), J.tailSide || 0), -(J.tailFlare || 0)), 0, -HEM_AT, 0);
      emit(K.tail, sc(tm, tsx, 1, tsz), 'top');
    }
  }
  if (v.acc === 'backpack') emit(lo ? 'lo:backpack' : K.acc, torso, 'acc');
  const hs = v.headScale * PR.head;
  const head = sc(rz(ry(rx(tr(copy(M[5], chest), 0, BODY.neckY, 0), J.headPitch), J.headYaw), J.headRoll || 0), hs, hs, hs);
  emit(lo ? 'lo:head' : 'head', head, 'skin');
  emit(lo ? K.loHair : K.hair, head, K.hairCol);
  for (let q = 0; q < 2; q++) {
    const sg = q === 0 ? -1 : 1; // 0 = left (-x), 1 = right (+x)
    let sh = J.sh[q], el = J.elbow[q];
    if (q === 1 && v.acc === 'umbrella' && mode !== MODE.CYCLE) { sh = 0.7; el = 1.5; }
    const arm = rz(rx(tr(copy(M[6], chest), sg * BODY.shoulderX * w * PR.shoulder, BODY.shoulderY + (J.shY ? J.shY[q] : 0), 0), sh), sg * J.abd[q]);
    if (J.armTwist && J.armTwist[q]) ry(arm, sg * J.armTwist[q]);
    emit(lo ? 'lo:upperArm' : 'upperArm', PR.arm === 1 ? arm : sc(copy(T1, arm), 1, PR.arm, 1), 'top');
    const fore = ry(rx(tr(copy(M[7], arm), 0, -BODY.upperArm * PR.arm, 0), el), J.foreRoll ? sg * J.foreRoll[q] : 0);
    emit(lo ? 'lo:foreArm' : 'foreArm', PR.arm === 1 ? fore : sc(copy(T1, fore), 1, PR.arm, 1), 'top');
    const hand = rx(tr(copy(M[8], fore), 0, -BODY.foreArm * PR.arm, 0), J.wrist ? J.wrist[q] : 0);
    if (!lo) emit('hand', hand, 'skin');
    if (q === 1 && ((v.acc === 'bag' && !lo) || v.acc === 'umbrella') && !seated) {
      // hangs straight down (bag) / stands straight up (umbrella) from the hand, turned like the body;
      // umbrellas show at any distance (rain is visible from afar), bags only near
      emit(K.acc, root(M[9], hand[12], hand[13], hand[14], pose.rotY || 0, s), 'acc');
    }
    const la = J.legAbd ? J.legAbd[q] : 0, ly = J.legYaw ? J.legYaw[q] : 0; // spread / cross, knee out / in
    const thigh = rx(rz(ry(tr(copy(M[6], pelvis), sg * BODY.hipX * w * PR.waist, 0, 0), -sg * ly), sg * la), J.hip[q] - pp);
    emit(lo ? 'lo:thigh' : 'thigh', leg === 1 ? thigh : sc(copy(T1, thigh), 1, leg, 1), 'bottom');
    const shin = rx(tr(copy(M[7], thigh), 0, -BODY.thigh * leg, 0), J.knee[q]);
    emit(lo ? 'lo:shin' : 'shin', leg === 1 ? shin : sc(copy(T1, shin), 1, leg, 1), 'bottom');
    if (!lo) emit('shoe', rx(rz(tr(copy(M[8], shin), 0, -BODY.shin * leg, 0), -sg * la), J.ankle[q]), 'shoe'); // (the spread undone at the ankle: soles flat)
  }
}

/** The part matrices of a posed figure (copies): [{ key, mat, colourKey }] (scattering, tests). */
export function captureParts(v, pose, J = jointAngles(v, pose)) {
  const out = [];
  poseFigure(v, pose, (key, m, colourKey) => out.push({ key, mat: Float32Array.from(m), colourKey }), J);
  return out;
}

/** Instances per figure of a variant (for pool sizing): 14 + accessory. */
export const PARTS_PER_FIGURE = 15;
