import { Injectable } from '@angular/core';
import { Tools, Tool } from '../../Core/canvases/tools';
import { BehaviorSubject } from 'rxjs';



@Injectable({
  providedIn: 'root'
})
export class DrawingService {


  selectedTool: Tool = Tools.LASSO;
  lineWidth: number = 100;
  swapMarkers: boolean = false; // if true, the markers under the cursor will be swapped with the active label
  eraseAll: boolean = false; // if true, erase all labels with erase. If false, erase only the active label

  autoPostProcess: boolean = false;
  autoPostProcessOpening: boolean = false;
  useInverse: boolean = false;

  enforceConnectivity: boolean = false;

  private _requestCanvasClear: BehaviorSubject<number> = new BehaviorSubject<number>(-1);
  private _requestCanvasRedraw: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);  
  private _requestUndo: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
  private _requestRedo: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
  public undo = this._requestUndo.asObservable();
  public redo = this._requestRedo.asObservable();
  public canvasRedraw = this._requestCanvasRedraw.asObservable();
  public canvasClear = this._requestCanvasClear.asObservable();

  _lastTool: Tool;
  constructor() { }

  canPan(): boolean {
    return this.selectedTool === Tools.PAN;
  }

  activatePanMode() {
    this._lastTool = this.selectedTool;
    this.selectedTool = Tools.PAN;
  }
  restoreLastTool() {
    this.selectedTool = this._lastTool;
  }

  requestUndo() {
    console.log('requesting undo');
    this._requestUndo.next(true);
  }
  requestRedo() {
    this._requestRedo.next(true);
  }

  requestCanvasRedraw() {
    this._requestCanvasRedraw.next(true);
  }
  requestCanvasClear(index: number = -1) {
    this._requestCanvasClear.next(index);
  }

  isDrawingTool(): boolean {
    return this.selectedTool === Tools.PEN || this.selectedTool === Tools.LASSO;
  }

  isEraser(): boolean {
    return this.selectedTool === Tools.ERASER || this.selectedTool === Tools.LASSO_ERASER;
  }

  isToolWithBrushSize(): boolean {
    return this.selectedTool === Tools.PEN || this.selectedTool === Tools.ERASER;
  }
}
