import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  Host,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { DrawableCanvasComponent } from '../../Core/drawable-canvas/component/drawable-canvas.component';

import { ToolbarComponent } from './toolbar/toolbar.component';
import { LabelsComponent } from './labels/labels.component';
import { ProjectService } from '../../../Services/Project/project.service';
import { NgIf } from '@angular/common';
import { HostListener } from '@angular/core';
import { EditorService } from '../../../Services/UI/editor.service';
import { Tools } from '../../../Core/canvases/tools';
import { ToolSettingComponent } from './tool-setting/tool-setting.component';
import { LabelsService } from '../../../Services/Project/labels.service';
import { PanelModule } from 'primeng/panel';
import { ButtonModule } from 'primeng/button';
import { IOService } from '../../../Services/io.service';
import { Subscription } from 'rxjs';

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
  ],
  templateUrl: './editor.component.html',
  styleUrl: './editor.component.scss',
})
export class EditorComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild(DrawableCanvasComponent) canvas: DrawableCanvasComponent;
  public viewPortSize: number = 800;
  private subscriptions = new Subscription();

  
  constructor(
    public projectService: ProjectService,
    private drawService: EditorService,
    private labelService: LabelsService,
    public IOService: IOService
  ) {
    this.IOService.requestedReload.subscribe((value) => {
      if (value) {
        this.loadCanvas();
      }
    });
  }

  ngOnInit() {
    this.initializeSubscriptions()
  }
  ngAfterViewInit() {
    void this.loadCanvas();
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  private initializeSubscriptions(): void {
    this.subscriptions.add(
      this.IOService.requestedReload.subscribe({
        next: (shouldReload: boolean) => {
          if (shouldReload) {
            void this.loadCanvas();
          }
        },
        error: (error: Error) => {
          console.error('Reload subscription error:', error);
        }
      })
    );
  }

  public async loadCanvas(): Promise<void> {
    if (!this.canvas || !this.projectService.activeImage) {
      console.warn('Canvas or active image not available');
      return;
    }

    try {
      await this.canvas.loadImage(this.projectService.activeImage);
      const hasLoaded = await this.IOService.load();
      
      if (hasLoaded) {
        this.canvas.reload();
      } else {
        throw new Error('Failed to load canvas data');
      }
    } catch (error) {
      console.error('Error loading canvas:', error);
      // Handle error appropriately (e.g., show user feedback)
    }
  }

  initSize() {
    if (!this.canvas) {
      return;
    }
    let width = this.canvas.stateService.width;
    let height = this.canvas.stateService.height;
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
    e.preventDefault();
    this.labelService.switchVisibilityAllSegLabels();
    this.drawService.requestCanvasRedraw();
  }

  @HostListener('window:keydown.control.s', ['$event'])
  save() {
    return this.IOService.save();
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
