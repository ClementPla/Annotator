import { Injectable } from '@angular/core';
import { LabelFormat } from '../Core/io/formats';
import { ProjectService } from './Project/project.service';
import { path } from '@tauri-apps/api';
import { invoke } from '@tauri-apps/api/core';
import { DrawableCanvasComponent } from '../Components/Core/drawable-canvas/drawable-canvas.component';
import { LabelsService } from './Project/labels.service';
import { ViewService } from './UI/view.service';
import { ImageFromCLI } from '../Core/interface';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class IOService {
  public requestedReload: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);

  constructor(
    private projectService: ProjectService,
    private labelService: LabelsService,
    private viewService: ViewService
  ) {}

  loadPrevious() {}

  loadNext() {}

  requestReload() {
    this.requestedReload.next(true);
  }
  
  checkIfDataExists(): Promise<boolean> {
    return this.getActiveSavePath().then((filepath) => {
      return invoke<boolean>('check_file_exists', { filepath })
        .then((response) => {
          return response ? true : false;
        })
        .catch((error) => {
          return false;
        });
    });
  }


  loadExistingAnnotations(): Promise<LabelFormat> {
    return this.getActiveSavePath()
      .then((filepath: string) => {
        return invoke<string>('load_xml_file', { filepath });
      })
      .then((response: string) => {
        // This is where you would parse the XML file and load the annotations
        // Find the SVG element in the response
        const parser = new DOMParser();
        const doc = parser.parseFromString(response as string, 'image/svg+xml');
        let labels = {
          masksName: [],
          masks: [],
          labels: [],
          colors: [],
          shades: null,
        } as LabelFormat;
        let hasShades = false;
        // Get the image elements
        const imageElements = doc.getElementsByTagName('image');
        // Get the image data
        for (let i = 0; i < imageElements.length; i++) {
          const imageElement = imageElements[i];
          const href = imageElement.getAttribute('href') as string;
          const color = imageElement.getAttribute('color');
          const id = imageElement.getAttribute('id');
          if (imageElement.hasAttribute('shades')) {
            hasShades = true;
            if (!labels.shades) {
              labels.shades = [];
            }
            labels.shades.push(imageElement.getAttribute('shades')!.split(','));
          }
          labels.masksName.push(id!);
          labels.colors.push(color!);
          // Decode the data URL to get the blob

          labels.masks.push(href);
        }
        return labels;
      });
  }

  load(currentCanvas: DrawableCanvasComponent) {
    currentCanvas
      .loadImage(this.projectService.activeImage!)
      .then(() => {
        return this.checkIfDataExists();
      })
      .then((exists) => {
        if (exists) {
          return this.loadExistingAnnotations();
        }
        return null;
      })
      .then((data) => {
        if (!data) {
          return false;
        }

        data.masksName.forEach((label, index) => {
          let segLabel = {
            label: label,
            color: data.colors[index],
            isVisible: true,
            shades: data.shades ? data.shades[index] : null,
          };
          this.labelService.addSegLabel(segLabel);
        });
        this.labelService.rebuildTreeNodes();
        currentCanvas.builCanvasMask();
        this.labelService.activeLabel =
          this.labelService.listSegmentationLabels[0];

        currentCanvas.loadAllCanvas(data.masks as string[]);
        return true;
      })
      .then((hasLoaded) => {
        if (!hasLoaded){
          this.viewService.endLoading();
          return;
        }
        currentCanvas.reload();
        currentCanvas.resetZoomAndPan();
        currentCanvas.refreshColor();
        this.viewService.endLoading();
      });
  }

  save(currentCanvas: DrawableCanvasComponent) {
    this.viewService.setLoading(true, 'Saving annotations');
    let savefile = {
      masksName: [],
      masks: [],
      labels: [],
      colors: [],
      shades: null,
    } as LabelFormat;

    let allPromises$: Promise<void>[] = [];
    this.labelService.listSegmentationLabels.forEach((label, index) => {
      if (label.shades) {
        if (!savefile.shades) {
          savefile.shades = [];
        }
        savefile.shades.push(label.shades);
      }

      savefile.labels.push(label.label);
      savefile.masksName.push(label.label);
      let canvas = currentCanvas.classesCanvas[index];
      let blob$ = canvas
        .convertToBlob({ type: 'image/png' })
        .then((blob) => {
          return blobToDataURL(blob);
        })
        .then((blob) => {
          savefile.masks.push(blob);
        });
      allPromises$.push(blob$);
      savefile.colors.push(label.color);
    });

    let finished = Promise.all(allPromises$)
      .then(() => {
        this.writeSave(savefile, currentCanvas.width, currentCanvas.height);
      })
      .then(() => {
        this.viewService.endLoading();
        return true;
      });
    return finished;
  }

  saveFromCLI(data: ImageFromCLI){

    let savefile = {
      masksName: [],
      masks: [],
      labels: [],
      colors: [],
      shades: null,
    } as LabelFormat;

    this.labelService.listSegmentationLabels.forEach((label, index) => {
      if (label.shades) {
        if (!savefile.shades) {
          savefile.shades = [];
        }
        savefile.shades.push(label.shades);
      }

      savefile.labels.push(label.label);
      savefile.masksName.push(label.label);
      if(data.mask_data){
        savefile.masks.push(data.mask_data[index]);
      }
      savefile.colors.push(label.color);
    });

    return this.writeSave(savefile, 512, 512);
  }

  async writeSave(labelFormat: LabelFormat, width: number, height: number) {
    let svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    svg.setAttribute('height', `${height}`);
    svg.setAttribute('width', `${width}`);

    const nElements = labelFormat.masks.length;
    for (let i = 0; i < nElements; i++) {
      var svgMask = document.createElementNS(
        'http://www.w3.org/2000/svg',
        'image'
      );

      let maskValue = labelFormat.masks[i] as string; // This is the blob, we need to convert it to a string to be able to use it in the href attribute
      svgMask.setAttribute('x', '0');
      svgMask.setAttribute('y', '0');
      svgMask.setAttribute('width', `${width}`);
      svgMask.setAttribute('height', `${height}`);
      svgMask.setAttribute('href', maskValue);
      svgMask.setAttribute('id', labelFormat.masksName[i]);
      svgMask.setAttribute('color', labelFormat.colors[i]);
      if (labelFormat.shades) {
        svgMask.setAttribute('shades', labelFormat.shades[i].join(','));
      }
      svg.appendChild(svgMask);
    }
    return invokeSaveXmlFile(
      await this.getActiveSavePath(),
      new XMLSerializer().serializeToString(svg)
    );
  }

  async getActiveSavePath() {
    
    const imageName =
      this.projectService.imagesName[this.projectService.activeIndex!];

    const imageNameWithoutExtension = imageName
      .split('.')
      .slice(0, -1)
      .join('.');
    const svgName = imageNameWithoutExtension + '.svg';
    console.log('SVG name:', svgName);
    console.log('Project folder:', this.projectService.projectFolder);
    return path.join(this.projectService.projectFolder, 'annotations', svgName);
  }
}
function invokeSaveXmlFile(filepath: string, xmlContent: string) {
  console.log('Saving XML file:', filepath);
  try {
    invoke('save_xml_file', { filepath, xmlContent }).then((response) => {
      console.log('XML file saved successfully:', response);
    });
  } catch (error) {
    console.error('Error saving XML file:', error);
  }
}

function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
