import { AfterViewInit, Component, ElementRef, EventEmitter, Input, OnInit, Output, QueryList, ViewChild, ViewChildren } from '@angular/core';

import { CommonModule, NgOptimizedImage } from '@angular/common';
import { ImageZoomPan } from '../../../Core/zoomPan';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';
import { LabelCanvas } from '../../../Core/interface';

@Component({
  selector: 'app-drawable-canvas',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule, NgOptimizedImage, FormsModule],
  templateUrl: './drawable-canvas.component.html',
  styleUrl: './drawable-canvas.component.scss'
})
export class DrawableCanvasComponent extends ImageZoomPan implements OnInit, AfterViewInit {

  title = 'Annotator';
  @Input() pathImage: string | null = "assets/imgs/image_01.png";
  @Input() width: number = 256;
  @Input() height: number = 256;

  @Input() override canZoom: boolean = true;
  @Input() override canPan: boolean = true;
  @Input() labelsOpacity: number | null | undefined = null;

  @ViewChild('image') imageElement: ElementRef<HTMLImageElement>;
  @ViewChild('imageCanvas') imgCanvas: ElementRef<HTMLCanvasElement>;

  @ViewChild('labelCanvas') labelCanvas: ElementRef<HTMLCanvasElement>;

  @Output() panAndZommed = new EventEmitter<{ scale: number, offsetX: number, offsetY: number }>();

  private image: HTMLImageElement;
  isFullscreen: boolean = false;
  _srcImg: string = 'assets/imgs/image_01.png';
  displayLabel: boolean = true;
  isLoading: boolean = true;
  labelImage: HTMLImageElement;

  ctxLabel: CanvasRenderingContext2D;
  constructor() {
    super();
    this.labelImage = new Image();

  }
  ngOnInit(): void {
    this.loadImage();
    // this.addCanvasLabel();

  }
  ngAfterViewInit(): void {

    this.image = this.imageElement.nativeElement;
    this.ctx = this.imgCanvas.nativeElement.getContext('2d', { alpha: false })!;
    this.ctxLabel = this.labelCanvas.nativeElement.getContext('2d', { alpha: true })!;

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



      this.clearCanvas(this.ctx);
      this.ctx.save();
      this.ctx.translate(this.offsetX, this.offsetY);
      this.ctx.scale(this.scale, this.scale);
      this.ctx.drawImage(this.image, 0, 0, this.width, this.height);
      this.ctx.restore();


      this.ctxLabel.save();
      this.ctxLabel.translate(this.offsetX, this.offsetY);
      this.ctxLabel.scale(this.scale, this.scale);
      // this.ctxLabel.drawImage(this.image, 0, 0, this.width, this.height);
      this.ctxLabel.restore();


      this.isLoading = false;
      this.panAndZommed.emit({ scale: this.targetScale, offsetX: this.targetOffsetX, offsetY: this.targetOffsetY });
    });
  }

  clearCanvas(ctx: CanvasRenderingContext2D) {
    ctx.clearRect(0, 0, this.width, this.height);
  }

  loadImage() {
    this.isLoading = true;
    this._srcImg = this.pathImage!;
  }

  drawOnLoad() {
    this.width = this.image.naturalWidth;
    this.height = this.image.naturalHeight;
    this.imgCanvas.nativeElement.width = this.width;
    this.imgCanvas.nativeElement.height = this.height;
    this.labelCanvas.nativeElement.width = this.width;
    this.labelCanvas.nativeElement.height = this.height;
    this.labelImage.width = this.width;
    this.labelImage.height = this.height;


    requestAnimationFrame(() => {
      this.redrawAllCanvas();

      this.isLoading = false;

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
}
