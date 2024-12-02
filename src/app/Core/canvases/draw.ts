import { ElementRef, QueryList } from "@angular/core";
import { LabelsService } from "../../Services/Project/labels.service";
import { Point2D } from "../interface";
import { ImageZoomPan } from "./zoomPan";
import { DrawingService } from "../../Services/UI/drawing.service";
import { Tools } from "./tools";
import { UndoRedo } from "../misc/undoRedo";
import { invoke } from "@tauri-apps/api/core";

export abstract class DrawCanvasUtility extends ImageZoomPan {
    isDrawing: boolean = false;
    protected ctxDraw: CanvasRenderingContext2D;
    protected _activeCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;
    protected image: HTMLImageElement;
    abstract width: number;
    abstract height: number;
    classesCanvas: OffscreenCanvas[] = [];
    lassoPoints: Point2D[] = [];

    previousPoint: Point2D = { x: -1, y: -1 };



    constructor(public drawService: DrawingService, public labelService: LabelsService) {
        super();

        this.drawService.undo.subscribe((value) => {
            if (value) {
                this.undo();
            }
        });
        this.drawService.redo.subscribe((value) => {
            if (value) {
                this.redo();
            }
        });

        this.drawService.canvasRedraw.subscribe((value) => {
            if (value) {
                this.refreshColor();
            }
        });

        this.drawService.canvasClear.subscribe((value) => {
            if (value >= 0) {
                this.clearCanvasByIndex(value);
            }
        });
    }
    startDraw() {
        this.minPoint = { x: Number.MAX_VALUE, y: Number.MAX_VALUE };
        this.maxPoint = { x: -1, y: -1 };
        this.isDrawing = true;
        this.lassoPoints = [];
        this._activeCtx = this.classesCanvas[this.labelService.getActiveIndex()]!.getContext('2d', { alpha: true, willReadFrequently: true });
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
            case Tools.LASSO:
                this.applyLasso(this._activeCtx!);
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
            this.postProcess();
        }

