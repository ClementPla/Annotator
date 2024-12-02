import { Component, OnInit } from '@angular/core';
import { ProjectService } from '../../../Services/Project/project.service';
import { CommonModule } from '@angular/common';
import { Observable } from 'rxjs';
import { GalleryElementComponent } from './gallery-element/gallery-element.component';
import { PanelModule } from 'primeng/panel';

interface ThumbnailsLoaded {
  path: Observable<string>;
  name: Observable<string>;
}

@Component({
  selector: 'app-gallery',
  standalone: true,
  imports: [CommonModule, GalleryElementComponent, PanelModule],
  templateUrl: './gallery.component.html',
  styleUrl: './gallery.component.scss'
})
export class GalleryComponent implements OnInit {

  constructor(public projectService: ProjectService  ) {}


  ngOnInit(): void {
  }
}
