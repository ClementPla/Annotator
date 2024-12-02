import { AfterViewInit, Component, OnInit, ViewChild } from '@angular/core';
import { DrawableCanvasComponent } from '../../Core/drawable-canvas/drawable-canvas.component';
import { ListImagesComponent } from '../list-images/list-images.component';

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

@Component({
  selector: 'app-editor',
  standalone: true,
  imports: [DrawableCanvasComponent, ListImagesComponent, ToolbarComponent, LabelsComponent, NgIf, ToolSettingComponent],
  templateUrl: './editor.component.html',
  styleUrl: './editor.component.scss'
})
export class EditorComponent implements OnInit, AfterViewInit {

  @ViewChild(DrawableCanvasComponent) canvas: DrawableCanvasComponent;

  constructor(public projectService: ProjectService, 
    private drawService: DrawingService, 
    private labelService: LabelsService, 
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
}


