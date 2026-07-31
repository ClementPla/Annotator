import { Injectable, Injector, inject } from '@angular/core';

import { PROJECT_SCOPED, ProjectScoped } from '../../Core/project-scoped';

/**
 * Clears every [`ProjectScoped`] service when the open project changes.
 *
 * See `Core/project-scoped.ts` for what belongs here and why.
 */
@Injectable({ providedIn: 'root' })
export class ProjectLifecycleService {
  /**
   * Resolved on use rather than injected.
   *
   * `ProjectService` calls this service, and several project-scoped services
   * inject `ProjectService` back. Taking `PROJECT_SCOPED` as a constructor
   * dependency would build that cycle at construction time and fail. Resolving
   * it inside `resetAll` defers it to a point where everything already exists.
   */
  private readonly injector = inject(Injector);

  /**
   * Reset every registered service, in registration order.
   *
   * A throwing service is reported and skipped rather than aborting the loop:
   * stopping halfway is the worst outcome available, because it leaves the rest
   * of the app holding the previous project's data while looking as though the
   * switch succeeded.
   */
  resetAll(): void {
    const scoped = this.injector.get<readonly ProjectScoped[]>(
      PROJECT_SCOPED,
      [],
    );
    for (const service of scoped) {
      try {
        service.resetForProject();
      } catch (error) {
        console.error(
          `[project] ${service.constructor.name}.resetForProject() failed`,
          error,
        );
      }
    }
  }
}
