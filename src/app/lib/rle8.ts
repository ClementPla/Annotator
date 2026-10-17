/**
 * The `rle8` mask encoding, as `src-tauri/src/storage/rle.rs` stores it: runs
 * in row-major order, each `[value: u8][count: u32 little-endian]`.
 *
 * Masks are encoded here before they cross the IPC: a full-size mask would
 * travel as one JSON number per pixel, the encoding as a few kilobytes.
 */

const RUN_BYTES = 5;

export function encodeRle8(mask: Uint8Array): Uint8Array {
  if (mask.length === 0) return new Uint8Array(0);
  // Count the runs first, so the output is allocated once.
  let runs = 1;
  for (let i = 1; i < mask.length; i++) {
    if (mask[i] !== mask[i - 1]) runs++;
  }
  const out = new Uint8Array(runs * RUN_BYTES);
  const view = new DataView(out.buffer);
  let at = 0;
  let start = 0;
  for (let i = 1; i <= mask.length; i++) {
    if (i === mask.length || mask[i] !== mask[start]) {
      out[at] = mask[start];
      view.setUint32(at + 1, i - start, true);
      at += RUN_BYTES;
      start = i;
    }
  }
  return out;
}

export function decodeRle8(data: Uint8Array, length: number): Uint8Array {
  const mask = new Uint8Array(length);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let at = 0;
  for (let o = 0; o + RUN_BYTES <= data.length && at < length; o += RUN_BYTES) {
    const end = Math.min(at + view.getUint32(o + 1, true), length);
    if (data[o] !== 0) mask.fill(data[o], at, end);
    at = end;
  }
  return mask;
}
