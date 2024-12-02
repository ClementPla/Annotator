import { Component } from '@angular/core';
import { ToolbarModule } from 'primeng/toolbar';
import { ButtonModule } from 'primeng/button';
import { SelectButtonModule } from 'primeng/selectbutton';
import { Tools } from '../../../../Core/canvases/tools';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DrawingService } from '../../../../Services/UI/drawing.service';
import { SliderModule } from 'primeng/slider';
import { InputSwitchModule } from 'primeng/inputswitch';
import { LabelledSwitchComponent } from "../../../Core/labelled-switch/labelled-switch.component";

@Component({
  selector: 'app-toolbar',
  standalone: true,
  imports: [ToolbarModule, ButtonModule, SelectButtonModule, CommonModule, FormsModule, SliderModule, InputSwitchModule, LabelledSwitchComponent],
  templateUrl: './toolbar.component.html',
  styleUrl: './toolbar.component.scss'
})
export class ToolbarComponent {

  tools = Tools.ALL_TOOLS;
  

  constructor(public drawService: DrawingService) { }

  
}
