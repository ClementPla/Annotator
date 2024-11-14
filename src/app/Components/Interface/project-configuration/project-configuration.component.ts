import { Component, output } from '@angular/core';
import { DividerModule } from 'primeng/divider';
import { PanelModule } from 'primeng/panel';
import { FloatLabelModule } from 'primeng/floatlabel';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { NgClass } from '@angular/common';
import { InputSwitchModule } from 'primeng/inputswitch';
import { InputTextModule } from 'primeng/inputtext';
import { open } from '@tauri-apps/plugin-dialog';
import { FieldsetModule } from 'primeng/fieldset';
import { ButtonModule } from 'primeng/button';

import { ProjectService } from '../../../Services/project.service';
@Component({
  selector: 'app-project-configuration',
  standalone: true,
  imports: [CardModule, NgClass, DividerModule, ButtonModule, FloatLabelModule, FormsModule, PanelModule, InputSwitchModule, InputTextModule, FieldsetModule],
  templateUrl: './project-configuration.component.html',
  styleUrl: './project-configuration.component.scss'
})
export class ProjectConfigurationComponent {

  recursiveLoad: boolean = true;
  inputRegex: string = '.(gif|jpe?g|tiff?|png|webp|bmp)$';
  generateThumbnails: boolean = true;

  isInputValid: boolean = true;
  isOutputValid: boolean = true;
  isNameValid: boolean = true;
  constructor(public projectService: ProjectService) { }

  openInputFolder() {
    const file = open({ directory: true, });
    file.then((value) => {
      if (value) this.projectService.inputFolder = value;

    });
  }
  openOutputFolder() {
    const file = open({ directory: true, });
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

}
