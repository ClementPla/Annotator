import { Injectable } from '@angular/core';

import { invoke } from '@tauri-apps/api/core';
import { environment } from '../../../environments/environment';
import { ViewService } from '../UI/view.service';

import { path } from '@tauri-apps/api';
import { Thumbnail } from '../../Core/interface';

import { loadImageFile } from '../../Core/io/images';


@Injectable({
  providedIn: 'root',
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

  maxInstances: number = 100;

  constructor(private viewService: ViewService) {}

  async startProject(regex: string, recursive: boolean): Promise<void> {
    this.viewService.setLoading(true, 'Starting project...');
    this.inputFolder = await path.resolve(this.inputFolder);
    console.log(this.inputFolder);
    let sep = path.sep();
    if (!this.inputFolder.endsWith(sep)) {
      this.inputFolder = this.inputFolder + sep;
    }
    // const folderExists = await exists(this.inputFolder).then((value) => { return true }).catch((err) => {
    //   this.viewService.setLoading(false, 'Input folder does not exist.');
    //   setTimeout(() => { this.viewService.endLoading(); }, 2000);
    //   console.log(err)
    //   return false;

    // });
    // if(!folderExists){
    //   return;
    // }

    this.outputFolder = await path.resolve(this.outputFolder);
    this.projectFolder = await path.join(this.outputFolder, this.projectName);

    let fileList$ = invoke('list_files_in_folder', {
      folder: this.inputFolder,
      regexfilter: regex,
      recursive: recursive,
    });
    let isStarted$ = fileList$
      .then((value: any) => {
        if (value) {
          this.viewService.setLoading(
            true,
            value.length + ' images found. Generating thumbnails...'
          );
          this.extractImagesName(value);
          this.generateThumbnails();
        }
      })
      .then(() => {
        this.isProjectStarted = true;
      });

    return isStarted$;
  }
  extractImagesName(files: string[]) {
    this.imagesName = files.map((file) => {
      let filename = file.split(this.inputFolder)[1];
      console.log(filename);
      return filename;
    });
  }

  async generateThumbnails() {
    let output_folder = await path.join(this.projectFolder, 'thumbnails');
    let thumbnails$ = invoke<boolean[] | null>('create_thumbnails', {
      params: {
        image_names: this.imagesName,
        input_folder: this.inputFolder,
        output_folder: output_folder,
        width: this.viewService.thumbnailsSize,
        height: this.viewService.thumbnailsSize,
      },
    });
    this.thumbnails$ = thumbnails$.then(() => {
      this.viewService.endLoading();
      this.viewService.navigateToGallery();

      return Promise.all(
        this.imagesName.map(async (image, index) => {
          return {
            thumbnailPath: loadImageFile(await path.join(output_folder, image)),
            name: path.basename(image),
          };
        })
      );
    });
  }

  async openEditor(index: number) {
    this.viewService.setLoading(true, 'Loading editor');
    this.activeIndex = index;
    this.activeImage = loadImageFile(
      await path.join(this.inputFolder, this.imagesName[index])
    ).then((value) => {
      this.viewService.navigateToEditor();
      return value;
    });
    return this.activeImage;
  }

  async goNext() {
    if (
      this.activeIndex != null &&
      this.activeIndex < this.imagesName.length - 1
    ) {
      return this.openEditor(this.activeIndex + 1);
    }
    return Promise.resolve('No more images');
    
  }

  async goPrevious() {
    if (this.activeIndex != null && this.activeIndex > 0) {
      return this.openEditor(this.activeIndex - 1);
    }
    return Promise.resolve('No more images');
    
  }
  resetProject() {
    this.isProjectStarted = false;
    this.imagesName = [];
    this.activeIndex = null;
    this.activeImage = null;
  }
}
