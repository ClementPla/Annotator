import { ApplicationConfig, ErrorHandler } from '@angular/core';
import { provideRouter } from '@angular/router';
import '@angular/compiler';

import { RouterModule } from '@angular/router';
import { routes } from './app.routes';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { MessageService } from 'primeng/api';

import { GlobalErrorHandler } from './Services/global-error-handler';
import { PROJECT_SCOPED } from './Core/project-scoped';

import { SequenceService } from './Services/sequence.service';
import { IOService } from './Services/io.service';
import { PyramidService } from './Services/pyramid.service';
import { LabelsService } from './Services/Labels/labels.service';
import { ClassificationService } from './Services/Labels/classification.service';
import { GalleryService } from './Components/pages/gallery/gallery.service';
import { RegistrationStateService } from './Components/pages/registration/registration-state.service';
import { CanvasManagerService } from './Components/pages/editor/drawable-canvas/service/canvas-manager.service';
import { StateManagerService } from './Components/pages/editor/drawable-canvas/service/state-manager.service';
import { VectorEditorService } from './Components/pages/editor/drawable-canvas/service/vector-editor.service';
import { UndoRedoService } from './Components/pages/editor/drawable-canvas/service/undo-redo.service';
import { BboxManagerService } from './Components/pages/editor/drawable-canvas/service/bbox-manager.service';
import { TiledImageService } from './Components/pages/editor/drawable-canvas/service/tiled-image.service';

RouterModule.forRoot(routes);

/**
 * Services holding state that belongs to one project, cleared whenever the open
 * project changes. See `Core/project-scoped.ts` for the contract.
 *
 * This list is the one place a new service can be forgotten. If something from
 * a previous project survives a switch, either its service is missing here or
 * its `resetForProject` does not go far enough.
 */
const projectScopedServices = [
  SequenceService,
  IOService,
  PyramidService,
  LabelsService,
  ClassificationService,
  GalleryService,
  RegistrationStateService,
  CanvasManagerService,
  StateManagerService,
  VectorEditorService,
  UndoRedoService,
  BboxManagerService,
  TiledImageService,
];

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideAnimationsAsync(),
    MessageService,
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
    ...projectScopedServices.map((useExisting) => ({
      provide: PROJECT_SCOPED,
      useExisting,
      multi: true,
    })),
  ],
};
