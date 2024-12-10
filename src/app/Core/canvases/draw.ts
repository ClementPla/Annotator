import { LabelsService } from "../../Services/Project/labels.service";
import { Point2D } from "../interface";
import { ImageZoomPan } from "./zoomPan";
import { DrawingService } from "../../Services/UI/drawing.service";
import { Tools } from "./tools";
import { UndoRedo } from "../misc/undoRedo";
import { invoke } from "@tauri-apps/api/core";
import { ImageProcessingService } from "../../Services/image-processing.service";

import { OpenCVService } from "../../Services/open-cv.service";
import { ProjectService } from "../../Services/Project/project.service";




export abstract class DrawCanvasUtility extends ImageZoomPan {
    isDrawing: boolean = false;
    protected ctxDraw: CanvasRenderingContext2D;
    protected _activeCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;
    protected image: HTMLImageElement;
    abstract width: number;
    abstract height: number;
    classesCanvas: (OffscreenCanvas)[] = [];
    lassoPoints: Point2D[] = [];

    previousPoint: Point2D = { x: -1, y: -1 };
    protected recomputeCanvasSum: boolean = false;
    protected bufferCanvas: OffscreenCanvas; // The buffer is used only in case of post-processing. 
    protected bufferCtx: OffscreenCanvasRenderingContext2D | null = null;
    // If post-processing is enabled, the buffer will store the image before the post-processing is applied. 

    protected sumCanvas: OffscreenCanvas;
    protected ctxSum: OffscreenCanvasRenderingContext2D | null = null;
    protected aliasingIteration: number = 1;

    constructor(public drawService: DrawingService,
        public labelService: LabelsService,
        protected openCVService: OpenCVService,
        protected imageProcessingService: ImageProcessingService,
        protected projectService: ProjectService) {
        super();

        this.drawService.canvasSumRefresh.subscribe((value) => {
            this.recomputeCanvasSum = value;
        });

        this.drawService.undo.subscribe((value) => {
            if (value) {
                this.recomputeCanvasSum = value;
                this.undo();
            }
        });
        this.drawService.redo.subscribe((value) => {
            if (value) {
                this.recomputeCanvasSum = value;
                this.redo();
            }
        });

        this.drawService.canvasRedraw.subscribe((value) => {
            if (value) {
                this.recomputeCanvasSum = value;
                this.refreshColor();
            }
        });

        this.drawService.canvasClear.subscribe((value) => {
            if (value >= 0) {
                this.recomputeCanvasSum = true;
                this.clearCanvasByIndex(value);
            }
        });
        this.sumCanvas = new OffscreenCanvas(1, 1);
        this.bufferCanvas = new OffscreenCanvas(1, 1);
        this.ctxSum = this.sumCanvas.getContext('2d', { alpha: true, willReadFrequently: true })!;
        this.bufferCtx = this.bufferCanvas.getContext('2d', { alpha: true, willReadFrequently: true })!;
    }
    startDraw() {
        this.minPoint = { x: Number.MAX_VALUE, y: Number.MAX_VALUE };
        this.maxPoint = { x: -1, y: -1 };
        this.isDrawing = true;
        this.lassoPoints = [];
        this._activeCtx = this.classesCanvas[this.labelService.getActiveIndex()]!.getContext('2d', { alpha: true, willReadFrequently: true });
        if (this.drawService.autoPostProcess) {
            this.clearCanvas(this.bufferCtx!);
        }

        UndoRedo.push({
            data: this._activeCtx?.canvas.convertToBlob({ type: 'image/png' })!,
            index: this.labelService.getActiveIndex()!
        });
    }

