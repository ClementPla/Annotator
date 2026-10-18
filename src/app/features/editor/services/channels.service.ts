import { Injectable, effect, inject, signal, untracked } from '@angular/core';

import { ChannelDisplay, DisplaySettings, PixelInfo, api } from '../../../lib/api';
import { SequenceService } from '../../../services/sequence.service';
import { OrchestratorService } from '../drawable-canvas/service/orchestrator.service';
import { TiledImageService } from '../drawable-canvas/service/tiled-image.service';
import { ZoomPanService } from '../drawable-canvas/service/zoom-pan.service';
import {
  AUTO_LEVELS,
  PreviewSamples,
  WindowRange,
  parsePreview,
  renderPreview,
  viewRange,
} from './channel-display';

export type { WindowRange } from './channel-display';

/** Wait after the last change before saving and rendering again. */
const RENDER_DEBOUNCE_MS = 150;
/** Bars of a channel's histogram in the panel. */
export const HISTOGRAM_BINS = 256;
/** Longest side of the copy of the frame a drag is previewed on. */
const PREVIEW_MAX_DIM = 1024;
/** Where the panel's axis choices are remembered. */
const PREFS_KEY = 'didascalie_channels_axis';

interface AxisPrefs {
  full: boolean;
  log: boolean;
}

/**
 * The display of the open frame when it is a render of raw pixels (deeper than
 * 8 bits, or several channels): a window, colour and gamma per channel, stored
 * per sequence. Each change is previewed at once from a small copy of the
 * frame's values, then shown after a short pause by a new render from Rust
 * that replaces the backdrop; masks, history and the view stay. Ordinary 8-bit
 * images keep the image adjustments and have no settings here.
 */
@Injectable({ providedIn: 'root' })
export class ChannelsService {
  private readonly sequences = inject(SequenceService);
  private readonly orchestrator = inject(OrchestratorService);
  private readonly tiles = inject(TiledImageService);
  private readonly zoomPan = inject(ZoomPanService);

  /** What the open frame's pixels are; null for an ordinary 8-bit image. */
  readonly info = this.sequences.currentPixelInfo;

  private readonly _settings = signal<DisplaySettings | null>(null);
  readonly settings = this._settings.asReadonly();

  /** The range each channel's histogram and window are drawn over. */
  private readonly _ranges = signal<WindowRange[]>([]);
  readonly ranges = this._ranges.asReadonly();

  /** Each channel's counts over its range, for the panel. */
  private readonly _histograms = signal<number[][]>([]);
  readonly histograms = this._histograms.asReadonly();

  /** Axes over everything the type holds rather than the frame's data. */
  readonly fullRange = signal(readPrefs().full);
  /** Log axes, finer at the low end. */
  readonly logScale = signal(readPrefs().log);

  /** Per channel, the Auto level (an index into `AUTO_LEVELS`) last applied;
   *  -1 when the window was set otherwise. */
  private readonly _autoLevels = signal<number[]>([]);
  readonly autoLevels = this._autoLevels.asReadonly();
  /** The same, for "Auto all". */
  private readonly _autoAllLevel = signal(-1);
  readonly autoAllLevel = this._autoAllLevel.asReadonly();

  /** Raw values of every channel under the cursor, with its position. */
  private readonly _cursor = signal<{ x: number; y: number; values: number[] } | null>(null);
  readonly cursor = this._cursor.asReadonly();

  /** Bumped by every change and frame switch; a render from an older one is
   *  dropped. */
  private generation = 0;
  private renderTimer: ReturnType<typeof setTimeout> | null = null;
  private cursorBusy = false;
  private cursorPending = false;

  /** The open frame's values for previews, loaded on the first change. */
  private preview: { frameId: number; samples: PreviewSamples } | null = null;
  private previewLoading: number | null = null;
  private previewQueued = false;
  private previewCanvas: HTMLCanvasElement | null = null;

  constructor() {
    // A new frame: its settings and histograms.
    effect(() => {
      const frame = this.sequences.currentFrame();
      const info = this.info();
      untracked(() => void this.loadFor(frame?.id ?? null, info));
    });

    // The raw values under the cursor, one request at a time.
    effect(() => {
      const at = this.zoomPan.cursorImage();
      untracked(() => {
        if (!at || !this.info()) {
          this._cursor.set(null);
          return;
        }
        this.requestCursorValues();
      });
    });
  }

  private async loadFor(frameId: number | null, info: PixelInfo | null): Promise<void> {
    const generation = ++this.generation;
    this.cancelRender();
    this.endPreview();
    this.preview = null;
    this._cursor.set(null);
    this._autoAllLevel.set(-1);
    if (frameId == null || !info) {
      this._settings.set(null);
      this._ranges.set([]);
      this._histograms.set([]);
      return;
    }
    try {
      const settings = await api.getDisplaySettings(frameId);
      if (generation !== this.generation) return;
      this._settings.set(settings);
      this._autoLevels.set(settings.channels.map(() => -1));
      await this.reloadAxes();
    } catch (error) {
      console.error('[Channels] could not load the display settings:', error);
    }
  }

