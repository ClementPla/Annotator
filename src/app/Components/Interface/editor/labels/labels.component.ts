import { Component, OnInit } from '@angular/core';
import { LabelsService } from '../../../../Services/Project/labels.service';
import { TreeModule } from 'primeng/tree';
import { ColorPickerModule } from 'primeng/colorpicker';
import { CommonModule } from '@angular/common';

import { FormsModule } from '@angular/forms';
import { TreeNode } from 'primeng/api';
import { Button } from 'primeng/button';
import { SegLabel } from '../../../../Core/interface';
import { DrawingService } from '../../../../Services/UI/drawing.service';
import { PanelModule } from 'primeng/panel';
import { FieldsetModule } from 'primeng/fieldset';



@Component({
  selector: 'app-labels',
  standalone: true,
  imports: [TreeModule, ColorPickerModule, CommonModule, FormsModule, Button, PanelModule, FieldsetModule],
  templateUrl: './labels.component.html',
  styleUrl: './labels.component.scss'
})
export class LabelsComponent implements OnInit {


  constructor(public labelsService: LabelsService, public drawService: DrawingService) {

  }

  ngOnInit(): void {
    this.labelsService.activeLabel = this.labelsService.listSegmentationLabels[0];

    
  }

  hasChild(node: TreeNode): boolean {
    if (node.children) {
      return node.children.length > 0
    }
    else {
      return false;
    }


  }
  changeActiveLabel(event: TreeNode[] | TreeNode | null) {
    
    if (event instanceof Array) {
      return;
    }
    if (!event) {
      return;
    }
    this.labelsService.activeLabel = event.data as SegLabel;
    // this.labelsService.activeLabel = event.node.data as SegLabel;
  }
  
  clearCanvas(node: TreeNode){
    let index = this.labelsService.listSegmentationLabels.indexOf(node.data as SegLabel);
    this.drawService.requestCanvasClear(index);

  }

  changeVisibility(node: TreeNode){
    let label = node.data as SegLabel;
    label.isVisible = !label.isVisible;
    this.drawService.requestCanvasRedraw();

  }
}
