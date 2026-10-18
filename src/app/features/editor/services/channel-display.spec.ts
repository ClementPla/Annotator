import type { ChannelDisplay, PixelInfo } from '../../../lib/api';
import { fromPosition, parsePreview, renderPreview, snap, toPosition, viewRange } from './channel-display';

const INFO: PixelInfo = {
  width: 4,
  height: 4,
  channels: 1,
  sampleType: 'u16',
  significantBits: 12,
  isRgb8: false,
  ranges: [{ min: 100, max: 3000 }],
};

function channel(patch: Partial<ChannelDisplay> = {}): ChannelDisplay {
  return { name: null, visible: true, color: '#ffffff', min: 0, max: 100, gamma: 1, ...patch };
}

describe('viewRange', () => {
  it('spans the frame data by default, not the 12-bit range', () => {
    expect(viewRange(INFO, 0, undefined, false)).toEqual({ min: 100, max: 3000, step: 1 });
  });

  it('spans what the type holds with full', () => {
    expect(viewRange(INFO, 0, undefined, true)).toEqual({ min: 0, max: 4095, step: 1 });
    expect(viewRange({ ...INFO, significantBits: null }, 0, undefined, true).max).toBe(65535);
  });

  it('takes in a window past the data', () => {
    expect(viewRange(INFO, 0, { min: 50, max: 3500 }, false)).toEqual({ min: 50, max: 3500, step: 1 });
  });

  it('steps a float axis by a thousandth', () => {
    const r = viewRange({ ...INFO, sampleType: 'f32', ranges: [{ min: -1, max: 1 }] }, 0, undefined, false);
    expect([r.min, r.max]).toEqual([-1, 1]);
    expect(r.step).toBeCloseTo(0.002);
  });

  it('never gives an empty axis', () => {
    const r = viewRange({ ...INFO, ranges: [{ min: 7, max: 7 }] }, 0, undefined, false);
    expect(r.max).toBeGreaterThan(r.min);
  });
});

describe('axis positions', () => {
  const range = { min: 0, max: 1000, step: 1 };

  it('round-trip on both scales', () => {
    for (const log of [false, true]) {
      for (const v of [0, 1, 10, 250, 1000]) {
        expect(fromPosition(toPosition(v, range, log), range, log)).toBeCloseTo(v, 6);
      }
    }
  });

  it('give the low values more room on a log axis', () => {
    expect(toPosition(10, range, true)).toBeGreaterThan(5 * toPosition(10, range, false));
    expect(toPosition(1000, range, true)).toBeCloseTo(1);
  });

  it('snap integers but not floats', () => {
    expect(snap(10.6, range)).toBe(11);
    expect(snap(0.25, { min: 0, max: 1, step: 0.001 })).toBe(0.25);
  });
});

describe('preview', () => {
  function buffer(width: number, height: number, planes: number[][]): ArrayBuffer {
    const out = new ArrayBuffer(16 + width * height * planes.length * 4);
    const head = new DataView(out);
    head.setUint32(0, width, true);
    head.setUint32(4, height, true);
    head.setUint32(8, planes.length, true);
    new Float32Array(out, 16).set(planes.flat());
    return out;
  }

  it('parses what Rust sends', () => {
    const p = parsePreview(buffer(2, 1, [[1, 2], [3, 4]]));
    expect([p.width, p.height, p.channels]).toEqual([2, 1, 2]);
    expect(Array.from(p.values)).toEqual([1, 2, 3, 4]);
  });

  it('windows, tints and adds the visible channels', () => {
    const samples = parsePreview(buffer(2, 1, [[0, 100], [100, 50]]));
    const image = renderPreview(samples, [
      channel({ color: '#00ff00' }),
      channel({ color: '#ff00ff' }),
    ]);
    // Pixel 0: green off, magenta full. Pixel 1: green full, magenta half.
    expect(Array.from(image.data.slice(0, 4))).toEqual([255, 0, 255, 255]);
    expect(image.data[4]).toBeCloseTo(128, -1);
    expect(image.data[5]).toBe(255);

    const hidden = renderPreview(samples, [channel({ color: '#00ff00' }), channel({ visible: false })]);
    expect(Array.from(hidden.data.slice(0, 4))).toEqual([0, 0, 0, 255]);
  });

  it('applies gamma', () => {
    const samples = parsePreview(buffer(1, 1, [[25]]));
    const image = renderPreview(samples, [channel({ gamma: 2 })]);
    // (0.25)^(1/2) = 0.5
    expect(image.data[0]).toBeCloseTo(128, -1);
  });
});
