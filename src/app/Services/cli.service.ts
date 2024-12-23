import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { ImageFromCLI, ProjectConfig } from '../Core/interface';
import { listen } from '@tauri-apps/api/event';

@Injectable({
  providedIn: 'root',
})
export class CLIService {
  public commandProcessed: BehaviorSubject<boolean> =
    new BehaviorSubject<boolean>(false);
  public projectCreated = new BehaviorSubject<ProjectConfig | null>(null);
  public imageLoaded = new BehaviorSubject<ImageFromCLI | null>(null);

  constructor(private ngZone: NgZone) {
    this.initializeListeners();
  }
  private initializeListeners() {
    listen('create_project', async (event) => {
      this.ngZone.run(() => {
        const config = event.payload as ProjectConfig;
        this.projectCreated.next(config);
      });
    });

    listen('load_image', async (event) => {
      this.ngZone.run(() => {
        const imageConfig = event.payload as ImageFromCLI;
        this.imageLoaded.next(imageConfig);
      });
    });
  }
}
