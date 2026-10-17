/**
 * What the microscopy import dialog edits: one row per series of every file,
 * started from the backend's default picks, turned back into the picks the
 * import takes (`SeriesPick`, in `didascalie-bioformats export`'s terms).
 */
import type { MicroscopyImport } from '../../../lib/generated/MicroscopyImport';
import type { MicroscopyInspection } from '../../../lib/generated/MicroscopyInspection';
import type { MicroscopySeries } from '../../../lib/generated/MicroscopySeries';
import type { SeriesPick } from '../../../lib/generated/SeriesPick';

export type ZMode = 'all' | 'mid' | 'max';
export type TMode = 'all' | 'step' | 'first';

/** A channel of the file, as the dialog lists it. */
export interface SourceChannel {
  source: number;
  label: string;
  /** `#rrggbb`, or null when the file gives none. */
  color: string | null;
}

export interface SeriesRow {
  series: MicroscopySeries;
  /** Whether the series is imported. */
  include: boolean;
  level: number;
  z: ZMode;
  t: TMode;
  /** Every `tStep`-th time point when `t` is `step`. */
  tStep: number;
  /** The file's channels to keep. */
  channels: number[];
}

export interface FileRow {
  path: string;
  name: string;
  error: string | null;
  rows: SeriesRow[];
}

/** One row per series, as the import would take it by default. */
export function fileRows(inspections: MicroscopyInspection[]): FileRow[] {
  return inspections.map((i) => ({
    path: i.path,
    name: i.path.split(/[\\/]/).pop() ?? i.path,
    error: i.error ?? null,
    rows: (i.file?.series ?? []).map(seriesRow),
  }));
}

function seriesRow(series: MicroscopySeries): SeriesRow {
  const pick = series.defaultPick ?? null;
  return {
    series,
    include: pick !== null,
    level: pick?.level ?? 0,
    z: pick?.z === 'max' ? 'max' : pick?.z === 'mid' ? 'mid' : 'all',
    t: 'all',
    tStep: 2,
    channels: sourceChannels(series).map((c) => c.source),
  };
}

/** The file's channels: an RGB channel's three samples count as one. */
export function sourceChannels(series: MicroscopySeries): SourceChannel[] {
  const seen = new Map<number, SourceChannel>();
  for (const c of series.channels) {
    if (seen.has(c.source)) continue;
    const rgb = series.samplesPerPixel === 3;
    seen.set(c.source, {
      source: c.source,
      label: rgb ? 'RGB' : (c.name ?? `Channel ${c.source + 1}`),
      color: rgb ? null : (c.color ?? null),
    });
  }
  return [...seen.values()];
}

/** Whether a series can be imported at all. */
export function importable(row: SeriesRow): boolean {
  return !row.series.error && !row.series.thumbnail;
}

/** Frames a row brings: time points times slices. */
export function frameCount(row: SeriesRow): number {
  const s = row.series;
  const slices = row.z === 'all' ? s.sizeZ : 1;
  const times =
    row.t === 'all' ? s.sizeT : row.t === 'first' ? 1 : Math.ceil(s.sizeT / Math.max(1, row.tStep));
  return slices * times;
}

const SAMPLE_BYTES = { u8: 1, u16: 2, f32: 4 } as const;

/** Bytes a row's frames take before compression. */
export function rawBytes(row: SeriesRow): number {
  const s = row.series;
  const level = s.levels[row.level] ?? { width: s.width, height: s.height };
  const pages = row.channels.length * Math.max(1, s.samplesPerPixel);
  return level.width * level.height * pages * SAMPLE_BYTES[s.sample] * frameCount(row);
}

/** The pick a row stands for. */
export function seriesPick(row: SeriesRow): SeriesPick {
  const s = row.series;
  const all = row.channels.length === sourceChannels(s).length;
  return {
    index: s.index,
    level: row.level,
    z: s.sizeZ > 1 ? row.z : 'all',
    t: s.sizeT <= 1 || row.t === 'all' ? 'all' : row.t === 'first' ? '0' : `step:${Math.max(1, row.tStep)}`,
    c: all ? 'all' : [...row.channels].sort((a, b) => a - b).join(','),
  };
}

/** What to import: every file, with the series kept (none leaves it out). */
export function imports(files: FileRow[]): MicroscopyImport[] {
  return files.map((f) => ({
    path: f.path,
    series: f.rows.filter((r) => r.include && importable(r) && r.channels.length > 0).map(seriesPick),
  }));
}