  /** Lay the axes out again around the current windows, and their histograms. */
  private async reloadAxes(): Promise<void> {
    const frameId = this.sequences.currentFrame()?.id;
    const info = this.info();
    const settings = this._settings();
    if (frameId == null || !info || !settings) return;
    const ranges = info.ranges.map((_, c) => viewRange(info, c, settings.channels[c], this.fullRange()));
    this._ranges.set(ranges);
    const log = this.logScale();
    const histograms = await Promise.all(
      ranges.map((r, c) => api.frameHistogram(frameId, c, HISTOGRAM_BINS, r.min, r.max, log)),
    );
    if (this.sequences.currentFrame()?.id === frameId && this.logScale() === log) {
      this._histograms.set(histograms);
    }
  }

  setFullRange(full: boolean): void {
    this.fullRange.set(full);
    writePrefs({ full, log: this.logScale() });
    void this.reloadAxes();
  }

  setLogScale(log: boolean): void {
    this.logScale.set(log);
    writePrefs({ full: this.fullRange(), log });
    void this.reloadAxes();
  }

  // ── Editing ────────────────────────────────────────────────────────────────

  update(channel: number, patch: Partial<ChannelDisplay>): void {
    const current = this._settings();
    if (!current?.channels[channel]) return;
    const channels = current.channels.map((c, i) => (i === channel ? { ...c, ...patch } : c));
    this._settings.set({ channels });
    this.changed();
  }

  /** Set a channel's window by hand: the next Auto starts from its first level. */
  setWindow(channel: number, min: number, max: number): void {
    if (!Number.isFinite(min) || !Number.isFinite(max)) return;
    this._autoLevels.update((levels) => levels.map((l, i) => (i === channel ? -1 : l)));
    this._autoAllLevel.set(-1);
    this.update(channel, { min: Math.min(min, max), max: Math.max(min, max) });
  }

  /**
   * The automatic window for one channel, or every one. Each press clips a
   * little more of both ends (`AUTO_LEVELS`), as ImageJ's Auto does.
   */
  async auto(channel?: number): Promise<void> {
    const previous = channel === undefined ? this._autoAllLevel() : (this._autoLevels()[channel] ?? -1);
    const level = (previous + 1) % AUTO_LEVELS.length;
    const clip = AUTO_LEVELS[level] / 100;
    if (!(await this.applyPercentiles(clip, 1 - clip, channel))) return;
    if (channel === undefined) {
      this._autoAllLevel.set(level);
      this._autoLevels.update((levels) => levels.map(() => level));
    } else {
      this._autoAllLevel.set(-1);
      this._autoLevels.update((levels) => levels.map((l, i) => (i === channel ? level : l)));
    }
  }

  /** Every channel's window from its `lowPercent` to its `highPercent`
   *  percentile (0–100). */
  async clip(lowPercent: number, highPercent: number): Promise<void> {
    if (!Number.isFinite(lowPercent) || !Number.isFinite(highPercent)) return;
    const low = Math.min(100, Math.max(0, lowPercent)) / 100;
    const high = Math.min(100, Math.max(0, highPercent)) / 100;
    if (!(await this.applyPercentiles(low, high))) return;
    this._autoAllLevel.set(-1);
    this._autoLevels.update((levels) => levels.map(() => -1));
  }

  private async applyPercentiles(low: number, high: number, channel?: number): Promise<boolean> {
    const frameId = this.sequences.currentFrame()?.id;
    if (frameId == null || !this._settings()) return false;
    const auto = await api.autoDisplaySettings(frameId, low, high);
    const current = this._settings();
    if (this.sequences.currentFrame()?.id !== frameId || !current) return false;
    const channels = current.channels.map((c, i) =>
      channel === undefined || i === channel
        ? { ...c, min: auto.channels[i]?.min ?? c.min, max: auto.channels[i]?.max ?? c.max }
        : c,
    );
    this._settings.set({ channels });
    this.changed();
    return true;
  }

  /** Forget the sequence's settings: back to the automatic display. */
  async resetToAutomatic(): Promise<void> {
    const sequenceId = this.sequences.currentSequence()?.id;
    const frameId = this.sequences.currentFrame()?.id;
    if (sequenceId == null || frameId == null) return;
    this.cancelRender();
    await api.setDisplaySettings(sequenceId, null);
    const settings = await api.getDisplaySettings(frameId);
    if (this.sequences.currentFrame()?.id !== frameId) return;
    this._settings.set(settings);
    this._autoLevels.set(settings.channels.map(() => -1));
    this._autoAllLevel.set(-1);
    await this.render(++this.generation, frameId);
    await this.reloadAxes();
  }

