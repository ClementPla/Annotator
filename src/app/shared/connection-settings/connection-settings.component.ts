import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { PopoverModule } from 'primeng/popover';
import { TooltipModule } from 'primeng/tooltip';

import { InferenceClientService } from '../../services/inference-client.service';

/** Where the user's Python functions server is. */
@Component({
  selector: 'app-connection-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    ButtonModule,
    InputNumberModule,
    InputTextModule,
    PopoverModule,
    TooltipModule,
  ],
  templateUrl: './connection-settings.component.html',
  styleUrl: './connection-settings.component.scss',
})
export class ConnectionSettingsComponent {
  readonly inference = inject(InferenceClientService);

  // Drafts, committed by the buttons.
  readonly host = signal('');
  readonly port = signal(0);

  readonly pythonStatus = computed(() => {
    const status = this.inference.status();
    switch (status.kind) {
      case 'connected': {
        const count = status.functions.length;
        return {
          tone: 'ok',
          text: `Connected: ${count} function${count === 1 ? '' : 's'} served`,
        };
      }
      case 'connecting':
        return { tone: 'muted', text: 'Looking for the server…' };
      case 'error':
        return {
          tone: 'warn',
          text: 'No server answers there yet. The address is saved, and the editor keeps looking for it.',
        };
      default:
        return { tone: 'muted', text: 'No server found' };
    }
  });

  onShow(): void {
    // Keeps the status line live while the popover is open.
    this.inference.startDiscovery();
    const { host, port } = this.inference.endpoint();
    this.host.set(host);
    this.port.set(port);
  }

  onHide(): void {
    this.inference.stopDiscovery();
  }

  async applyPython(): Promise<void> {
    try {
      await this.inference.connect(this.host().trim(), this.port());
    } catch {
      // The status line already says the server is not there.
    }
  }
}
