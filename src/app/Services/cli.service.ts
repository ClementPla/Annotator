import { Injectable, NgZone } from '@angular/core';
import { Subject } from 'rxjs';
import { ImageFromCLI, ProjectConfig } from '../Core/interface';
import { listen } from '@tauri-apps/api/event';

@Injectable({
  providedIn: 'root',
})
export class CLIService {
  public commandProcessed: Subject<boolean> = new Subject<boolean>();
  public projectCreated = new Subject<ProjectConfig | null>();
  public imageLoaded = new Subject<ImageFromCLI | null>();

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
