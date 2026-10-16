import { Pyramid, PyramidService } from '../../services/pyramid.service';
import { PinchStep } from './touch-gesture';
import { ViewportController } from './viewport-controller';

/** The elements a registration viewport draws into. */
export interface PyramidViewElements {
  host: HTMLElement;
  canvas: HTMLCanvasElement;
  svg: SVGSVGElement;
}

/**
 * One image pyramid drawn on a canvas through a `ViewportController`, with an
 * SVG overlay in native-pixel coordinates. Shared by the registration panes:
 * it sizes the canvas to its host, redraws on pan/zoom, and fits a new image.
 */
export class PyramidView {
  private readonly dpr = Math.max(1, window.devicePixelRatio || 1);
  private resizeObs?: ResizeObserver;
  private lastSize = { w: 0, h: 0 };
  private elements?: PyramidViewElements;

  /**
   * `controller` and `pyramid` are read on every draw, so they can be signal
   * inputs. `onResize` runs on a size change, before the redraw.
   */
  constructor(
    private readonly pyramidSvc: PyramidService,
    private readonly controller: () => ViewportController,
    private readonly pyramid: () => Pyramid | null,
    private readonly onResize?: (w: number, h: number) => void,
  ) {}

  /** Start following the host's size and the controller's transform. */
  attach(elements: PyramidViewElements): void {
    this.elements = elements;
    this.controller().onRedrawNeeded = () => this.refresh();

    this.resizeObs = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      const w = Math.round(r.width);
      const h = Math.round(r.height);
      if (w === 0 || h === 0) return;
      if (w === this.lastSize.w && h === this.lastSize.h) return;
      this.lastSize = { w, h };

      this.controller().setSize(w, h);
      this.onResize?.(w, h);
      this.resizeCanvas(w, h);
      this.refresh();
    });
    this.resizeObs.observe(elements.host);
  }

  detach(): void {
    this.resizeObs?.disconnect();
    this.controller().onRedrawNeeded = undefined;
  }

  /** A new image: fit it once the controller has a size, then draw. */
  pyramidChanged(): void {
    const pyramid = this.pyramid();
    if (!pyramid) return;
    const { nativeWidth: w, nativeHeight: h } = pyramid;
    const controller = this.controller();
    controller.smooth = Math.max(w, h) < 4096;
    const size = controller.size();
    if (size.width > 0 && size.height > 0) {
      controller.fitImage(w, h, false);
    }
    this.refresh();
  }

  /** Redraw the canvas and realign the SVG overlay. */
  refresh(): void {
    this.redraw();
    this.updateSvgViewBox();
  }

  redraw(): void {
    const canvas = this.elements?.canvas;
    const pyramid = this.pyramid();
    if (!canvas || !pyramid) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const controller = this.controller();
    const level = this.pyramidSvc.getLevelForViewport(
      pyramid,
      controller.scale(),
      controller.size().width,
      controller.size().height,
    );

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    controller.applyToContextForLevel(ctx, this.dpr, level);
    ctx.imageSmoothingEnabled = controller.scale() < 1;
    ctx.drawImage(level.canvas, 0, 0);
    ctx.restore();
  }

  /** The canvas's client rect, for client → viewport conversions. */
  canvasRect(): DOMRect {
    return this.elements!.canvas.getBoundingClientRect();
  }

  wheel(event: WheelEvent): void {
    this.controller().wheel(event, this.canvasRect());
  }

  pinch(step: PinchStep): void {
    const controller = this.controller();
    controller.pinch(
      controller.clientToViewport(step.pivot.x, step.pivot.y, this.canvasRect()),
      step.factor,
      step.dx,
      step.dy,
    );
  }

  private updateSvgViewBox(): void {
    const svg = this.elements?.svg;
    const pyramid = this.pyramid();
    if (!svg || !pyramid) return;
    svg.setAttribute(
      'viewBox',
      this.controller().getSVGViewBox(pyramid.nativeWidth, pyramid.nativeHeight),
    );
  }

  private resizeCanvas(w: number, h: number): void {
    const canvas = this.elements?.canvas;
    if (!canvas) return;
    canvas.width = Math.round(w * this.dpr);
    canvas.height = Math.round(h * this.dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  }
}
