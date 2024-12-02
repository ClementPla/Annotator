import { AfterViewInit, Component, ElementRef, EventEmitter, Input, NgZone, OnInit, Output, QueryList, ViewChild, ViewChildren } from '@angular/core';

import { CommonModule, NgOptimizedImage } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DrawCanvasUtility } from '../../../Core/canvases/draw';
import { DrawingService } from '../../../Services/UI/drawing.service';
import { ViewService } from '../../../Services/UI/view.service';
import { LabelsService } from '../../../Services/Project/labels.service';
import { from, Observable, of } from 'rxjs';
import { Point2D, SegLabel } from '../../../Core/interface';
import { inject } from '@angular/core';
import { Button } from 'primeng/button';

@Component({
  selector: 'app-drawable-canvas',
  standalone: true,
  imports: [CommonModule, NgOptimizedImage, FormsModule, Button],
  templateUrl: './drawable-canvas.component.html',
  styleUrl: './drawable-canvas.component.scss'
})
export class DrawableCanvasComponent extends DrawCanvasUtility implements OnInit{

  title = 'Annotator';
  @Input() width: number = 256;
  @Input() height: number = 256;
  @Input() lineWidth: number = 10;

  @Input() override canZoom: boolean = true;
  @Input() override canPan: boolean = true;
  @Input() labelsOpacity: number | null | undefined = null;

  @ViewChild('image') imageElement: ElementRef<HTMLImageElement>;
  @ViewChild('imageCanvas') imgCanvas: ElementRef<HTMLCanvasElement>;
  @ViewChild('drawCanvas') drawCanvas: ElementRef<HTMLCanvasElement>;

  @ViewChild('svgCanvas') svgCanvas: ElementRef<SVGElement>;

  @Output() panAndZommed = new EventEmitter<{ scale: number, offsetX: number, offsetY: number }>();

  
  private ngZone = inject(NgZone)
  isFullscreen: boolean = false;
  srcImg$: Observable<string>;
  displayLabel: boolean = true;

  cursor: Point2D | null = {x: 0, y: 0};  
  classes$: Observable<SegLabel[]>;


  constructor(public override drawService: DrawingService, public viewService: ViewService, public override labelService: LabelsService) {
    super(drawService, labelService);
  }
  ngOnInit(): void {

    this.labelService.listSegmentationLabels.forEach((label) => {
      this.classesCanvas.push(new OffscreenCanvas(this.width, this.height));
    });
  }

  getCursorSize() {
    if (!this.ctxDraw) {
      return 0;
    }
    const rect = this.ctxDraw.canvas.getBoundingClientRect();
    return this.drawService.lineWidth * rect.width / this.width * this.scale;
  }

  mouseMove(event: MouseEvent) {

    const rect = this.ctxDraw.canvas.getBoundingClientRect();
    // Transform mouse coordinates to canvas coordinates
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    this.cursor = { x: mouseX, y: mouseY };
    if (this.drawService.canPan())
      this.drag(event);
    else {
      this.ngZone.runOutsideAngular(()=>{
        this.draw(event)
      })
    }

  }
  mouseDown(event: MouseEvent) {
    if (event.button == 1) {
      this.drawService.activatePanMode();
    }
    if (this.drawService.canPan())
      this.startDrag();
    else {

      this.startDraw();
      this.draw(event);
    }
  }

  mouseUp($event: MouseEvent) {
    if ($event.button == 1) {
      this.drawService.restoreLastTool();
    }
    if (this.drawService.canPan())
      this.endDrag();
    else {
      this.endDraw();
    }
    this.isDrawing = false;
  }

  reload(): void {

    this.image = this.imageElement.nativeElement;
    this.ctx = this.imgCanvas.nativeElement.getContext('2d', { alpha: false })!;
    this.ctxDraw = this.drawCanvas.nativeElement.getContext('2d', { alpha: true })!;
    this.ctxDraw.imageSmoothingEnabled = false;
    this.ctx.imageSmoothingEnabled = false;
    
    this.srcImg$.subscribe((src) => {
      this.image.src = src;
    });
    this.image.onload = () => {
      this.drawOnLoad();
      this.viewService.endLoading();
    }
  }

  redrawAllCanvas() {
    // Redraw the main image
    requestAnimationFrame(() => {

      if (!this.image.complete || this.image.naturalWidth === 0) {
        console.error("Image is not fully loaded or is invalid");
        return;
      }

      // Redraw the main image
      if (this.ctx == null) {
        this.ctx = this.imgCanvas.nativeElement.getContext('2d', { alpha: false })!;
      }
      if (!this.ctx) {
        console.error("Failed to get 2D context");
        return;
      }


      // This is the canvas with the main image
      this.ctx.resetTransform();
      this.clearCanvas(this.ctx);
      this.ctx.translate(this.offset.x, this.offset.y);
      this.ctx.scale(this.scale, this.scale);
      this.ctx.drawImage(this.image, 0, 0, this.width, this.height);


      // This is the canvas with the marker drawings
      this.ctxDraw.resetTransform();
      this.ctxDraw.imageSmoothingEnabled = false
      this.clearCanvas(this.ctxDraw);
      this.ctxDraw.translate(this.offset.x, this.offset.y);
      this.ctxDraw.scale(this.scale, this.scale);

      // Redraw the labels
      this.classesCanvas.forEach((canvas, index) => {
        if (this.labelService.listSegmentationLabels[index].isVisible) {
          this.ctxDraw.drawImage(canvas, 0, 0);
        }
      });


      this.panAndZommed.emit({ scale: this.targetScale, offsetX: this.targetOffset.x, offsetY: this.targetOffset.y });
    });
  }


  loadImage(image: Promise<string>) {
    this.srcImg$ = from(image);
    this.reload();
  }


  drawOnLoad() {
    this.width = this.image.naturalWidth;
    this.height = this.image.naturalHeight;
    this.imgCanvas.nativeElement.width = this.width;
    this.imgCanvas.nativeElement.height = this.height;
    this.drawCanvas.nativeElement.width = this.width;
    this.drawCanvas.nativeElement.height = this.height;

    this.classesCanvas.forEach((canvas) => {
      canvas.width = this.width;
      canvas.height = this.height;
    });

    // Set viewbox for SVG
    this.svgCanvas.nativeElement.setAttribute('viewBox', `0 0 ${this.width} ${this.height}`);
    requestAnimationFrame(() => {
      this.redrawAllCanvas();

    });
  }

  switchFullScreen() {
    this.isFullscreen = !this.isFullscreen;
    if (this.isFullscreen) {
    }
    else {
      this.resetZoomAndPan(true, true)
    }
  }

  getLassoPointsToPolygon() {

    if (this.lassoPoints.length < 3) {
      return ""
    }
    let points = "";
    for (let i = 0; i < this.lassoPoints.length; i++) {
      points += this.lassoPoints[i].x + "," + this.lassoPoints[i].y + " ";
    }
    return points

  }
}
