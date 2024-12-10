import { Injectable } from '@angular/core';
import { NgxOpenCVService, OpenCVState } from 'ngx-opencv';
import { from_hex_to_rgb } from '../Core/misc/colors';

declare var cv: any;



@Injectable({
  providedIn: 'root'
})
export class OpenCVService {
  cv_ready: boolean = false;
  constructor(private ngxOpenCv: NgxOpenCVService) {
    this.ngxOpenCv.cvState.subscribe((cvState: OpenCVState) => {
      // do something with the state string
      if (cvState.error) {
        console.error('Error loading OpenCV:', cvState.error);
      }
      else if (cvState.loading) {
        this.cv_ready = false;
      } else if (cvState.ready) {
        this.cv_ready = true;
      }
    });
  }

  morphoGradient(canvas: HTMLCanvasElement | OffscreenCanvas, color: string): OffscreenCanvas | HTMLCanvasElement {

    let tmp_canvas = document.createElement('canvas');
    tmp_canvas.width = canvas.width;
    tmp_canvas.height = canvas.height;
    tmp_canvas.getContext('2d', { alpha: true, willReadFrequently: false })!.drawImage(canvas, 0, 0);

    let src = cv.imread(tmp_canvas);


    // We convert the image to grayscale

    let gray = new cv.Mat();

    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY, 0);



    // We apply the morphological gradient to the image

