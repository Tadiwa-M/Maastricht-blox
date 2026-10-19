// Chunk file reader (CONTRACT section 4): 32-byte header + 12-byte brick records.
export const HEADER_BYTES = 32;
export const RECORD_BYTES = 12;
export const FLAG_DEFLATE = 1;

export function parseHeader(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (magic !== 'BXC1') throw new Error(`bad chunk magic ${JSON.stringify(magic)}`);
  const h = {
    version: dv.getUint16(4, true),
    flags: dv.getUint16(6, true),
    cx: dv.getInt32(8, true),
    cy: dv.getInt32(12, true),
    brickCount: dv.getUint32(16, true),
    minK: dv.getUint16(20, true),
    maxK: dv.getUint16(22, true),
    bodyBytes: dv.getUint32(24, true),
  };
  if (h.version !== 1) throw new Error(`unsupported chunk version ${h.version}`);
  return h;
}

async function inflateRaw(data) {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Decode a .bxc file into a header plus column arrays of its records (local i/j). */
export async function parseBxc(bytes) {
  const h = parseHeader(bytes);
  let body = bytes.subarray(HEADER_BYTES, HEADER_BYTES + h.bodyBytes);
  if (h.flags & FLAG_DEFLATE) body = await inflateRaw(body);
  const n = h.brickCount;
  if (body.byteLength !== n * RECORD_BYTES) {
    throw new Error(`chunk ${h.cx},${h.cy}: body ${body.byteLength} B, expected ${n * RECORD_BYTES}`);
  }
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const rec = {
    i: new Uint8Array(n), j: new Uint8Array(n), k: new Uint16Array(n),
    type: new Uint8Array(n), color: new Uint8Array(n), rotFlags: new Uint8Array(n),
    feature: new Uint32Array(n),
  };
  for (let r = 0, o = 0; r < n; r++, o += RECORD_BYTES) {
    rec.i[r] = body[o];
    rec.j[r] = body[o + 1];
    rec.k[r] = dv.getUint16(o + 2, true);
    rec.type[r] = body[o + 4];
    rec.color[r] = body[o + 5];
    rec.rotFlags[r] = body[o + 6];
    rec.feature[r] = dv.getUint32(o + 8, true);
  }
  return { header: h, records: rec };
}
