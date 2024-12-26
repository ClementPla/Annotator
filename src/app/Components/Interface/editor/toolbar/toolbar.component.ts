import { AfterViewInit, ChangeDetectorRef, Component } from '@angular/core';
import { ToolbarModule } from 'primeng/toolbar';
import { ButtonModule } from 'primeng/button';
import { SelectButtonModule } from 'primeng/selectbutton';
import { Tools } from '../../../../Core/canvases/tools';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EditorService } from '../../../../Services/UI/editor.service';
import { SliderModule } from 'primeng/slider';
import { InputSwitchModule } from 'primeng/inputswitch';
import { LabelledSwitchComponent } from "../../../Core/labelled-switch/labelled-switch.component";
import { BlockUIModule } from 'primeng/blockui';
@Component({
  selector: 'app-toolbar',
  standalone: true,
  imports: [ToolbarModule, ButtonModule, SelectButtonModule, BlockUIModule, CommonModule, FormsModule, SliderModule, InputSwitchModule, LabelledSwitchComponent],
  templateUrl: './toolbar.component.html',
  styleUrl: './toolbar.component.scss'
})
export class ToolbarComponent implements AfterViewInit{

  tools = Tools.ALL_TOOLS;
  

  constructor(public drawService: EditorService, private cdr: ChangeDetectorRef) { }

  ngAfterViewInit(): void {
    this.cdr.detectChanges()
      
  }

  
}
