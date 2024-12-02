import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CardModule } from 'primeng/card';
import { PanelModule } from 'primeng/panel';
      

import { ProjectService } from '../../../../Services/Project/project.service';


    

@Component({
  selector: 'app-gallery-element',
  standalone: true,
  imports: [CommonModule, CardModule, PanelModule],
  templateUrl: './gallery-element.component.html',
  styleUrl: './gallery-element.component.scss'
})
export class GalleryElementComponent {
  @Input() thumbnailPath$: Promise<string>;
  @Input() name$: Promise<string>;
  @Input() id: number;

  constructor(private projectService: ProjectService) {
  }

  openEditor(){
    this.projectService.openEditor(this.id);
  }

}
