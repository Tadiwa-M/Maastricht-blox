// Tiny static file server for the screenshot and perf tools (and a quick local preview:
// `node tools/serve.mjs ../build/site 8080`). Serves a directory, no caching tricks.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png',
  '.bin': 'application/octet-stream', '.bxc': 'application/octet-stream', '.bxi': 'application/octet-stream' };

/** Start serving dir on 127.0.0.1:port (0 = any). Returns { server, url }. */
export async function serve(dir, port = 0) {
  const server = createServer(async (req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
    try {
      const body = await readFile(join(dir, path || 'index.html'));
      res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404); res.end('not found');
    }
  });
  await new Promise((ok) => server.listen(port, '127.0.0.1', ok));
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
}

/** Pull `--site <dir>` out of argv (mutates); returns the directory to serve. */
export function siteArg(argv, fallback) {
  const i = argv.indexOf('--site');
  return i >= 0 ? resolve(argv.splice(i, 2)[1]) : fallback;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { url } = await serve(resolve(process.argv[2] || '.'), Number(process.argv[3] || 8080));
  console.log(`serving ${resolve(process.argv[2] || '.')} at ${url}`);
}
