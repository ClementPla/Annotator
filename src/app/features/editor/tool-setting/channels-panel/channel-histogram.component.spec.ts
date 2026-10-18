import { TestBed } from '@angular/core/testing';

import { ChannelHistogramComponent } from './channel-histogram.component';

describe('ChannelHistogramComponent', () => {
  function create(min = 200, max = 600, log = false) {
    const fixture = TestBed.createComponent(ChannelHistogramComponent);
    fixture.componentRef.setInput('range', { min: 0, max: 1000, step: 1 });
    fixture.componentRef.setInput('min', min);
    fixture.componentRef.setInput('max', max);
    fixture.componentRef.setInput('log', log);
    fixture.componentRef.setInput('counts', [1, 5, 2, 0]);
    fixture.detectChanges();
    const emitted: { min: number; max: number }[] = [];
    fixture.componentInstance.windowChange.subscribe((w) => emitted.push(w));
    const el: HTMLElement = fixture.nativeElement;
    const track = el.querySelector<HTMLDivElement>('.track')!;
    track.style.width = '1000px';
    track.getBoundingClientRect = () => ({ left: 0, width: 1000 }) as DOMRect;
    const handles = el.querySelectorAll<HTMLElement>('.handle');
    return { fixture, emitted, track, low: handles[0], high: handles[1] };
  }

  function key(target: HTMLElement, k: string, shiftKey = false): void {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true }));
  }

  function pointer(target: HTMLElement, type: string, clientX: number, shiftKey = false): void {
    target.dispatchEvent(
      new PointerEvent(type, { clientX, shiftKey, pointerId: 1, button: 0, bubbles: true }),
    );
  }

  beforeEach(() => {
    spyOn(HTMLElement.prototype, 'setPointerCapture');
  });

  it('places the window over the axis', () => {
    const { low, high } = create();
    expect(low.style.left).toBe('20%');
    expect(high.style.left).toBe('60%');
  });

  it('steps a handle with the keys, ten times with Shift, 1 % with Page keys', () => {
    const { emitted, low, high } = create();
    key(low, 'ArrowRight');
    key(low, 'ArrowLeft', true);
    key(high, 'PageUp');
    key(high, 'Home'); // the upper edge goes down to just above the lower one
    expect(emitted).toEqual([
      { min: 201, max: 600 },
      { min: 190, max: 600 },
      { min: 200, max: 610 },
      { min: 200, max: 201 },
    ]);
  });

  it('drags a handle, ten times finer with Shift', () => {
    const { emitted, track } = create();
    pointer(track, 'pointerdown', 200); // on the lower handle
    pointer(track, 'pointermove', 300);
    expect(emitted.at(-1)).toEqual({ min: 300, max: 600 });
    pointer(track, 'pointermove', 300, true); // Shift: carry on from here
    pointer(track, 'pointermove', 400, true);
    expect(emitted.at(-1)).toEqual({ min: 210, max: 600 });
    pointer(track, 'pointerup', 400);
  });

  it('moves the whole window when dragged by its middle, within the axis', () => {
    const { emitted, track } = create();
    pointer(track, 'pointerdown', 400);
    pointer(track, 'pointermove', 1000);
    expect(emitted.at(-1)).toEqual({ min: 600, max: 1000 });
    pointer(track, 'pointerup', 1000);
  });

  it('brings the nearer edge to a press outside the window', () => {
    const { emitted, track } = create();
    pointer(track, 'pointerdown', 900);
    expect(emitted.at(-1)).toEqual({ min: 200, max: 900 });
    pointer(track, 'pointermove', 950);
    expect(emitted.at(-1)).toEqual({ min: 200, max: 950 });
  });

  it('narrows the window around its centre with the wheel', () => {
    const { emitted, track } = create();
    track.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));
    const w = emitted.at(-1)!;
    expect((w.min + w.max) / 2).toBeCloseTo(400, -1);
    expect(w.max - w.min).toBeLessThan(400);
  });

  it('maps positions on a log axis', () => {
    const { low } = create(10, 1000, true);
    // 10 of 1000 is far right of 1 % on a log axis.
    expect(parseFloat(low.style.left)).toBeGreaterThan(20);
  });
});
