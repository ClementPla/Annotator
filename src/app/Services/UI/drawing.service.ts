import { Injectable } from '@angular/core';
import { Tools, Tool } from '../../Core/canvases/tools';
import { BehaviorSubject } from 'rxjs';



@Injectable({
  providedIn: 'root'
})
export class DrawingService {


  selectedTool: Tool = Tools.PEN;
  lineWidth: number = 10;
  swapMarkers: boolean = false; // if true, the markers under the cursor will be swapped with the active label
  eraseAll: boolean = false; // if true, erase all labels with erase. If false, erase only the active label

  morphoSize: number = 3;
  autoPostProcess: boolean = false;
  autoPostProcessOpening: boolean = false;
  useInverse: boolean = false;

  labelOpacity: number = 1;

  useProcessing: boolean = false;
  edgesOnly: boolean = false;

  enforceConnectivity: boolean = false;

  public canvasClear: BehaviorSubject<number> = new BehaviorSubject<number>(-1);
  public canvasRedraw: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);  
  public undo: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
  public redo: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
  public canvasSumRefresh: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);


  
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
    this.needsRefreshCanvasSum();
    this.undo.next(true);
  }
  requestRedo() {
    this.needsRefreshCanvasSum();
    this.redo.next(true);
  }

  requestCanvasRedraw() {
    this.needsRefreshCanvasSum();
    this.canvasRedraw.next(true);
  }
  requestCanvasClear(index: number = -1) {
    this.needsRefreshCanvasSum();
    this.canvasClear.next(index);
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

  needsRefreshCanvasSum(){
    this.canvasSumRefresh.next(true);

  }
}
