import { Component } from '@angular/core';
import { ProjectService } from '../../../Services/Project/project.service';
import { CommonModule } from '@angular/common';
import {DataViewModule} from 'primeng/dataview';


@Component({
  selector: 'app-list-images',
  standalone: true,
  imports: [DataViewModule, CommonModule],
  templateUrl: './list-images.component.html',
  styleUrl: './list-images.component.scss'
})
export class ListImagesComponent 
{

  constructor(
    public projectService: ProjectService,
  ) {}
}
