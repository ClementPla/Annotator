import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  HostListener,
  NgZone,
  OnInit,
} from '@angular/core';
import { ToolbarModule } from 'primeng/toolbar';
import { ViewService } from './Services/UI/view.service';
import { LoadingComponent } from './Components/Interface/loading/loading.component';
import { RouterOutlet } from '@angular/router';
import { NgIf } from '@angular/common';
import { ProjectService } from './Services/Project/project.service';
import { Button } from 'primeng/button';
import { RouterModule } from '@angular/router';
import { environment } from '../environments/environment';
import { LabelsService } from './Services/Project/labels.service';
import { EditorService } from './Services/UI/editor.service';
import { PrimeNGConfig } from 'primeng/api';
import { getDefaultColor } from './Core/misc/colors';
import { path } from '@tauri-apps/api';
import { CLIService } from './Services/cli.service';
import { IOService } from './Services/io.service';
import { ProjectConfig, ImageFromCLI, SegLabel } from './Core/interface';
@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    ToolbarModule,
    LoadingComponent,
    NgIf,
    RouterOutlet,
    Button,
    RouterModule,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent implements OnInit, AfterViewInit {
  title = 'Client';

  constructor(
    public viewService: ViewService,
    public projectService: ProjectService,
    public drawService: EditorService,
    private labelService: LabelsService,
    private primengConfig: PrimeNGConfig,
    private cli: CLIService,
    private cdr: ChangeDetectorRef,
    private IOService: IOService,
  ) {}


  ngOnInit(): void {
    this.primengConfig.ripple = true;
    this.cli.commandProcessed.subscribe((value) => {
      if (value) {
        this.cdr.detectChanges();
      }
    });
    this.cli.projectCreated.subscribe((config) => {
      if (config) {
        this.create_project(config);
      }
    });
    this.cli.imageLoaded.subscribe((imageConfig) => {
      if (imageConfig) {
        this.load_image(imageConfig);
      }
    });
  }

  ngAfterViewInit() {
    this.debug();
  }


  async debug() {
    this.labelService.addSegLabel({
      label: 'Foreground',
      color: '#209fb5',
      isVisible: true,
      shades: null,
    });
    this.labelService.addSegLabel({
      label: 'Example1/Class 1',
      color: '#df8e1d',
      isVisible: true,
      shades: null,
    });
    this.labelService.addSegLabel({
      label: 'Example1/Class 2',
      color: '#8839ef',
      isVisible: true,
      shades: null,
    });
    this.labelService.addSegLabel({
      label: 'Example2/Class 3',
      color: '#d20f39',
      isVisible: true,
      shades: null,
    });
    let isStarted$ = this.projectService.startProject();
    this.projectService.isSegmentation = true;
    isStarted$.then(() => {
      this.projectService.openEditor(0);
    });
  }
  create_project(config: ProjectConfig) {
    this.projectService.isClassification = config.is_classification;
    this.projectService.isInstanceSegmentation =
      config.is_instance_segmentation;
    this.projectService.projectName = config.project_name;
    this.projectService.inputFolder = config.input_dir;
    this.projectService.outputFolder = config.output_dir;

    if (config.segmentation_classes) {
      this.labelService.listSegmentationLabels =
        config.segmentation_classes.map((label, index) => {
          return {
            label,
            color: getDefaultColor(index + 1),
            isVisible: true,
            shades: null,
          } as SegLabel;
        });
    }
    this.labelService.rebuildTreeNodes();
    this.projectService.isSegmentation = config.is_segmentation;
  }
  async load_image(imageConfig: ImageFromCLI) {
    const file = imageConfig.image_path;

    // Start project and get resolved path
    await this.projectService.startProject();
    const resolvedFile = await path.resolve(file);

    // Find image index
    const filename = resolvedFile.split(this.projectService.inputFolder)[1];
    const index = this.projectService.imagesName.findIndex(
      (value) => value === filename
    );

    this.projectService.activeIndex = index;
    // Save masks
    await this.IOService.saveFromCLI(imageConfig);

    requestAnimationFrame(async () => {
      this.viewService.endLoading();
      this.cdr.detectChanges();
      // await this.projectService.openEditor(index);
    });
  }
}
