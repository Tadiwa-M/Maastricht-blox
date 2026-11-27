// The learn/ folder's tools: the quiz finds questions in every curriculum track, the map reads header comments.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { questions } from '../../learn/tools/quiz.mjs';
import { headline } from '../../learn/tools/map.mjs';

test('every curriculum track has at least one check question with an answer', () => {
  const md = readFileSync(new URL('../../learn/curriculum.md', import.meta.url), 'utf8');
  const qs = questions(md), tracks = [...md.matchAll(/^##\s+\d+\.\s+([a-z-]+):/gm)].map((m) => m[1]);
  assert.equal(tracks.length, 10);
  for (const t of tracks) assert.ok(qs.some((q) => q.track === t && q.a), t);
});

test('headline: the first comment line, in each language', () => {
  assert.equal(headline('// Smooth other players\nconst x = 1;'), 'Smooth other players');
  assert.equal(headline('#!/usr/bin/env bash\n# One-command quality gate\nset -e'), 'One-command quality gate');
  assert.equal(headline('"""\nChunk writer for the bxc format.\n"""'), 'Chunk writer for the bxc format.');
  assert.equal(headline('import x from "y";'), '');
});

test('links: repo paths and same-line function names become links; re-running changes nothing', async () => {
  const { linkify, repoIndex } = await import('../../learn/tools/links.mjs');
  const idx = repoIndex(['viewer/src/a.js', 'viewer/src/render/b.js', 'learn/other.md', 'docs/guide/x.md']);
  const read = (p) => ({ 'viewer/src/a.js': '// a\n\nexport function go() {}\n', 'viewer/src/render/b.js': '  vec3 shade(vec3 c) {\n' }[p]);
  const md = [
    'See `viewer/src/a.js` (`go()`), `b.js` `shade()`, `other.md`, `docs/guide/` and `nope.js`.',
    'Generated: `a.js`<!--nolink-->; web: [`x`](https://example.com).',
    '```', '`viewer/src/a.js` in a code block stays', '```',
  ].join('\r\n');
  const once = linkify(md, 'learn/doc.md', idx, read);
  const lines = once.split('\r\n');
  assert.equal(lines[0], 'See [`viewer/src/a.js`](../viewer/src/a.js) ([`go()`](../viewer/src/a.js#L3)), [`b.js`](../viewer/src/render/b.js) '
    + '[`shade()`](../viewer/src/render/b.js#L1), [`other.md`](other.md), [`docs/guide/`](../docs/guide/) and `nope.js`.');
  assert.equal(lines[1], 'Generated: `a.js`<!--nolink-->; web: [`x`](https://example.com).');
  assert.equal(lines[3], '`viewer/src/a.js` in a code block stays');
  assert.equal(linkify(once, 'learn/doc.md', idx, read), once);
});

test('links: every link in learn/ lands on an existing file, and a #L line still holds the name it links', async () => {
  const { relativeLinks, ROOT } = await import('../../learn/tools/links.mjs');
  const { readdirSync, existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  for (const name of readdirSync(join(ROOT, 'learn')).filter((n) => n.endsWith('.md'))) {
    const md = readFileSync(join(ROOT, 'learn', name), 'utf8');
    for (const m of md.matchAll(/\[`([^`]+)`\]\(([^)]+#L\d+)\)/g)) {
      const [{ path, line }] = relativeLinks(`](${m[2]})`, `learn/${name}`);
      const text = readFileSync(join(ROOT, path), 'utf8').split(/\r?\n/)[line - 1] ?? '';
      assert.ok(text.includes(m[1].replace(/\(\)$/, '')), `${name}: ${m[0]} -> line ${line} is "${text.trim()}" (run node learn/tools/links.mjs)`);
    }
    for (const l of relativeLinks(md, `learn/${name}`)) assert.ok(existsSync(join(ROOT, l.path)), `${name}: ${l.target} does not exist`);
  }
});
