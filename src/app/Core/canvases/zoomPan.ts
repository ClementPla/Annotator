import { ElementRef } from '@angular/core';
import { Point2D, Viewbox } from '../interface';
import { SVGElementsComponent } from '../../Components/Core/drawable-canvas/svgelements/svgelements.component';

export abstract class ImageZoomPan {
  // #region Properties (13)

  protected ctx: CanvasRenderingContext2D;
  protected isDragging = false;
  protected maxPoint: Point2D = { x: -1, y: -1 };
  protected maxScale = 10;
  protected minPoint: Point2D = { x: Number.MAX_VALUE, y: Number.MAX_VALUE };
  protected minScale = 0.01;
  protected offset: Point2D = { x: 0, y: 0 };
  protected recomputeCanvasSum: boolean = false;
  protected scale = 1;
  protected targetOffset: Point2D = { x: 0, y: 0 };
  protected targetScale = 1;
  protected fitScreenScale = 1;
  protected centerOffset: Point2D = { x: 0, y: 0 };

  public svgCanvas: ElementRef<SVGElement>;
  public canPan = true;
  public canZoom = true;

  public width: number = 1;
  public height: number = 1;
  public abstract rulerSize: number;
  public svg: SVGElementsComponent;

  public drag(event: MouseEvent) {
    if (!this.canPan) {
      return;
    }
    if (this.isDragging) {
      const canvas = this.ctx.canvas;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;

      const dx = event.movementX * scaleX;
      const dy = event.movementY * scaleY;

      this.targetOffset.x += dx;
      this.targetOffset.y += dy;
      this.offset.x += dx;
      this.offset.y += dy;
      this.updateViewBox();
      this.redrawAllCanvas();
    }
  }

  public endDrag() {
    this.isDragging = false;
  }

  public fromCanvasToImageCoordinates(point: Point2D): Point2D {
    const imageX = (point.x - this.offset.x) / this.scale;
    const imageY = (point.y - this.offset.y) / this.scale;
    return { x: Math.trunc(imageX), y: Math.trunc(imageY) };
  }

  public getCanvasCoordinates(
    event: MouseEvent | WheelEvent | Point2D
  ): Point2D {
    const clientX = (event as MouseEvent).clientX
      ? (event as MouseEvent).clientX
      : (event as Point2D).x;
    const clientY = (event as MouseEvent).clientY
      ? (event as MouseEvent).clientY
      : (event as Point2D).y;

    const rect = this.ctx.canvas.getBoundingClientRect();
    const scaleX = this.ctx.canvas.width / rect.width;
    const scaleY = this.ctx.canvas.height / rect.height;

    const x = Math.round((clientX - rect.left) * scaleX);
    const y = Math.round((clientY - rect.top) * scaleY);

    return { x, y };
  }

  public getImageCoordinates(
    event: MouseEvent | WheelEvent | Point2D
  ): Point2D {
    const clientX = (event as MouseEvent).clientX
      ? (event as MouseEvent).clientX
      : (event as Point2D).x;
    const clientY = (event as MouseEvent).clientY
      ? (event as MouseEvent).clientY
      : (event as Point2D).y;

    const rect = this.ctx.canvas.getBoundingClientRect();
    const scaleX = this.ctx.canvas.width / rect.width;
    const scaleY = this.ctx.canvas.height / rect.height;

    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;

    let imageX = (x - this.offset.x) / this.scale;
    let imageY = (y - this.offset.y) / this.scale;
    imageX = Math.min(this.width - 1, Math.max(0, imageX));
    imageY = Math.min(this.height - 1, Math.max(0, imageY));

    return { x: Math.round(imageX), y: Math.round(imageY) };
  }

  public getTransform() {
    return {
      scale: this.targetScale,
      offsetX: this.targetOffset.x,
      offsetY: this.targetOffset.y,
    };
  }

  public setTransform(
    scale: number,
    offsetX: number,
    offsetY: number,
    smooth: boolean = true
  ) {
    this.targetScale = scale;
    this.targetOffset.x = offsetX;
    this.targetOffset.y = offsetY;
    if (smooth) {
      this.smoothUpdateTransform();
    } else {
      this.redrawAllCanvas();
    }
  }

