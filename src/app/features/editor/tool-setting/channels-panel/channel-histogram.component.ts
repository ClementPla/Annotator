import { ChangeDetectionStrategy, Component, ElementRef, computed, input, output, viewChild } from '@angular/core';

import { WindowRange, fromPosition, snap, toPosition } from '../../services/channel-display';

/** Height of the histogram, in SVG units (its width is the bin count). */
const HEIGHT = 40;
/** How much finer a drag is with Shift held. */
const FINE = 0.1;
/** How close to a handle (px) a press grabs it rather than the window. */
const GRAB_PX = 8;

type Grip = 'min' | 'max' | 'body';

/**
 * A channel's histogram with its display window on it: drag a handle to move
 * one edge, the window to move both, the wheel to widen or narrow it around
 * its centre; Shift makes all of it ten times finer. The handles take the
 * arrow keys (Shift: ten steps), Page Up/Down (1 % of the axis), Home and End.
 */
@Component({
  selector: 'app-channel-histogram',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      #track
      class="track"
      (pointerdown)="onPointerDown($event)"
      (pointermove)="onPointerMove($event)"
      (pointerup)="onPointerUp($event)"
      (pointercancel)="onPointerUp($event)"
      (wheel)="onWheel($event)"
    >
      <svg [attr.viewBox]="'0 0 ' + bins() + ' ' + height" preserveAspectRatio="none" aria-hidden="true">
        <path [attr.d]="path()" [attr.fill]="color()" />
      </svg>
      <span class="shade shade--low" [style.width.%]="lowPercent()"></span>
      <span class="shade shade--high" [style.width.%]="100 - highPercent()"></span>
      <span class="body" [style.left.%]="lowPercent()" [style.width.%]="highPercent() - lowPercent()"></span>
      <span
        class="handle"
        role="slider"
        tabindex="0"
        [style.left.%]="lowPercent()"
        [attr.aria-label]="'Lower edge of the window of ' + label()"
        [attr.aria-valuemin]="range().min"
        [attr.aria-valuemax]="max()"
        [attr.aria-valuenow]="min()"
        (keydown)="onKey($event, 'min')"
      ></span>
      <span
        class="handle"
        role="slider"
        tabindex="0"
        [style.left.%]="highPercent()"
        [attr.aria-label]="'Upper edge of the window of ' + label()"
        [attr.aria-valuemin]="min()"
        [attr.aria-valuemax]="range().max"
        [attr.aria-valuenow]="max()"
        (keydown)="onKey($event, 'max')"
      ></span>
    </div>
  `,
  styles: `
    :host { display: block; }
    .track {
      position: relative;
      height: 2.6rem;
      border-radius: 4px;
      overflow: hidden;
      background: var(--surface-ground, rgba(255, 255, 255, 0.04));
      cursor: crosshair;
      touch-action: none;
      user-select: none;
    }
    svg { display: block; width: 100%; height: 100%; opacity: 0.85; pointer-events: none; }
    .shade {
      position: absolute; top: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      pointer-events: none;
    }
    .shade--low { left: 0; }
    .shade--high { right: 0; }
    .body { position: absolute; top: 0; bottom: 0; cursor: grab; }
    .track.dragging .body { cursor: grabbing; }
    /* A thin line with a small tab at the top; both grow on hover or focus. */
    .handle {
      position: absolute; top: 0; bottom: 0;
      width: 12px; margin-left: -6px;
      cursor: ew-resize;
      outline: none;
    }
    .handle::before {
      content: ''; position: absolute; top: 0; bottom: 0; left: 50%;
      width: 1px; transform: translateX(-50%);
      background: var(--p-text-color, #fff);
      opacity: 0.8;
      transition: width 0.12s, opacity 0.12s;
    }
    .handle::after {
      content: ''; position: absolute; top: 0; left: 50%;
      width: 8px; height: 6px; transform: translateX(-50%);
      border-radius: 0 0 3px 3px;
      background: var(--p-text-color, #fff);
      opacity: 0.8;
      transition: width 0.12s, height 0.12s, opacity 0.12s;
    }
    .handle:hover::before, .handle:focus-visible::before, .track.dragging .handle::before {
      width: 2px; opacity: 1;
    }
    .handle:hover::after, .handle:focus-visible::after {
      width: 10px; height: 8px; opacity: 1;
    }
    .handle:focus-visible::after { box-shadow: 0 0 0 2px var(--p-primary-color, #3b82f6); }
    @media (prefers-reduced-motion: reduce) {
      .handle::before, .handle::after { transition: none; }
    }
  `,
})
export class ChannelHistogramComponent {
  readonly counts = input<number[]>([]);
  readonly color = input('#ffffff');
  readonly range = input.required<WindowRange>();
  readonly log = input(false);
  readonly min = input.required<number>();
  readonly max = input.required<number>();
  readonly label = input('the channel');

  /** A new window, as the user moves it. */
  readonly windowChange = output<{ min: number; max: number }>();

  private readonly track = viewChild.required<ElementRef<HTMLDivElement>>('track');

  readonly height = HEIGHT;
  readonly bins = computed(() => Math.max(1, this.counts().length));

  /** Bars on a log scale of counts, so faint signal shows. */
  readonly path = computed(() => {
    const counts = this.counts();
    const peak = Math.log1p(Math.max(1, ...counts));
    return counts
      .map((c, i) => {
        const h = (Math.log1p(c) / peak) * HEIGHT;
        return `M${i} ${HEIGHT}v${-h.toFixed(2)}h1v${h.toFixed(2)}z`;
      })
      .join('');
  });

  readonly lowPercent = computed(() => 100 * toPosition(this.min(), this.range(), this.log()));
  readonly highPercent = computed(() => 100 * toPosition(this.max(), this.range(), this.log()));

  // ── Dragging ───────────────────────────────────────────────────────────────

  private drag: {
    grip: Grip;
    pointerId: number;
    /** Where the pointer and the window's edges (0–1) were when the drag, or
     *  its last change of Shift, began. */
    x: number;
    low: number;
    high: number;
    fine: boolean;
  } | null = null;

  onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    const el = this.track().nativeElement;
    const rect = el.getBoundingClientRect();
    const px = event.clientX - rect.left;
    const lowPx = (this.lowPercent() / 100) * rect.width;
    const highPx = (this.highPercent() / 100) * rect.width;

    let grip: Grip;
    let low = toPosition(this.min(), this.range(), this.log());
    let high = toPosition(this.max(), this.range(), this.log());
    const nearLow = Math.abs(px - lowPx);
    const nearHigh = Math.abs(px - highPx);
    if (Math.min(nearLow, nearHigh) <= GRAB_PX) {
      grip = nearLow <= nearHigh ? 'min' : 'max';
      // Handles that touch: pull apart in the direction of the drag.
      if (nearLow === nearHigh) grip = px < lowPx ? 'min' : 'max';
    } else if (px > lowPx && px < highPx) {
      grip = 'body';
    } else {
      // Outside the window: bring the nearer edge here, then drag it.
      grip = px <= lowPx ? 'min' : 'max';
      const at = px / rect.width;
      if (grip === 'min') low = at;
      else high = at;
      this.moveEdge(grip, at);
    }
    event.preventDefault();
    el.setPointerCapture(event.pointerId);
    el.classList.add('dragging');
    (event.target as HTMLElement).closest<HTMLElement>('.handle')?.focus();
    this.drag = {
      grip,
      pointerId: event.pointerId,
      x: event.clientX,
      low,
      high,
      fine: event.shiftKey,
    };
  }

  onPointerMove(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (event.shiftKey !== drag.fine) {
      // Shift pressed or let go: carry on from here at the new speed.
      Object.assign(drag, {
        x: event.clientX,
        low: toPosition(this.min(), this.range(), this.log()),
        high: toPosition(this.max(), this.range(), this.log()),
        fine: event.shiftKey,
      });
    }
    const width = this.track().nativeElement.getBoundingClientRect().width || 1;
    const dt = ((event.clientX - drag.x) / width) * (drag.fine ? FINE : 1);
    if (drag.grip === 'body') {
      const shift = Math.min(1 - drag.high, Math.max(-drag.low, dt));
      this.emitPositions(drag.low + shift, drag.high + shift);
    } else {
      this.moveEdge(drag.grip, (drag.grip === 'min' ? drag.low : drag.high) + dt);
    }
  }

  onPointerUp(event: PointerEvent): void {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    this.track().nativeElement.classList.remove('dragging');
    this.drag = null;
  }

  /** The wheel widens (down) or narrows (up) the window around its centre. */
  onWheel(event: WheelEvent): void {
    if (event.deltaY === 0) return;
    event.preventDefault();
    const step = event.shiftKey ? 1.02 : 1.1;
    const factor = event.deltaY > 0 ? step : 1 / step;
    const low = toPosition(this.min(), this.range(), this.log());
    const high = toPosition(this.max(), this.range(), this.log());
    const centre = (low + high) / 2;
    const half = Math.min(0.5, Math.max(0.001, ((high - low) / 2) * factor));
    this.emitPositions(Math.max(0, centre - half), Math.min(1, centre + half));
  }

  // ── Keyboard ───────────────────────────────────────────────────────────────

  onKey(event: KeyboardEvent, edge: 'min' | 'max'): void {
    const range = this.range();
    const span = range.max - range.min;
    const step = range.step * (event.shiftKey ? 10 : 1);
    const value = edge === 'min' ? this.min() : this.max();
    let next: number;
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowDown':
        next = value - step;
        break;
      case 'ArrowRight':
      case 'ArrowUp':
        next = value + step;
        break;
      case 'PageDown':
        next = value - span / 100;
        break;
      case 'PageUp':
        next = value + span / 100;
        break;
      case 'Home':
        next = edge === 'min' ? range.min : this.min() + range.step;
        break;
      case 'End':
        next = edge === 'max' ? range.max : this.max() - range.step;
        break;
      default:
        return;
    }
    event.preventDefault();
    this.emitValue(edge, next);
  }

  // ── Emitting ───────────────────────────────────────────────────────────────

  private moveEdge(edge: 'min' | 'max', position: number): void {
    this.emitValue(edge, fromPosition(position, this.range(), this.log()));
  }

  /** One edge at `value`, kept a step inside the other. */
  private emitValue(edge: 'min' | 'max', value: number): void {
    const range = this.range();
    let v = snap(Math.min(range.max, Math.max(range.min, value)), range);
    if (edge === 'min') {
      v = Math.min(v, this.max() - range.step);
      this.windowChange.emit({ min: v, max: this.max() });
    } else {
      v = Math.max(v, this.min() + range.step);
      this.windowChange.emit({ min: this.min(), max: v });
    }
  }

  private emitPositions(low: number, high: number): void {
    const range = this.range();
    const min = snap(fromPosition(low, range, this.log()), range);
    const max = snap(fromPosition(high, range, this.log()), range);
    if (max > min) this.windowChange.emit({ min, max });
  }
}