    endDraw() {
        if (!this.isDrawing) {
            return;
        }
        this.isDrawing = false;

        switch (this.drawService.selectedTool) {

            case Tools.PEN:
                this.binarizeCanvas(this._activeCtx!, this.getFillColor());
                break;
            case Tools.ERASER:
                this.binarizeCanvas(this._activeCtx!, this.getFillColor());
                break;

            case Tools.LASSO:
                if (this.drawService.autoPostProcess) {
                    this.applyLasso(this.bufferCtx!);
                }
                else {
                    this.applyLasso(this._activeCtx!);
                }
                break;
            case Tools.LASSO_ERASER:
                if (this.drawService.eraseAll) {
                    this.classesCanvas.forEach((classCanvas, index) => {
                        const ctxClass = classCanvas.getContext('2d', { alpha: true })!;
                        this.applyLassoEraser(ctxClass);
                    });

                }
                else {
                    this.applyLassoEraser(this._activeCtx!);
                }
                this.lassoPoints = [];
                break;
        }
        this.previousPoint = { x: -1, y: -1 };


        if (this.drawService.autoPostProcess) {
            if (this.drawService.isDrawingTool()) {
                this.postProcessDraw();
            }
            else if (this.drawService.isEraser()) {
                this.postProcessErase();
            }

        }

        this.redrawAllCanvas();

    }

