import { DrawingService } from '../../Services/UI/drawing.service';
import { ImageProcessingService } from '../../Services/image-processing.service';
import { ImageZoomPan } from './zoomPan';
import { invoke } from '@tauri-apps/api/core';
import { LabelsService } from '../../Services/Project/labels.service';
import { OpenCVService } from '../../Services/open-cv.service';
import { Point2D } from '../interface';
import { ProjectService } from '../../Services/Project/project.service';
import { Tools } from './tools';
import { UndoRedo } from '../misc/undoRedo';

export abstract class DrawCanvasUtility extends ImageZoomPan {

  protected _activeCtx:
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null = null;
  protected bufferCanvas: OffscreenCanvas;
  // The buffer is used only in case of post-processing.
  protected bufferCtx: OffscreenCanvasRenderingContext2D | null = null;
  protected ctxDraw: CanvasRenderingContext2D;
  protected ctxSum: OffscreenCanvasRenderingContext2D | null = null;
  protected image: HTMLImageElement;
  // If post-processing is enabled, the buffer will store the image before the post-processing is applied.
  protected sumCanvas: OffscreenCanvas;

  public classesCanvas: OffscreenCanvas[] = [];
  public isDrawing: boolean = false;
  public lassoPoints: Point2D[] = [];
  public previousPoint: Point2D = { x: -1, y: -1 };

  constructor(
    public drawService: DrawingService,
    public labelService: LabelsService,
    protected openCVService: OpenCVService,
    protected imageProcessingService: ImageProcessingService,
    protected projectService: ProjectService
  ) {
    super();

    
    this.sumCanvas = new OffscreenCanvas(1, 1);
    this.bufferCanvas = new OffscreenCanvas(1, 1);
    this.ctxSum = this.sumCanvas.getContext('2d', {
      alpha: true,
      willReadFrequently: true,
    })!;
    this.bufferCtx = this.bufferCanvas.getContext('2d', {
      alpha: true,
      willReadFrequently: true,
    })!;
  }

  public applyLasso(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  ) {
    if (this.lassoPoints.length < 3) {
      return;
    }
    ctx.strokeStyle = this.getFillColor();
    ctx.fillStyle = this.getFillColor();
    ctx.lineWidth = 0;
    if (this.drawService.swapMarkers) {
      this.swapLasso(ctx);
    } else {
      ctx.globalCompositeOperation = 'source-over';
      let prev: Point2D = this.lassoPoints[0];
      ctx.beginPath();
      ctx.moveTo(prev.x, prev.y);
      for (let i = 1; i < this.lassoPoints.length; i++) {
        const canvasCoord = this.lassoPoints[i];
        ctx.lineTo(canvasCoord.x, canvasCoord.y);
      }
      ctx.closePath();
      ctx.fill();
      this.binarizeCanvas(ctx, this.getFillColor());
    }

    this.lassoPoints = [];
    ctx.globalCompositeOperation = 'source-over';
  }

