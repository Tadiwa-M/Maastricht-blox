// A map of a folder: every source file, its line count and the first line of its header comment
// (every file in this repo opens with a comment saying what it does).
// Usage: node learn/tools/map.mjs <folder> [--deep]     (--deep: include subfolders)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';

const SOURCE = new Set(['.js', '.mjs', '.py', '.cs', '.ps1', '.sh', '.shader', '.json']);
const SKIP = new Set(['node_modules', '__pycache__', '.git', 'Library', 'Temp', 'bin', 'obj']);

/** The first meaningful comment line of a source file, or ''. */
export function headline(text) {
  let doc = false; // inside a Python docstring
  for (const raw of text.split('\n').slice(0, 12)) {
    const line = raw.trim();
    if (line === '"""') { doc = true; continue; }
    if (!line || line.startsWith('#!') || line === '/**') continue;
    if (doc) return line;
    const m = /^(?:\/\/+|#|\*|\/\*\*?|""")\s?(.*)$/.exec(line);
    if (m && m[1].trim() && !/^(using|import|namespace)\b/.test(m[1])) return m[1].replace(/\*\/$/, '').trim();
    if (!m) return '';
  }
  return '';
}

export function mapFolder(dir, deep = false, root = dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    if (SKIP.has(name) || name.startsWith('.')) continue;
    const p = join(dir, name), st = statSync(p);
    if (st.isDirectory()) { out.push({ path: relative(root, p) + '/', dir: true }); if (deep) out.push(...mapFolder(p, deep, root)); continue; }
    if (!SOURCE.has(extname(name))) continue;
    const text = readFileSync(p, 'utf8');
    out.push({ path: relative(root, p), lines: text.split('\n').length, about: extname(name) === '.json' ? '' : headline(text) });
  }
  return out;
}

if (process.argv[1]?.endsWith('map.mjs')) {
  const dir = process.argv[2];
  if (!dir) { console.log('usage: node learn/tools/map.mjs <folder> [--deep]'); process.exit(1); }
  const rows = mapFolder(dir, process.argv.includes('--deep'));
  const w = Math.min(44, Math.max(...rows.map((r) => r.path.length)));
  for (const r of rows) console.log(r.dir ? r.path : `${r.path.padEnd(w)} ${String(r.lines).padStart(5)}  ${r.about.slice(0, 110)}`);
}
