import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { computed, signal } from '@angular/core';

import { ChannelsService } from './channels.service';
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

function previewBuffer(): ArrayBuffer {
  // 2x2, two channels.
  const out = new ArrayBuffer(16 + 2 * 2 * 2 * 4);
  const head = new DataView(out);
  head.setUint32(0, 2, true);
  head.setUint32(4, 2, true);
  head.setUint32(8, 2, true);
  new Float32Array(out, 16).set([0, 1000, 2000, 3000, 10, 200, 400, 800]);
  return out;
}

describe('ChannelsService', () => {
  const frame = signal<{ id: number } | null>({ id: 7 });
  const info = signal<PixelInfo | null>(INFO);
  const orchestrator = {
    replaceImage: jasmine.createSpy('replaceImage').and.resolveTo(),
    requestRedraw: jasmine.createSpy('requestRedraw'),
    setPreview: jasmine.createSpy('setPreview'),
  };
  const tiles = { refresh: jasmine.createSpy('refresh') };
  let service: ChannelsService;

  beforeEach(() => {
    frame.set({ id: 7 });
    info.set(INFO);
    orchestrator.replaceImage.calls.reset();
    orchestrator.setPreview.calls.reset();
    localStorage.removeItem('didascalie_channels_axis');
    tiles.refresh.calls.reset();
    spyOn(api, 'getDisplaySettings').and.resolveTo(structuredClone(SETTINGS));
    spyOn(api, 'frameHistogram').and.resolveTo([1, 2, 3]);
    spyOn(api, 'setDisplaySettings').and.resolveTo();
    spyOn(api, 'previewSamples').and.resolveTo(previewBuffer());
    spyOn(api, 'autoDisplaySettings').and.callFake(async (_f: number, low?: number, high?: number) => ({
      channels: SETTINGS.channels.map((c) => ({ ...c, min: (low ?? 0) * 1000, max: (high ?? 1) * 1000 })),
    }));
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
    // Over the frame's data (0–4000), not the 12-bit range.
    expect(api.frameHistogram).toHaveBeenCalledWith(7, 0, 256, 0, 4000, false);
    expect(service.ranges()[1]).toEqual({ min: 10, max: 900, step: 1 });
  }));

  it('lays the axes out again over the full range, or on a log scale', fakeAsync(() => {
    settle();
    service.setFullRange(true);
    flushMicrotasks();
    expect(service.ranges()[0]).toEqual({ min: 0, max: 4095, step: 1 });
    service.setLogScale(true);
    flushMicrotasks();
    expect(api.frameHistogram).toHaveBeenCalledWith(7, 0, 256, 0, 4095, true);
  }));

  it('clips a little more at each press of Auto, then starts again', fakeAsync(() => {
    settle();
    const clips: number[] = [];
    for (let press = 0; press < 7; press++) {
      void service.auto(0);
      flushMicrotasks();
      clips.push((api.autoDisplaySettings as jasmine.Spy).calls.mostRecent().args[1]);
    }
    expect(clips.map((c) => +(c * 100).toFixed(2))).toEqual([0.5, 1, 2, 4, 8, 0.1, 0.5]);
    expect(service.settings()!.channels[0].min).toBe(5);
    // Only channel 0 moved.
    expect(service.settings()!.channels[1]).toEqual(SETTINGS.channels[1]);
    // A window set by hand: Auto starts over.
    service.setWindow(0, 1, 2);
    void service.auto(0);
    flushMicrotasks();
    expect((api.autoDisplaySettings as jasmine.Spy).calls.mostRecent().args[1]).toBeCloseTo(0.005);
    tick(150);
    flushMicrotasks();
  }));

  it('clips every channel at the percentiles typed', fakeAsync(() => {
    settle();
    void service.clip(1, 99);
    flushMicrotasks();
    expect(api.autoDisplaySettings).toHaveBeenCalledWith(7, 0.01, 0.99);
    expect(service.settings()!.channels.map((c) => [c.min, c.max])).toEqual([
      [10, 990],
      [10, 990],
    ]);
    tick(150);
    flushMicrotasks();
  }));

  it('previews a change at once and drops the preview when the render lands', fakeAsync(() => {
    settle();
    service.setWindow(0, 200, 2500);
    flushMicrotasks(); // the preview samples arrive
    tick(16); // the next animation frame
    expect(orchestrator.setPreview).toHaveBeenCalledWith(jasmine.any(HTMLCanvasElement));
    tick(150);
    flushMicrotasks();
    expect(orchestrator.setPreview).toHaveBeenCalledWith(null);
    expect(orchestrator.setPreview.calls.mostRecent().args[0]).toBeNull();
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
