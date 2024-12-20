import { ChangeDetectorRef, Component, OnInit, output } from '@angular/core';
import { DividerModule } from 'primeng/divider';
import { PanelModule } from 'primeng/panel';
import { FloatLabelModule } from 'primeng/floatlabel';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { NgClass, NgIf, NgFor } from '@angular/common';
import { InputSwitchModule } from 'primeng/inputswitch';
import { InputTextModule } from 'primeng/inputtext';
import { open } from '@tauri-apps/plugin-dialog';
import { FieldsetModule } from 'primeng/fieldset';
import { ButtonModule } from 'primeng/button';
import { environment } from '../../../../environments/environment';
import { ProjectService } from '../../../Services/Project/project.service';
import { LabelsService } from '../../../Services/Project/labels.service';
import { LabelledSwitchComponent } from '../../Core/labelled-switch/labelled-switch.component';
import { getDefaultColor } from '../../../Core/misc/colors';
import { ColorPickerModule } from 'primeng/colorpicker';
import { CheckboxModule } from 'primeng/checkbox';
import { SegLabel } from '../../../Core/interface';
import { CLIService } from '../../../Services/cli.service';

@Component({
  selector: 'app-project-configuration',
  standalone: true,
  imports: [
    CardModule,
    NgClass,
    NgIf,
    NgFor,
    DividerModule,
    ColorPickerModule,
    CheckboxModule,
    ButtonModule,
    FloatLabelModule,
    FormsModule,
    PanelModule,
    InputSwitchModule,
    InputTextModule,
    FieldsetModule,
    LabelledSwitchComponent,
  ],
  templateUrl: './project-configuration.component.html',
  styleUrl: './project-configuration.component.scss',
})
export class ProjectConfigurationComponent implements OnInit {
  recursiveLoad: boolean = true;
  inputRegex: string = environment.defaultRegex;
  generateThumbnails: boolean = true;

  isInputValid: boolean = true;
  isOutputValid: boolean = true;
  isNameValid: boolean = true;
  constructor(
    public projectService: ProjectService,
    public labelService: LabelsService,
    private cli: CLIService,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.cli.commandProcessed.subscribe((value) => {
      if (value) {
        console.log('Command processed from Project Configuration');
        this.cdr.detectChanges();
      }
    });
  }

  openInputFolder() {
    const file = open({ directory: true });
    file.then((value) => {
      if (value) {
        if (value != this.projectService.inputFolder) {
          this.projectService.resetProject();
        }
        this.projectService.inputFolder = value;
      }
    });
  }
  openOutputFolder() {
    const file = open({ directory: true });
    file.then((value) => {
      if (value) this.projectService.outputFolder = value;
    });
  }

  startProject() {
    // Validate input
    this.isInputValid = this.projectService.inputFolder !== '';
    this.isOutputValid = this.projectService.outputFolder !== '';
    this.isNameValid = this.projectService.projectName !== '';
    if (this.isInputValid && this.isOutputValid) {
      this.projectService.startProject(this.inputRegex, this.recursiveLoad);
    }
  }

  addSegmentationClass() {
    let color = getDefaultColor(
      this.labelService.listSegmentationLabels.length + 1
    );
    this.labelService.addSegLabel({
      label: 'Class ' + this.labelService.listSegmentationLabels.length,
      color: color,
      isVisible: true,
      shades: null,
    });
    this.cdr.detectChanges();
  }
  deleteSegmentationClass(segLabel: SegLabel) {
    this.labelService.removeSegLabel(segLabel);
  }

  addClassificationClass() {
    this.labelService.addClassLabel({
      label: 'Class ' + this.labelService.listClassificationLabels.length,
      isExclusive: true,
    });
    this.cdr.detectChanges();
  }
}
