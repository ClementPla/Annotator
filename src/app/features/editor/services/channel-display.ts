import type { ChannelDisplay, PixelInfo } from '../../../lib/api';

/** The value range a channel's window is shown and set over. */
export interface WindowRange {
  min: number;
  max: number;
  /** The smallest change a keyboard step makes: 1 for integers. */
  step: number;
}

/**
 * How many times finer a log axis is at its low end than a linear one: three
 * decades whatever the units. Matches `pixels::stats::LOG_SPREAD` in Rust,
 * which spaces the histogram's bins the same way.
 */
export const LOG_SPREAD = 1000;

/** Where `value` falls (0–1) on an axis over `range`. */
export function toPosition(value: number, range: WindowRange, log: boolean): number {
  const span = range.max - range.min || 1;
  const x = Math.min(1, Math.max(0, (value - range.min) / span));
  return log ? Math.log1p(LOG_SPREAD * x) / Math.log1p(LOG_SPREAD) : x;
}

/** The value at `position` (0–1) of an axis over `range`. */
export function fromPosition(position: number, range: WindowRange, log: boolean): number {
  const t = Math.min(1, Math.max(0, position));
  const x = log ? Math.expm1(t * Math.log1p(LOG_SPREAD)) / LOG_SPREAD : t;
  return range.min + x * (range.max - range.min);
}

/** `value` on the range's grid: whole numbers for integer channels. */
export function snap(value: number, range: WindowRange): number {
  return range.step >= 1 ? Math.round(value) : value;
}

/**
 * The range a channel's window is shown over. By default the frame's data,
 * from its smallest to its largest value, so the window does not sit in a
 * sliver of the axis; with `full`, everything the type holds (0–4095 for
 * 12-bit data). Either way it takes in the window itself.
 */
export function viewRange(
  info: PixelInfo,
  channel: number,
  window: Pick<ChannelDisplay, 'min' | 'max'> | undefined,
  full: boolean,
): WindowRange {
  const data = info.ranges[channel] ?? { min: 0, max: 1 };
  const integer = info.sampleType !== 'f32';
  let lo = data.min;
  let hi = data.max;
  if (full && info.sampleType === 'u8') [lo, hi] = [0, 255];
  if (full && info.sampleType === 'u16') [lo, hi] = [0, Math.max(1, 2 ** (info.significantBits ?? 16) - 1)];
  if (window) {
    lo = Math.min(lo, window.min);
    hi = Math.max(hi, window.max);
  }
  if (!(hi > lo)) hi = lo + (integer ? 1 : 1e-6);
  return { min: lo, max: hi, step: integer ? 1 : (hi - lo) / 1000 };
}

/**
 * What each press of Auto clips off both ends, in percent: a little more every
 * time, as in ImageJ, then back to almost nothing.
 */
export const AUTO_LEVELS = [0.5, 1, 2, 4, 8, 0.1];

/** The raw values the preview is drawn from: every channel's plane, smaller. */
export interface PreviewSamples {
  width: number;
  height: number;
  channels: number;
  /** Planar: channel 0's plane, then channel 1's, … */
  values: Float32Array;
}

/** Parse what `preview_samples` sends: four u32, then f32 planes. */
export function parsePreview(buffer: ArrayBuffer): PreviewSamples {
  const head = new DataView(buffer, 0, 16);
  const width = head.getUint32(0, true);
  const height = head.getUint32(4, true);
  const channels = head.getUint32(8, true);
  const values = new Float32Array(buffer.slice(16, 16 + width * height * channels * 4));
  return { width, height, channels, values };
}

/** Steps of the gamma curve; finer than the 256 levels of the output. */
const CURVE_STEPS = 1024;

/**
 * The image `channels` make of `samples`, as the Rust render does: each
 * visible channel windowed, gamma-corrected, tinted, and added.
 */
export function renderPreview(samples: PreviewSamples, channels: ChannelDisplay[]): ImageData {
  const n = samples.width * samples.height;
  const acc = new Float32Array(n * 3);
  channels.forEach((ch, c) => {
    if (!ch.visible || c >= samples.channels) return;
    const [r, g, b] = parseColor(ch.color);
    const lo = ch.min;
    const inv = 1 / Math.max(ch.max - ch.min, 1e-12);
    const curve = new Float32Array(CURVE_STEPS + 1);
    for (let k = 0; k <= CURVE_STEPS; k++) curve[k] = Math.pow(k / CURVE_STEPS, 1 / (ch.gamma || 1));
    const plane = samples.values.subarray(c * n, (c + 1) * n);
    for (let i = 0; i < n; i++) {
      let t = (plane[i] - lo) * inv;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const v = curve[(t * CURVE_STEPS) | 0];
      acc[i * 3] += v * r;
      acc[i * 3 + 1] += v * g;
      acc[i * 3 + 2] += v * b;
    }
  });
  const image = new ImageData(samples.width, samples.height);
  const px = image.data;
  for (let i = 0; i < n; i++) {
    px[i * 4] = acc[i * 3] * 255;
    px[i * 4 + 1] = acc[i * 3 + 1] * 255;
    px[i * 4 + 2] = acc[i * 3 + 2] * 255;
    px[i * 4 + 3] = 255;
  }
  return image;
}

/** `#rrggbb` as 0–1 floats; white when malformed, as in Rust. */
function parseColor(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return [1, 1, 1];
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
}
