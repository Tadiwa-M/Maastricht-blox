import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, viewLink, issueUrl } from '../src/report/report.js';

const where = { x: 1720.4, z: 3988.2, dist: 140, mode: 'map', street: 'Markt', originRD: [174700, 314000], studM: 0.5 };

test('a report says where, with a link that reopens the view', () => {
  const r = buildReport({ text: 'The bus platforms are missing\nat the station side', category: 'building', where });
  assert.equal(r.title, '[map] Markt: The bus platforms are missing');
  assert.match(r.body, /#at=1720\.4,3988\.2&dist=140/);
  assert.match(r.body, /\| RD \(EPSG:28992\) \| 176420, 317988 \|/);
  assert.match(r.body, /\| Grid cell \(I, J\) \| 3440, 7976 \|/);
  assert.deepEqual(r.labels, ['map-report', 'report:building']);
});

test('walk-mode links reopen walk mode facing the same way', () => {
  assert.equal(viewLink({ ...where, mode: 'walk', yaw: 91.6 }, 'https://x/'), 'https://x/#mode=walk&at=1720.4,3988.2&yaw=92');
});

test('images go into the body; the fallback is a pre-filled GitHub issue', () => {
  const r = buildReport({ text: '', category: 'other', where, screenshot: '![view](u)' });
  assert.match(r.body, /no description/);
  assert.match(r.body, /!\[view\]\(u\)/);
  const u = new URL(issueUrl(r));
  assert.equal(u.pathname, '/Tadiwa-M/Maastricht-blox/issues/new');
  assert.equal(u.searchParams.get('labels'), 'map-report,report:other');
});
