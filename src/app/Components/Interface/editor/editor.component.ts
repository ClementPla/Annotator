import { Component, ElementRef, ViewChild } from '@angular/core';
import { DrawableCanvasComponent } from '../../Core/drawable-canvas/drawable-canvas.component';
import { MatToolbarModule } from '@angular/material/toolbar';
import { ListImagesComponent } from '../list-images/list-images.component';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIcon } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatButton } from '@angular/material/button';
import { BiomarkersListComponent } from "../biomarkers-list/biomarkers-list.component";
import { invoke } from '@tauri-apps/api/core'

import { open } from '@tauri-apps/plugin-dialog';


@Component({
  selector: 'app-editor',
  standalone: true,
  imports: [DrawableCanvasComponent, ListImagesComponent, MatToolbarModule, MatIcon, MatFormFieldModule, MatInputModule, MatButton, BiomarkersListComponent],
  templateUrl: './editor.component.html',
  styleUrl: './editor.component.scss'
})
export class EditorComponent {

  @ViewChild('fileInput', { static: false }) fileInput: ElementRef;


  selectedFile: any = null;

  onFileSelected(event: any): void {

    console.log(event);
    this.selectedFile = event.target.files[0] ?? null;

  }

  openLoading() {

    const file = open({ directory: true, });
    file.then((value) => {
      invoke('list_files_in_folder', { folder: value }).then((value: any) => {
        console.log(value);
      });
    });
  }

}



