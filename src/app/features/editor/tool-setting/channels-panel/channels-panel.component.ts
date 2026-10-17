import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { InputTextModule } from 'primeng/inputtext';
import { SliderModule } from 'primeng/slider';
import { TooltipModule } from 'primeng/tooltip';

import { ChannelsService, HISTOGRAM_BINS } from '../../services/channels.service';

/** Height of a histogram strip, in SVG units (its width is the bin count). */
const HIST_HEIGHT = 28;

/**
 * Window, colour and gamma of each channel of a frame deeper than 8 bits, with
 * its histogram, and the raw values under the cursor.
 */
@Component({
  selector: 'app-channels-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, FormsModule, ButtonModule, CheckboxModule, InputTextModule, SliderModule, TooltipModule],
  templateUrl: './channels-panel.component.html',
  styleUrl: './channels-panel.component.scss',
})
export class ChannelsPanelComponent {
  readonly channels = inject(ChannelsService);

  readonly histWidth = HISTOGRAM_BINS;
  readonly histHeight = HIST_HEIGHT;

  /** One SVG path per channel: bars on a log scale, so faint signal shows. */
  readonly histogramPaths = computed(() =>
    this.channels.histograms().map((counts) => {
      const peak = Math.log1p(Math.max(1, ...counts));
      return counts
        .map((c, i) => {
          const h = (Math.log1p(c) / peak) * HIST_HEIGHT;
          return `M${i} ${HIST_HEIGHT}v${-h.toFixed(2)}h1v${h.toFixed(2)}z`;
        })
        .join('');
    }),
  );

  /** The histogram of a channel; empty until it has loaded. */
  histogramPath(channel: number): string {
    return this.histogramPaths().at(channel) ?? '';
  }

  colorOf(channel: number): string {
    return this.channels.settings()?.channels.at(channel)?.color ?? 'transparent';
  }

  /** Position (0–100 %) of the window edges over the histogram. */
  markerPercent(channel: number, value: number): number {
    const r = this.channels.ranges()[channel];
    if (!r || r.max === r.min) return 0;
    return Math.min(100, Math.max(0, ((value - r.min) / (r.max - r.min)) * 100));
  }

  label(channel: number): string {
    return this.channels.settings()?.channels[channel]?.name || `Channel ${channel + 1}`;
  }

  onWindow(channel: number, value: number[] | number | null | undefined): void {
    if (Array.isArray(value) && value.length === 2) {
      this.channels.setWindow(channel, value[0], value[1]);
    }
  }

  onMin(channel: number, value: number | string): void {
    const max = this.channels.settings()?.channels[channel]?.max;
    if (max !== undefined) this.channels.setWindow(channel, Number(value), max);
  }

  onMax(channel: number, value: number | string): void {
    const min = this.channels.settings()?.channels[channel]?.min;
    if (min !== undefined) this.channels.setWindow(channel, min, Number(value));
  }

  onGamma(channel: number, value: number | string): void {
    const gamma = Number(value);
    if (Number.isFinite(gamma) && gamma > 0) this.channels.update(channel, { gamma });
  }

  /** Digits shown for raw values: none for integers. */
  readonly valueFormat = computed(() => (this.channels.info()?.sampleType === 'f32' ? '1.0-3' : '1.0-0'));
}
