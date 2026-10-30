// "Report a mistake": what a report contains (pure, tested in test/report.test.mjs).
//
// A report is the player's words plus everything an agent or a person needs to find and fix the
// spot: a link that opens the game exactly there (map view or walk mode), the street, Unity and
// RD coordinates, the grid cell (I, J) the pipeline uses, the view mode and the build.

export const REPO = 'Tadiwa-M/Maastricht-blox';
export const SITE = 'https://tadiwa-m.github.io/Maastricht_larper/';
export const CATEGORIES = [
  ['building', 'A building looks wrong or is missing'],
  ['street', 'A road, path or square is wrong (steps, gaps, wrong shape)'],
  ['bridge', 'A bridge, tunnel or the river'],
  ['life', 'People, bikes, cars, buses or trains behave oddly'],
  ['place', 'A shop, landmark or name is wrong or missing'],
  ['other', 'Something else'],
];

/**
 * where: { x, z (Unity metres east/north), dist (camera distance), mode: 'map'|'walk', yaw (deg),
 * street, originRD: [x, y], studM }. -> the link that reopens this view.
 */
export function viewLink(where, site = SITE) {
  const r = (v) => Math.round(v * 10) / 10;
  const p = where.mode === 'walk'
    ? `mode=walk&at=${r(where.x)},${r(where.z)}&yaw=${Math.round(where.yaw || 0)}`
    : `at=${r(where.x)},${r(where.z)}&dist=${Math.round(Math.max(20, where.dist || 120))}`;
  return `${site}#${p}`;
}

/** { title, body, labels } of a report. text: the player's words; category: CATEGORIES key. */
export function buildReport({ text, category = 'other', where, build = '', ua = '', screenshot = null, photo = null }) {
  const words = String(text || '').trim();
  const firstLine = words.split('\n')[0].slice(0, 70);
  const place = where.street || `${Math.round(where.x)}, ${Math.round(where.z)}`;
  const title = `[map] ${place}: ${firstLine || (CATEGORIES.find((c) => c[0] === category)?.[1] ?? 'mistake')}`;
  const rd = where.originRD ? [Math.round(where.originRD[0] + where.x), Math.round(where.originRD[1] + where.z)] : null;
  const studM = where.studM || 0.5;
  const lines = [
    words || '_(no description)_',
    '',
    `**Open this spot in the game:** ${viewLink(where)}`,
    '',
    '| | |', '|---|---|',
    `| Category | ${category} |`,
    `| Street | ${where.street || '?'} |`,
    `| View | ${where.mode === 'walk' ? 'walk mode' : 'map'} |`,
    `| Unity (m, east / north) | ${where.x.toFixed(1)}, ${where.z.toFixed(1)} |`,
    rd ? `| RD (EPSG:28992) | ${rd[0]}, ${rd[1]} |` : null,
    `| Grid cell (I, J) | ${Math.floor(where.x / studM)}, ${Math.floor(where.z / studM)} |`,
    build ? `| Build | ${build} |` : null,
    ua ? `| Browser | ${ua.slice(0, 120)} |` : null,
    screenshot ? '\n**Screenshot of the view:**\n\n' + screenshot : null,
    photo ? '\n**Photo from the reporter:**\n\n' + photo : null,
    '', '_Sent with the in-game "Report a mistake" button._',
  ].filter((l) => l !== null);
  return { title, body: lines.join('\n'), labels: ['map-report', `report:${category}`] };
}

/** Fallback without the relay: a pre-filled "new issue" page on GitHub (needs a GitHub account). */
export function issueUrl(report, repo = REPO) {
  const q = new URLSearchParams({ title: report.title, body: report.body, labels: report.labels.join(',') });
  return `https://github.com/${repo}/issues/new?${q}`;
}