        this.redrawAllCanvas();

    }

    async postProcess() {

        let minPoint = this.fromCanvasToImageCoordinates(this.minPoint);
        let maxPoint = this.fromCanvasToImageCoordinates(this.maxPoint);
        if (this.drawService.selectedTool == Tools.PEN) {
            let lineWidth = this.drawService.lineWidth / 2;
            minPoint.x -= lineWidth
            minPoint.y -= lineWidth
            maxPoint.x += lineWidth
            maxPoint.y += lineWidth
        }

        let rect = { x: minPoint.x, y: minPoint.y, width: maxPoint.x - minPoint.x, height: maxPoint.y - minPoint.y };
        const imageData = this._activeCtx?.getImageData(rect.x, rect.y, rect.width, rect.height);
        const tmp = new OffscreenCanvas(rect.width, rect.height)
        const tmpImage = new OffscreenCanvas(rect.width, rect.height)
        tmp.getContext('2d')?.putImageData(imageData!, 0, 0)
        tmpImage.getContext('2d')?.drawImage(this.image, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height)

        let blobMask$ = tmp.convertToBlob({ type: 'image/png' })
        let blobImage$ = tmpImage.convertToBlob({ type: 'image/png' })

        Promise.all([blobMask$, blobImage$]).then(async (values) => {
            if (values[0] && values[1]) {
                return invoke<Uint8ClampedArray>("refine_segmentation", {
                    mask: await values[0]!.arrayBuffer(),
                    image: await values[1]!.arrayBuffer(),
                    opening: this.drawService.autoPostProcessOpening,
                    inverse: this.drawService.useInverse,
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
                    this._activeCtx!.globalCompositeOperation = 'destination-over';
                    this._activeCtx!.clearRect(rect.x, rect.y, rect.width, rect.height);
                    this._activeCtx?.drawImage(imageBitmap, rect.x, rect.y);
                    this._activeCtx!.globalCompositeOperation = 'source-over';
                }
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
        let ctx = this._activeCtx;
        if (!ctx) {
            return;
        }
        this._activeCtx = ctx;
        ctx.fillStyle = this.labelService.activeLabel.color;
        ctx.strokeStyle = this.labelService.activeLabel.color;
        ctx.lineWidth = this.drawService.lineWidth;
        // Deactivate anti-aliasing
        ctx.imageSmoothingEnabled = false;
        ctx.lineCap = 'round';
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
        ctx.beginPath();
        ctx.moveTo(this.previousPoint.x, this.previousPoint.y);
        ctx.lineTo(imageCoord.x, imageCoord.y);
        ctx.stroke();
        // Update previous point
        this.previousPoint = imageCoord;
        this.finalizeDraw(ctx);
    }

    eraserPen(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, event: MouseEvent) {
        const canvasCoord = this.getCanvasCoordinates(event);
        const imageCoord = this.fromCanvasToImageCoordinates(canvasCoord);
        if (this.previousPoint.x == -1) {
            this.previousPoint = { x: imageCoord.x, y: imageCoord.y };
        }
        if (this.drawService.eraseAll) {
            this.classesCanvas.forEach((classCanvas, index) => {
                const ctxClass = classCanvas.getContext('2d', { alpha: true })!;
                ctxClass.globalCompositeOperation = 'destination-out';
                ctxClass.beginPath();
                ctxClass.moveTo(this.previousPoint.x, this.previousPoint.y);
                ctxClass.lineTo(imageCoord.x, imageCoord.y);
                ctxClass.stroke();
                ctxClass.globalCompositeOperation = 'source-over';
            })
        }
        else {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.beginPath();
            ctx.moveTo(this.previousPoint.x, this.previousPoint.y);
            ctx.lineTo(imageCoord.x, imageCoord.y);
            ctx.stroke();
            ctx.globalCompositeOperation = 'source-over';
        }

        // Update previous point
        this.previousPoint = imageCoord;
        this.redrawAllCanvas();
    }

    updateLasso(event: MouseEvent) {
        const canvasCoord = this.getCanvasCoordinates(event);
        this.lassoPoints.push(canvasCoord);
    }

    applyLasso(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) {
        if (this.lassoPoints.length < 3) {
            return;
        }
        ctx.strokeStyle = this.labelService.activeLabel!.color;
        ctx.fillStyle = this.labelService.activeLabel!.color;
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
        }

        this.lassoPoints = [];
        ctx.globalCompositeOperation = 'source-over';
    }
    applyLassoEraser(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D) {
        if (this.lassoPoints.length < 3) {
            return;
        }
        ctx.strokeStyle = this.labelService.activeLabel!.color;
        ctx.fillStyle = this.labelService.activeLabel!.color;
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
        const { x: minX, y: minY } = this.minPoint;
        const width = this.maxPoint.x - minX;
        const height = this.maxPoint.y - minY;

        // Create buffer canvas only once
        const buffer = document.createElement('canvas');
        buffer.width = this.width;
        buffer.height = this.height;
        const ctxBuffer = buffer.getContext('2d', { alpha: true })!;
        ctxBuffer.imageSmoothingEnabled = false;
        // Batch draw other class canvases
        const activeIndex = this.labelService.getActiveIndex();
        this.classesCanvas.forEach((classCanvas, index) => {
            if (index === activeIndex) return;

            const canvas = classCanvas;
            ctxBuffer.drawImage(canvas, minX, minY, width, height, minX, minY, width, height);
        });

        // Create lasso path mask
        ctxBuffer.globalCompositeOperation = 'source-in';
        ctxBuffer.fillStyle = this.labelService.activeLabel!.color;
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


        // Draw masked buffer to main context
        ctx.drawImage(buffer, minX, minY, width, height, minX, minY, width, height);

        // Remove masked area from other class canvases
        this.classesCanvas.forEach((classCanvas, index) => {
            if (index === activeIndex) return;

            const ctxClass = classCanvas.getContext('2d', { alpha: true })!;
            ctxClass.imageSmoothingEnabled = false;
            ctxClass.globalCompositeOperation = 'destination-out';
            ctxClass.drawImage(buffer, minX, minY, width, height, minX, minY, width, height);
            ctxClass.globalCompositeOperation = 'source-over';
        });
        // Reset composite operations
        ctx.globalCompositeOperation = 'source-over';
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
        this._activeCtx = this.classesCanvas[this.labelService.getActiveIndex()]!.getContext('2d', { alpha: true, willReadFrequently: true });
        if (!this._activeCtx) {
            return;
        }
        this._activeCtx.fillStyle = this.labelService.activeLabel!.color;
        this._activeCtx.strokeStyle = this.labelService.activeLabel!.color;
        this._activeCtx.globalCompositeOperation = 'source-atop';

        this._activeCtx.fillRect(0, 0, this.width, this.height);
        this.finalizeDraw(this._activeCtx);
        this._activeCtx.globalCompositeOperation = 'source-over';
        this.redrawAllCanvas();
    }

    clearCanvasByIndex(index: number) {
        let ctx = this.classesCanvas[index]!.getContext('2d', { alpha: true, willReadFrequently: true });
        if (!ctx) {
            return;
        }
        this.clearCanvas(ctx);
        this.finalizeDraw(ctx);
        this.redrawAllCanvas();
    }

    override  wheel(event: WheelEvent) {
        if (event.ctrlKey) {
            this.drawService.lineWidth += (event.deltaY > 0) ? -10 : 10;
        }
        else {
            super.wheel(event);
        }
    }

}