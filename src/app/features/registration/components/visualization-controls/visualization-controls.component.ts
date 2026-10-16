import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { SliderModule } from 'primeng/slider';

import {
  RegistrationStateService,
  VisualizationMode,
} from '../../registration-state.service';

const MODE_OPTIONS: { label: string; value: VisualizationMode; icon: string }[] = [
  { label: 'Side by side', value: 'side-by-side', icon: 'pi pi-table' },
  { label: 'Overlay', value: 'overlay', icon: 'pi pi-clone' },
  { label: 'Checkerboard', value: 'checkerboard', icon: 'pi pi-th-large' },
];

/**
 * The visualization mode buttons and the active mode's slider, shared by the
 * registration toolbar and the composite pop-out. Content is projected after
 * the mode buttons.
 */
@Component({
  selector: 'app-visualization-controls',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DecimalPipe, FormsModule, ButtonModule, SliderModule],
  templateUrl: './visualization-controls.component.html',
  styleUrl: './visualization-controls.component.scss',
})
export class VisualizationControlsComponent {
  private readonly state = inject(RegistrationStateService);

  /** The modes offered, in display order. */
  readonly modes = input<VisualizationMode[]>(MODE_OPTIONS.map((o) => o.value));

  readonly options = computed(() =>
    MODE_OPTIONS.filter((o) => this.modes().includes(o.value)),
  );
  readonly mode = this.state.mode;
  readonly vis = this.state.vis;

  setMode(mode: VisualizationMode): void {
    this.state.setMode(mode);
  }

  setOverlayOpacity(v: number): void {
    this.state.setOverlayOpacity(v);
  }

  setCheckerTileSize(v: number): void {
    this.state.setCheckerTileSize(v);
  }
}
