import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';


import { NgxOpenCVModule, OpenCVConfig } from 'ngx-opencv';

const openCVConfig: OpenCVConfig = {
  openCVDirPath: 'assets/opencv/',
};




bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));
