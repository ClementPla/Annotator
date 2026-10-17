import { Component, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { DialogModule } from 'primeng/dialog';
import { InputNumberModule } from 'primeng/inputnumber';
import { SelectModule } from 'primeng/select';

import { api } from '../../../lib/api';
import type { MicroscopyImport } from '../../../lib/generated/MicroscopyImport';
import type { MicroscopyInspection } from '../../../lib/generated/MicroscopyInspection';
import type { ScanOptions } from '../../../lib/generated/ScanOptions';
import {
  FileRow,
  SeriesRow,
  SourceChannel,
  TMode,
  ZMode,
  channelNames,
  channelState,
  common,
  fileRows,
  fileSummary,
  formatBytes,
  frameCount,
  importable,
  imports,
  pyramids,
  rawBytes,
  setChannelEverywhere,
  setMaxSideEverywhere,
  setTEverywhere,
  setZEverywhere,
  sourceChannels,
  stacks,
  timeSeries,
} from './microscopy-picks';

/** Past this many files, their sections start folded. */
const FOLD_PAST = 3;

/**
 * Before a folder scan imports microscopy files, choose what to take of each:
 * which series, channels, slices, time points and resolution level. Every
 * series starts from the backend's default pick.
 *
 * Use it through {@link chooseFor}: it resolves to the picks for
 * `ScanOptions.microscopy`, `undefined` when the folder has no microscopy
 * file, or `null` when the user cancels the import.
 */
@Component({
  selector: 'app-microscopy-import-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, CheckboxModule, DialogModule, InputNumberModule, SelectModule],
  templateUrl: './microscopy-import-dialog.component.html',
  styles: `
    .series { border: 1px solid var(--p-content-border-color); border-radius: 6px; }
    .series.off { opacity: 0.6; }
    .chip {
      display: inline-flex; align-items: center; gap: 0.35rem;
      padding: 0.15rem 0.6rem; border-radius: 999px; font-size: 0.8rem;
      border: 1px solid var(--p-content-border-color); background: transparent;
      color: inherit; cursor: pointer;
    }
    .chip.on { background: var(--p-highlight-background); border-color: var(--p-primary-color); }
    .swatch { width: 0.7rem; height: 0.7rem; border-radius: 50%; border: 1px solid rgba(0, 0, 0, 0.3); }
    .muted { color: var(--p-text-muted-color); }
    .bulk {
      background: var(--p-content-hover-background, rgba(127, 127, 127, 0.08));
      border-radius: 6px;
    }
    .bulk-label { flex: 0 0 6rem; font-size: 0.8rem; color: var(--p-text-muted-color); }
    .chip.mixed { border-style: dashed; }
    .file-head {
      display: flex; align-items: baseline; gap: 0.5rem; width: 100%;
      background: none; border: none; padding: 0; color: inherit; text-align: left; cursor: pointer;
    }
  `,
})
export class MicroscopyImportDialogComponent {
  readonly visible = signal(false);
  readonly files = signal<FileRow[]>([]);
  /** Bumped on every edit, so the totals recompute. */
  private readonly edits = signal(0);

  readonly zOptions = [
    { label: 'Every slice', value: 'all' },
    { label: 'Middle slice', value: 'mid' },
    { label: 'Maximum projection', value: 'max' },
  ];
  readonly tOptions = [
    { label: 'Every time point', value: 'all' },
    { label: 'One in…', value: 'step' },
    { label: 'First only', value: 'first' },
  ];

  readonly maxSideOptions = [
    { label: 'Full resolution', value: 0 },
    { label: 'Up to 8192 px', value: 8192 },
    { label: 'Up to 4096 px', value: 4096 },
    { label: 'Up to 2048 px', value: 2048 },
    { label: 'Up to 1024 px', value: 1024 },
  ];

  /** The bulk resolution last chosen (0: full); undefined until one is. */
  bulkMaxSide: number | undefined = undefined;

  /** Paths of the files whose sections are folded. */
  readonly folded = signal<ReadonlySet<string>>(new Set());

  /** What the bulk bar shows: the value every series shares, or null. */
  readonly bulk = computed(() => {
    this.edits();
    const files = this.files();
    const z = stacks(files);
    const t = timeSeries(files);
    return {
      several: files.length > 1 || files.some((f) => f.rows.length > 1),
      stacks: z.length,
      z: common(z, (r) => r.z),
      timeSeries: t.length,
      t: common(t, (r) => r.t),
      tStep: common(t, (r) => r.tStep) ?? 2,
      pyramids: pyramids(files).length,
      channels: channelNames(files).map((c) => ({ ...c, state: channelState(files, c.label) })),
    };
  });

  readonly totals = computed(() => {
    this.edits();
    const rows = this.files().flatMap((f) => f.rows.filter((r) => this.kept(r)));
    return {
      series: rows.length,
      frames: rows.reduce((n, r) => n + frameCount(r), 0),
      bytes: rows.reduce((n, r) => n + rawBytes(r), 0),
    };
  });

  private resolve: ((picks: MicroscopyImport[] | null) => void) | null = null;

  /**
   * Find the microscopy files a scan with `options` would take and let the
   * user choose what to import of them.
   */
  async chooseFor(options: ScanOptions): Promise<MicroscopyImport[] | null | undefined> {
    const paths = await api.findMicroscopyFiles(options);
    if (paths.length === 0) return undefined;
    return this.choose(await api.inspectMicroscopy(paths));
  }

  /** Show `inspections`; resolves to the picks, or null when cancelled. */
  choose(inspections: MicroscopyInspection[]): Promise<MicroscopyImport[] | null> {
    this.resolve?.(null);
    const files = fileRows(inspections);
    this.files.set(files);
    this.folded.set(new Set(files.length > FOLD_PAST ? files.map((f) => f.path) : []));
    this.bulkMaxSide = undefined;
    this.edits.update((n) => n + 1);
    this.visible.set(true);
    return new Promise((resolve) => (this.resolve = resolve));
  }

  confirm(): void {
    this.finish(imports(this.files()));
  }

  cancel(): void {
    this.finish(null);
  }

  /** Closing the dialog any other way cancels. */
  onVisibleChange(visible: boolean): void {
    if (!visible) this.finish(null);
  }

  touch(): void {
    this.edits.update((n) => n + 1);
  }

  // ── For every file ────────────────────────────────────────────────────────

  allZ(z: ZMode): void {
    setZEverywhere(this.files(), z);
    this.touch();
  }

  allT(t: TMode, step: number): void {
    setTEverywhere(this.files(), t, Math.max(2, Math.floor(step) || 2));
    this.touch();
  }

  /** 0 is full resolution. */
  allMaxSide(maxSide: number): void {
    setMaxSideEverywhere(this.files(), maxSide || null);
    this.touch();
  }

  /** A mixed or dropped channel is kept everywhere; a kept one dropped. */
  allChannel(label: string, state: 'on' | 'off' | 'mixed'): void {
    setChannelEverywhere(this.files(), label, state !== 'on');
    this.touch();
  }

  isFolded(file: FileRow): boolean {
    return this.folded().has(file.path);
  }

  toggleFold(file: FileRow): void {
    const next = new Set(this.folded());
    if (!next.delete(file.path)) next.add(file.path);
    this.folded.set(next);
  }

  // ── Template helpers ──────────────────────────────────────────────────────

  readonly fileSummary = fileSummary;

  readonly importable = importable;
  readonly sourceChannels = sourceChannels;
  readonly frameCount = frameCount;
  readonly formatBytes = formatBytes;

  kept(row: SeriesRow): boolean {
    return row.include && importable(row) && row.channels.length > 0;
  }

  levelOptions(row: SeriesRow): { label: string; value: number }[] {
    return row.series.levels.map((l, i) => ({
      label: `${l.width} × ${l.height}${i === 0 ? ' (full)' : ''}`,
      value: i,
    }));
  }

  hasChannel(row: SeriesRow, channel: SourceChannel): boolean {
    return row.channels.includes(channel.source);
  }

  /** Toggle a channel; the last one stays on. */
  toggleChannel(row: SeriesRow, channel: SourceChannel): void {
    if (this.hasChannel(row, channel)) {
      if (row.channels.length > 1) row.channels = row.channels.filter((c) => c !== channel.source);
    } else {
      row.channels = [...row.channels, channel.source];
    }
    this.touch();
  }

  /** `16-bit (12 used)`, `8-bit`, `float`. */
  depth(row: SeriesRow): string {
    const s = row.series;
    if (s.sample === 'f32') return s.pixelType.startsWith('Float') ? 'float' : `${s.pixelType} as float`;
    const bits = s.sample === 'u16' ? 16 : 8;
    return s.bitsPerPixel && s.bitsPerPixel < bits ? `${bits}-bit (${s.bitsPerPixel} used)` : `${bits}-bit`;
  }

  pixelSize(row: SeriesRow): string | null {
    const p = row.series.physicalSizeUm;
    if (!p?.x) return null;
    return `${p.x.toPrecision(3)} µm/px${p.z ? `, ${p.z.toPrecision(3)} µm/slice` : ''}`;
  }

  private finish(picks: MicroscopyImport[] | null): void {
    const resolve = this.resolve;
    this.resolve = null;
    this.visible.set(false);
    resolve?.(picks);
  }
}
