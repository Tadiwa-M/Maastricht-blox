// Build step (viewer/build.mjs bundle()): check every place file in src/interiors/data/ and copy
// it into the site's interiors/ folder with an index.json listing them. A broken file stops the
// build with a message naming the file and the field. Adding a place = drop a JSON file in data/
// and rebuild the site (scripts/site.ps1|sh); the world is not rebuilt.
import { readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parsePlace } from './format.js';

/** -> [file names copied]. srcDir: the data folder; outDir: <site>/interiors. */
export async function copyPlaces(srcDir, outDir, log = console.log) {
  const files = existsSync(srcDir) ? (await readdir(srcDir)).filter((f) => f.endsWith('.json') && f !== 'index.json').sort() : [];
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  const ids = new Map(), out = [];
  for (const f of files) {
    let raw;
    try { raw = JSON.parse(await readFile(join(srcDir, f), 'utf8')); } catch (e) { throw new Error(`interiors/${f}: not valid JSON (${e.message})`); }
    const { place, warnings } = parsePlace(raw, `interiors/${f}`);
    for (const w of warnings) log(`warning: ${w}`);
    if (ids.has(place.id)) throw new Error(`interiors/${f}: id "${place.id}" is already used by ${ids.get(place.id)}`);
    ids.set(place.id, f);
    await writeFile(join(outDir, f), JSON.stringify(raw));
    out.push(f);
  }
  await writeFile(join(outDir, 'index.json'), JSON.stringify({ version: 1, places: out }));
  log(`interiors: ${out.length ? out.join(', ') : 'none'}`);
  return out;
}
