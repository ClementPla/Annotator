import { Component } from '@angular/core';
import { ProgressBarModule } from 'primeng/progressbar';
import { ViewService } from '../../../Services/view.service';
import { NgIf } from '@angular/common';

@Component({
  selector: 'app-loading',
  standalone: true,
  imports: [ProgressBarModule, NgIf],
  templateUrl: './loading.component.html',
  styleUrl: './loading.component.scss'
})
export class LoadingComponent {

  constructor(public viewService: ViewService) { }

}