  public resetZoomAndPan(smooth: boolean = true, redraw: boolean = true) {
    this.targetScale = this.fitScreenScale;
    this.targetOffset = { x: this.centerOffset.x, y: this.centerOffset.y };
    if (!redraw) {
      return;
    }
    this.updateViewBox();

    if (smooth) {
      this.smoothUpdateTransform();
    } else {
      this.scale = this.targetScale;
      this.offset = this.targetOffset;
      this.redrawAllCanvas();
    }
  }

  public smoothUpdateTransform() {
    const easeFactor = 0.1;
    const newScale = this.scale + (this.targetScale - this.scale) * easeFactor;
    const newOffsetX =
      this.offset.x + (this.targetOffset.x - this.offset.x) * easeFactor;
    const newOffsetY =
      this.offset.y + (this.targetOffset.y - this.offset.y) * easeFactor;
    this.updateViewBox();

    if (
      Math.abs(this.targetScale - newScale) > 0.2 ||
      Math.abs(this.targetOffset.x - newOffsetX) > 0.2 ||
      Math.abs(this.targetOffset.y - newOffsetY) > 0.2
    ) {
      this.scale = newScale;
      this.offset.x = newOffsetX;
      this.offset.y = newOffsetY;
      requestAnimationFrame(() => {
        this.smoothUpdateTransform();
        this.redrawAllCanvas();
      });
    }
  }

  public startDrag() {
    this.isDragging = true;
  }

  public wheel(event: WheelEvent) {
    if (!this.canZoom) {
      return;
    }
    this.recomputeCanvasSum = false;
    event.preventDefault();
    const zoomIntensity = 0.25;
    const wheel = event.deltaY < 0 ? 1 : -1;
    const zoom = Math.exp(wheel * zoomIntensity);

    const canvasCoord = this.getCanvasCoordinates(event);
    const imageCoord = this.fromCanvasToImageCoordinates(canvasCoord);

    this.targetScale *= zoom;
    this.targetScale = Math.min(this.targetScale, this.maxScale);
    this.targetScale = Math.max(this.targetScale, this.minScale);
    this.targetOffset.x = canvasCoord.x - imageCoord.x * this.targetScale;
    this.targetOffset.y = canvasCoord.y - imageCoord.y * this.targetScale;
    this.smoothUpdateTransform();
  }

  private updateViewBox() {
    const viewBoxX = -this.offset.x / this.scale;
    const viewBoxY = -this.offset.y / this.scale;
    const viewBoxWidth = this.ctx.canvas.width / this.scale;
    const viewBoxHeight = this.ctx.canvas.width / this.scale;
    this.svg.setViewBox({
      x: viewBoxX,
      y: viewBoxY,
      width: viewBoxWidth,
      height: viewBoxHeight,
    });
  }

  protected adjustScaleToFitImage() {
    return;
    // This function does not work properly
    // It seems to mess with the zoom and pan after the first time it is called
    let imgWidth = this.width;
    let imgHeight = this.height;

    let canvasWidth = this.ctx.canvas.getBoundingClientRect().width;
    let canvasHeight = this.ctx.canvas.getBoundingClientRect().height;

    let scaleX = imgWidth / canvasWidth;
    let scaleY = imgHeight / canvasHeight;

    let scale = Math.min(scaleX, scaleY);

    this.fitScreenScale = scale;
    this.resetZoomAndPan(false, true);
  }

  getCurrentViewbox(): Viewbox {
    if (!this.ctx) {
      return { xmin: 0, ymin: 0, xmax: 0, ymax: 0 };
    }
    let rect = this.ctx.canvas.getBoundingClientRect();

    let canvasScale = rect.width / this.width;
    let xmin = Math.round(this.offset.x * canvasScale);
    let xmax = xmin + this.width * this.scale * canvasScale;
    let ymin = Math.round(this.offset.y * canvasScale);
    let ymax = ymin + this.height * this.scale * canvasScale;

    return { xmin: xmin, ymin: ymin, xmax: xmax, ymax: ymax };
  }

  public abstract redrawAllCanvas(): void;
}
