// Island file reader (CONTRACT section 5.1): 40-byte "BXI1" header with the island pose,
// then the same 12-byte brick records as a chunk, with i, j LOCAL to the island grid.
import { decodeRecords, readBody } from './bxc.js';

export const BXI_HEADER_BYTES = 40;

export function parseBxiHeader(bytes) {
  if (bytes.byteLength < BXI_HEADER_BYTES) throw new Error(`island header needs ${BXI_HEADER_BYTES} bytes`);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (magic !== 'BXI1') throw new Error(`bad island magic ${JSON.stringify(magic)}`);
  const h = {
    magic,
    version: dv.getUint16(4, true),
    flags: dv.getUint16(6, true),
    islandId: dv.getUint32(8, true),
    cx: dv.getInt32(12, true),
    cy: dv.getInt32(16, true),
    originX: dv.getFloat32(20, true),
    originZ: dv.getFloat32(24, true),
    yawDeg: dv.getFloat32(28, true),
    brickCount: dv.getUint32(32, true),
    bodyBytes: dv.getUint32(36, true),
  };
  if (h.version !== 1) throw new Error(`unsupported island version ${h.version}`);
  return h;
}

/** Decode a .bxi file into { header, records } (records: column arrays, local i/j, global k). */
export async function parseBxi(bytes) {
  const h = parseBxiHeader(bytes);
  if (bytes.byteLength !== BXI_HEADER_BYTES + h.bodyBytes) {
    throw new Error(`island ${h.islandId}: file is ${bytes.byteLength} B, header says ${BXI_HEADER_BYTES + h.bodyBytes}`);
  }
  const body = await readBody(bytes, BXI_HEADER_BYTES, h.bodyBytes, h.flags);
  return { header: h, records: decodeRecords(body, h.brickCount, `island ${h.islandId}`) };
}
