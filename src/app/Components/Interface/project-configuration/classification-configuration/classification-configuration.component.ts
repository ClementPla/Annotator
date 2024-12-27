import { Component } from '@angular/core';
import { LabelsService } from '../../../../Services/Project/labels.service';
import { FormsModule } from '@angular/forms';
import { CheckboxModule } from 'primeng/checkbox';
import { ButtonModule } from 'primeng/button';
import { NgFor } from '@angular/common';

@Component({
  selector: 'app-classification-configuration',
  standalone: true,
  imports: [FormsModule, ButtonModule, CheckboxModule, NgFor],
  templateUrl: './classification-configuration.component.html',
  styleUrl: './classification-configuration.component.scss'
})
export class ClassificationConfigurationComponent {

  constructor(public labelService: LabelsService) { }

  addMulticlassTask(){
  }

  addMultiLabelTask(){

  }

}
