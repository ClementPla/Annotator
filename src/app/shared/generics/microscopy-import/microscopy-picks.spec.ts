import type { MicroscopyInspection } from '../../../lib/generated/MicroscopyInspection';
import type { MicroscopySeries } from '../../../lib/generated/MicroscopySeries';
import {
  channelNames,
  channelState,
  common,
  fileRows,
  fileSummary,
  formatBytes,
  frameCount,
  imports,
  rawBytes,
  seriesPick,
  setChannelEverywhere,
  setMaxSideEverywhere,
  setZEverywhere,
  sourceChannels,
  stacks,
} from './microscopy-picks';

function series(over: Partial<MicroscopySeries> = {}): MicroscopySeries {
  return {
    index: 0,
    name: 'scene',
    width: 100,
    height: 50,
    sizeZ: 21,
    sizeC: 3,
    sizeT: 1,
    samplesPerPixel: 1,
    pixelType: 'Uint16',
    bitsPerPixel: 12,
    sample: 'u16',
    thumbnail: false,
    levels: [{ width: 100, height: 50 }],
    channels: [
      { source: 0, sample: 0, name: 'TagYFP', color: '#ffff00' },
      { source: 1, sample: 0, name: 'mRFP1.2', color: '#ff0500' },
      { source: 2, sample: 0, name: null, color: null },
    ],
    defaultPick: { index: 0, level: 0, z: 'all', t: 'all', c: 'all' },
    ...over,
  };
}

function inspection(...s: MicroscopySeries[]): MicroscopyInspection {
  return { path: 'C:\\data\\plate.czi', file: { protocol: 1, file: 'plate.czi', hasOmeMetadata: true, series: s } };
}

describe('microscopy picks', () => {
  it('starts from the default picks and gives them back unchanged', () => {
    const [file] = fileRows([inspection(series())]);
    expect(file.name).toBe('plate.czi');
    const row = file.rows[0];
    expect(row.include).toBeTrue();
    expect(frameCount(row)).toBe(21);
    expect(imports([file])).toEqual([
      { path: 'C:\\data\\plate.czi', series: [{ index: 0, level: 0, z: 'all', t: 'all', c: 'all' }] },
    ]);
  });

  it('leaves out series without a default pick, and a file with none kept', () => {
    const [file] = fileRows([inspection(series({ thumbnail: true, defaultPick: null }))]);
    expect(file.rows[0].include).toBeFalse();
    expect(imports([file])[0].series).toEqual([]);
  });

  it('turns choices into the export terms', () => {
    const [file] = fileRows([inspection(series({ sizeT: 10 }))]);
    const row = file.rows[0];
    row.z = 'max';
    row.t = 'step';
    row.tStep = 3;
    row.channels = [2, 0];
    expect(seriesPick(row)).toEqual({ index: 0, level: 0, z: 'max', t: 'step:3', c: '0,2' });
    expect(frameCount(row)).toBe(4);
    // 100 × 50 × 2 pages × 2 bytes × 4 frames.
    expect(rawBytes(row)).toBe(80_000);
    row.t = 'first';
    expect(seriesPick(row).t).toBe('0');
  });

  it('names channels, an RGB one once', () => {
    expect(sourceChannels(series()).map((c) => c.label)).toEqual(['TagYFP', 'mRFP1.2', 'Channel 3']);
    const rgb = series({
      samplesPerPixel: 3,
      sizeC: 1,
      channels: [0, 1, 2].map((k) => ({ source: 0, sample: k, name: null, color: null })),
    });
    expect(sourceChannels(rgb)).toEqual([{ source: 0, label: 'RGB', color: null }]);
  });

  it('formats sizes', () => {
    expect(formatBytes(950)).toBe('950 B');
    expect(formatBytes(1_234_000)).toBe('1.2 MB');
    expect(formatBytes(350_000_000)).toBe('350 MB');
  });

  describe('for every file at once', () => {
    function folder() {
      const dic = { source: 1, sample: 0, name: 'TL DIC', color: '#b3b3b3' };
      return fileRows([
        inspection(series()),
        { ...inspection(series({ sizeZ: 1, channels: [{ source: 0, sample: 0, name: 'DAPI', color: '#0000ff' }, dic] })), path: 'b.czi' },
        {
          ...inspection(
            series({
              levels: [
                { width: 40_000, height: 30_000 },
                { width: 10_000, height: 7_500 },
                { width: 2_500, height: 1_875 },
              ],
            }),
          ),
          path: 'c.czi',
        },
      ]);
    }

    it('sets slices on stacks only', () => {
      const files = folder();
      setZEverywhere(files, 'max');
      expect(stacks(files).length).toBe(2);
      expect(common(stacks(files), (r) => r.z)).toBe('max');
      expect(files[1].rows[0].z).toBe('all');
    });

    it('drops a channel by name wherever it is', () => {
      const files = folder();
      expect(channelNames(files).map((c) => c.label)).toEqual(['TagYFP', 'mRFP1.2', 'Channel 3', 'DAPI', 'TL DIC']);
      setChannelEverywhere(files, 'TL DIC', false);
      expect(files[1].rows[0].channels).toEqual([0]);
      expect(channelState(files, 'TL DIC')).toBe('off');
      expect(channelState(files, 'TagYFP')).toBe('on');
      files[0].rows[0].channels = [1, 2];
      expect(channelState(files, 'TagYFP')).toBe('mixed');
      // The last channel of a series stays.
      setChannelEverywhere(files, 'DAPI', false);
      expect(files[1].rows[0].channels).toEqual([0]);
    });

    it('picks the largest level that fits', () => {
      const files = folder();
      setMaxSideEverywhere(files, 4096);
      expect(files[2].rows[0].level).toBe(2);
      setMaxSideEverywhere(files, 1000);
      expect(files[2].rows[0].level).toBe(2);
      setMaxSideEverywhere(files, null);
      expect(files[2].rows[0].level).toBe(0);
    });

    it('summarises a file', () => {
      const files = folder();
      expect(fileSummary(files[0])).toBe('21 frames');
      expect(fileSummary(files[1])).toBe('1 frame');
    });
  });
});
