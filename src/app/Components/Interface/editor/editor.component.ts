import {
  AfterViewInit,
  Component,
  Host,
  OnInit,
  ViewChild,
} from '@angular/core';
import { DrawableCanvasComponent } from '../../Core/drawable-canvas/drawable-canvas.component';

import { ToolbarComponent } from './toolbar/toolbar.component';
import { LabelsComponent } from './labels/labels.component';
import { ProjectService } from '../../../Services/Project/project.service';
import { NgIf, NgStyle } from '@angular/common';
import { HostListener } from '@angular/core';
import { DrawingService } from '../../../Services/UI/drawing.service';
import { Tools } from '../../../Core/canvases/tools';
import { ToolSettingComponent } from './tool-setting/tool-setting.component';
import { LabelsService } from '../../../Services/Project/labels.service';
import { ViewService } from '../../../Services/UI/view.service';
import { PanelModule } from 'primeng/panel';
import { ButtonModule } from 'primeng/button';
import { IOService } from '../../../Services/io.service';
import { LabelFormat } from '../../../Core/io/formats';

@Component({
  selector: 'app-editor',
  standalone: true,
  imports: [
    DrawableCanvasComponent,
    ButtonModule,
    ToolbarComponent,
    LabelsComponent,
    NgIf,
    PanelModule,
    ToolSettingComponent,
    NgStyle,
  ],
  templateUrl: './editor.component.html',
  styleUrl: './editor.component.scss',
})
export class EditorComponent implements OnInit, AfterViewInit {
  @ViewChild(DrawableCanvasComponent) canvas: DrawableCanvasComponent;
  public viewPortSize: number = 800;
  constructor(
    public projectService: ProjectService,
    private drawService: DrawingService,
    private labelService: LabelsService,
    public IOService: IOService,
    private viewService: ViewService
  ) {}

  ngOnInit(): void {}
  ngAfterViewInit() {
    this.loadCanvas();
  }

  loadCanvas() {
    this.viewService.setLoading(true, 'Loading image');
    this.IOService.load(this.canvas)

  }

  initSize() {
    let width = this.canvas.width;
    let height = this.canvas.height;
    this.viewPortSize = Math.min(width, height);
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

  @HostListener('window:keydown.control.s', ['$event'])
  async save() {
    return this.IOService.save(this.canvas);
  }

  @HostListener('window:keydown.ArrowRight', ['$event'])
  async loadNext() {
    this.save()
      .then((hasSaved) => {
        if (!hasSaved) {
          return Promise.reject('Could not save');
        }
        return this.projectService.goNext();
      })
      .then(() => {
        this.loadCanvas();
      });
  }

  @HostListener('window:keydown.ArrowLeft', ['$event'])
  async loadPrevious() {
    this.save()
      .then((hasSaved) => {
        if (!hasSaved) {
          return Promise.reject('Could not save');
        }
        return this.projectService.goPrevious();
      })
      .then(() => {
        this.loadCanvas();
      });
  }
}
