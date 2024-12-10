import { AfterViewInit, Component, OnInit, ViewChild } from '@angular/core';
import { DrawableCanvasComponent } from '../../Core/drawable-canvas/drawable-canvas.component';

import { ToolbarComponent } from './toolbar/toolbar.component';
import { LabelsComponent } from "./labels/labels.component";
import { ProjectService } from '../../../Services/Project/project.service';
import { NgIf } from '@angular/common';
import { HostListener } from '@angular/core';
import { DrawingService } from '../../../Services/UI/drawing.service';
import { Tools } from '../../../Core/canvases/tools';
import { ToolSettingComponent } from "./tool-setting/tool-setting.component";
import { LabelsService } from '../../../Services/Project/labels.service';
import { ViewService } from '../../../Services/UI/view.service';
import { PanelModule } from 'primeng/panel';
import { ButtonModule } from 'primeng/button';
import { IOService } from '../../../Services/io.service';
import { LabelFormat } from '../../../Core/io/formats';

@Component({
  selector: 'app-editor',
  standalone: true,
  imports: [DrawableCanvasComponent, ButtonModule, ToolbarComponent, LabelsComponent, NgIf, PanelModule, ToolSettingComponent],
  templateUrl: './editor.component.html',
  styleUrl: './editor.component.scss'
})
export class EditorComponent implements OnInit, AfterViewInit {

  @ViewChild(DrawableCanvasComponent) canvas: DrawableCanvasComponent;


  constructor(public projectService: ProjectService,
    private drawService: DrawingService,
    private labelService: LabelsService,
    public IOService: IOService,
    private viewService: ViewService) { }


  ngOnInit(): void {
    this.labelService.rebuildTreeNodes()

  }
  ngAfterViewInit(): void {
    this.canvas.loadImage(this.projectService.activeImage!);

  }
  @HostListener('window:keydown.control.z', ['$event'])
  undo(event: KeyboardEvent) {
    this.drawService.requestUndo();
  }
  @HostListener('window:keydown.control.y', ['$event'])
  redo(event: KeyboardEvent) {
    this.drawService.requestRedo();
  }

  @HostListener('window:keydown.e')
  changeToEraser() {
    this.drawService.selectedTool = Tools.ERASER;
  }
  @HostListener('window:keydown.l')
  changeToLasso() {
    this.drawService.selectedTool = Tools.LASSO;
  }

  @HostListener('window:keydown.shift.l')
  changeToLassoEraser() {
    this.drawService.selectedTool = Tools.LASSO_ERASER;
  }

  @HostListener('window:keydown.g')
  changeToPan() {
    this.drawService.selectedTool = Tools.PAN;
  }

  @HostListener('window:keydown.p')
  changeToPencil() {
    this.drawService.selectedTool = Tools.PEN;
  }

  @HostListener('window:keydown.tab', ['$event'])
  switchAllVisibility(e: KeyboardEvent) {
    this.labelService.switchVisibilityAllSegLabels();
    this.drawService.requestCanvasRedraw();


  }

  save() {
    let savefile = { masksName: [], masks: [], labels: [], colors: [] } as LabelFormat

    let allPromises$: Promise<void>[] = []
    this.labelService.listSegmentationLabels.forEach((label, index) => {

      savefile.masksName.push(label.label)
      let canvas = this.canvas.classesCanvas[index]

      let blob$ = canvas.convertToBlob({ type: 'image/png' })
      allPromises$.push(blob$.then((blob) => {
        savefile.masks.push(blob)
      }));
      savefile.colors.push(label.color)
    }
  )
    Promise.all(allPromises$).then(() => {
      this.IOService.save(savefile, this.canvas.width, this.canvas.height)
    })
    
  }
}


