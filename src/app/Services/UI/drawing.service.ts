import { BehaviorSubject } from 'rxjs';
import { Injectable } from '@angular/core';
import { Tool, Tools } from '../../Core/canvases/tools';

@Injectable({
  providedIn: 'root'
})
export class DrawingService {

  public _lastTool: Tool;
  public autoPostProcess: boolean = false;
  public autoPostProcessOpening: boolean = false;
  public canvasClear: BehaviorSubject<number> = new BehaviorSubject<number>(-1);
  public canvasRedraw: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
  public canvasSumRefresh: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
  public edgesOnly: boolean = false;
  public enforceConnectivity: boolean = false;
  public eraseAll: boolean = false;
  public labelOpacity: number = 1;
  public lineWidth: number = 10;
  public morphoSize: number = 3;
  public redo: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
  public selectedTool: Tool = Tools.PEN;
  public swapMarkers: boolean = false;
  public undo: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
  public useInverse: boolean = false;
  public useProcessing: boolean = false;

  public postProcessOption: string = "otsu"

  public incrementAfterStroke: boolean = false;



  constructor() { }



  public activatePanMode() {
    this._lastTool = this.selectedTool;
    this.selectedTool = Tools.PAN;
  }

  public affectsMultipleLabels(): boolean {
    return this.eraseAll || this.swapMarkers;
  }

  public canPan(): boolean {
    return this.selectedTool === Tools.PAN;
  }

  public isDrawingTool(): boolean {
    return this.selectedTool === Tools.PEN || this.selectedTool === Tools.LASSO;
  }

  public isEraser(): boolean {
    return this.selectedTool === Tools.ERASER || this.selectedTool === Tools.LASSO_ERASER;
  }

  public isToolWithBrushSize(): boolean {
    return this.selectedTool === Tools.PEN || this.selectedTool === Tools.ERASER;
  }

  public needsRefreshCanvasSum(){
    this.canvasSumRefresh.next(true);
  }

  public requestCanvasClear(index: number = -1) {
    this.needsRefreshCanvasSum();
    this.canvasClear.next(index);
  }

  public requestCanvasRedraw() {
    this.needsRefreshCanvasSum();
    this.canvasRedraw.next(true);
  }

  public requestRedo() {
    this.needsRefreshCanvasSum();
    this.redo.next(true);
  }

  public requestUndo() {
    this.needsRefreshCanvasSum();
    this.undo.next(true);
  }

  public restoreLastTool() {
    this.selectedTool = this._lastTool;
  }

  // #endregion Public Methods (12)
}
