// Interiors: walk into real places (docs/guide/19-interiors.md). initInteriors(ctx) is called once
// by main.js (initHooks, after the player). Places are data: interiors/index.json + one JSON per
// place, copied into the site by build.mjs (copy-data.mjs), so adding one needs no world rebuild.
//
// Walking up to a door shows "Enter <name>"; F, the hint, gamepad X, or walking into the door
// fades to black and puts the player in the room, DEPTH metres below the door (layout.js). The
// room answers the city queries while the player is in it (volume.js), so the shared controller
// and follow camera collide with its walls and furniture. Walking back into the doorway (or F)
// fades back out onto the pavement, facing the street.
//
// URL hash: #interior=<id> starts inside that place (with #mode=walk&at=... or on its own).
import { parsePlace, MAX_PEOPLE } from './format.js';
import { roomFrame, entrySpot, exitSpot, DEPTH } from './layout.js';
import { roomVolume, installVolumes } from './volume.js';
import { nearestDoor, exitCheck, Fader, doorHere } from './door.js';
import { roomPeople, peoplePoses } from './people.js';
import { buildRoomGroup, placeRoomGroup, buildSign } from './mesh.js';
import { FigureCrowd } from '../figure/crowd.js';
import { makeVariant } from '../figure/variants.js';

/** Follow-camera settings while inside (player/camera.js CAM keys): close, low shoulder offset. */
export const INSIDE_CAM = { minDist: 0.7, shoulder: 0.22, fov: 60, sprintBack: 0, sprintFov: 0, focusY: 1.5 };
export const INSIDE_DIST = { want: 2.3, max: 3.4, pitch: 0.3 };
const SIGN_DIST = 220; // m: signs further than this from the camera are hidden

/** Fetch and parse every place listed in <base>index.json; a broken file is skipped with an error. */
export async function loadPlaces(fetchJson, base = 'interiors/') {
  let index;
  try { index = await fetchJson(`${base}index.json`); } catch { return []; }
  const out = [], seen = new Set();
  for (const f of index?.places || []) {
    try {
      const { place, warnings } = parsePlace(await fetchJson(`${base}${f}`), f);
      for (const w of warnings) console.warn(w);
      if (seen.has(place.id)) throw new Error(`${f}: id "${place.id}" is used twice`);
      seen.add(place.id);
      out.push(place);
    } catch (e) { console.error('interiors', e.message || e); }
  }
  return out;
}

const CSS = `
#in-pill { position: fixed; left: 50%; bottom: calc(110px + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%);
  z-index: 5; background: rgba(18,22,30,.8); color: #f6f3ea; border: 1px solid rgba(255,255,255,.25); border-radius: 999px;
  padding: 8px 16px; font: 600 13px/1.2 system-ui, sans-serif; cursor: pointer; white-space: nowrap; max-width: calc(100vw - 32px);
  overflow: hidden; text-overflow: ellipsis; }
#in-pill:hover { border-color: #F2A900; }
#in-pill kbd { font: 700 11px system-ui, sans-serif; background: rgba(255,255,255,.16); border-radius: 4px; padding: 1px 6px; margin-left: 8px; }
#in-pill[hidden] { display: none; }
body.title #in-pill, body.riding #in-pill, body.shot #in-pill { display: none; }
#in-fade { position: fixed; inset: 0; background: #07080c; opacity: 0; pointer-events: none; z-index: 8; }
`;

export const DOOR_ORIGIN_RD = [174700, 314000]; // the city slice: where the doors in data/ were picked

/** Move a place's door from the origin it was picked in to this world's origin (both RD metres). */
export function shiftDoor(place, worldOrigin) {
  const from = place.originRD || DOOR_ORIGIN_RD;
  if (!worldOrigin || !place.door || place.shifted) return place;
  place.door.x += from[0] - worldOrigin[0]; place.door.z += from[1] - worldOrigin[1];
  place.shifted = true;
  return place;
}

