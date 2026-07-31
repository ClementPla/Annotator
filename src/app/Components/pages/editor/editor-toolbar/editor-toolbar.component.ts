import { AfterViewInit, ChangeDetectorRef, Component } from '@angular/core';
import { ToolbarModule } from 'primeng/toolbar';
import { ButtonModule } from 'primeng/button';
import { SelectButtonModule } from 'primeng/selectbutton';
import { ALL_TOOLS, CONVERT_TOOLS, VECTOR_TOOLS } from '../../../../Core/tools';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EditorService } from '../services/editor.service';
import { ConvertService } from '../drawable-canvas/service/convert.service';
import { VectorEditorService } from '../drawable-canvas/service/vector-editor.service';
import { PredictionService } from '../../../../Services/prediction.service';
import { SliderModule } from 'primeng/slider';
import { ToggleSwitchModule } from 'primeng/toggleswitch';
import { BlockUIModule } from 'primeng/blockui';
import { PanelModule } from 'primeng/panel';
import { GenericsModule } from '../../../../generics/generics.module';
import { TooltipModule } from 'primeng/tooltip';

@Component({
    selector: 'app-editor-toolbar',
    imports: [
        ToolbarModule,
        ButtonModule,
        PanelModule,
        SelectButtonModule,
        BlockUIModule,
        CommonModule,
        FormsModule,
        SliderModule,
        ToggleSwitchModule,
        GenericsModule,
        TooltipModule,
    ],
    templateUrl: './editor-toolbar.component.html',
    styleUrl: './editor-toolbar.component.scss'
})
export class EditorToolbarComponent {
  tools = ALL_TOOLS;
  vectorTools = VECTOR_TOOLS;
  convertTools = CONVERT_TOOLS;

  // Brush-size slider bounds. The slider is logarithmic so small, commonly-used
  // sizes get most of the track; the number input still edits lineWidth directly.
  private readonly brushMin = 1;
  private readonly brushMax = 1024;
  private readonly brushSteps = 1000;

  constructor(
    public editorService: EditorService,
    public vectorEditor: VectorEditorService,
    public prediction: PredictionService,
    private convertService: ConvertService,
  ) {}

  /** Burn the selected shape (or the active label's shapes) into the masks. */
  rasterize(): void {
    this.convertService.rasterize();
  }

  /**
   * Run the trained head on this frame.
   *
   * @param useScribbles feed the current annotation in as conditioning.
   */
  predict(useScribbles: boolean): void {
    void this.prediction.predictCurrentFrame(useScribbles);
  }

  /**
   * Run the head and trace its output into editable paths instead of pixels.
   *
   * The model predicts a raster mask either way; this vectorises the result, so
   * it is a choice about what you get back rather than about how it was fitted.
   */
  predictAsVectors(useScribbles: boolean): void {
    void this.prediction.predictCurrentFrameAsVectors(useScribbles);
  }

  /**
   * Run the head and reduce its output to centerlines instead of outlines.
   *
   * Same prediction, different reading of it: for a curve-like structure the
   * outline is two nearly parallel boundaries, and the path down the middle is
   * the thing worth editing and measuring.
   */
  predictAsSkeletons(useScribbles: boolean): void {
    void this.prediction.predictCurrentFrameAsSkeletons(useScribbles);
  }

  /** Slider position [0, brushSteps] mapped logarithmically from lineWidth. */
  get brushSizeSlider(): number {
    const v = Math.min(this.brushMax, Math.max(this.brushMin, this.editorService.lineWidth));
    return Math.round(
      (this.brushSteps * Math.log(v / this.brushMin)) /
        Math.log(this.brushMax / this.brushMin)
    );
  }

  set brushSizeSlider(pos: number) {
    const v =
      this.brushMin *
      Math.pow(this.brushMax / this.brushMin, pos / this.brushSteps);
    this.editorService.lineWidth = Math.max(
      this.brushMin,
      Math.min(this.brushMax, Math.round(v))
    );
  }
}
