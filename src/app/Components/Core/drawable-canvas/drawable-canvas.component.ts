import { Component, ElementRef, EventEmitter, Input, OnInit, Output, ViewChild } from '@angular/core';

import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DrawCanvasUtility } from '../../../Core/canvases/draw';
import { DrawingService } from '../../../Services/UI/drawing.service';
import { ViewService } from '../../../Services/UI/view.service';
import { LabelsService } from '../../../Services/Project/labels.service';
import { from, Observable, of } from 'rxjs';
import { Point2D, SegLabel } from '../../../Core/interface';
import { Button } from 'primeng/button';
import { UndoRedo } from '../../../Core/misc/undoRedo';
import { OpenCVService } from '../../../Services/open-cv.service';
import { ImageProcessingService } from '../../../Services/image-processing.service';
import { ProjectService } from '../../../Services/Project/project.service';



@Component({
  selector: 'app-drawable-canvas',
  standalone: true,
  imports: [CommonModule, FormsModule, Button],
  templateUrl: './drawable-canvas.component.html',
  styleUrl: './drawable-canvas.component.scss'
})
export class DrawableCanvasComponent extends DrawCanvasUtility implements OnInit {

  title = 'Annotator';
  width: number = 1;
  height: number = 1;

  @Input() override canZoom: boolean = true;
  @Input() override canPan: boolean = true;
  @Input() labelsOpacity: number | null | undefined = null;

  @ViewChild('image') imageElement: ElementRef<HTMLImageElement>;
  @ViewChild('imageCanvas') imgCanvas: ElementRef<HTMLCanvasElement>; 
  @ViewChild('labelCanvas') labelCanvas: ElementRef<HTMLCanvasElement>; // Technically, this could be the same as imgCanvas

  @ViewChild('svgUI') svgCanvas: ElementRef<SVGElement>;

  @Output() panAndZommed = new EventEmitter<{ scale: number, offsetX: number, offsetY: number }>();


  isFullscreen: boolean = false;
  srcImg$: Observable<string>;
  displayLabel: boolean = true;

  cursor: Point2D | null = { x: 0, y: 0 };
  classes$: Observable<SegLabel[]>;



  constructor(public override drawService: DrawingService,
    public viewService: ViewService,
    public override labelService: LabelsService,
    protected override imageProcessingService: ImageProcessingService,
    protected override openCVService: OpenCVService,
    protected override projectService: ProjectService) {
    super(drawService, labelService, openCVService, imageProcessingService, projectService);
  }
  ngOnInit(): void {

    

    this.labelService.listSegmentationLabels.forEach(() => {
      let canvas = new OffscreenCanvas(this.width, this.height)
      let ctx = canvas.getContext("2d", { alpha: true, willReadFrequently: true })!
      setpixelated(ctx);
      this.classesCanvas.push(canvas);
    });

    UndoRedo.empty()

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
      this.recomputeCanvasSum = true;
      this.draw(event)
    }

  }
  mouseDown(event: MouseEvent) {
    if (event.button == 1) {
      this.drawService.activatePanMode();
    }
    if (this.drawService.canPan())
      this.startDrag();
    else {
      this.recomputeCanvasSum = true;
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
    this.ctxDraw = this.labelCanvas.nativeElement.getContext('2d', { alpha: true, willReadFrequently: true })!;
    setpixelated(this.ctxDraw!);
    this.srcImg$.subscribe((src) => {
      this.image.src = src;
    });
    this.image.onload = () => {
      this.drawOnLoad();
      this.imageProcessingService.setImage(this.image);
      this.viewService.endLoading();
    }

    UndoRedo.empty()
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
      this.ctx.translate(Math.round(this.offset.x), Math.round(this.offset.y));
      this.ctx.scale(this.scale, this.scale);

      let image = this.imageProcessingService.getCurrentCanvas();

      this.ctx.drawImage(image, 0, 0, this.width, this.height);

      // This is the canvas with the marker drawings
      this.clearCanvas(this.ctxDraw);

      this.ctxDraw.resetTransform();
      this.ctxDraw.translate(this.offset.x, this.offset.y);
      this.ctxDraw.scale(this.scale, this.scale);
      this.ctxSum!.imageSmoothingEnabled = false;
      // Investigate performance using CSS filters
      if (this.recomputeCanvasSum) {
        this.clearCanvas(this.ctxDraw);
        this.clearCanvas(this.ctxSum!);
        for (let i = 0; i < this.labelService.listSegmentationLabels.length; i++) {
          let canvas = this.classesCanvas[i];
          if (!this.labelService.listSegmentationLabels[i].isVisible) {
            continue;
          }
          else {
            if (this.drawService.edgesOnly) {
              this.ctxSum!.drawImage(this.openCVService.morphoGradient(canvas, this.labelService.listSegmentationLabels[i].color), 0, 0);
            }
            else {
              this.ctxSum!.drawImage(canvas, 0, 0);
            }
          }
        }
        this.recomputeCanvasSum = false;
      }

      this.ctxDraw.globalAlpha = this.drawService.labelOpacity;
      this.ctxDraw.imageSmoothingEnabled = false;
      this.ctxDraw.drawImage(this.sumCanvas, 0, 0);
      
      this.ctxDraw.globalAlpha = 1;

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

    this.imgCanvas.nativeElement.width = this.width; // This is the canvas with the main image
    this.imgCanvas.nativeElement.height = this.height;

    this.labelCanvas.nativeElement.width = this.width; // This is the displayed canvas
    this.labelCanvas.nativeElement.height = this.height;

    this.bufferCanvas.width = this.width; // This is the buffer canvas when drawing needs to be delayed (i.e when post-processing)
    this.bufferCanvas.height = this.height;

    this.sumCanvas.width = this.width; // This is the canvas with all the classes summed
    this.sumCanvas.height = this.height;

    this.classesCanvas.forEach((canvas) => {
      canvas.width = this.width;
      canvas.height = this.height;
    });

    // Set viewbox for SVG
    this.svgCanvas.nativeElement.setAttribute('viewBox', `0 0 ${this.width} ${this.height}`);
    this.redrawAllCanvas();

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

function setpixelated(context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) {
  context['imageSmoothingEnabled'] = false;       /* standard */

}