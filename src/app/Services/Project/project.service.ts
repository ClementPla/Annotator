import { Injectable, output } from '@angular/core';

import { invoke } from '@tauri-apps/api/core';
import { environment } from '../../../environments/environment';
import { ViewService } from '../UI/view.service';

import { path } from '@tauri-apps/api';
import { Thumbnail } from '../../Core/interface';

import { loadImageFile } from '../../Core/io/images';

@Injectable({
  providedIn: 'root'
})
export class ProjectService {


  isClassification: boolean = false;
  isSegmentation: boolean = false;
  isInstanceSegmentation: boolean = false;
  isBoundingBoxDetection: boolean = false;

  isProjectStarted: boolean = false;
  projectName: string = environment.defaultProjectName;
  outputFolder: string = environment.defaultOutputFolder;
  inputFolder: string = environment.defaultInputFolder;

  projectFolder: string = '';
  imagesName: string[] = [];

  thumbnails$: Promise<Array<Thumbnail>>;

  activeIndex: number | null = null;
  activeImage: Promise<string> | null = null;

  constructor(private viewService: ViewService) { }



  async startProject(regex: string, recursive: boolean): Promise<void> {

    this.viewService.setLoading(true, 'Starting project...');
    this.projectFolder = await path.join(this.outputFolder, this.projectName);
    // List promises:
    let fileList$ = invoke('list_files_in_folder', { folder: this.inputFolder, regexfilter: regex, recursive: recursive });
    let isStarted$ = fileList$.then((value: any) => {
      if (value) {
        this.viewService.setLoading(true, this.imagesName.length + ' images found. Generating thumbnails...');
        this.extractImagesName(value);
        this.generateThumbnails();
      }
    })
      .then(() => {
        this.isProjectStarted = true;
      })
      .then(() => {
        this.viewService.endLoading();
        this.viewService.navigateToGallery();
      });


    return isStarted$;

  }
  extractImagesName(files: string[]) {

    this.imagesName = files.map(

      (file) => {
        let filename = file.split(this.inputFolder)[1];

        return filename;
      }
    );
  }

  async generateThumbnails() {
    let thumbnails$ = invoke<boolean[] | null>('create_thumbnails', {
      params: {
        image_names: this.imagesName,
        input_folder: this.inputFolder,
        output_folder: await path.join(this.projectFolder, 'thumbnails'),
        width: this.viewService.thumbnailsSize,
        height: this.viewService.thumbnailsSize,
      }
    });
    this.thumbnails$ = thumbnails$.then(() => {
          return Promise.all(this.imagesName.map(async (image, index) => {
            return { 
              thumbnailPath: loadImageFile(await path.join(this.projectFolder, 'thumbnails', image)),
              name: path.basename(image) };
          }));
        })
  }

  async openEditor(index: number) {
    this.viewService.setLoading(true, 'Loading editor');
    this.activeIndex = index;
    this.activeImage =
     loadImageFile(await path.join(this.inputFolder, this.imagesName[index])).then((value) => {
      this.viewService.navigateToEditor();
    
      return value;
    });
  }



}