    let kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(9, 9));
    let grad = new cv.Mat();
    cv.morphologyEx(gray, grad, cv.MORPH_GRADIENT, kernel);


    // We convert the image to color

    cv.cvtColor(grad, src, cv.COLOR_GRAY2RGBA, 0);



    cv.imshow(tmp_canvas, src);

    kernel.delete(); // We delete the kernel to free memory
    gray.delete(); // We delete the gray image to free memory
    grad.delete(); // We delete the gradient image to free memory
    src.delete(); // We delete the source image to free memory

    return tmp_canvas;
  }

  to_grayscale(input: HTMLCanvasElement, output: HTMLCanvasElement): HTMLCanvasElement {
    let src = cv.imread(input);

    cv.cvtColor(src, src, cv.COLOR_RGBA2GRAY, 0);
    cv.cvtColor(src, src, cv.COLOR_GRAY2RGBA, 0);
    cv.imshow(output, src);
    src.delete();
    return output;
  }

  brightness_contrast(input: HTMLCanvasElement, output: HTMLCanvasElement, contrast: number, brightness: number): HTMLCanvasElement {
    let src = cv.imread(input);
    cv.convertScaleAbs(src, src, contrast, brightness);
    cv.imshow(output, src);
    src.delete();
    return output;
  }

  median_blur(input: HTMLCanvasElement, output: HTMLCanvasElement, kernel_size: number): HTMLCanvasElement {
    let src = cv.imread(input);
    cv.medianBlur(src, src, kernel_size);
    cv.imshow(output, src);
    src.delete();
    return output;
  }

  stretchHist(input: HTMLCanvasElement, output: HTMLCanvasElement): HTMLCanvasElement {

    let image = cv.imread(input);
    cv.cvtColor(image, image, cv.COLOR_RGBA2RGB, 0);

    let srcVec = new cv.MatVector();
    srcVec.push_back(image);

    let accumulate = false;
    let histSize = [256];
    let ranges = [0, 255];
    let rhist = new cv.Mat();
    let ghist = new cv.Mat();
    let bhist = new cv.Mat();
    let mask = new cv.Mat();
    cv.calcHist(srcVec, [0], mask, rhist, histSize, ranges, accumulate);
    cv.calcHist(srcVec, [1], mask, ghist, histSize, ranges, accumulate);
    cv.calcHist(srcVec, [2], mask, bhist, histSize, ranges, accumulate);
    let total = new cv.Mat(rhist.rows, rhist.cols, cv.CV_32F, new cv.Scalar(image.rows * image.cols));
    let rnorm_hist = new cv.Mat(rhist.rows, rhist.cols, cv.CV_32F);
    let bnorm_hist = new cv.Mat(rhist.rows, rhist.cols, cv.CV_32F);
    let gnorm_hist = new cv.Mat(rhist.rows, rhist.cols, cv.CV_32F);

    cv.divide(rhist, total, rnorm_hist);
    cv.divide(bhist, total, bnorm_hist);
    cv.divide(ghist, total, gnorm_hist);

    rhist.delete();
    bhist.delete();
    ghist.delete();
    total.delete();
    srcVec.delete();

    let r_cdf = new Array(256).fill(0)
    let g_cdf = new Array(256).fill(0)
    let b_cdf = new Array(256).fill(0)
    for (let i = 0; i < 256; i++) {
      if (i == 0) {
        r_cdf[i] = rnorm_hist.data32F[i]
        g_cdf[i] = gnorm_hist.data32F[i]
        b_cdf[i] = bnorm_hist.data32F[i]
      }
      else {
        r_cdf[i] = rnorm_hist.data32F[i] + r_cdf[i - 1]
        g_cdf[i] = gnorm_hist.data32F[i] + g_cdf[i - 1]
        b_cdf[i] = bnorm_hist.data32F[i] + b_cdf[i - 1]
      }

    }
    let percent = 2 / 100;
    let rmin = -1, rmax = -1, gmin = -1, gmax = -1, bmin = -1, bmax = -1;
    for (let i = 0; i < 256; i++) {
      if (r_cdf[i] > percent && rmin == -1) {
        rmin = i;
      }
      if (g_cdf[i] > percent && gmin == -1) {
        gmin = i;
      }
      if (b_cdf[i] > percent && bmin == -1) {
        bmin = i;
      }
      if (r_cdf[i] > 1 - percent && rmax == -1) {
        rmax = i;
      }
      if (g_cdf[i] > 1 - percent && gmax == -1) {
        gmax = i;
      }
      if (b_cdf[i] > 1 - percent && bmax == -1) {
        bmax = i;
      }
    }

    let vec = new cv.MatVector();
    image.convertTo(image, cv.CV_32F, 1, 0);
    cv.split(image, vec);

    vec.get(0).convertTo(vec.get(0), cv.CV_32F, 1 / (rmax - rmin), -rmin / (rmax - rmin));
    vec.get(1).convertTo(vec.get(1), cv.CV_32F, 1 / (gmax - gmin), -gmin / (gmax - gmin));
    vec.get(2).convertTo(vec.get(2), cv.CV_32F, 1 / (bmax - bmin), -bmin / (bmax - bmin));

    cv.merge(vec, image);
    vec.delete();
    rnorm_hist.delete();
    gnorm_hist.delete();
    bnorm_hist.delete();
    cv.convertScaleAbs(image, image, 255)

    cv.imshow(output, image);
    image.delete();
    return output;

  }


  reinforceEdges(input: HTMLCanvasElement, output: HTMLCanvasElement, strengh: number): HTMLCanvasElement {

    // Compute the gaussian blur of the image
    // Compute the difference between the original image and the gaussian blur


    let src = cv.imread(input);
    let dst = new cv.Mat();

    cv.GaussianBlur(src, dst, new cv.Size(0, 0), 10);

    cv.addWeighted(src, 1 + strengh, dst, -strengh, 0, src);

    cv.convertScaleAbs(src, src, 1, 0);

    cv.imshow(output, src);
    src.delete();
    dst.delete();




    return output;

  }

  gammaCorrection(input: HTMLCanvasElement, output: HTMLCanvasElement, gamma: number): HTMLCanvasElement {
    // Create matrices from input and output canvases
    let src = cv.imread(input);
    let dst = new cv.Mat();

    // Convert source image to floating point for precise calculations
    src.convertTo(dst, cv.CV_32F);

    // Normalize the image to 0-1 range
    cv.normalize(dst, dst, 0, 1, cv.NORM_MINMAX);

    // Apply gamma correction
    // Formula: output = input^(1/gamma)
    let gamma_inv = 1.0 / gamma;

    // Create a temporary matrix to store results
    let corrected = new cv.Mat();

    // Perform gamma correction
    cv.pow(dst, gamma_inv, corrected);

    // Scale back to 0-255 range
    corrected.convertTo(corrected, cv.CV_8U, 255.0);

    // Write the result to the output canvas
    cv.imshow(output, corrected);

    // Free memory
    src.delete();
    dst.delete();
    corrected.delete();

    return output;
  }

  binarizeCanvas(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, color: string) {
    // Get the canvas context and image data
    const rgb = from_hex_to_rgb(color); // Convert hex color to RGB
    const imgData = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);

    // Convert the image data to OpenCV format
    const src = cv.matFromImageData(imgData);
    const gray = new cv.Mat();
    const binary = new cv.Mat();

    // Convert to grayscale
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    // Apply binary thresholding to remove anti-aliasing
    cv.threshold(gray, binary, 1, 255, cv.THRESH_BINARY);

    // Create an RGBA matrix for the foreground color
    const foreground = new cv.Mat(src.size(), src.type());
    foreground.setTo(new cv.Scalar(rgb[0], rgb[1], rgb[2], 255)); // Opaque foreground color

    // Create an output matrix
    const output = new cv.Mat();

    // Copy the foreground color to the output where the binary mask is 255
    foreground.copyTo(output, binary);

    // Convert the output to an image data format
    const processedImageData = new ImageData(new Uint8ClampedArray(output.data), ctx.canvas.width, ctx.canvas.height);
    ctx.putImageData(processedImageData, 0, 0);

    // Clean up
    src.delete();
    gray.delete();
    binary.delete();
    foreground.delete();
    output.delete();
  }
  binarizeMultiColorCanvas(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, labelColors: string[]) {
    // Get the canvas context and image data
    const imgData = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);

    // Convert the image data to OpenCV format
    const src = cv.matFromImageData(imgData);
    const rgba = new cv.Mat();
    const output = new cv.Mat.zeros(src.size(), src.type()); // Initialize output with transparent background

    // Loop through each label color
    for (const labelColor of labelColors) {

      const [r, g, b] = from_hex_to_rgb(labelColor)

      // Create a mask for the current label color
      const mask = new cv.Mat();
      const lowerBound = new cv.Mat(src.size(), src.type()); // Slight tolerance
      const upperBound = new cv.Mat(src.size(), src.type());

      lowerBound.setTo(new cv.Scalar(r - 1, g - 1, b - 1, 255))
      upperBound.setTo(new cv.Scalar(r + 1, g + 1, b + 1, 255))

      cv.inRange(src, lowerBound, upperBound, mask);

      // Remove anti-aliasing artifacts by thresholding the mask
      cv.threshold(mask, mask, 1, 255, cv.THRESH_BINARY);

      // Create a label matrix for the current color
      const label = new cv.Mat(src.size(), src.type());
      label.setTo(new cv.Scalar(r, g, b, 255))
      label.copyTo(output, mask); // Copy the label color where the mask is 255

      // Clean up temporary matrices
      mask.delete();
      lowerBound.delete();
      upperBound.delete();
      label.delete();
    }

    // Convert the output to an ImageData object
    const processedImageData = new ImageData(new Uint8ClampedArray(output.data), ctx.canvas.width, ctx.canvas.height);
    ctx.putImageData(processedImageData, 0, 0);

    // Clean up
    src.delete();
    rgba.delete();
    output.delete();
  }

}
