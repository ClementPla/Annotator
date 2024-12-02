import { Routes } from '@angular/router';
import { ProjectConfigurationComponent } from './Components/Interface/project-configuration/project-configuration.component';
import { GalleryComponent } from './Components/Interface/gallery/gallery.component';
import { projectStartedGuard } from './Guards/project-started.guard';
import { EditorComponent } from './Components/Interface/editor/editor.component';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'project-configuration',
    pathMatch: 'full'
  },
  {
    path: 'project-configuration',
    component: ProjectConfigurationComponent
  },
  {
    path: 'gallery',
    component: GalleryComponent,
    canActivate: [projectStartedGuard]
  },
  {
    path: 'editor',
    component: EditorComponent,
    canActivate: [projectStartedGuard]
  }
];