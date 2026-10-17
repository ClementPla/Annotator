import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ProgressBarModule } from 'primeng/progressbar';

import type { ImportProgress } from '../../../lib/api';

const PHASES: Record<ImportProgress['phase'], string> = {
  images: 'Reading images',
  videos: 'Indexing videos',
  microscopy: 'Converting microscopy files',
};

/**
 * What a running import is doing: its phase, how many files of it are done,
 * and the last one. Before the first event, an indeterminate bar.
 */
@Component({
  selector: 'app-import-progress',
  imports: [ProgressBarModule],
  template: `
    @let p = progress();
    @if (p) {
      <div class="line">
        <span class="phase">{{ phase() }}</span>
        <span class="count">{{ p.done }} / {{ p.total }}</span>
      </div>
      <p-progressbar [value]="percent()" [showValue]="false" class="bar"></p-progressbar>
      @if (p.current) {
        <span class="current" [title]="p.current">{{ p.current }}</span>
      }
    } @else {
      <span class="phase">Looking for files…</span>
      <p-progressbar mode="indeterminate" class="bar"></p-progressbar>
    }
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 0.25rem; min-width: 0; }
    .line { display: flex; justify-content: space-between; gap: 0.75rem; }
    .phase { font-size: 0.85rem; }
    .count { font-size: 0.8rem; font-variant-numeric: tabular-nums; color: var(--p-text-muted-color); }
    .bar { height: 0.4rem; }
    .current {
      font-size: 0.75rem; color: var(--p-text-muted-color);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      direction: rtl; text-align: left;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImportProgressComponent {
  readonly progress = input<ImportProgress | null>(null);

  protected readonly phase = computed(() => {
    const p = this.progress();
    return p ? PHASES[p.phase] : '';
  });

  protected readonly percent = computed(() => {
    const p = this.progress();
    return p && p.total > 0 ? Math.round((100 * p.done) / p.total) : 0;
  });
}
