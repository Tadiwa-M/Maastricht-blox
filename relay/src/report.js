// Map reports -> GitHub issues, so reporters need no GitHub account. Images (data URLs from the
// viewer, JPEG) are committed to the REPORT_BRANCH under reports/<date>/ and linked in the issue.
// Pure parts are exported for test/report.test.mjs.

export const LIMITS = { title: 200, body: 12000, image: 2_500_000, images: 2 };

/** Validate a report payload -> { ok, error?, title, body, labels, images: [{ name, bytes }] }. */
export function checkReport(p) {
  if (!p || typeof p !== 'object') return { ok: false, error: 'bad request' };
  const title = String(p.title || '').slice(0, LIMITS.title).trim();
  const body = String(p.body || '').slice(0, LIMITS.body);
  if (!title.startsWith('[map]')) return { ok: false, error: 'not a map report' };
  const labels = (Array.isArray(p.labels) ? p.labels : []).filter((l) => /^(map-report|report:[a-z]+)$/.test(l)).slice(0, 3);
  const images = [];
  for (const [name, data] of Object.entries(p.images || {}).slice(0, LIMITS.images)) {
    if (!data) continue;
    const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(data));
    if (!m) return { ok: false, error: `${name}: only JPEG images` };
    if (m[1].length * 0.75 > LIMITS.image) return { ok: false, error: `${name}: image too big` };
    if (!/^(screenshot|photo)$/.test(name)) continue;
    images.push({ name, b64: m[1] });
  }
  return { ok: true, title, body, labels: labels.length ? labels : ['map-report'], images };
}

/** Replace the viewer's image placeholders with links to the committed files. */
export function bodyWithImages(body, links) {
  let out = body.replace(/\n\*\*(Screenshot of the view|Photo from the reporter):\*\*\n\n[^\n]*/g, '');
  for (const [name, url] of Object.entries(links)) {
    out = out.replace('\n\n_Sent with', `\n\n**${name === 'photo' ? 'Photo from the reporter' : 'Screenshot of the view'}:**\n\n![${name}](${url})\n\n_Sent with`);
  }
  return out;
}

/** Tiny per-isolate rate limit: at most `n` reports per IP per hour. */
export function rateLimiter(n = 5, windowMs = 3600_000) {
  const seen = new Map();
  return (ip, now = Date.now()) => {
    const list = (seen.get(ip) || []).filter((t) => now - t < windowMs);
    if (list.length >= n) return false;
    list.push(now); seen.set(ip, list);
    return true;
  };
}
