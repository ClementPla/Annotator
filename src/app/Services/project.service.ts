import { Injectable, output } from '@angular/core';

import { invoke } from '@tauri-apps/api/core';
import { environment } from '../../environments/environment';
import { from, map } from 'rxjs';
import { ViewService } from './view.service';

@Injectable({
  providedIn: 'root'
})
export class ProjectService {

  projectName: string = environment.defaultProjectName;
  outputFolder: string = environment.defaultOutputFolder;
  inputFolder: string = environment.defaultInputFolder;
  projectFolder: string = '';
  imagesName: string[] = [];

  constructor(private viewService: ViewService) { }



  async startProject(regex: string, recursive: boolean) {

    this.viewService.setLoading(true, 'Starting project...');
    this.projectFolder = this.outputFolder + '/' + this.projectName;

    // List promises:
    let fileList$ = invoke('list_files_in_folder', { folder: this.inputFolder, regexfilter: regex, recursive: recursive });


    fileList$.then((value: any) => {
      if (value) {
        this.extractImagesName(value);
        this.viewService.setLoading(true, 'Generating thumbnails...');
        this.generateThumbnails();
      }
    });

  }

  extractImagesName(files: string[]) {
    this.imagesName = files.map((file) => file.split('/').pop()!);
  }

  async generateThumbnails() {
    let thumbnails$ = invoke('create_thumbnails', {
      params: {
        image_names: Array.from(this.imagesName),
        input_folder: this.inputFolder,
        output_folder: this.projectFolder + '/thumbnails/',
        width: 64,
        height: 64,
      }
    });
    thumbnails$.then((value: any) => {
      this.viewService.endLoading();
    });

  }


}