/** `1.2 GB`, `350 MB`, `12 kB`. */
export function formatBytes(bytes: number): string {
  const units = ['B', 'kB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let u = 0;
  while (v >= 1000 && u < units.length - 1) {
    v /= 1000;
    u++;
  }
  return `${v >= 100 || u === 0 ? Math.round(v) : v.toFixed(1)} ${units[u]}`;
}

// ── Choices for every file at once ──────────────────────────────────────────
//
// They apply where they make sense: a slice choice to stacks, a time choice
// to time series, a channel by its name (indices differ between
// acquisitions). Each series stays editable afterwards.

/** The series a bulk choice reaches: kept ones that can be imported. */
function reached(files: FileRow[]): SeriesRow[] {
  return files.flatMap((f) => f.rows).filter((r) => r.include && importable(r));
}

/** The one value `get` gives every row, or null when they differ (or none). */
export function common<T>(rows: SeriesRow[], get: (r: SeriesRow) => T): T | null {
  if (rows.length === 0) return null;
  const first = get(rows[0]);
  return rows.every((r) => get(r) === first) ? first : null;
}

export function stacks(files: FileRow[]): SeriesRow[] {
  return reached(files).filter((r) => r.series.sizeZ > 1);
}

export function timeSeries(files: FileRow[]): SeriesRow[] {
  return reached(files).filter((r) => r.series.sizeT > 1);
}

export function pyramids(files: FileRow[]): SeriesRow[] {
  return reached(files).filter((r) => r.series.levels.length > 1);
}

export function setZEverywhere(files: FileRow[], z: ZMode): void {
  for (const r of stacks(files)) r.z = z;
}

export function setTEverywhere(files: FileRow[], t: TMode, step: number): void {
  for (const r of timeSeries(files)) {
    r.t = t;
    r.tStep = step;
  }
}

/** The largest level no wider than `maxSide` (the smallest when none is), or
 *  full resolution for null. */
export function setMaxSideEverywhere(files: FileRow[], maxSide: number | null): void {
  for (const r of pyramids(files)) {
    const levels = r.series.levels;
    const fit = levels.findIndex((l) => Math.max(l.width, l.height) <= (maxSide ?? Infinity));
    r.level = fit >= 0 ? fit : levels.length - 1;
  }
}

/** Every channel name met in the kept series, in order, with its colour. */
export function channelNames(files: FileRow[]): { label: string; color: string | null }[] {
  const seen = new Map<string, string | null>();
  for (const r of reached(files)) {
    for (const c of sourceChannels(r.series)) {
      if (!seen.has(c.label)) seen.set(c.label, c.color);
    }
  }
  return [...seen].map(([label, color]) => ({ label, color }));
}

/** Whether a named channel is kept in every series that has it. */
export function channelState(files: FileRow[], label: string): 'on' | 'off' | 'mixed' {
  let on = 0;
  let off = 0;
  for (const r of reached(files)) {
    const c = sourceChannels(r.series).find((c) => c.label === label);
    if (!c) continue;
    if (r.channels.includes(c.source)) on++;
    else off++;
  }
  return off === 0 ? 'on' : on === 0 ? 'off' : 'mixed';
}

/** Keep or drop a named channel in every series that has it. A series keeps
 *  at least one channel. */
export function setChannelEverywhere(files: FileRow[], label: string, keep: boolean): void {
  for (const r of reached(files)) {
    const c = sourceChannels(r.series).find((c) => c.label === label);
    if (!c) continue;
    if (keep && !r.channels.includes(c.source)) {
      r.channels = [...r.channels, c.source];
    } else if (!keep && r.channels.length > 1) {
      r.channels = r.channels.filter((s) => s !== c.source);
    }
  }
}

/** `2 of 3 series, 42 frames`: what a file brings, for its folded header. */
export function fileSummary(file: FileRow): string {
  const kept = file.rows.filter((r) => r.include && importable(r) && r.channels.length > 0);
  const frames = kept.reduce((n, r) => n + frameCount(r), 0);
  const series = file.rows.length === 1 ? '' : `${kept.length} of ${file.rows.length} series, `;
  return `${series}${frames} frame${frames === 1 ? '' : 's'}`;
}
