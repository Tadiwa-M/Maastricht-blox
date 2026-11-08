// Which quiet thing the G key (or the prompt pill) does right now (pure, tested in
// test/activities.test.mjs). While busy (sitting, cycling, on a boat) G ends it; otherwise the
// nearest chair or parked bike within reach wins, then a boat passing the riverside you stand
// on, then feeding the ducks at the water's edge.

/** Reach in metres: chair / bike from the feet, water from the feet, boat from the feet. */
export const REACH = { seat: 1.6, bike: 1.7, boatWater: 7, boat: 48, ducks: 6 };

export const LABELS = {
  sit: 'Sit down', bike: 'Ride bike', boat: 'Board the boat', ducks: 'Feed the ducks',
  stand: 'Stand up', dismount: 'Get off the bike', land: 'Get off at the next quay', stay: 'Stay aboard',
};

const within = (d, r) => d != null && Number.isFinite(d) && d <= r;

/**
 * busy: null | 'sit' | 'bike' | 'boat'. near: { seat, bike, water, boat } distances in metres
 * (null = none). pendingLand: getting off at the next quay was asked for.
 * -> { action, label, note } or null (nothing to do here). note: what is going on, shown first.
 */
export function chooseAction(busy, near = {}, { pendingLand = false } = {}) {
  const pick = (action, note = '') => ({ action, label: LABELS[action], note });
  if (busy === 'sit') return pick('stand', 'Time flies (10x)');
  if (busy === 'bike') return pick('dismount');
  if (busy === 'boat') return pendingLand ? pick('stay', 'Getting off at the next quay') : pick('land');
  const seat = within(near.seat, REACH.seat), bike = within(near.bike, REACH.bike);
  if (seat && bike) return pick(near.seat <= near.bike ? 'sit' : 'bike');
  if (seat) return pick('sit');
  if (bike) return pick('bike');
  if (within(near.water, REACH.boatWater) && within(near.boat, REACH.boat)) return pick('boat');
  if (within(near.water, REACH.ducks)) return pick('ducks');
  return null;
}

/** The pill's text: the note, then the label, with the key on keyboards. */
export function promptText(choice, touch = false) {
  if (!choice) return '';
  const label = touch ? choice.label : `${choice.label} (G)`;
  return choice.note ? `${choice.note} · ${label}` : label;
}
