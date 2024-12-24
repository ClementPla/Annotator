import { Injectable } from '@angular/core';
import { Point2D, Viewbox } from '../models';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class ZoomPanService {
  public isDragging = false;
  public scale = 1;
  public offset: Point2D = { x: 0, y: 0 };
  public maxScale = 10;
  public minScale = 0.01;
  private targetScale = 1;
  private targetOffset: Point2D = { x: 0, y: 0 };
  private canZoom = true;
  private canPan = true;
  private ctx: CanvasRenderingContext2D;
  private width: number;
  private height: number;

  public redrawRequest = new BehaviorSubject<boolean>(false);
  public svgRequest = new BehaviorSubject<boolean>(false);

  constructor() {}

  public setContext(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  public setCanvasSize(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  enableDrag() {
    this.isDragging = true;
  }

  disableDrag() {
    this.isDragging = false;
  }

  getViewBox(): Viewbox {
    // Return computed viewBox
    return {
      xmin: -this.offset.x / this.scale,
      ymin: -this.offset.y / this.scale,
      xmax: this.ctx!.canvas.width / this.scale,
      ymax: this.ctx!.canvas.height / this.scale,
    };
  }

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
      this.svgRequest.next(true);
      this.redrawRequest.next(true);
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
      this.redrawRequest.next(true);
    }
  }

  public resetZoomAndPan(smooth: boolean = true, redraw: boolean = true) {
    this.targetScale = 1;
    this.targetOffset = { x: 0, y: 0 };
    if (!redraw) {
      return;
    }
    this.svgRequest.next(true);

    if (smooth) {
      this.smoothUpdateTransform();
    } else {
      this.scale = this.targetScale;
      this.offset = this.targetOffset;
      this.redrawRequest.next(true);
    }
  }

  public smoothUpdateTransform() {
    const easeFactor = 0.1;
    const newScale = this.scale + (this.targetScale - this.scale) * easeFactor;
    const newOffsetX =
      this.offset.x + (this.targetOffset.x - this.offset.x) * easeFactor;
    const newOffsetY =
      this.offset.y + (this.targetOffset.y - this.offset.y) * easeFactor;
    this.svgRequest.next(true);

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
        this.redrawRequest.next(true);
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

}
