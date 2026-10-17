import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { computed, signal } from '@angular/core';

import { ChannelsService, windowRange } from './channels.service';
import { DisplaySettings, PixelInfo, api } from '../../../lib/api';
import { SequenceService } from '../../../services/sequence.service';
import { OrchestratorService } from '../drawable-canvas/service/orchestrator.service';
import { TiledImageService } from '../drawable-canvas/service/tiled-image.service';
import { ZoomPanService } from '../drawable-canvas/service/zoom-pan.service';

const INFO: PixelInfo = {
  width: 4,
  height: 4,
  channels: 2,
  sampleType: 'u16',
  significantBits: 12,
  isRgb8: false,
  ranges: [
    { min: 0, max: 4000 },
    { min: 10, max: 900 },
  ],
};

const SETTINGS: DisplaySettings = {
  channels: [
    { name: null, visible: true, color: '#00ff00', min: 100, max: 3000, gamma: 1 },
    { name: null, visible: true, color: '#ff00ff', min: 20, max: 800, gamma: 1 },
  ],
};

describe('windowRange', () => {
  it('uses the bits a 16-bit camera records', () => {
    expect(windowRange(INFO, 0)).toEqual({ min: 0, max: 4095, step: 1 });
    expect(windowRange({ ...INFO, significantBits: null }, 0).max).toBe(65535);
  });

  it('spans the data range of a float channel', () => {
    const r = windowRange({ ...INFO, sampleType: 'f32', ranges: [{ min: -1, max: 1 }] }, 0);
    expect(r.min).toBe(-1);
    expect(r.max).toBe(1);
    expect(r.step).toBeCloseTo(0.002);
  });
});

describe('ChannelsService', () => {
  const frame = signal<{ id: number } | null>({ id: 7 });
  const info = signal<PixelInfo | null>(INFO);
  const orchestrator = {
    replaceImage: jasmine.createSpy('replaceImage').and.resolveTo(),
    requestRedraw: jasmine.createSpy('requestRedraw'),
  };
  const tiles = { refresh: jasmine.createSpy('refresh') };
  let service: ChannelsService;

  beforeEach(() => {
    frame.set({ id: 7 });
    info.set(INFO);
    orchestrator.replaceImage.calls.reset();
    tiles.refresh.calls.reset();
    spyOn(api, 'getDisplaySettings').and.resolveTo(structuredClone(SETTINGS));
    spyOn(api, 'frameHistogram').and.resolveTo([1, 2, 3]);
    spyOn(api, 'setDisplaySettings').and.resolveTo();
    spyOn(api, 'renderFrameImage').and.resolveTo({
      width: 4,
      height: 4,
      nativeWidth: 4,
      nativeHeight: 4,
      imageBase64: 'data:image/png;base64,AAAA',
    });

    TestBed.configureTestingModule({
      providers: [
        {
          provide: SequenceService,
          useValue: {
            currentFrame: computed(() => frame()),
            currentPixelInfo: computed(() => info()),
            currentSequence: () => ({ id: 3 }),
          },
        },
        { provide: OrchestratorService, useValue: orchestrator },
        { provide: TiledImageService, useValue: tiles },
        { provide: ZoomPanService, useValue: { cursorImage: signal(null) } },
      ],
    });
    service = TestBed.inject(ChannelsService);
  });

  function settle(): void {
    TestBed.flushEffects();
    flushMicrotasks();
  }

  it('loads the frame settings and one histogram per channel', fakeAsync(() => {
    settle();
    expect(service.settings()).toEqual(SETTINGS);
    expect(service.histograms().length).toBe(2);
    expect(api.frameHistogram).toHaveBeenCalledWith(7, 0, jasmine.any(Number), 0, 4095);
  }));

  it('renders once after a burst of changes, and keeps the masks', fakeAsync(() => {
    settle();
    service.setWindow(0, 200, 2500);
    tick(50);
    service.setWindow(0, 300, 2400);
    service.update(1, { visible: false });
    tick(149);
    expect(api.renderFrameImage).not.toHaveBeenCalled();
    tick(1);
    flushMicrotasks();

    expect(api.setDisplaySettings).toHaveBeenCalledTimes(1);
    const saved = (api.setDisplaySettings as jasmine.Spy).calls.mostRecent().args;
    expect(saved[0]).toBe(3);
    expect(saved[1].channels[0]).toEqual(jasmine.objectContaining({ min: 300, max: 2400 }));
    expect(saved[1].channels[1].visible).toBeFalse();
    expect(api.renderFrameImage).toHaveBeenCalledTimes(1);
    expect(orchestrator.replaceImage).toHaveBeenCalledWith('data:image/png;base64,AAAA');
    expect(tiles.refresh).toHaveBeenCalled();
  }));

  it('drops a render that comes back after the frame changed', fakeAsync(() => {
    settle();
    let finish!: (v: unknown) => void;
    (api.renderFrameImage as jasmine.Spy).and.returnValue(new Promise((r) => (finish = r)));
    service.setWindow(0, 1, 2);
    tick(150);
    flushMicrotasks();
    frame.set({ id: 8 });
    settle();
    finish({ width: 1, height: 1, nativeWidth: 1, nativeHeight: 1, imageBase64: 'stale' });
    flushMicrotasks();
    expect(orchestrator.replaceImage).not.toHaveBeenCalled();
  }));

  it('has no settings for an ordinary 8-bit image', fakeAsync(() => {
    info.set(null);
    settle();
    expect(service.settings()).toBeNull();
  }));
});