    async postProcessErase() {
        let bufferCtx = this.bufferCtx!;

        const blobBuffer = await bufferCtx.canvas.convertToBlob({ type: 'image/png' });

        let allPromises: Promise<void>[] = [];
        this.classesCanvas.forEach((classCanvas, index) => {

            if ((index != this.labelService.getActiveIndex()) && !this.drawService.eraseAll) {
                return;
            }
            const blobClass$ = classCanvas.convertToBlob({ type: 'image/png' }).then(async (blob) => {
                return invoke<Uint8ClampedArray>("find_overlapping_region", {
                    label: await blob.arrayBuffer(),
                    mask: await blobBuffer.arrayBuffer(),
                })

            }).then(async (result: Uint8ClampedArray | null) => {
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

    async postProcessDraw() {

        let minPoint = this.fromCanvasToImageCoordinates(this.minPoint);
        let maxPoint = this.fromCanvasToImageCoordinates(this.maxPoint);
        if (this.drawService.selectedTool == Tools.PEN) {
            let lineWidth = this.drawService.lineWidth / 2;
            minPoint.x -= lineWidth
            minPoint.y -= lineWidth
            maxPoint.x += lineWidth
            maxPoint.y += lineWidth
        }
        let bufferCtx = this.bufferCtx!;
        let rect = { x: minPoint.x, y: minPoint.y, width: maxPoint.x - minPoint.x, height: maxPoint.y - minPoint.y };
        const imageData = bufferCtx.getImageData(rect.x, rect.y, rect.width, rect.height);
        const tmp = new OffscreenCanvas(rect.width, rect.height)
        const tmpImage = new OffscreenCanvas(rect.width, rect.height)
        tmp.getContext('2d')?.putImageData(imageData!, 0, 0)


        tmpImage.getContext('2d')?.drawImage(this.imageProcessingService.getCurrentCanvas(), rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height)

        let blobMask$ = tmp.convertToBlob({ type: 'image/png' })
        let blobImage$ = tmpImage.convertToBlob({ type: 'image/png' })

        Promise.all([blobMask$, blobImage$]).then(async (values) => {
            if (values[0] && values[1]) {
                return invoke<Uint8ClampedArray>("refine_segmentation", {
                    mask: await values[0]!.arrayBuffer(),
                    image: await values[1]!.arrayBuffer(),
                    opening: this.drawService.autoPostProcessOpening,
                    inverse: this.drawService.useInverse,
                    kernelSize: this.drawService.morphoSize,
                    connectedness: this.drawService.enforceConnectivity
                })
            }
            return null;
        })
            .then(async (result: Uint8ClampedArray | null) => {
                if (!result) {
                    return
                }
                // Decode PNG blob to Uint8ClampedArray
                let blob = new Blob([result], { type: 'image/png' });
                let imageBitmap = await createImageBitmap(blob);

                if (imageBitmap) {
                    bufferCtx.globalCompositeOperation = 'destination-over';
                    bufferCtx.clearRect(rect.x, rect.y, rect.width, rect.height);
                    bufferCtx.drawImage(imageBitmap, rect.x, rect.y);
                    this._activeCtx?.drawImage(this.bufferCanvas, 0, 0);
                }
                this.recomputeCanvasSum = true;
                this.redrawAllCanvas();
            });
    }

    draw(event: MouseEvent) {
        if (!this.isDrawing) {
            return;
        }
        if (!this.labelService.activeLabel) {
            return;
        }
        const postProcess = this.drawService.autoPostProcess;
        let ctx = postProcess ? this.bufferCtx! : this._activeCtx;
        if (!ctx) {
            return;
        }

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

    drawPen(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, event: MouseEvent) {
        const canvasCoord = this.getCanvasCoordinates(event);
        const imageCoord = this.fromCanvasToImageCoordinates(canvasCoord);
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
        for (let i = 0; i < this.aliasingIteration; i++) {
            ctx.stroke();

        }

        // Update previous point
        this.previousPoint = imageCoord;
        this.finalizeDraw(ctx);
    }

    eraserPen(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, event: MouseEvent) {

        // Is auto post-processing enabled? In which case, ctx is a buffer canvas
        // and we need to draw on the buffer canvas instead of the active canvas
        // Otherwise, we draw on the active canvas or all class canvases if eraseAll is enabled

        const canvasCoord = this.getCanvasCoordinates(event);
        const imageCoord = this.fromCanvasToImageCoordinates(canvasCoord);
        if (this.previousPoint.x == -1) {
            this.previousPoint = { x: imageCoord.x, y: imageCoord.y };
        }
        if (!this.drawService.autoPostProcess) {
            if (this.drawService.eraseAll) {
                this.classesCanvas.forEach((classCanvas, index) => {
                    const ctxClass = classCanvas.getContext('2d', { alpha: true })!;
                    ctxClass.globalCompositeOperation = 'destination-out';
                    ctxClass.beginPath();
                    ctxClass.moveTo(this.previousPoint.x, this.previousPoint.y);
                    ctxClass.lineTo(imageCoord.x, imageCoord.y);
                    for (let i = 0; i < this.aliasingIteration; i++) {
                        ctxClass.stroke();
                    }
                    ctxClass.globalCompositeOperation = 'source-over';
                })
            }
            ctx.globalCompositeOperation = 'destination-out';
        }
        else {
            ctx.fillStyle = 'white';
            ctx.strokeStyle = 'black';
            ctx.globalCompositeOperation = 'source-over';
        }
        ctx.beginPath();
        ctx.moveTo(this.previousPoint.x, this.previousPoint.y);
        ctx.lineTo(imageCoord.x, imageCoord.y);


        ctx.stroke();

        // Update previous point
        this.previousPoint = imageCoord;
        if (this.drawService.autoPostProcess) {
            this.recomputeCanvasSum = false;
            this.ctxSum!.globalAlpha = 0.01;
            this.ctxSum?.drawImage(ctx.canvas, 0, 0);
            this.ctxSum!.globalAlpha = 1;
            this.redrawAllCanvas();
        }
        else {
            this.redrawAllCanvas();
        }

    }

    updateLasso(event: MouseEvent) {
        const canvasCoord = this.getCanvasCoordinates(event);
        this.lassoPoints.push(canvasCoord);
    }

    applyLasso(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) {
        if (this.lassoPoints.length < 3) {
            return;
        }
        ctx.strokeStyle = this.getFillColor();
        ctx.fillStyle = this.getFillColor();
        ctx.lineWidth = 0;


        if (this.drawService.swapMarkers) {
            this.swapLasso(ctx);
        }
        else {
            ctx.globalCompositeOperation = 'source-over';
            let prev: Point2D = this.lassoPoints[0];
            prev = this.fromCanvasToImageCoordinates(prev);
            ctx.beginPath();
            ctx.moveTo(prev.x, prev.y);
            for (let i = 1; i < this.lassoPoints.length; i++) {
                const canvasCoord = this.fromCanvasToImageCoordinates(this.lassoPoints[i]);
                ctx.lineTo(canvasCoord.x, canvasCoord.y);

            }
            ctx.closePath();
            ctx.fill();
            this.binarizeCanvas(ctx, this.getFillColor())
        }

        this.lassoPoints = [];
        ctx.globalCompositeOperation = 'source-over';
    }
    applyLassoEraser(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) {
        if (this.lassoPoints.length < 3) {
            return;
        }
        ctx.strokeStyle = this.getFillColor();
        ctx.fillStyle = this.getFillColor();
        ctx.lineWidth = 0;
        ctx.globalCompositeOperation = 'destination-out';
        let prev: Point2D = this.lassoPoints[0];
        prev = this.fromCanvasToImageCoordinates(prev);
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        for (let i = 1; i < this.lassoPoints.length; i++) {
            const canvasCoord = this.fromCanvasToImageCoordinates(this.lassoPoints[i]);
            ctx.lineTo(canvasCoord.x, canvasCoord.y);

        }
        ctx.closePath();
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
    }

    swapLasso(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) {        
        // Create buffer canvas only once
        this.clearCanvas(this.bufferCtx!) ;
        const ctxBuffer = this.bufferCtx!;
        // Batch draw other class canvases
        const activeIndex = this.labelService.getActiveIndex();

        ctxBuffer.drawImage(this.sumCanvas, 0, 0);

        // Create lasso path mask
        ctxBuffer.globalCompositeOperation = 'source-in';
        ctxBuffer.fillStyle = this.getFillColor();
        ctxBuffer.beginPath();

        const lassoPath = this.lassoPoints.map(point =>
            this.fromCanvasToImageCoordinates(point)
        );

        ctxBuffer.moveTo(lassoPath[0].x, lassoPath[0].y);
        lassoPath.slice(1).forEach(coord => {
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

    finalizeDraw(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) {
        this.ctxDraw.drawImage(ctx.canvas, 0, 0);
    }
    clearCanvas(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) {
        ctx.clearRect(0, 0, this.width, this.height);
    }
    undo() {
        const element = UndoRedo.undo();
        if (element) {
            let ctx = this.classesCanvas[element.index]!.getContext('2d', { alpha: true })!;
            element.data!.then((blob) => {
                // Decode PNG blob to Uint8ClampedArray
                let imageBitmap = createImageBitmap(blob);
                imageBitmap.then((img) => {
                    ctx?.clearRect(0, 0, this.width, this.height);
                    ctx?.drawImage(img, 0, 0, this.width, this.height);
                    if (ctx) {
                        this.redrawAllCanvas();
                    }
                });

            });
        }
    }
    redo() {
        const element = UndoRedo.redo();
        if (element) {
            let ctx = this.classesCanvas[element.index]!.getContext('2d', { alpha: true })!;
            element.data!.then((blob) => {
                // Decode PNG blob to Uint8ClampedArray
                let imageBitmap = createImageBitmap(blob);
                imageBitmap.then((img) => {
                    ctx?.clearRect(0, 0, this.width, this.height);
                    ctx?.drawImage(img, 0, 0, this.width, this.height);
                    if (ctx) {
                        this.redrawAllCanvas();
                    }
                });
            });

        }
    }

    refreshColor() {
        if (this._activeCtx) {
            this._activeCtx = this.classesCanvas[this.labelService.getActiveIndex()]!.getContext('2d', { alpha: true, willReadFrequently: true });
            if (!this._activeCtx) {
                return;
            }
            const color = this.labelService.activeLabel?.color;

            this._activeCtx.fillStyle = color ? color : "#ffffff";
            this._activeCtx.strokeStyle = color ? color : "#ffffff";;
            this._activeCtx.globalCompositeOperation = 'source-atop';

            this._activeCtx.fillRect(0, 0, this.width, this.height);
            this._activeCtx.globalCompositeOperation = 'source-over';
        }

        this.redrawAllCanvas();
    }

    clearCanvasByIndex(index: number) {
        let ctx = this.classesCanvas[index]!.getContext('2d', { alpha: true, willReadFrequently: true });
        if (!ctx) {
            return;
        }
        this.clearCanvas(ctx);
        this.redrawAllCanvas();
    }

    override  wheel(event: WheelEvent) {
        if (event.ctrlKey) {
            this.drawService.lineWidth += (event.deltaY > 0) ? -2 : 2;
        }
        else {
            super.wheel(event);
        }
    }


    getFillColor() {
        if (this.projectService.isInstanceSegmentation) {
            return this.labelService.activeSegInstance!.shade;
        }

        const color = this.labelService.activeLabel?.color;
        return color ? color : "#ffffff";
    }

    binarizeCanvas(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, color: string) {
        if(!this.projectService.isInstanceSegmentation){
            this.openCVService.binarizeCanvas(ctx, color);
        }
        else{

            this.openCVService.binarizeMultiColorCanvas(ctx, this.labelService.activeLabel?.shades!)

        }
            
    }

}