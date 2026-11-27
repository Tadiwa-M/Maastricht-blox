// Each painted look's own cars and bikes (owner: every look adopts its own figures, vehicles too):
// the same keys, sizes, wheel places and colour slots as the toy vehicles (vehicles.js), so the
// traffic, the riders and the instancing work unchanged. Vertex colours as there: 1 = the car's
// paint, < 1 fixed darker trim, > 1 lighter (chrome, a pale roof), and >= 2 an absolute decal
// colour (colour - 2: stickers, neon), which render/vehiclesurface.js paints over the body.
//   manga: rounded retro European cars (a long bonnet, separate fenders, a set-back cabin with a
//          pale roof, chrome bumpers and trim, round lamps, whitewall tyres); a drop-bar road bike
//   verse: chunky street cars (boxy, wide dark arches, big wheels, a spoiler, a roof rack or bull
//          bar, stickers); a BMX (thick tubes, high-rise bars, pegs, fat knobbly tyres)
import { rbox, box, sphere, cyl, torus, tube as tubeN, place, merge, decal, CHROME, CREAM } from './geom.js';

const WHEEL_R = 0.32, Y0 = 0.22, DARK = 0.16;
const lowOf = (t) => (t.van ? 0.85 : t.tall ? 0.74 : 0.6);

// ---- manga: retro European ---------------------------------------------------------------
function mangaBody(t) {
  const { L, W, cabin: [cw, ch, cl, cz] } = t;
  const low = lowOf(t) * 0.92;
  const parts = [
    place(rbox(W * 0.94, low, L, 0.3, 1, 3), { at: [0, Y0 + low / 2, 0] }), // a rounded tub
    place(rbox(W * 0.62, 0.1, L * 0.36, 0.05, 1, 2), { at: [0, Y0 + low + 0.02, -L / 2 + L * 0.2] }), // the bonnet's centre crease
    place(rbox(cw * 0.96, ch, cl * 0.92, Math.min(0.32, ch * 0.45), CREAM, 3), { at: [0, Y0 + low + ch / 2 - 0.08, cz + 0.08] }), // a pale roof
  ];
  for (const sx of [-1, 1]) {
    for (const az of [-1, 1]) parts.push(place(sphere(0.5, 1, 14, 10), { at: [sx * (W / 2 - 0.2), WHEEL_R + 0.1, az * (L / 2 - 0.85)], scale: [0.52, 0.62, 1.05] })); // swelling fenders
    parts.push(place(rbox(0.03, 0.04, L * 0.8, 0.015, CHROME), { at: [sx * (W * 0.47 + 0.01), Y0 + low * 0.62, 0] }), // a chrome side strip
      place(rbox(0.1, 0.07, 0.12, 0.03, CHROME), { at: [sx * (W / 2 + 0.04), Y0 + low + 0.04, cz - cl / 2 + 0.3] })); // round-ish mirrors
    if (!t.van) parts.push(place(rbox(0.05, 0.22, 0.5, 0.02, 1), { at: [sx * (W * 0.42), Y0 + low + 0.08, L / 2 - 0.3], rot: [0.25, 0, 0] })); // little tail fins
  }
  parts.push(place(rbox(W + 0.06, 0.12, 0.16, 0.06, CHROME), { at: [0, Y0 + 0.14, -L / 2 - 0.02] }), // chrome bumpers
    place(rbox(W + 0.06, 0.12, 0.16, 0.06, CHROME), { at: [0, Y0 + 0.14, L / 2 + 0.02] }),
    place(rbox(W * 0.38, 0.16, 0.04, 0.02, CHROME), { at: [0, Y0 + low * 0.55, -L / 2 - 0.005] })); // a chrome grille
  if (t.police) parts.push(place(rbox(W * 0.95, 0.2, L * 0.8, 0.05, [0.06, 0.2, 0.62]), { at: [0, Y0 + low * 0.45, 0] }));
  return merge(parts);
}
function mangaGlass(t) {
  const { L, W, cabin: [cw, ch, cl, cz] } = t;
  const low = lowOf(t) * 0.92, G = [0.05, 0.07, 0.1];
  const lamp = (x, z, c, r = 0.085) => place(cyl(r, r, 0.05, c, 14), { at: [x, Y0 + low - 0.1, z], rot: [Math.PI / 2, 0, 0] }); // round lamps
  const parts = [place(rbox(cw + 0.01, ch * 0.62, cl * 0.88, 0.16, G, 2), { at: [0, Y0 + low + ch / 2 - 0.08, cz + 0.08] }),
    lamp(-W / 2 + 0.28, -L / 2 - 0.03, [1.5, 1.45, 1.25]), lamp(W / 2 - 0.28, -L / 2 - 0.03, [1.5, 1.45, 1.25]),
    lamp(-W / 2 + 0.25, L / 2 + 0.03, [0.95, 0.08, 0.06], 0.06), lamp(W / 2 - 0.25, L / 2 + 0.03, [0.95, 0.08, 0.06], 0.06),
    place(rbox(0.46, 0.12, 0.03, 0.02, [0.95, 0.85, 0.2]), { at: [0, Y0 + 0.26, -L / 2 - 0.1] })];
  if (t.sign) parts.push(place(rbox(0.5, 0.14, 0.2, 0.04, [1.5, 1.15, 0.2]), { at: [0, Y0 + low + ch + 0.0, cz - 0.1] }));
  if (t.police) parts.push(place(rbox(1.12, 0.08, 0.32, 0.03, 0.12), { at: [0, 1.38, 0.2] }));
  return merge(parts);
}
const mangaWheel = () => merge([place(cyl(WHEEL_R, WHEEL_R, 0.2, 0.1, 20), { rot: [0, 0, Math.PI / 2] }),
  place(cyl(WHEEL_R * 0.78, WHEEL_R * 0.78, 0.205, 1.6, 18), { rot: [0, 0, Math.PI / 2] }), // a whitewall
  place(cyl(WHEEL_R * 0.6, WHEEL_R * 0.6, 0.21, 0.1, 16), { rot: [0, 0, Math.PI / 2] }),
  place(cyl(WHEEL_R * 0.42, WHEEL_R * 0.42, 0.215, 0.85, 16), { rot: [0, 0, Math.PI / 2] })]); // a chrome hubcap

