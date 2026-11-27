// How each painted look's people stand, walk and pose (owner: each look owns its people; only
// Classic stays stiff). rig.js is the skeleton and its mechanics; this is the style on top:
// proportions, a walk, a default stance and (manga) stand-your-ground poses. The page's look picks
// one when this module loads (figure/crowd.js imports it); Classic has none.
import { LOOK } from '../render/verse.js';
import { setProportions, ground } from './rig.js';

/**
 * Stand-your-ground poses (pose.idle = IDLE.POSE, pose.poseKind picks one): our own sculptural poses in
 * the spirit of the fashion-plate posing of bizarre-adventure manga: weight on one hip, the trunk
 * twisted against the hips, the neck bent, an arm across the face, a pointing hand, a hand at the
 * temple. The whole skeleton takes part.
 */
// legs (owner: the poses must be dramatic in the legs too): legAbd spreads a leg out (+) or pinches
// the knee in across the body (-), legYaw turns the knee out (+) or in (-); the pelvis sinks so the
// lowest foot stays on the ground however deep the knees bend. cam: the posing shot that sells it
// (player/camera.js: yaw from straight in front, pitch, dist, fov added, focus height)
export const STAND_POSES = [
  { cam: { yaw: 0.35, pitch: -0.34, dist: 2.6, fov: 12 },
    pelvisYaw: -0.55, chestYaw: 0.75, lean: -0.22, roll: -0.3, headYaw: -0.55, headPitch: 0.1, hip: [-0.3, 0.75], knee: [-0.15, -1.15],
    legAbd: [0.28, -0.22], legYaw: [0.35, -0.4], sh: [0.1, 1.55], abd: [0.35, 0.05], elbow: [0.3, 0.05] }, // the accusation: weight thrown back on a straight leg, the front knee driving across, an arm aimed straight out
  { cam: { yaw: 1.25, pitch: -0.42, dist: 3.4, fov: 6, y: -0.6 },
    pelvisYaw: 0.7, chestYaw: -1.05, lean: -0.18, roll: 0.13, headYaw: 0.75, headPitch: -0.35, hip: [0.55, -0.1], knee: [-1.0, -0.2],
    legAbd: [-0.3, 0.12], legYaw: [-0.45, 0.2], sh: [3.05, 0.9], abd: [0.25, -0.5], elbow: [2.0, 2.3] }, // the twist: an arm thrown over the head, hips cocked hard, knees pinched in
  { cam: { yaw: -0.65, pitch: -0.48, dist: 3.0, fov: 10, y: -0.7 },
    pelvisYaw: -0.4, chestYaw: 0.9, lean: 0.18, roll: -0.12, headYaw: -0.7, headPitch: 0.2, hip: [1.05, -0.55], knee: [-1.45, -0.25],
    legAbd: [0.4, 0.35], legYaw: [0.4, 0.5], sh: [0.4, 2.2], abd: [0.3, -0.3], elbow: [1.6, 0.1] }, // the deep lunge, wide, pointing up and ahead
  { cam: { yaw: 2.5, pitch: -0.12, dist: 2.4, fov: 4, y: -0.1 },
    pelvisYaw: 0.35, chestYaw: -0.8, lean: -0.48, roll: 0.24, headYaw: 0.6, headPitch: 0.55, hip: [0.2, -0.12], knee: [-0.35, -0.1],
    legAbd: [-0.32, -0.26], legYaw: [-0.2, 0.3], sh: [-0.4, 2.7], abd: [1.1, 0.6], elbow: [2.1, 2.5] }, // legs crossed at the shin, arched back, a hand splayed across the face
  { cam: { yaw: -0.3, pitch: -0.2, dist: 4.4, fov: 14, y: -0.6 },
    pelvisYaw: -0.8, chestYaw: 1.1, lean: 0.35, roll: -0.2, headYaw: -0.95, headPitch: -0.2, hip: [1.3, 0.35], knee: [-2.0, -1.0],
    legAbd: [0.5, 0.3], legYaw: [0.6, 0.2], sh: [1.5, 1.3], abd: [1.4, 1.3], elbow: [0.4, 0.4] }, // a crouch on one heel, twisted, both arms flung wide
  { cam: { yaw: 0.05, pitch: -0.2, dist: 2.2, fov: 16, y: -0.5 },
    pelvisYaw: -0.25, chestYaw: 0.45, lean: 0.55, spineLean: 0.35, spineYaw: 0.3, roll: -0.08, headYaw: -0.2, headPitch: 0.75, hip: [1.05, -1.3], knee: [-1.75, -0.05],
    legAbd: [0.3, 0.12], legYaw: [0.3, 0.1], toe: [0, 0.7], sh: [1.55, -1.0], abd: [0.15, 0.5], elbow: [0.15, 0.7], wrist: [-0.5, 0], foreRoll: [0.6, 0] }, // the reach: flung low over a folded knee, the back leg out straight, a hand driving at you
  { cam: { yaw: 1.55, pitch: -0.36, dist: 3.2, fov: 8, y: -0.5 },
    pelvisYaw: 0.35, chestYaw: -0.6, lean: -0.42, spineLean: -0.8, spineRoll: 0.22, roll: 0.14, hipShift: 0.05, hipThrust: 0.15, pelvisPitch: -0.3, waistRoll: -0.12,
    headYaw: 0.5, headPitch: -0.85, headRoll: 0.25, hip: [-0.1, 0.55], knee: [0, -1.0], legAbd: [0.08, -0.18], legYaw: [0.25, -0.3], toe: [0, 0.95],
    sh: [2.2, 0.35], abd: [0.25, -0.35], elbow: [2.45, 1.65], wrist: [0.65, 0.45], foreRoll: [0.3, 0.9] }, // the backbend: hips thrust, the chest arched back, chin curled to the hand at the brow, up on one toe
];

