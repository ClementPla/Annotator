import { Component } from '@angular/core';
import { PanelModule } from 'primeng/panel';
import { NgIf } from '@angular/common';
import { InputSwitchModule } from 'primeng/inputswitch';
import { DrawingService } from '../../../../Services/UI/drawing.service';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { LabelledSwitchComponent } from "../../../Core/labelled-switch/labelled-switch.component";
import { FieldsetModule } from 'primeng/fieldset';
import { SliderModule } from 'primeng/slider';
import { ProjectService } from '../../../../Services/Project/project.service';
import { ImageProcessingService } from '../../../../Services/image-processing.service';

@Component({
  selector: 'app-tool-setting',
  standalone: true,
  imports: [PanelModule, SliderModule, NgIf, InputSwitchModule, FormsModule, CardModule, LabelledSwitchComponent, FieldsetModule],
  templateUrl: './tool-setting.component.html',
  styleUrl: './tool-setting.component.scss'
})
export class ToolSettingComponent {
  constructor(public drawService: DrawingService, public projectService: ProjectService, 
    public imageProcess: ImageProcessingService) { }


}
