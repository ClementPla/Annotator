import { decodeRle8, encodeRle8 } from './rle8';

describe('rle8', () => {
  it('writes the runs the Rust codec reads', () => {
    // 0 ×3, 1 ×2, 7 ×1: as `rle::encode8` would.
    expect(Array.from(encodeRle8(new Uint8Array([0, 0, 0, 1, 1, 7])))).toEqual([
      0, 3, 0, 0, 0, 1, 2, 0, 0, 0, 7, 1, 0, 0, 0,
    ]);
    expect(encodeRle8(new Uint8Array(0)).length).toBe(0);
  });

  it('round-trips, long runs included', () => {
    const mask = new Uint8Array(70_000 * 3);
    mask.fill(1, 10, 70_010);
    mask.fill(255, 150_000);
    expect(decodeRle8(encodeRle8(mask), mask.length)).toEqual(mask);
  });
});