/** The manga look's walk: looser, swaggering. */
function mangaWalk(out) {
  out.chestYaw *= 2.4; out.pelvisYaw = (out.pelvisYaw || 0) * 2.0; out.pelvisRoll *= 2.0; out.lean -= 0.06;
  for (let q = 0; q < 2; q++) { out.sh[q] *= 1.25; out.elbow[q] += 0.3; out.abd[q] += 0.06; }
  out.headYaw -= out.chestYaw * 0.4;
}

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * The Spider-Verse look's walk: a laid-back bounce: a small dip on each step, leaning back a touch,
 * the shoulders rolling, loose arms, the head nodding. (Owner: the run looked goofy: it had all of
 * the swagger at full strength, leaning back with straight arms and knees out.) The swagger fades
 * out with speed; a run leans into it with the arms pumping.
 */
function verseWalk(out, pose) {
  const ph = pose.phase || 0, step = Math.sin(ph * 2), w = 1 - smooth(1.8, 3.2, pose.speed ?? 1.2), run = 1 - w;
  out.bob = out.bob * (1 + 0.4 * w) - 0.02 * w * Math.max(0, -step);
  out.lean += -0.06 * w + 0.16 * run;
  out.chestYaw *= 1 + 0.9 * w; out.pelvisYaw = (out.pelvisYaw || 0) * (1 + 0.5 * w);
  out.pelvisRoll = out.pelvisRoll * (1 + 0.8 * w) + 0.03 * w * Math.sin(ph);
  for (let q = 0; q < 2; q++) {
    out.elbow[q] += 0.25 * w + 0.55 * run; out.abd[q] += (0.1 + 0.04 * Math.sin(ph + q * Math.PI)) * w;
    out.legYaw[q] = 0.12 * w; out.knee[q] -= 0.06 * w;
  }
  out.headPitch += (0.05 * Math.max(0, step) - 0.03) * w; out.headYaw -= out.chestYaw * 0.4;
}

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

export const STYLES = {
  // the heroic build of that world (the anime figure, animeparts.js, carries most of it itself)
  manga: { proportions: { shoulder: 1.12, chest: 1.06, waist: 0.92, leg: 1.17, head: 0.9, arm: 1.05, spine: true }, walk: mangaWalk, stand: relaxed, poses: STAND_POSES },
  // lanky, swaggering (verseparts.js)
  verse: { proportions: { shoulder: 1.06, chest: 1.0, waist: 0.9, leg: 1.16, head: 0.98, arm: 1.1, spine: true }, walk: verseWalk, stand: street },
};

const style = STYLES[LOOK];
if (style) setProportions({ ...style.proportions, style });
