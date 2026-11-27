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
