// Makes the learn docs clickable: every repo path in backticks becomes a link to that file or folder, and a
// function named on the same line as its file links straight to its line (e.g. `usablePads()` -> input.js#L42).
// Usage: node learn/tools/links.mjs          (rewrites learn/*.md; safe to re-run after code moves)
// Paths resolve from the doc's folder, then the repo root, then a unique ending (`verse.js` -> viewer/src/render/verse.js).
// viewer/test/learn.test.mjs checks that every link in learn/ still lands on an existing file and line.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Tracked files (posix paths from the repo root) and every folder that holds one. */
export function repoIndex(files) {
  const list = files ?? execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
  const dirs = new Set();
  for (const f of list) for (let d = posix.dirname(f); d !== '.'; d = posix.dirname(d)) dirs.add(d);
  return { list, files: new Set(list), dirs };
}

const PATHISH = /^[\w.@-]+(?:\/[\w.@-]+)*\/?$/;
const IDENT = /^([A-Za-z_]\w*)(?:\(\))?$/;

/** The repo path a backticked span names (folders end in '/'), or null. */
export function resolvePath(span, docDir, idx) {
  if (!PATHISH.test(span) || !/[./]/.test(span)) return null;
  const clean = span.replace(/\/$/, '');
  for (const c of [posix.join(docDir, clean), clean]) {
    if (idx.files.has(c)) return c;
    if (idx.dirs.has(c)) return c + '/';
  }
  const hits = idx.list.filter((f) => f.endsWith('/' + clean));
  return hits.length === 1 ? hits[0] : null;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 1-based line where `name` is defined in a JS/Python/C#/shell file, or null. */
export function definitionLine(text, name) {
  const n = esc(name);
  const pats = [
    `^\\s*(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?function\\*?\\s+${n}\\b`,
    `^\\s*(?:export\\s+)?(?:const|let|var)\\s+${n}\\b`,
    `^\\s*(?:async\\s+)?def\\s+${n}\\b`,
    `^\\s*(?:export\\s+)?class\\s+${n}\\b`,
    `^\\s*(?:static\\s+)?(?:async\\s+)?${n}\\s*\\([^)]*\\)\\s*\\{`,
    `^\\s*(?:public|private|internal|protected)?\\s*(?:static\\s+)?[\\w<>\\[\\],?]+\\s+${n}\\s*\\(`,
    `^\\s*function\\s+${n}\\b`,
  ].map((p) => new RegExp(p));
  const lines = text.split(/\r?\n/);
  for (const re of pats) {
    const i = lines.findIndex((l) => re.test(l));
    if (i >= 0) return i + 1;
  }
  return null;
}

/**
 * Links one markdown document. `docPath` is its repo path (e.g. 'learn/curriculum.md'); `read(path)` returns a repo
 * file's text. Fenced code blocks and http(s) links are left alone. Idempotent: earlier relative links are rebuilt.
 */
export function linkify(md, docPath, idx, read) {
  const eol = md.includes('\r\n') ? '\r\n' : '\n';
  const docDir = posix.dirname(docPath);
  const rel = (p) => posix.relative(docDir, p.replace(/\/$/, '')) + (p.endsWith('/') ? '/' : '');
  let fenced = false;
  return md.split(/\r?\n/).map((line) => {
    if (/^\s*```/.test(line)) { fenced = !fenced; return line; }
    if (fenced) return line;
    // undo our own earlier links ([`x`](relative)) so a re-run recomputes them
    line = line.replace(/\[(`[^`]+`)\]\((?!https?:)[^)]*\)/g, '$1');
    // Each pass walks tokens: a whole link (kept as is, so its backticks never pair with others) or a free code span.
    // `x`<!--nolink--> opts a span out (e.g. a generated file that shares a source file's name).
    const TOKENS = /\[[^\]]*\]\([^)]*\)|`([^`]+)`(<!--nolink-->)?/g;
    const files = [];
    line = line.replace(TOKENS, (m, span, off) => {
      if (span === undefined || off) return m;
      const p = resolvePath(span, docDir, idx);
      if (!p) return m;
      if (!p.endsWith('/')) files.push(p);
      return `[\`${span}\`](${rel(p)})`;
    });
    if (!files.length) return line;
    return line.replace(TOKENS, (m, span, off) => {
      const id = span !== undefined && !off && IDENT.exec(span);
      if (!id) return m;
      for (const f of files) {
        let text;
        try { text = read(f); } catch { continue; }
        const at = definitionLine(text, id[1]);
        if (at) return `[\`${span}\`](${rel(f)}#L${at})`;
      }
      return m;
    });
  }).join(eol);
}

/** Every relative link in a doc: { target, path (repo), line|null }. */
export function relativeLinks(md, docPath) {
  const docDir = posix.dirname(docPath), out = [];
  for (const m of md.matchAll(/\]\((?!https?:|#|mailto:)([^)\s]+)\)/g)) {
    const [file, frag] = m[1].split('#');
    const line = /^L(\d+)$/.exec(frag ?? '');
    out.push({ target: m[1], path: posix.normalize(posix.join(docDir, file)), line: line ? +line[1] : null });
  }
  return out;
}

if (process.argv[1]?.endsWith('links.mjs')) {
  const idx = repoIndex();
  const read = (p) => readFileSync(join(ROOT, p), 'utf8');
  for (const name of readdirSync(join(ROOT, 'learn')).filter((n) => n.endsWith('.md')).sort()) {
    const doc = `learn/${name}`, before = read(doc), after = linkify(before, doc, idx, read);
    const n = relativeLinks(after, doc).length;
    if (after !== before) writeFileSync(join(ROOT, doc), after);
    console.log(`${doc}: ${n} links${after !== before ? ' (updated)' : ''}`);
  }
}