// a drop-bar road bike (hands stay where the riders hold the bars: rig.js)
function mangaBike(B) {
  const tube = (a, b, r, c = 1) => tubeN(a, b, r, c, 6);
  const hub = B.wheelR, BB = [0, 0.3, B.bb], seat = [0, 0.86, 0.04], head0 = [0, 0.66, -0.68], head1 = [0, 0.88, -0.66];
  const parts = [tube(BB, seat, 0.02), tube(seat, head1, 0.019), tube(BB, head0, 0.022), tube(head0, head1, 0.024), // the diamond
    tube([0.05, 0.3, B.bb], [0.05, hub, B.rear], 0.011), tube([-0.05, 0.3, B.bb], [-0.05, hub, B.rear], 0.011),
    tube([0.04, 0.83, 0.04], [0.05, hub, B.rear], 0.01), tube([-0.04, 0.83, 0.04], [-0.05, hub, B.rear], 0.01),
    tube([0.045, head0[1], head0[2]], [0.045, hub, B.front], 0.012), tube([-0.045, head0[1], head0[2]], [-0.045, hub, B.front], 0.012),
    tube(head1, [0, 1.0, -0.62], 0.015, 0.6), tube([-0.21, 1.02, -0.6], [0.21, 1.02, -0.6], 0.012, 0.6),
    tube([0, 0.86, 0.04], [0, 0.92, 0.06], 0.011, 0.7), place(rbox(0.11, 0.04, 0.26, 0.02, DARK), { at: [0, 0.94, 0.05] }),
    place(cyl(0.065, 0.065, 0.02, CHROME, 14), { at: [0.06, 0.3, B.bb], rot: [0, 0, Math.PI / 2] })];
  for (const sx of [-1, 1]) parts.push(place(torus(0.09, 0.012, DARK, Math.PI * 1.1, 4, 10), { at: [sx * 0.21, 0.93, -0.66], rot: [0, Math.PI / 2, -0.4] })); // the drops
  return merge(parts);
}
function mangaBikeWheel(B) {
  const R = B.wheelR, parts = [place(torus(R - 0.015, 0.014, 0.12, Math.PI * 2, 4, 20), { rot: [0, Math.PI / 2, 0] }),
    place(torus(R - 0.04, 0.008, 0.86, Math.PI * 2, 3, 18), { rot: [0, Math.PI / 2, 0] }), place(cyl(0.022, 0.022, 0.07, 0.86, 8), { rot: [0, 0, Math.PI / 2] })];
  for (let q = 0; q < 10; q++) { const a = (q / 10) * Math.PI * 2; parts.push(tubeN([0, 0, 0], [0, Math.cos(a) * (R - 0.04), Math.sin(a) * (R - 0.04)], 0.003, 0.86, 3)); }
  return merge(parts);
}

