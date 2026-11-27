// One random check question from learn/curriculum.md; press Enter to see the answer.
// Usage: node learn/tools/quiz.mjs [track]      (track: architecture, rendering, gameplay, ...)
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

/** -> [{ track, q, a }] from the curriculum's "## n. track: ..." headings and "- Q:" / "- A:" lines. */
export function questions(md) {
  const out = [];
  let track = '', q = null;
  for (const line of md.split('\n')) {
    const h = /^##\s+\d+\.\s+([a-z-]+):/.exec(line);
    if (h) { track = h[1]; continue; }
    const mq = /^\s*-\s+Q:\s+(.*)$/.exec(line), ma = /^\s*-\s+A:\s+(.*)$/.exec(line);
    if (mq) q = mq[1];
    else if (ma && q) { out.push({ track, q, a: ma[1] }); q = null; }
  }
  return out;
}

if (process.argv[1]?.endsWith('quiz.mjs')) {
  const all = questions(readFileSync(new URL('../curriculum.md', import.meta.url), 'utf8'));
  const want = process.argv[2], pool = want ? all.filter((x) => x.track === want) : all;
  if (!pool.length) { console.log(`no questions for "${want}". Tracks: ${[...new Set(all.map((x) => x.track))].join(', ')}`); process.exit(1); }
  const pick = pool[Math.floor(Math.random() * pool.length)];
  console.log(`[${pick.track}] ${pick.q}\n(think, or write your answer, then press Enter)`);
  const rl = createInterface({ input: process.stdin });
  rl.once('line', () => { console.log(`\n${pick.a}`); rl.close(); });
}
