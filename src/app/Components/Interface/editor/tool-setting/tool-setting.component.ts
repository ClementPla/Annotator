import { Component } from '@angular/core';
import { PanelModule } from 'primeng/panel';
import { NgIf } from '@angular/common';
import { InputSwitchModule } from 'primeng/inputswitch';
import { DrawingService } from '../../../../Services/UI/drawing.service';
import { FormsModule } from '@angular/forms';
import { CardModule } from 'primeng/card';
import { LabelledSwitchComponent } from "../../../Core/labelled-switch/labelled-switch.component";
import { FieldsetModule } from 'primeng/fieldset';


@Component({
  selector: 'app-tool-setting',
  standalone: true,
  imports: [PanelModule, NgIf, InputSwitchModule, FormsModule, CardModule, LabelledSwitchComponent, FieldsetModule],
  templateUrl: './tool-setting.component.html',
  styleUrl: './tool-setting.component.scss'
})
export class ToolSettingComponent {
  constructor(public drawService: DrawingService) { }

}
