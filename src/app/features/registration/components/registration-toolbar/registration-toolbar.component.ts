import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import { IS_MOBILE } from '../../../../core/platform';

import { RegistrationStateService } from '../../registration-state.service';
import { VisualizationControlsComponent } from '../visualization-controls/visualization-controls.component';

@Component({
  selector: 'app-registration-toolbar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonModule, TooltipModule, VisualizationControlsComponent],
  templateUrl: './registration-toolbar.component.html',
  styleUrl: './registration-toolbar.component.scss',
})
export class RegistrationToolbarComponent {
  readonly isMobile = IS_MOBILE;
  readonly previousClicked = output<void>();
  readonly nextClicked = output<void>();
  readonly saveClicked = output<void>();
  readonly openCompositeClicked = output<void>();

  onPrevious(): void {
    this.previousClicked.emit();
  }
  onNext(): void {
    this.nextClicked.emit();
  }
  onSave(): void {
    this.saveClicked.emit();
  }
  onOpenComposite(): void {
    this.openCompositeClicked.emit();
  }
  readonly state = inject(RegistrationStateService);

  readonly mode = this.state.mode;
  readonly vis = this.state.vis;

  get syncPanZoom(): boolean {
    return this.vis().syncPanZoom;
  }
  set syncPanZoom(v: boolean) {
    this.state.setSyncPanZoom(v);
  }

  get showMovingWarped(): boolean {
    return this.vis().showMovingWarped;
  }
  set showMovingWarped(v: boolean) {
    this.state.setShowMovingWarped(v);
  }

  get showShadowCursor(): boolean {
    return this.vis().showShadowCursor;
  }
  set showShadowCursor(v: boolean) {
    this.state.setShowShadowCursor(v);
  }
}
