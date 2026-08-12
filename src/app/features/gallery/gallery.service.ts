import { Injectable, inject } from '@angular/core';
import { SequenceService } from '../../services/sequence.service';
import { ProjectScoped } from '../../core/project-scoped';

type SequenceStatus = 'empty' | 'annotated' | 'reviewed';

/** Keypoint presence filter: show all, only sequences with keypoints, or only those without. */
export type KeypointFilter = 'all' | 'with' | 'without';

@Injectable({
  providedIn: 'root',
})
export class GalleryService implements ProjectScoped {
  private sequenceService = inject(SequenceService);

  itemPerPage = 64;

  // Persisted filter / view state (survives gallery <-> editor navigation)
  filterTitle = '';
  selectedStatuses: SequenceStatus[] = [];
  keypointFilter: KeypointFilter = 'all';
  sortKey = 'name-asc';
  frameCountRange: number[] = [0, 0];
  frameRangeInitialized = false;
  showAdvancedFilters = false;
  imgSize = 256;

  // Grid (thumbnail cards) vs list (rows) layout.
  viewLayout: 'grid' | 'list' = 'grid';

  // Explicit page set by user pagination. null = fall back to active-frame.
  private explicitFirst: number | null = null;

  /**
   * @see ProjectScoped
   *
   * Filters and paging describe *this project's* sequences — a status filter or
   * a frame-count range carried into another project hides items for no visible
   * reason, which is the "gallery is wrong after switching" symptom.
   *
   * `imgSize`, `viewLayout`, `sortKey` and `itemPerPage` are deliberately left
   * alone. They are how the user likes the gallery to look, not facts about the
   * project, and resetting them would be its own small annoyance.
   */
  resetForProject(): void {
    this.filterTitle = '';
    this.selectedStatuses = [];
    this.keypointFilter = 'all';
    this.frameCountRange = [0, 0];
    this.frameRangeInitialized = false;
    this.showAdvancedFilters = false;
    this.explicitFirst = null;
  }

  setFirstPage(first: number): void {
    this.explicitFirst = first;
  }

  getFirstPage(): number {
    if (this.explicitFirst !== null) {
      return this.explicitFirst;
    }
    const activeIndex = this.sequenceService.currentFrameIndex();
    if (activeIndex > 0) {
      return Math.floor(activeIndex / this.itemPerPage) * this.itemPerPage;
    }
    return 0;
  }

  getTotalFrames(): number {
    return this.sequenceService.frameCount();
  }

  getCurrentPage(): number {
    return Math.floor(
      this.sequenceService.currentFrameIndex() / this.itemPerPage,
    );
  }

  getTotalPages(): number {
    return Math.ceil(this.getTotalFrames() / this.itemPerPage);
  }
}