export async function initInteriors(ctx) {
  if (typeof document === 'undefined') return null;
  const player = window.__bloxPlayer;
  if (!player?.ctrl || !player.city) return null;
  const { stage } = ctx;
  const camera = ctx.camera || stage.camera;
  const places = await loadPlaces(async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(`${u}: ${r.status}`); return r.json(); });
  // door positions are Unity metres of the world they were picked in (a place's own originRD,
  // else the city slice's): another world (the whole of Maastricht) has its origin elsewhere
  const worldOrigin = window.BLOX_SITE?.originRD || ctx.originRD || ctx.world?.manifest?.originRD || null;
  for (const p of places) shiftDoor(p, worldOrigin);
  const byId = new Map(places.map((p) => [p.id, p]));
  const volumes = installVolumes(player.city);
  const fader = new Fader();
  const el = (tag, props) => Object.assign(document.createElement(tag), props);
  document.head.append(el('style', { textContent: CSS }));
  const pill = el('button', { id: 'in-pill', hidden: true });
  const fade = el('div', { id: 'in-fade' });
  document.body.append(pill, fade);

  const rooms = new Map(); // id -> three.js group (built on first visit)
  const signs = new Map(); // id -> group | null (null: pavement height not known yet)
  const ground = new Map(); // id -> pavement y at the door
  let crowd = null, inside = null, near = null, cooldown = 0, mapFix = 0, t = 0, padX = false;
  let startId = new URLSearchParams(location.hash.replace(/^#/, '')).get('interior');

  const groundOf = (p) => {
    if (ground.has(p.id)) return ground.get(p.id);
    const g = volumes.base.groundHeight(p.door.x, -p.door.z);
    if (typeof g !== 'number') return null;
    ground.set(p.id, g);
    return g;
  };

  // the player's public API puts them somewhere (enterAtUnity: snaps the camera, resets the
  // follow smoothing); its first-walk tip is for the first walks, not for every door
  function teleport(ux, uz, yaw) {
    let tips = null;
    try { tips = localStorage.getItem('blox.walkTips'); localStorage.setItem('blox.walkTips', '99'); } catch { /* no storage */ }
    const ok = player.enterAtUnity(ux, uz, yaw, yaw, false);
    try { if (tips === null) localStorage.removeItem('blox.walkTips'); else localStorage.setItem('blox.walkTips', tips); } catch { /* no storage */ }
    return ok;
  }

  let savedCam = null, savedShadow = null;
  function cameraInside(on) {
    const f = player.follow;
    if (on) {
      savedCam = { o: Object.fromEntries(Object.keys(INSIDE_CAM).map((k) => [k, f.o[k]])), want: f.want, pitch: f.pitch };
      Object.assign(f.o, INSIDE_CAM);
      f.want = INSIDE_DIST.want; f.pitch = INSIDE_DIST.pitch;
      savedShadow = stage.sun?.shadow?.intensity ?? null;
      if (savedShadow !== null) stage.sun.shadow.intensity = 0; // the city above would shade the room
    } else if (savedCam) {
      Object.assign(f.o, savedCam.o);
      f.want = savedCam.want; f.pitch = savedCam.pitch;
      if (savedShadow !== null) stage.sun.shadow.intensity = savedShadow;
      savedCam = null;
    }
  }

  function goInside(place) {
    const g = groundOf(place) ?? player.ctrl.pos[1];
    const floorY = g - DEPTH + place.room.floor;
    let group = rooms.get(place.id);
    if (!group) { group = buildRoomGroup(place); rooms.set(place.id, group); stage.scene.add(group); }
    placeRoomGroup(group, place, floorY);
    group.visible = true;
    const vol = roomVolume(place, floorY);
    volumes.set(vol);
    const fr = roomFrame(place), s = entrySpot(place);
    const [ux, uz] = fr.toUnity(s.x, s.z);
    cameraInside(true);
    if (!teleport(ux, uz, fr.yawIn)) { volumes.set(null); cameraInside(false); group.visible = false; return false; }
    if (!crowd) { crowd = new FigureCrowd(MAX_PEOPLE, { lod: false, shadows: false }); stage.scene.add(crowd.group); }
    const people = roomPeople(place).map((p) => {
      const v = makeVariant(p.seed, { kind: 'adult' });
      v.acc = 'none';
      return { ...p, v };
    });
    inside = { place, vol, floorY, people, shift: g - floorY };
    document.body.classList.add('interior');
    return true;
  }

  /** Leave the room state (volume off, camera back); `out` also puts the player on the pavement. */
  function endInside(out = true) {
    if (!inside) return;
    const { place } = inside;
    volumes.set(null);
    cameraInside(false);
    rooms.get(place.id).visible = false;
    if (crowd) { crowd.begin(); crowd.end(); }
    inside = null;
    document.body.classList.remove('interior');
    if (out) {
      const [ux, uz] = exitSpot(place);
      teleport(ux, uz, roomFrame(place).yawOut);
    }
    cooldown = 1.2;
  }

  const enter = (place) => player.mode === 'walk' && fader.start(() => goInside(place));
  const leave = () => inside && fader.start(() => endInside(true));
  function act() {
    if (fader.busy) return;
    if (inside) leave(); else if (near) enter(near);
  }
  pill.addEventListener('click', () => act());
  window.addEventListener('keydown', (e) => {
    if (e.repeat || /INPUT|TEXTAREA|SELECT/.test(e.target?.tagName || '')) return;
    if (e.code === 'KeyF' && (inside || near) && player.mode === 'walk') { act(); e.stopImmediatePropagation(); }
    // M (back to the map) from inside: out onto the pavement first, so the map flight starts there
    if (e.code === 'KeyM' && inside) endInside(true);
  }, true);

  function showPill(text) {
    if (!text) { pill.hidden = true; return; }
    const html = `${text}<kbd>F</kbd>`;
    if (pill.innerHTML !== html) pill.innerHTML = html;
    pill.hidden = false;
  }

  function updateSigns() {
    const c = camera.position;
    for (const p of places) {
      if (Math.abs(c.x - p.door.x) > SIGN_DIST || Math.abs(-c.z - p.door.z) > SIGN_DIST) { const s = signs.get(p.id); if (s) s.visible = false; continue; }
      if (!signs.get(p.id)) {
        const g = groundOf(p);
        if (g === null) continue;
        const s = buildSign(p, g);
        signs.set(p.id, s);
        stage.scene.add(s);
      }
      signs.get(p.id).visible = !inside;
    }
  }

  function padPressed() {
    const pads = navigator.getGamepads?.() || [];
    const down = [...pads].some((g) => g?.buttons?.[2]?.pressed);
    const edge = down && !padX;
    padX = down;
    return edge;
  }

  const api = {
    places,
    get inside() { return inside?.place.id ?? null; },
    enter(id) { const p = byId.get(id); return p ? enter(p) : false; },
    leave,
    /** Door snippet for a place file: stand on the pavement at the door, facing it. */
    here() { const [x, , z] = player.ctrl.pos; return doorHere({ x, z: -z }, player.ctrl.yaw); },
    update(dt) {
      t += dt;
      const op = fader.update(dt);
      fade.style.opacity = op ? op.toFixed(3) : '0';
      if (mapFix && ctx.controls?.enabled) { // the map flight from inside ended under the street
        camera.position.y += mapFix; ctx.controls.target.y += mapFix; mapFix = 0;
      }
      if (startId && !fader.busy) { // #interior=<id>
        const p = byId.get(startId);
        if (!p) startId = null;
        else if (player.mode !== 'walk') { const [ux, uz] = exitSpot(p); if (groundOf(p) !== null) teleport(ux, uz, roomFrame(p).yawIn); }
        else if (goInside(p)) startId = null;
      }
      updateSigns();
      const riding = document.body.classList.contains('riding') || !!window.__bloxRide?.state?.ride;
      const pad = padPressed();
      if (inside) {
        const [x, y, z] = player.ctrl.pos;
        if (player.mode !== 'walk') { mapFix = inside.shift; endInside(false); showPill(null); return; }
        // moved away by something else (a trip, a ride): leave them there; but never leave anyone
        // under the street once the room is gone
        if (!inside.vol.contains(x, y + 0.5, z)) { endInside(y < inside.vol.box.max.y + 2); return; }
        const f = player.follow;
        if (f.aimDist > INSIDE_DIST.max) f.aimDist = INSIDE_DIST.max; // rooms are small; never zoom out to the map from here
        if (camera.near > 0.09) { camera.near = 0.08; camera.updateProjectionMatrix(); }
        const [rx, rz] = inside.vol.toRoom(x, z);
        const ex = exitCheck(inside.place, { x: rx, z: rz }, player.ctrl.yaw);
        showPill(ex.near ? `Leave ${inside.place.name}` : null);
        if ((ex.walkOut || (pad && ex.near)) && !fader.busy) leave();
        crowd.begin(camera.position);
        const poses = peoplePoses(inside.place, inside.people, inside.floorY, t);
        poses.forEach((pose, q) => crowd.add(inside.people[q].v, pose));
        crowd.end();
        return;
      }
      if (cooldown > 0) cooldown -= dt;
      if (player.mode !== 'walk' || riding || fader.busy) { near = null; showPill(null); return; }
      const [x, y, z] = player.ctrl.pos;
      const hit = nearestDoor(places, { x, y, z: -z }, player.ctrl.yaw, groundOf);
      near = hit?.place ?? null;
      showPill(near ? `Enter ${near.name}` : null);
      if (hit && cooldown <= 0 && (hit.check.walkIn || pad)) enter(hit.place);
    },
  };
  window.__bloxInteriors = api;
  return api;
}
