import { Injectable } from '@angular/core';
import { LabelFormat } from '../Core/io/formats';
import { ProjectService } from './Project/project.service';
import { path } from '@tauri-apps/api';
import { invoke } from '@tauri-apps/api/core';


@Injectable({
  providedIn: 'root'
})
export class IOService {

  constructor(private projectService: ProjectService) { }

  loadPrevious() { }

  loadNext() { }

  async save(labelFormat: LabelFormat, width: number, height: number) {

    let svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    svg.setAttribute('height', `${height}`);
    svg.setAttribute('width', `${width}`);

    const nElements = labelFormat.masks.length

    for (let i = 0; i < nElements; i++) {
      var svgMask = document.createElementNS('http://www.w3.org/2000/svg', 'image');

      let data = await blobToDataURL(labelFormat.masks[i]) // This is the blob, we need to convert it to a string to be able to use it in the href attribute
      svgMask.setAttribute('x', '0');
      svgMask.setAttribute('y', '0');
      svgMask.setAttribute('width', `${width}`);
      svgMask.setAttribute('height', `${height}`);
      svgMask.setAttribute('href', data);
      svgMask.setAttribute('id', labelFormat.masksName[i]);
      svgMask.setAttribute('color', labelFormat.colors[i]);
      svg.appendChild(svgMask);
    }

    const imageName = this.projectService.imagesName[this.projectService.activeIndex!]
    const imageNameWithoutExtension = imageName.split('.').slice(0, -1).join('.');
    const svgName = imageNameWithoutExtension + '.svg';

    path.join(this.projectService.projectFolder, 'annotations', svgName).then((filepath) => {
      invokeSaveXmlFile(filepath, svg.outerHTML);
    })




  }
}
async function invokeSaveXmlFile(filepath: string, xmlContent: string) {
  try {
    await invoke('save_xml_file', { filepath, xmlContent }).then((response) => {
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
