import { Injectable, NgZone, OnDestroy, inject } from '@angular/core';
import { Subject } from 'rxjs';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { DownloadProgress } from './interface';

/** Tauri events, re-emitted as observables inside NgZone. */
@Injectable({
  providedIn: 'root'
})
export class TauriEventService implements OnDestroy {
  private ngZone = inject(NgZone);
  private initialized = false;
  private unlistenFunctions: UnlistenFn[] = [];

  private downloadProgressSubject = new Subject<DownloadProgress>();
  private segmentationStartedSubject = new Subject<void>();
  private segmentationCompletedSubject = new Subject<void>();

  public downloadProgress$ = this.downloadProgressSubject.asObservable();
  public segmentationStarted$ = this.segmentationStartedSubject.asObservable();
  public segmentationCompleted$ = this.segmentationCompletedSubject.asObservable();

  public async initialize(): Promise<void> {
    if (this.initialized) {
      console.warn('TauriEventService already initialized');
      return;
    }

    try {
      await this.registerListener<DownloadProgress>(
        'download-progress',
        (progress) => {
          this.downloadProgressSubject.next(progress);
        }
      );

      await this.registerListener<void>(
        'mask-segmentation-started',
        () => {
          this.segmentationStartedSubject.next();
        }
      );

      await this.registerListener<void>(
        'mask-segmentation-completed',
        () => {
          this.segmentationCompletedSubject.next();
        }
      );

      this.initialized = true;
      console.log('TauriEventService initialized successfully');
    } catch (error) {
      console.error('Failed to initialize Tauri event listeners:', error);
      throw error;
    }
  }

  /** Register a listener whose handler runs in NgZone. */
  private async registerListener<T>(
    eventName: string,
    handler: (payload: T) => void | Promise<void>
  ): Promise<void> {
    const unlisten = await listen<T>(eventName, async (event) => {
      await this.ngZone.run(async () => {
        await handler(event.payload);
      });
    });
    this.unlistenFunctions.push(unlisten);
  }

  ngOnDestroy(): void {
    this.downloadProgressSubject.complete();
    this.segmentationStartedSubject.complete();
    this.segmentationCompletedSubject.complete();
    this.unlistenFunctions.forEach((unlisten) => unlisten());
    this.unlistenFunctions = [];
  }
}