  public applyLassoEraser(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  ) {
    if (this.lassoPoints.length < 3) {
      return;
    }
    ctx.strokeStyle = this.getFillColor();
    ctx.fillStyle = this.getFillColor();
    ctx.lineWidth = 0;
    ctx.globalCompositeOperation = 'destination-out';
    let prev: Point2D = this.lassoPoints[0];
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    for (let i = 1; i < this.lassoPoints.length; i++) {
      const canvasCoord = this.lassoPoints[i];
      ctx.lineTo(canvasCoord.x, canvasCoord.y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  public binarizeCanvas(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    color: string
  ) {
    let bbox = this.getBoundingBox();
    if (!this.projectService.isInstanceSegmentation) {
      this.openCVService.binarizeCanvas(ctx, color, bbox);
    } else {
      const shade = this.labelService.activeSegInstance!.shade;
      this.openCVService.binarizeCanvas(ctx, shade, bbox);
    }
  }

  public clearCanvas(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  ) {
    ctx.clearRect(0, 0, this.width, this.height);
  }

  public clearCanvasByIndex(index: number) {
    let ctx = this.classesCanvas[index]!.getContext('2d', {
      alpha: true,
      willReadFrequently: true,
    });
    if (!ctx) {
      return;
    }
    this.clearCanvas(ctx);
    this.redrawAllCanvas();
  }

  public draw(event: MouseEvent) {
    if (!this.isDrawing) {
      return;
    }
    if (!this.labelService.activeLabel) {
      return;
    }
    let ctx = this.bufferCtx!;
    if (!ctx) {
      return;
    }
    const imageCoord = this.getImageCoordinates(event);
    const x = imageCoord.x;
    const y = imageCoord.y;

    const offset = this.drawService.isToolWithBrushSize()
      ? this.drawService.lineWidth / 2 + 2
      : 0;

    this.minPoint = {
      x: Math.min(this.minPoint.x, x - offset),
      y: Math.min(this.minPoint.y, y - offset),
    };
    this.maxPoint = {
      x: Math.max(this.maxPoint.x, x + offset),
      y: Math.max(this.maxPoint.y, y + offset),
    };

    ctx.fillStyle = this.getFillColor();
    ctx.strokeStyle = this.getFillColor();
    ctx.lineWidth = this.drawService.lineWidth;
    // Deactivate anti-aliasing
    ctx.imageSmoothingEnabled = false;
    ctx.lineCap = 'round';
    this.recomputeCanvasSum = true;
    switch (this.drawService.selectedTool) {
      case Tools.PEN:
        this.drawPen(ctx, event);
        break;
      case Tools.ERASER:
        this.eraserPen(ctx, event);
        break;
      case Tools.LASSO:
        this.updateLasso(event);
        break;
      case Tools.LASSO_ERASER:
        this.updateLasso(event);
        break;
    }
  }

  public drawPen(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    event: MouseEvent
  ) {
    const imageCoord = this.getImageCoordinates(event);
    // Initialize previous point if not set
    if (this.previousPoint.x == -1) {
      this.previousPoint = { x: imageCoord.x, y: imageCoord.y };
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = false;

    // drawLine(ctx, this.previousPoint, imageCoord, this.drawService.lineWidth, this.getFillColor());
    ctx.beginPath();
    ctx.moveTo(this.previousPoint.x, this.previousPoint.y);
    ctx.lineTo(imageCoord.x, imageCoord.y);
    ctx.stroke();

    this.binarizeCanvas(ctx, this.getFillColor());
    // Update previous point
    this.previousPoint = imageCoord;
    this.finalizeDraw(ctx);
  }

  public async endDraw() {
    if (!this.isDrawing) {
      return;
    }
    this.isDrawing = false;
    this.binarizeCanvas(this.bufferCtx!, this.getFillColor());
    switch (this.drawService.selectedTool) {
      case Tools.PEN:
        let bbox = this.getBoundingBox();
        if (!this.drawService.autoPostProcess) {
          this._activeCtx!.drawImage(
            this.bufferCanvas,
            bbox.x,
            bbox.y,
            bbox.width,
            bbox.height,
            bbox.x,
            bbox.y,
            bbox.width,
            bbox.height
          );
        }

        break;
      case Tools.ERASER:
        break;

      case Tools.LASSO:
        if (this.drawService.autoPostProcess) {
          this.applyLasso(this.bufferCtx!);
        } else {
          this.applyLasso(this._activeCtx!);
        }
        break;
      case Tools.LASSO_ERASER:
        if (this.drawService.eraseAll) {
          this.classesCanvas.forEach((classCanvas, index) => {
            const ctxClass = classCanvas.getContext('2d', { alpha: true })!;
            this.applyLassoEraser(ctxClass);
          });
        } else {
          this.applyLassoEraser(this._activeCtx!);
        }
        this.lassoPoints = [];
        break;
    }
    this.previousPoint = { x: -1, y: -1 };

    let postProcessCallback;
    if (!this.drawService.autoPostProcess)
    {
      // Callback is simply Identity
      postProcessCallback = Promise.resolve()
    }
    else if(this.drawService.isEraser()){
      postProcessCallback = this.postProcessErase();
    }
    else if(this.drawService.isDrawingTool()){
        postProcessCallback = this.postProcessDraw();
      }

    
    await postProcessCallback?.then(() => {
      this.redrawAllCanvas();
    });
    

    if (this.projectService.isInstanceSegmentation) {
      if (this.drawService.incrementAfterStroke) {
        this.labelService.incrementActiveInstance();
      }
    }
  }

  public eraserPen(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    event: MouseEvent
  ) {
    // Is auto post-processing enabled? In which case, ctx is a buffer canvas
    // and we need to draw on the buffer canvas instead of the active canvas
    // Otherwise, we draw on the active canvas or all class canvases if eraseAll is enabled

    const imageCoord = this.getImageCoordinates(event);
    if (this.previousPoint.x == -1) {
      this.previousPoint = { x: imageCoord.x, y: imageCoord.y };
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.beginPath();
    ctx.moveTo(this.previousPoint.x, this.previousPoint.y);
    ctx.lineTo(imageCoord.x, imageCoord.y);
    ctx.stroke();

    this.binarizeCanvas(ctx, this.getFillColor());
    let bbox = this.getBoundingBox();

    if (!this.drawService.autoPostProcess) {
      this.classesCanvas.forEach((classCanvas, index) => {
        if (
          index != this.labelService.getActiveIndex() &&
          !this.drawService.eraseAll
        ) {
          return;
        }
        const ctxClass = classCanvas.getContext('2d', { alpha: true })!;
        ctxClass.globalCompositeOperation = 'destination-out';
        ctxClass.drawImage(
          ctx.canvas,
          bbox.x,
          bbox.y,
          bbox.width,
          bbox.height,
          bbox.x,
          bbox.y,
          bbox.width,
          bbox.height
        );
        ctxClass.globalCompositeOperation = 'source-over';
      });
    } else {
      ctx.fillStyle = 'white';
      ctx.strokeStyle = 'black';
      ctx.globalCompositeOperation = 'source-over';
    }

    // Update previous point
    this.previousPoint = imageCoord;

    if (this.drawService.autoPostProcess) {
      this.recomputeCanvasSum = false;
      this.ctxSum!.globalAlpha = 0.02;
      this.ctxSum?.drawImage(ctx.canvas, 0, 0);
      this.ctxSum!.globalAlpha = 1;
      this.redrawAllCanvas();
    } else {
      this.redrawAllCanvas();
    }
  }

  public finalizeDraw(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  ) {
    this.ctxDraw.drawImage(ctx.canvas, 0, 0);
  }

  public getBoundingBox() {


    return {
      x: this.minPoint.x,
      y: this.minPoint.y,
      width: this.maxPoint.x - this.minPoint.x,
      height: this.maxPoint.y - this.minPoint.y,
    };
  }

  public getFillColor() {
    if (this.projectService.isInstanceSegmentation) {
      if (!this.labelService.activeSegInstance) {
        throw new Error('No active instance');
      }
      return this.labelService.activeSegInstance.shade;
    }

    const color = this.labelService.activeLabel?.color;
    return color ? color : '#ffffff';
  }

  public async postProcessDraw() {
    let bufferCtx = this.bufferCtx!;
    let rect = { x: 0, y: 0, width: this.width, height: this.height };

    if (this.drawService.postProcessOption == 'otsu') {
      rect = this.getBoundingBox();
    }

    const imageData = bufferCtx.getImageData(
      rect.x,
      rect.y,
      rect.width,
      rect.height
    );
    const tmp = new OffscreenCanvas(rect.width, rect.height);
    const tmpImage = new OffscreenCanvas(rect.width, rect.height);
    tmp.getContext('2d')?.putImageData(imageData!, 0, 0);

    tmpImage
      .getContext('2d')
      ?.drawImage(
        this.imageProcessingService.getCurrentCanvas(),
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        0,
        0,
        rect.width,
        rect.height
      );

    let blobMask$ = tmp.convertToBlob({ type: 'image/png' });
    let blobImage$ = tmpImage.convertToBlob({ type: 'image/png' });

    await Promise.all([blobMask$, blobImage$])
      .then(async (values) => {
        if (values[0] && values[1]) {
          switch (this.drawService.postProcessOption) {
            case 'otsu':
              return invoke<Uint8ClampedArray>('refine_segmentation', {
                mask: await values[0]!.arrayBuffer(),
                image: await values[1]!.arrayBuffer(),
                opening: this.drawService.autoPostProcessOpening,
                inverse: this.drawService.useInverse,
                kernelSize: this.drawService.morphoSize,
                connectedness: this.drawService.enforceConnectivity,
              });
            case 'MedSAM':
              return invoke<Uint8ClampedArray>('sam_segment', {
                coarseMask: await values[0]!.arrayBuffer(),
                image: await values[1]!.arrayBuffer(),
              });
          }
        }
        return null;
      })
      .then(async (result: Uint8ClampedArray | null) => {
        if (!result) {
          return;
        }
        // Decode PNG blob to Uint8ClampedArray
        let blob = new Blob([result], { type: 'image/png' });
        let imageBitmap = await createImageBitmap(blob);

        if (this.drawService.postProcessOption == 'MedSAM') {
          bufferCtx.clearRect(rect.x, rect.y, rect.width, rect.height);
          bufferCtx.drawImage(imageBitmap, rect.x, rect.y);
          this._activeCtx?.drawImage(this.bufferCanvas, 0, 0);
        } else {
          bufferCtx.globalCompositeOperation = 'destination-over';
          bufferCtx.clearRect(rect.x, rect.y, rect.width, rect.height);
          bufferCtx.drawImage(imageBitmap, rect.x, rect.y);
          this._activeCtx?.drawImage(this.bufferCanvas, 0, 0);
        }
        this.recomputeCanvasSum = true;
      });
  }

  public async postProcessErase() {
    let bufferCtx = this.bufferCtx!;

    const blobBuffer = await bufferCtx.canvas.convertToBlob({
      type: 'image/png',
    });

    let allPromises: Promise<void>[] = [];
    this.classesCanvas.forEach((classCanvas, index) => {
      if (
        index != this.labelService.getActiveIndex() &&
        !this.drawService.eraseAll
      ) {
        return;
      }
      const blobClass$ = classCanvas
        .convertToBlob({ type: 'image/png' })
        .then(async (blob) => {
          return invoke<Uint8ClampedArray>('find_overlapping_region', {
            label: await blob.arrayBuffer(),
            mask: await blobBuffer.arrayBuffer(),
          });
        })
        .then(async (result: Uint8ClampedArray | null) => {
          if (!result) {
            return;
          }
          let blob = new Blob([result], { type: 'image/png' });
          let imageBitmap = await createImageBitmap(blob);
          if (imageBitmap) {
            const ctx = classCanvas.getContext('2d', { alpha: true })!;
            ctx.globalCompositeOperation = 'destination-out';
            ctx.drawImage(imageBitmap, 0, 0);
          }
        });
      allPromises.push(blobClass$);
    });

    Promise.all(allPromises).then(() => {
      this.recomputeCanvasSum = true;
      this.redrawAllCanvas();
    });
  }

  public redo() {
    const element = UndoRedo.redo();
    if (element) {
      this.classesCanvas.forEach((classCanvas, index) => {
        let data: Blob;
        if (Array.isArray(element.data)) {
          data = element.data[index];
        } else if (element.index != index) {
          return;
        } else {
          data = element.data as Blob;
        }

        const imageBitmap = createImageBitmap(data);
        imageBitmap.then((img) => {
          const ctx = classCanvas.getContext('2d', { alpha: true })!;
          ctx?.clearRect(0, 0, this.width, this.height);
          ctx?.drawImage(img, 0, 0, this.width, this.height);
          if (ctx) {
            this.redrawAllCanvas();
          }
        });
      });
    }
  }

  public refreshColor(inputCtx: OffscreenCanvasRenderingContext2D | null = null, inputColor: string | null = null) {
    if (this.projectService.isInstanceSegmentation) {
      this.redrawAllCanvas();
      return;
    }

    let ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
    if(!inputCtx && !this._activeCtx){
      ctx = this.classesCanvas[this.labelService.getActiveIndex()]!.getContext('2d', { alpha: true, willReadFrequently: true });
    }
    else if(!inputCtx && this._activeCtx){
      ctx = this._activeCtx;
    }
    else{
      ctx = inputCtx;
    }

      
    if (!ctx) {
      return;
    }
    let color = inputColor ? inputColor : this.labelService.activeLabel?.color;

    console.log('refresh color', color);

    ctx.fillStyle = color ? color : '#ffffff';
    ctx.strokeStyle = color ? color : '#ffffff';
    ctx.globalCompositeOperation = 'source-atop';

    ctx.fillRect(0, 0, this.width, this.height);
    ctx.globalCompositeOperation = 'source-over';
  

    this.redrawAllCanvas();
  }

  public startDraw() {
    this.minPoint = { x: Number.MAX_VALUE, y: Number.MAX_VALUE };
    this.maxPoint = { x: -1, y: -1 };
    this.isDrawing = true;
    this.lassoPoints = [];
    this._activeCtx = this.classesCanvas[
      this.labelService.getActiveIndex()
    ]!.getContext('2d', { alpha: true, willReadFrequently: true });
    this.clearCanvas(this.bufferCtx!);
    return this.update_undo_redo();
  }

  public swapLasso(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  ) {
    // Create buffer canvas only once
    this.clearCanvas(this.bufferCtx!);
    const ctxBuffer = this.bufferCtx!;
    // Batch draw other class canvases
    const activeIndex = this.labelService.getActiveIndex();

    ctxBuffer.drawImage(this.sumCanvas, 0, 0);

    // Create lasso path mask
    ctxBuffer.globalCompositeOperation = 'source-in';
    ctxBuffer.fillStyle = this.getFillColor();
    ctxBuffer.beginPath();

    const lassoPath = this.lassoPoints.map((point) =>
      this.fromCanvasToImageCoordinates(point)
    );

    ctxBuffer.moveTo(lassoPath[0].x, lassoPath[0].y);
    lassoPath.slice(1).forEach((coord) => {
      ctxBuffer.lineTo(coord.x, coord.y);
    });

    ctxBuffer.closePath();
    ctxBuffer.fill();
    this.binarizeCanvas(ctxBuffer, this.getFillColor());

    // Draw masked buffer to main context
    ctx.drawImage(this.bufferCanvas, 0, 0);

    // Remove masked area from other class canvases
    this.classesCanvas.forEach((classCanvas, index) => {
      if (index === activeIndex) return;
      const ctxClass = classCanvas.getContext('2d', { alpha: true })!;
      ctxClass.globalCompositeOperation = 'destination-out';
      ctxClass.drawImage(this.bufferCanvas, 0, 0);
      ctxClass.globalCompositeOperation = 'source-over';
    });
    // Reset composite operations
    ctx.globalCompositeOperation = 'source-over';
    this.bufferCtx!.globalCompositeOperation = 'source-over';
  }

  public undo() {
    const element = UndoRedo.undo();
    if (element) {
      this.classesCanvas.forEach(async (classCanvas, index) => {
        let data: Blob;
        if (Array.isArray(element.data)) {
          data = element.data[index];
        } else if (element.index != index) {
          return;
        } else {
          data = element.data as Blob;
        }
        const imageBitmap = createImageBitmap(data);
        await imageBitmap.then((img) => {
          const ctx = classCanvas.getContext('2d', { alpha: true })!;
          ctx?.clearRect(0, 0, this.width, this.height);
          ctx?.drawImage(img, 0, 0, this.width, this.height);
          if (ctx) {
            this.redrawAllCanvas();
          }
        });
      });
    }
  }

  public updateLasso(event: MouseEvent) {
    const canvasCoord = this.getImageCoordinates(event);

    this.lassoPoints.push(canvasCoord);
  }

  public update_undo_redo(): Promise<void> {
    if (this.drawService.affectsMultipleLabels()) {
      let allPromises: Promise<Blob>[] = [];
      this.classesCanvas.forEach((classCanvas, index) => {
        const blob$ = classCanvas.convertToBlob({ type: 'image/png' });
        allPromises.push(blob$);
      });
      return Promise.all(allPromises).then((blobs) => {
        UndoRedo.push({ data: blobs, index: -1 });
      });
    } else {
      const blob$ = this.classesCanvas[
        this.labelService.getActiveIndex()
      ]!.convertToBlob({ type: 'image/png' });
      return blob$.then((blob) => {
        UndoRedo.push({
          data: blob,
          index: this.labelService.getActiveIndex(),
        });
      });
    }
  }

  override wheel(event: WheelEvent) {
    if (event.ctrlKey) {
      this.drawService.lineWidth += event.deltaY > 0 ? -2 : 2;
    } else {
      super.wheel(event);
    }
  }

  // #endregion Public Methods (22)
}
