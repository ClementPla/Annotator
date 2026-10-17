import { TestBed } from '@angular/core/testing';

import { FormatTogglesComponent } from './format-toggles.component';
import { ALL_EXTENSIONS, FILE_FORMAT_GROUPS, FILE_FORMATS, FileFormatGroup } from '../../../lib/file-formats';

describe('FormatTogglesComponent', () => {
  function create(extensions: string[]) {
    const fixture = TestBed.createComponent(FormatTogglesComponent);
    fixture.componentRef.setInput('extensions', extensions);
    fixture.detectChanges();
    return fixture.componentInstance as unknown as {
      selected: () => string[];
      select: (group: FileFormatGroup, labels: string[] | null) => void;
      extensions: () => string[];
    };
  }

  const [images, videos] = FILE_FORMAT_GROUPS;

  it('shows every format on by default', () => {
    expect(create(ALL_EXTENSIONS).selected()).toEqual(FILE_FORMATS.map((f) => f.label));
  });

  it('shows a format on only when all of its extensions are', () => {
    expect(create(['png', 'jpg', 'TIF', 'tiff', 'czi']).selected()).toEqual([
      'PNG',
      'TIFF / OME-TIFF',
      'Zeiss CZI',
    ]);
  });

  it('changes one group and keeps the others', () => {
    const toggles = create(['png', 'mp4', 'm4v', 'mov']);
    toggles.select(images, ['JPEG']);
    expect(toggles.extensions()).toEqual(['jpg', 'jpeg', 'mp4', 'm4v', 'mov']);
    toggles.select(videos, null);
    expect(toggles.extensions()).toEqual(['jpg', 'jpeg']);
  });
});