  /** A change to show: a preview now, the real render after a pause. */
  private changed(): void {
    this.queuePreview();
    this.scheduleRender();
  }

  // ── Previewing ─────────────────────────────────────────────────────────────

  /** Draw the current settings over the preview copy at the next frame. */
  private queuePreview(): void {
    const frameId = this.sequences.currentFrame()?.id;
    if (frameId == null) return;
    if (this.preview?.frameId !== frameId) {
      void this.loadPreview(frameId);
      return;
    }
    if (this.previewQueued) return;
    this.previewQueued = true;
    requestAnimationFrame(() => {
      this.previewQueued = false;
      this.drawPreview();
    });
  }

  private async loadPreview(frameId: number): Promise<void> {
    if (this.previewLoading === frameId) return;
    this.previewLoading = frameId;
    try {
      const samples = parsePreview(await api.previewSamples(frameId, PREVIEW_MAX_DIM));
      if (this.sequences.currentFrame()?.id !== frameId) return;
      this.preview = { frameId, samples };
      // Only while a render is still to come: otherwise it already shows this.
      if (this.renderTimer) this.queuePreview();
    } catch (error) {
      console.error('[Channels] could not load the preview:', error);
    } finally {
      if (this.previewLoading === frameId) this.previewLoading = null;
    }
  }

  private drawPreview(): void {
    const settings = this._settings();
    const preview = this.preview;
    if (!settings || !preview || preview.frameId !== this.sequences.currentFrame()?.id) return;
    const image = renderPreview(preview.samples, settings.channels);
    const canvas = (this.previewCanvas ??= document.createElement('canvas'));
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext('2d')!.putImageData(image, 0, 0);
    this.orchestrator.setPreview(canvas);
    this.orchestrator.requestRedraw();
  }

  private endPreview(): void {
    this.orchestrator.setPreview(null);
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  private scheduleRender(): void {
    this.cancelRender();
    const generation = ++this.generation;
    this.renderTimer = setTimeout(() => {
      this.renderTimer = null;
      void this.saveAndRender(generation);
    }, RENDER_DEBOUNCE_MS);
  }

  private cancelRender(): void {
    if (this.renderTimer) {
      clearTimeout(this.renderTimer);
      this.renderTimer = null;
    }
  }

  private async saveAndRender(generation: number): Promise<void> {
    const sequenceId = this.sequences.currentSequence()?.id;
    const frameId = this.sequences.currentFrame()?.id;
    const settings = this._settings();
    if (sequenceId == null || frameId == null || !settings) return;
    try {
      await api.setDisplaySettings(sequenceId, settings);
      await this.render(generation, frameId);
      // A window typed past its axis: widen the axis to show it.
      const ranges = this._ranges();
      if (settings.channels.some((c, i) => ranges[i] && (c.min < ranges[i].min || c.max > ranges[i].max))) {
        await this.reloadAxes();
      }
    } catch (error) {
      console.error('[Channels] could not apply the display settings:', error);
      if (generation === this.generation) this.endPreview();
    }
  }

  private async render(generation: number, frameId: number): Promise<void> {
    const image = await api.renderFrameImage(frameId, SequenceService.DISPLAY_MAX_DIM);
    if (generation !== this.generation || this.sequences.currentFrame()?.id !== frameId) return;
    await this.orchestrator.replaceImage(image.imageBase64);
    this.endPreview();
    this.tiles.refresh();
    this.orchestrator.requestRedraw();
  }

  // ── Cursor ─────────────────────────────────────────────────────────────────

  private requestCursorValues(): void {
    if (this.cursorBusy) {
      this.cursorPending = true;
      return;
    }
    const at = this.zoomPan.cursorImage();
    const frameId = this.sequences.currentFrame()?.id;
    if (!at || frameId == null) return;
    const x = Math.floor(at.x);
    const y = Math.floor(at.y);
    this.cursorBusy = true;
    api
      .pixelValues(frameId, x, y)
      .then((values) => {
        if (this.sequences.currentFrame()?.id === frameId && this.zoomPan.cursorImage()) {
          this._cursor.set(values.length ? { x, y, values } : null);
        }
      })
      .catch(() => this._cursor.set(null))
      .finally(() => {
        this.cursorBusy = false;
        if (this.cursorPending) {
          this.cursorPending = false;
          this.requestCursorValues();
        }
      });
  }
}

function readPrefs(): AxisPrefs {
  try {
    const stored = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
    return { full: stored.full === true, log: stored.log === true };
  } catch {
    return { full: false, log: false };
  }
}

function writePrefs(prefs: AxisPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Private mode: the choice lasts the session.
  }
}
