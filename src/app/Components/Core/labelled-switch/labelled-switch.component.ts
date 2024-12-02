import { Component, Input, Output } from '@angular/core';
import { InputSwitchModule } from 'primeng/inputswitch';
import { FormsModule } from '@angular/forms';
import { EventEmitter } from '@angular/core';

@Component({
  selector: 'app-labelled-switch',
  standalone: true,
  imports: [InputSwitchModule, FormsModule],
  templateUrl: './labelled-switch.component.html',
  styleUrl: './labelled-switch.component.scss'
})
export class LabelledSwitchComponent {

  @Input() checked: boolean;
  @Output() checkedChange = new EventEmitter<boolean>();

  updateCheck(){
    this.checkedChange.emit(this.checked);
  }
}