// ---- verse: chunky street ----------------------------------------------------------------
const STICKERS = [decal(1, 0.15, 0.55), decal(0.15, 0.85, 1), decal(1, 0.85, 0.1), decal(0.6, 1, 0.2)];
function verseBody(t) {
  const { L, W, cabin: [cw, ch, cl, cz] } = t;
  const low = lowOf(t) * 1.05;
  const parts = [
    place(rbox(W, low, L, 0.1, 1, 2), { at: [0, Y0 + 0.04 + low / 2, 0] }), // boxy, sitting high on big wheels
    place(rbox(cw, ch, cl, 0.1, 1, 2), { at: [0, Y0 + low + ch / 2 - 0.02, cz] }),
    place(rbox(W + 0.06, 0.16, 0.18, 0.04, DARK), { at: [0, Y0 + 0.16, -L / 2] }), place(rbox(W + 0.06, 0.16, 0.18, 0.04, DARK), { at: [0, Y0 + 0.16, L / 2] }),
  ];
  for (const sx of [-1, 1]) {
    for (const az of [-1, 1]) parts.push(place(rbox(0.14, 0.24, 1.05, 0.05, DARK), { at: [sx * (W / 2 + 0.03), WHEEL_R + 0.3, az * (L / 2 - 0.85)] })); // wide arches
    parts.push(place(rbox(0.12, 0.09, 0.12, 0.02, DARK), { at: [sx * (W / 2 + 0.06), Y0 + low + 0.08, cz - cl / 2 + 0.3] }));
    STICKERS.forEach((col, k) => { if ((k + (sx > 0 ? 1 : 0)) % 2) parts.push(place(rbox(0.012, 0.12 + 0.05 * (k % 2), 0.2 + 0.06 * k, 0.01, col), { at: [sx * (W / 2 + 0.006), Y0 + low * (0.35 + 0.12 * k), -L / 4 + k * (L / 8)] })); });
  }
  if (t.van) parts.push(place(rbox(cw * 0.9, 0.06, cl * 0.8, 0.02, DARK), { at: [0, Y0 + low + ch + 0.06, cz] })); // a roof rack
  else if (t.tall || t.rails) parts.push(place(rbox(W * 0.9, 0.3, 0.06, 0.02, DARK), { at: [0, Y0 + 0.45, -L / 2 - 0.12] })); // a bull bar
  else parts.push(place(rbox(W * 0.92, 0.04, 0.26, 0.015, DARK), { at: [0, Y0 + low + ch + 0.06, cz + cl / 2 - 0.05] }), // a spoiler
    ...[-1, 1].map((sx) => place(rbox(0.04, 0.1, 0.06, 0.01, DARK), { at: [sx * W * 0.38, Y0 + low + ch + 0.0, cz + cl / 2 - 0.05] })));
  if (t.police) parts.push(place(rbox(W + 0.03, 0.2, L * 0.8, 0.03, decal(0.08, 0.25, 0.8)), { at: [0, Y0 + low * 0.5, 0] }));
  return merge(parts);
}
function verseGlass(t) {
  const { L, W, cabin: [cw, ch, cl, cz] } = t;
  const low = lowOf(t) * 1.05, G = [0.04, 0.05, 0.08];
  const lamp = (x, z, c) => place(rbox(0.36, 0.1, 0.06, 0.02, c), { at: [x, Y0 + low - 0.14, z] });
  const parts = [place(rbox(cw + 0.02, ch * 0.6, cl + 0.02, 0.06, G), { at: [0, Y0 + low + ch / 2 - 0.02, cz] }),
    lamp(-W / 2 + 0.3, -L / 2 - 0.01, [1.4, 1.4, 1.5]), lamp(W / 2 - 0.3, -L / 2 - 0.01, [1.4, 1.4, 1.5]),
    lamp(-W / 2 + 0.25, L / 2 + 0.01, [1.0, 0.06, 0.2]), lamp(W / 2 - 0.25, L / 2 + 0.01, [1.0, 0.06, 0.2]),
    place(rbox(0.5, 0.14, 0.03, 0.02, [0.95, 0.85, 0.2]), { at: [0, Y0 + 0.3, -L / 2 - 0.1] })];
  if (t.sign) parts.push(place(rbox(0.5, 0.14, 0.2, 0.04, [1.5, 1.15, 0.2]), { at: [0, Y0 + low + ch + 0.04, cz - 0.2] }));
  if (t.police) parts.push(place(rbox(1.12, 0.08, 0.32, 0.03, 0.12), { at: [0, 1.4, 0.2] }));
  return merge(parts);
}
const verseWheel = () => { const parts = [place(cyl(WHEEL_R, WHEEL_R, 0.28, 0.1, 16), { rot: [0, 0, Math.PI / 2] }),
  place(cyl(WHEEL_R * 0.62, WHEEL_R * 0.62, 0.285, 0.8, 6), { rot: [0, 0, Math.PI / 2] })]; // fat tyres, six-spoke rims
  for (let q = 0; q < 12; q++) { const a = (q / 12) * Math.PI * 2; parts.push(place(box(0.29, 0.05, 0.05, 0.1), { at: [0, Math.cos(a) * WHEEL_R, Math.sin(a) * WHEEL_R], rot: [a, 0, 0] })); } // tread blocks (plain boxes: 12 a wheel, 4 wheels a car)
  return merge(parts); };

