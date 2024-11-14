import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { DrawableCanvasComponent } from './Components/Core/drawable-canvas/drawable-canvas.component';

import { EditorComponent } from './Components/Interface/editor/editor.component';
import { ProjectConfigurationComponent } from "./Components/Interface/project-configuration/project-configuration.component";

import { ToolbarModule } from 'primeng/toolbar';
import { ViewService } from './Services/view.service';
import { LoadingComponent } from "./Components/Interface/loading/loading.component";

import { NgIf } from '@angular/common';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [ProjectConfigurationComponent, ToolbarModule, LoadingComponent, NgIf],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  title = 'Client';

  constructor(public viewService: ViewService) { }
}
