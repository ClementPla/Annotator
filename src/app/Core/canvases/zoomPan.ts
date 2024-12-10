import { Point2D } from "../interface";

export abstract class ImageZoomPan {
    public canZoom = true;
    public canPan = true;

    protected scale = 1;
    protected maxScale = 7;
    protected minScale = 0.75;

    protected isDragging = false;

    protected targetScale = 1;
    protected offset: Point2D = { x: 0, y: 0 };

    protected targetOffset: Point2D = { x: 0, y: 0 };


    protected ctx: CanvasRenderingContext2D;

    protected minPoint: Point2D = { x: Number.MAX_VALUE, y: Number.MAX_VALUE };
    protected maxPoint: Point2D = { x: -1, y: -1 };


    startDrag() {
        this.isDragging = true;
    }

    drag(event: MouseEvent) {
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
            this.redrawAllCanvas();
        }
    }

    endDrag() {
        this.isDragging = false;
    }

    wheel(event: WheelEvent) {
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

    resetZoomAndPan(smooth: boolean = true, redraw: boolean = true) {
        this.targetScale = 1;
        this.targetOffset.x = 0;
        this.targetOffset.y = 0;
        if (!redraw) {
            return;
        }
        if (smooth) {
            this.smoothUpdateTransform();
        }
        else {
            this.redrawAllCanvas()
        }
    }

    smoothUpdateTransform() {
        const easeFactor = 0.2;
        const newScale = this.scale + (this.targetScale - this.scale) * easeFactor;
        const newOffsetX = this.offset.x + (this.targetOffset.x - this.offset.x) * easeFactor;
        const newOffsetY = this.offset.y + (this.targetOffset.y - this.offset.y) * easeFactor;

        if (
            Math.abs(this.targetScale - newScale) > 0.01 ||
            Math.abs(this.targetOffset.x - newOffsetX) > 0.01 ||
            Math.abs(this.targetOffset.y - newOffsetY) > 0.01
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


    getTransform() {
        return { scale: this.targetScale, offsetX: this.targetOffset.x, offsetY: this.targetOffset.y };
    }

    resetTransform(scale: number, offsetX: number, offsetY: number, smooth: boolean = true) {
        this.targetScale = scale;
        this.targetOffset.x = offsetX;
        this.targetOffset.y = offsetY;
        if (smooth) {
            this.smoothUpdateTransform();
        }
        else {
            this.redrawAllCanvas();
        }
    }

    abstract redrawAllCanvas(): void;


    getCanvasCoordinates(event: MouseEvent | WheelEvent): Point2D {
        const rect = this.ctx.canvas.getBoundingClientRect();
        const scaleX = this.ctx.canvas.width / rect.width;
        const scaleY = this.ctx.canvas.height / rect.height;

        const x = Math.trunc((event.clientX - rect.left) * scaleX);
        const y = Math.trunc((event.clientY - rect.top) * scaleY);

        this.minPoint = { x: Math.min(this.minPoint.x, x), y: Math.min(this.minPoint.y, y) };
        this.maxPoint = { x: Math.max(this.maxPoint.x, x), y: Math.max(this.maxPoint.y, y) };

        return { x, y };

    }

    getImageCoordinates(event: MouseEvent | WheelEvent): Point2D {
        const rect = this.ctx.canvas.getBoundingClientRect();
        const scaleX = this.ctx.canvas.width / rect.width;
        const scaleY = this.ctx.canvas.height / rect.height;

        const x = (event.clientX - rect.left) * scaleX;
        const y = (event.clientY - rect.top) * scaleY;

        const imageX = (x - this.offset.x) / this.scale;
        const imageY = (y - this.offset.y) / this.scale;

        return { x: Math.trunc(imageX), y: Math.trunc(imageY) };
    }

    fromCanvasToImageCoordinates(point: Point2D): Point2D {
        const imageX = (point.x - this.offset.x) / this.scale;
        const imageY = (point.y - this.offset.y) / this.scale;
        return { x: Math.trunc(imageX), y: Math.trunc(imageY) };
    }
    

}