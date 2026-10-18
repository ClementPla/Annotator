import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { InputTextModule } from 'primeng/inputtext';
import { SelectButtonModule } from 'primeng/selectbutton';
import { TooltipModule } from 'primeng/tooltip';

import { ChannelsService } from '../../services/channels.service';
import { AUTO_LEVELS } from '../../services/channel-display';
import { ChannelHistogramComponent } from './channel-histogram.component';

/**
 * Window, colour and gamma of each channel of a frame deeper than 8 bits, with
 * its histogram, and the raw values under the cursor.
 */
@Component({
  selector: 'app-channels-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DecimalPipe,
    FormsModule,
    ButtonModule,
    CheckboxModule,
    InputTextModule,
    SelectButtonModule,
    TooltipModule,
    ChannelHistogramComponent,
  ],
  templateUrl: './channels-panel.component.html',
  styleUrl: './channels-panel.component.scss',
})
export class ChannelsPanelComponent {
  readonly channels = inject(ChannelsService);

  readonly rangeOptions = [
    { label: 'Data', value: false },
    { label: 'Full', value: true },
  ];
  readonly scaleOptions = [
    { label: 'Linear', value: false },
    { label: 'Log', value: true },
  ];

  /** The percentiles typed for "Clip". */
  clipLow = 0.5;
  clipHigh = 99.5;

  readonly autoHint = `Each press clips more of both ends: ${AUTO_LEVELS.map((l) => `${l} %`).join(', ')}, then again`;

  colorOf(channel: number): string {
    return this.channels.settings()?.channels.at(channel)?.color ?? 'transparent';
  }

  label(channel: number): string {
    return this.channels.settings()?.channels[channel]?.name || `Channel ${channel + 1}`;
  }

  /** "Auto", or the clipping its last press applied. */
  autoLabel(level: number): string {
    return level < 0 ? 'Auto' : `Auto · ${AUTO_LEVELS[level]} %`;
  }

  autoAllLabel(level: number): string {
    return level < 0 ? 'Auto all' : `Auto all · ${AUTO_LEVELS[level]} %`;
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

  applyClip(): void {
    void this.channels.clip(Number(this.clipLow), Number(this.clipHigh));
  }

  /** Digits shown for raw values: none for integers. */
  readonly valueFormat = computed(() => (this.channels.info()?.sampleType === 'f32' ? '1.0-3' : '1.0-0'));

  /** The step of the Min and Max fields: a thousandth of the axis for floats. */
  step(channel: number): number {
    return this.channels.ranges()[channel]?.step ?? 1;
  }
}
