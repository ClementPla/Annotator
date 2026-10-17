import { ChangeDetectionStrategy, Component, computed, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SelectButtonModule } from 'primeng/selectbutton';

import { FILE_FORMAT_GROUPS, FILE_FORMATS, FileFormatGroup } from '../../../lib/file-formats';

/**
 * One toggle button per file format a folder scan can take, by group. Callers
 * bind `[(extensions)]` to the list of enabled extensions.
 */
@Component({
  selector: 'app-format-toggles',
  imports: [FormsModule, SelectButtonModule],
  template: `
    <div class="groups">
      @for (group of groups; track group.label) {
        <div class="group">
          <span class="group-label">{{ group.label }}</span>
          <p-selectbutton
            [options]="group.formats"
            [ngModel]="selected()"
            (ngModelChange)="select(group, $event)"
            [multiple]="true"
            optionLabel="label"
            optionValue="label"
            size="small"
            [ariaLabel]="group.label + ' formats'"
          ></p-selectbutton>
        </div>
      }
      <small class="note">
        Microscopy files are read through Bio-Formats, whose import is coming:
        for now a scan lists the ones it finds and leaves them out.
      </small>
    </div>
  `,
  styles: `
    .groups { display: flex; flex-direction: column; gap: 0.6rem; }
    .group { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; }
    .group-label {
      flex: 0 0 6.5rem;
      font-size: 0.85rem;
      color: var(--p-text-muted-color);
    }
    p-selectbutton { flex: 1 1 20rem; }
    .note { font-size: 0.8rem; color: var(--p-text-muted-color); }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FormatTogglesComponent {
  readonly extensions = model.required<string[]>();

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

  /** A group's buttons changed: its formats now on are `labels`, and the other
   *  groups keep theirs. */
  protected select(group: FileFormatGroup, labels: string[] | null): void {
    const own = new Set(group.formats.map((f) => f.label));
    const on = new Set([...this.selected().filter((l) => !own.has(l)), ...(labels ?? [])]);
    this.extensions.set(FILE_FORMATS.filter((f) => on.has(f.label)).flatMap((f) => f.extensions));
  }
}
