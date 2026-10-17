import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';

import { ChannelDisplay, DisplaySettings, PixelInfo, api } from '../../../lib/api';
import { SequenceService } from '../../../services/sequence.service';
import { OrchestratorService } from '../drawable-canvas/service/orchestrator.service';
import { TiledImageService } from '../drawable-canvas/service/tiled-image.service';
import { ZoomPanService } from '../drawable-canvas/service/zoom-pan.service';

/** Wait after the last change before saving and rendering again. */
const RENDER_DEBOUNCE_MS = 150;
/** Bars of a channel's histogram in the panel. */
export const HISTOGRAM_BINS = 96;

/** The value range a channel's window can be set in. */
export interface WindowRange {
  min: number;
  max: number;
  step: number;
}

/**
 * The display of the open frame when it is a render of raw pixels (deeper than
 * 8 bits, or several channels): a window, colour and gamma per channel, stored
 * per sequence. Every change is shown after a short pause, by a new render
 * from Rust that replaces the backdrop; masks, history and the view stay.
 * Ordinary 8-bit images keep the image adjustments and have no settings here.
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

  /** Each channel's counts over its window range, for the panel. */
  private readonly _histograms = signal<number[][]>([]);
  readonly histograms = this._histograms.asReadonly();

  /** Raw values of every channel under the cursor, with its position. */
  private readonly _cursor = signal<{ x: number; y: number; values: number[] } | null>(null);
  readonly cursor = this._cursor.asReadonly();

  readonly ranges = computed<WindowRange[]>(() => {
    const info = this.info();
    return info ? info.ranges.map((_, c) => windowRange(info, c)) : [];
  });

  /** Bumped by every change and frame switch; a render from an older one is
   *  dropped. */
  private generation = 0;
  private renderTimer: ReturnType<typeof setTimeout> | null = null;
  private cursorBusy = false;
  private cursorPending = false;

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
    this._cursor.set(null);
    if (frameId == null || !info) {
      this._settings.set(null);
      this._histograms.set([]);
      return;
    }
    try {
      const settings = await api.getDisplaySettings(frameId);
      if (generation !== this.generation) return;
      this._settings.set(settings);
      const ranges = info.ranges.map((_, c) => windowRange(info, c));
      const histograms = await Promise.all(
        ranges.map((r, c) => api.frameHistogram(frameId, c, HISTOGRAM_BINS, r.min, r.max)),
      );
      if (generation === this.generation) this._histograms.set(histograms);
    } catch (error) {
      console.error('[Channels] could not load the display settings:', error);
    }
  }

  // ── Editing ────────────────────────────────────────────────────────────────

  update(channel: number, patch: Partial<ChannelDisplay>): void {
    const current = this._settings();
    if (!current?.channels[channel]) return;
    const channels = current.channels.map((c, i) => (i === channel ? { ...c, ...patch } : c));
    this._settings.set({ channels });
    this.scheduleRender();
  }

  setWindow(channel: number, min: number, max: number): void {
    if (!Number.isFinite(min) || !Number.isFinite(max)) return;
    this.update(channel, { min: Math.min(min, max), max: Math.max(min, max) });
  }

  /** The automatic window (0.5–99.5 %) for one channel, or every one. */
  async auto(channel?: number): Promise<void> {
    const frameId = this.sequences.currentFrame()?.id;
    const current = this._settings();
    if (frameId == null || !current) return;
    const auto = await api.autoDisplaySettings(frameId);
    if (this.sequences.currentFrame()?.id !== frameId) return;
    const channels = current.channels.map((c, i) =>
      channel === undefined || i === channel
        ? { ...c, min: auto.channels[i]?.min ?? c.min, max: auto.channels[i]?.max ?? c.max }
        : c,
    );
    this._settings.set({ channels });
    this.scheduleRender();
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
    await this.render(++this.generation, frameId);
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
    } catch (error) {
      console.error('[Channels] could not apply the display settings:', error);
    }
  }

  private async render(generation: number, frameId: number): Promise<void> {
    const image = await api.renderFrameImage(frameId, SequenceService.DISPLAY_MAX_DIM);
    if (generation !== this.generation || this.sequences.currentFrame()?.id !== frameId) return;
    await this.orchestrator.replaceImage(image.imageBase64);
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

/**
 * Where a channel's window can go: the whole 8-bit range, the range the
 * camera's bits allow for 16-bit data (0–4095 for 12 bits), or the data range
 * for floats.
 */
export function windowRange(info: PixelInfo, channel: number): WindowRange {
  const range = info.ranges[channel] ?? { min: 0, max: 1 };
  switch (info.sampleType) {
    case 'u8':
      return { min: 0, max: 255, step: 1 };
    case 'u16': {
      const bits = info.significantBits ?? 16;
      return { min: 0, max: Math.max(1, 2 ** bits - 1), step: 1 };
    }
    default: {
      const span = range.max - range.min || 1;
      return { min: range.min, max: range.min + span, step: span / 1000 };
    }
  }
}
