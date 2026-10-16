import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { TooltipModule } from 'primeng/tooltip';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { VisualizationControlsComponent } from '../../visualization-controls/visualization-controls.component';

@Component({
  selector: 'app-popout-toolbar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonModule, TooltipModule, VisualizationControlsComponent],
  templateUrl: './popout-toolbar.component.html',
  styleUrl: './popout-toolbar.component.scss',
})
export class PopoutToolbarComponent {
  readonly alwaysOnTop = signal(false);

  async toggleAlwaysOnTop(): Promise<void> {
    const next = !this.alwaysOnTop();
    await getCurrentWebviewWindow().setAlwaysOnTop(next);
    this.alwaysOnTop.set(next);
  }
}
