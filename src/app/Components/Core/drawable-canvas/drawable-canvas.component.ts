import {
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnInit,
  Output,
  ViewChild,
} from '@angular/core';

import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DrawCanvasUtility } from '../../../Core/canvases/draw';
import { DrawingService } from '../../../Services/UI/drawing.service';
import { ViewService } from '../../../Services/UI/view.service';
import { LabelsService } from '../../../Services/Project/labels.service';
import { from, Observable, of } from 'rxjs';
import { Point2D, SegLabel, Viewbox } from '../../../Core/interface';
import { Button } from 'primeng/button';
import { UndoRedo } from '../../../Core/misc/undoRedo';
import { OpenCVService } from '../../../Services/open-cv.service';
import { ImageProcessingService } from '../../../Services/image-processing.service';
import { ProjectService } from '../../../Services/Project/project.service';
import { SVGElementsComponent } from './svgelements/svgelements.component';

@Component({
  selector: 'app-drawable-canvas',
  standalone: true,
  imports: [CommonModule, FormsModule, Button, SVGElementsComponent],
  templateUrl: './drawable-canvas.component.html',
  styleUrl: './drawable-canvas.component.scss',
})
export class DrawableCanvasComponent
  extends DrawCanvasUtility
  implements OnInit
{
  @Input() override canPan: boolean = true;
  @Input() override canZoom: boolean = true;

  @Output() public imageLoaded = new EventEmitter<boolean>();

  public cursor: Point2D = { x: 0, y: 0 };
  public currentPixel: Point2D = { x: 0, y: 0 };
  public viewBox: Viewbox = { xmin: 0, ymin: 0, xmax: 0, ymax: 0 };
  public isFullscreen: boolean = false;
  public override rulerSize: number = 16;

  srcImg: string;

  @ViewChild('imageCanvas') public imgCanvas: ElementRef<HTMLCanvasElement>;
  @ViewChild('labelCanvas') public labelCanvas: ElementRef<HTMLCanvasElement>;

  @ViewChild('svg') public override svg: SVGElementsComponent;

  override image: HTMLImageElement = new Image();

  constructor(
    public override drawService: DrawingService,
    public viewService: ViewService,
    public override labelService: LabelsService,
    protected override imageProcessingService: ImageProcessingService,
    protected override openCVService: OpenCVService,
    protected override projectService: ProjectService
  ) {
    super(
      drawService,
      labelService,
      openCVService,
      imageProcessingService,
      projectService
    );
  }

  public drawOnLoad() {
    this.imageLoaded.emit(true);
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

    this.svg.setViewBox({
      x: 0,
      y: 0,
      width: this.width,
      height: this.height,
    });
    this.adjustScaleToFitImage();
    requestAnimationFrame(() => {
      this.redrawAllCanvas();
    });
  }

  public getCursorSize() {
    if (!this.ctxDraw) {
      return 0;
    }
    const rect = this.ctxDraw.canvas.getBoundingClientRect();
    return (
      ((this.drawService.lineWidth * rect.width) / this.width) * this.scale
    );
  }

  public getLassoPointsToPolygon() {
    if (this.lassoPoints.length < 3) {
      return '';
    }
    let points = '';
    for (let i = 0; i < this.lassoPoints.length; i++) {
      points += this.lassoPoints[i].x + ',' + this.lassoPoints[i].y + ' ';
    }
    return points;
  }

  public async loadImage(image: Promise<string>) {
    this.srcImg = await image;
    this.reload();
  }

  public override wheel(event: WheelEvent): void {
    this.viewBox = this.getCurrentViewbox();
    const rect = this.ctxDraw.canvas.getBoundingClientRect();
    // Transform mouse coordinates to canvas coordinates
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    this.currentPixel = this.getImageCoordinates(event);

    super.wheel(event);
  }
  public mouseDown(event: MouseEvent) {
    if (event.button == 1) {
      this.drawService.activatePanMode();
    }
    if (this.drawService.canPan()) {
      this.recomputeCanvasSum = false;
      this.startDrag();
    } else {
      this.recomputeCanvasSum = true;
      this.startDraw().then(() => {
        this.draw(event);
      });
    }
  }

  public mouseMove(event: MouseEvent) {
    const rect = this.ctxDraw.canvas.getBoundingClientRect();
    // Transform mouse coordinates to canvas coordinates
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;

    this.viewBox = this.getCurrentViewbox();
    this.currentPixel = this.getImageCoordinates(event);

    this.cursor = { x: mouseX, y: mouseY };
    if (this.drawService.canPan()) {
      this.recomputeCanvasSum = false;
      this.drag(event);
    } else {
      this.recomputeCanvasSum = true;
      this.draw(event);
    }
  }

  public mouseUp($event: MouseEvent) {
    if ($event.button == 1) {
      this.drawService.restoreLastTool();
    }
    if (this.drawService.canPan()) this.endDrag();
    else {
      this.endDraw();
    }
    this.isDrawing = false;
  }

  public ngOnInit(): void {
    this.builCanvasMask();

    UndoRedo.empty();
    this.update_undo_redo();
  }

  public builCanvasMask() {
    this.labelService.listSegmentationLabels.forEach(() => {
      let canvas = new OffscreenCanvas(this.width, this.height);
      let ctx = canvas.getContext('2d', {
        alpha: true,
        willReadFrequently: true,
      })!;
      ctx.imageSmoothingEnabled = false;
      this.classesCanvas.push(canvas);
    });
  }

  public redrawAllCanvas() {
    // Redraw the main image

    this.viewBox = this.getCurrentViewbox();

    if (!this.image.complete || this.image.naturalWidth === 0) {
      console.error('Image is not fully loaded or is invalid');
      return;
    }

    // Redraw the main image
    if (this.ctx == null) {
      this.ctx = this.imgCanvas.nativeElement.getContext('2d', {
        alpha: false,
      })!;
    }
    if (!this.ctx) {
      console.error('Failed to get 2D context');
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
      for (
        let i = 0;
        i < this.labelService.listSegmentationLabels.length;
        i++
      ) {
        let canvas = this.classesCanvas[i];
        if (!this.labelService.listSegmentationLabels[i].isVisible) {
          continue;
        } else {
          if (this.drawService.edgesOnly) {
            const edgeCanvas = this.openCVService.edgeDetection(
              canvas.getContext('2d')!
            );
            this.ctxSum!.drawImage(edgeCanvas, 0, 0);
          } else {
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
  }

  public reload(): void {
    this.ctx = this.imgCanvas.nativeElement.getContext('2d', { alpha: false })!;
    this.ctxDraw = this.labelCanvas.nativeElement.getContext('2d', {
      alpha: true,
      willReadFrequently: true,
    })!;
    this.ctxDraw.imageSmoothingEnabled = false;
    this.clearCanvas(this.ctxDraw);
    this.clearCanvas(this.ctx);
    this.clearCanvas(this.ctxSum!);

    this.image.src = this.srcImg;

    this.image.onload = () => {
      this.imageProcessingService.setImage(this.image);
      this.drawOnLoad();
      this.viewService.endLoading();
      UndoRedo.empty();
    };
  }
  public loadCanvas(data: string, index: number) {
    let canvas = this.classesCanvas[index];
    canvas.width = this.width;
    canvas.height = this.height;

    let ctx = canvas.getContext('2d', { alpha: true })!;

    let img = new Image();
    img.src = data;
    img.onload = () => {
      this.clearCanvas(ctx);
      console.log('Canvas has been drawn');
      ctx.drawImage(img, 0, 0);
      this.recomputeCanvasSum = true;
      this.redrawAllCanvas();
    };
  }

  public loadAllCanvas(masks: string[]) {
    this.labelService.listSegmentationLabels.forEach((label, index) => {
      this.loadCanvas(masks[index], index);
    });
  }

  public switchFullScreen() {
    this.isFullscreen = !this.isFullscreen;
    if (this.isFullscreen) {
    } else {
      this.resetZoomAndPan(true, true);
    }
  }

  // #endregion Public Methods (11)
}
