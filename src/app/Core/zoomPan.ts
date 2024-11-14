
export abstract class ImageZoomPan {
    public canZoom = true;
    public canPan = true;

    protected scale = 1;
    protected offsetX = 0;
    protected offsetY = 0;
    protected maxScale = 3;
    protected minScale = 0.75;

    protected isDragging = false;

    protected targetScale = 1;
    protected targetOffsetX = 0;
    protected targetOffsetY = 0;


    protected ctx: CanvasRenderingContext2D;


    startDrag(event: MouseEvent) {
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

            this.targetOffsetX += dx;
            this.targetOffsetY += dy;

            this.smoothUpdateTransform();
        }
    }

    endDrag() {
        this.isDragging = false;
    }

    zoom(event: WheelEvent) {
        if (!this.canZoom) {
            return;
        }
        event.preventDefault();
        const zoomIntensity = 0.25;
        const wheel = event.deltaY < 0 ? 1 : -1;
        const zoom = Math.exp(wheel * zoomIntensity);

        const rect = this.ctx.canvas.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;

        const canvasX = mouseX * (this.ctx.canvas.width / rect.width);
        const canvasY = mouseY * (this.ctx.canvas.height / rect.height);

        const imageX = (canvasX - this.offsetX) / this.scale;
        const imageY = (canvasY - this.offsetY) / this.scale;

        this.targetScale *= zoom;
        this.targetScale = Math.min(this.targetScale, this.maxScale);
        this.targetScale = Math.max(this.targetScale, this.minScale);
        this.targetOffsetX = canvasX - imageX * this.targetScale;
        this.targetOffsetY = canvasY - imageY * this.targetScale;

        this.smoothUpdateTransform();
    }

    resetZoomAndPan(smooth: boolean = true, redraw: boolean = true) {
        this.targetScale = 1;
        this.targetOffsetX = 0;
        this.targetOffsetY = 0;
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
        const newOffsetX = this.offsetX + (this.targetOffsetX - this.offsetX) * easeFactor;
        const newOffsetY = this.offsetY + (this.targetOffsetY - this.offsetY) * easeFactor;

        if (
            Math.abs(this.targetScale - newScale) > 0.01 ||
            Math.abs(this.targetOffsetX - newOffsetX) > 0.01 ||
            Math.abs(this.targetOffsetY - newOffsetY) > 0.01
        ) {
            this.scale = newScale;
            this.offsetX = newOffsetX;
            this.offsetY = newOffsetY;
            requestAnimationFrame(() => {
                this.smoothUpdateTransform();
                this.redrawAllCanvas();
            });
        }
    }

    abstract redrawAllCanvas(): void;

    getTransform() {
        return { scale: this.targetScale, offsetX: this.targetOffsetX, offsetY: this.targetOffsetY }
    }

    resetTransform(scale: number, offsetX: number, offsetY: number, smooth: boolean = true) {
        this.targetScale = scale;
        this.targetOffsetX = offsetX;
        this.targetOffsetY = offsetY;
        if (smooth) {
            this.smoothUpdateTransform();
        }
        else {
            this.redrawAllCanvas();
        }
    }

}