// a BMX (riders' hands and saddle stay put: rig.js)
function verseBike(B) {
  const tube = (a, b, r, c = 1) => tubeN(a, b, r, c, 6);
  const hub = B.wheelR, BB = [0, 0.3, B.bb], seat = [0, 0.8, 0.0], head0 = [0, 0.6, -0.68], head1 = [0, 0.82, -0.64];
  const parts = [tube(BB, seat, 0.03), tube(seat, head1, 0.03), tube(BB, head0, 0.033), tube(head0, head1, 0.034),
    tube([0.05, 0.3, B.bb], [0.06, hub, B.rear], 0.018), tube([-0.05, 0.3, B.bb], [-0.06, hub, B.rear], 0.018),
    tube([0.04, 0.78, 0.0], [0.06, hub, B.rear], 0.016), tube([-0.04, 0.78, 0.0], [-0.06, hub, B.rear], 0.016),
    tube([0.05, head0[1], head0[2]], [0.06, hub, B.front], 0.018), tube([-0.05, head0[1], head0[2]], [-0.06, hub, B.front], 0.018),
    tube(head1, [0, 0.9, -0.62], 0.02, DARK), // high-rise bars with a crossbar
    tube([-0.15, 0.9, -0.62], [-0.28, 1.04, -0.58], 0.014, DARK), tube([0.15, 0.9, -0.62], [0.28, 1.04, -0.58], 0.014, DARK),
    tube([-0.15, 0.9, -0.62], [0.15, 0.9, -0.62], 0.014, DARK), tube([-0.2, 0.97, -0.6], [0.2, 0.97, -0.6], 0.012, DARK),
    tube([-0.3, 1.04, -0.58], [0.3, 1.04, -0.58], 0.016, DARK),
    tube([0, 0.8, 0.0], [0, 0.9, 0.02], 0.014, DARK), place(rbox(0.13, 0.05, 0.24, 0.03, decal(1, 0.2, 0.55)), { at: [0, 0.94, 0.02] }), // a hot-pink saddle
    place(cyl(0.07, 0.07, 0.025, decal(0.15, 0.85, 1), 14), { at: [0.07, 0.3, B.bb], rot: [0, 0, Math.PI / 2] })];
  for (const z of [B.rear, B.front]) parts.push(place(cyl(0.022, 0.022, 0.3, CHROME, 8), { at: [0, hub, z], rot: [0, 0, Math.PI / 2] })); // pegs
  return merge(parts);
}
function verseBikeWheel(B) {
  const R = B.wheelR, parts = [place(torus(R - 0.04, 0.042, 0.12, Math.PI * 2, 6, 18), { rot: [0, Math.PI / 2, 0] }),
    place(torus(R - 0.085, 0.012, 0.85, Math.PI * 2, 3, 16), { rot: [0, Math.PI / 2, 0] }), place(cyl(0.035, 0.035, 0.1, 0.8, 8), { rot: [0, 0, Math.PI / 2] })];
  for (let q = 0; q < 5; q++) { const a = (q / 5) * Math.PI * 2; parts.push(place(rbox(0.02, R - 0.09, 0.03, 0.008, 0.8), { at: [0, Math.cos(a) * (R - 0.09) / 2, Math.sin(a) * (R - 0.09) / 2], rot: [a, 0, 0] })); } // mag spokes
  return merge(parts);
}

/** The look's own vehicle geometries keyed as VEHICLE_GEOS (bikeFrame, bikeWheel, carWheel, body:<type>, glass:<type>), or null. */
export function lookRides(look, CAR_TYPES, BIKE) {
  if (look !== 'manga' && look !== 'verse') return null;
  const m = look === 'manga';
  const out = { bikeFrame: m ? mangaBike(BIKE) : verseBike(BIKE), bikeWheel: m ? mangaBikeWheel(BIKE) : verseBikeWheel(BIKE), carWheel: m ? mangaWheel() : verseWheel() };
  for (const [k, t] of Object.entries(CAR_TYPES)) { out[`body:${k}`] = m ? mangaBody(t) : verseBody(t); out[`glass:${k}`] = m ? mangaGlass(t) : verseGlass(t); }
  return out;
}
