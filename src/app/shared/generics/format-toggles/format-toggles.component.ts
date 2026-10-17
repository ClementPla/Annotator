import { ChangeDetectionStrategy, Component, computed, model, signal } from '@angular/core';

import { FILE_FORMAT_GROUPS, FILE_FORMATS, FileFormatGroup } from '../../../lib/file-formats';

type GroupState = 'all' | 'some' | 'none';

/**
 * Which file formats a folder scan takes: one pill per group (images, videos,
 * microscopy) that turns the whole group on or off, and behind "More options"
 * a chip per format plus whatever the caller projects (filename pattern,
 * video frame step). Callers bind `[(extensions)]` to the enabled extensions.
 */
@Component({
  selector: 'app-format-toggles',
  template: `
    <div class="formats">
      <div class="row">
        <span class="row-label">Formats</span>
        @for (group of groups; track group.label) {
          @let state = groupState(group);
          <button
            type="button"
            class="pill"
            [class.all]="state === 'all'"
            [class.some]="state === 'some'"
            [attr.aria-pressed]="state === 'all' ? true : state === 'some' ? 'mixed' : false"
            (click)="toggleGroup(group)"
          >
            <i
              class="pi"
              [class.pi-check]="state === 'all'"
              [class.pi-minus]="state === 'some'"
              [class.pi-circle]="state === 'none'"
            ></i>
            {{ group.label }}
            @if (state === 'some') {
              <span class="count">{{ onCount(group) }} of {{ group.formats.length }}</span>
            }
          </button>
        }
        <button
          type="button"
          class="more"
          [attr.aria-expanded]="expanded()"
          (click)="expanded.set(!expanded())"
        >
          More options
          <i class="pi" [class.pi-chevron-down]="!expanded()" [class.pi-chevron-up]="expanded()"></i>
        </button>
      </div>

      @if (expanded()) {
        <div class="details">
          @for (group of groups; track group.label) {
            <div class="group">
              <span class="row-label">{{ group.label }}</span>
              <div class="chips" role="group" [attr.aria-label]="group.label + ' formats'">
                @for (format of group.formats; track format.label) {
                  @let on = isOn(format.label);
                  <button
                    type="button"
                    class="pill small"
                    [class.all]="on"
                    [attr.aria-pressed]="on"
                    (click)="toggleFormat(group, format.label)"
                  >
                    @if (on) {
                      <i class="pi pi-check"></i>
                    }
                    {{ format.label }}
                  </button>
                }
              </div>
            </div>
          }
          <small class="note">
            Microscopy files (and OME-TIFF) are converted through Bio-Formats at full bit depth; you
            choose their series, channels and slices before the import.
          </small>
          <div class="extra"><ng-content></ng-content></div>
        </div>
      }
    </div>
  `,
  styles: `
    .formats { display: flex; flex-direction: column; gap: 0.75rem; }
    .row { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
    .row-label {
      flex: 0 0 6.5rem;
      font-size: 0.85rem;
      color: var(--p-text-muted-color);
    }
    .pill {
      display: inline-flex; align-items: center; gap: 0.4rem;
      padding: 0.3rem 0.8rem; border-radius: 999px; font-size: 0.85rem;
      border: 1px solid var(--p-content-border-color);
      background: transparent; color: var(--p-text-muted-color); cursor: pointer;
    }
    .pill .pi { font-size: 0.7rem; }
    .pill.all, .pill.some {
      color: var(--p-text-color);
      border-color: var(--p-primary-color);
      background: var(--p-highlight-background);
    }
    .pill.some { border-style: dashed; }
    .count { font-size: 0.75rem; color: var(--p-text-muted-color); }
    .more {
      margin-left: auto;
      display: inline-flex; align-items: center; gap: 0.35rem;
      background: none; border: none; padding: 0.3rem 0.4rem;
      font-size: 0.85rem; color: var(--p-primary-color); cursor: pointer;
    }
    .more .pi { font-size: 0.7rem; }
    .pill:focus-visible, .more:focus-visible {
      outline: 2px solid var(--p-primary-color); outline-offset: 2px;
    }
    .details {
      display: flex; flex-direction: column; gap: 0.75rem;
      padding: 0.9rem 1rem; border-radius: 6px;
      border: 1px solid var(--p-content-border-color);
    }
    .group { display: flex; align-items: flex-start; gap: 0.75rem; }
    .group .row-label { padding-top: 0.25rem; }
    .chips { flex: 1 1 0; min-width: 0; display: flex; flex-wrap: wrap; gap: 0.4rem; }
    .pill.small { padding: 0.2rem 0.65rem; font-size: 0.8rem; }
    .extra { padding-top: 1rem; }
    @media (max-width: 40rem) {
      .group { flex-direction: column; gap: 0.35rem; }
    }
    .note { font-size: 0.8rem; color: var(--p-text-muted-color); }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormatTogglesComponent {
  readonly extensions = model.required<string[]>();

  protected readonly expanded = signal(false);

  protected readonly groups: FileFormatGroup[] = FILE_FORMAT_GROUPS.map((g) => ({
    ...g,
    formats: [...g.formats],
  }));

  /** Labels of the formats that are on: those whose extensions all are. */
  protected readonly selected = computed(() => {
    const enabled = new Set(this.extensions().map((e) => e.toLowerCase()));
    return FILE_FORMATS.filter((f) => f.extensions.every((e) => enabled.has(e))).map(
      (f) => f.label,
    );
  });

  protected onCount(group: FileFormatGroup): number {
    const on = new Set(this.selected());
    return group.formats.filter((f) => on.has(f.label)).length;
  }

  protected groupState(group: FileFormatGroup): GroupState {
    const n = this.onCount(group);
    return n === group.formats.length ? 'all' : n === 0 ? 'none' : 'some';
  }

  protected isOn(label: string): boolean {
    return this.selected().includes(label);
  }

  /** One format of `group` on or off; the rest stay as they are. */
  protected toggleFormat(group: FileFormatGroup, label: string): void {
    const on = this.selected().filter((l) => group.formats.some((f) => f.label === l));
    this.select(group, on.includes(label) ? on.filter((l) => l !== label) : [...on, label]);
  }

  /** A group all on goes off; otherwise all of it comes on. */
  protected toggleGroup(group: FileFormatGroup): void {
    const on = this.groupState(group) !== 'all';
    this.select(group, on ? group.formats.map((f) => f.label) : []);
  }

  /** A group's buttons changed: its formats now on are `labels`, and the other
   *  groups keep theirs. */
  protected select(group: FileFormatGroup, labels: string[] | null): void {
    const own = new Set(group.formats.map((f) => f.label));
    const on = new Set([...this.selected().filter((l) => !own.has(l)), ...(labels ?? [])]);
    this.extensions.set(FILE_FORMATS.filter((f) => on.has(f.label)).flatMap((f) => f.extensions));
  }
}
