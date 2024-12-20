import { ChangeDetectorRef, Injectable } from '@angular/core';
import { listen } from '@tauri-apps/api/event';
import { ProjectService } from './Project/project.service';
import { ProjectConfig, SegLabel } from '../Core/interface';
import { LabelsService } from './Project/labels.service';
import { getDefaultColor } from '../Core/misc/colors';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class CLIService {

  public commandProcessed: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
  
  constructor(
    private projectService: ProjectService,
    private labelService: LabelsService,
  ) {}

  createCLIHooks() {
    listen('create_project', (event) => {
      const config = event.payload as ProjectConfig;

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
      this.commandProcessed.next(true);
    });
  }
}
