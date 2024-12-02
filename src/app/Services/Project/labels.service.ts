import { Injectable } from '@angular/core';
import { ClassLabel, SegLabel } from '../../Core/interface';
import { constructLabelTreeNode } from './labelTreeNode';
import { TreeNode } from 'primeng/api';


@Injectable({
  providedIn: 'root'
})
export class LabelsService {

  listSegmentationLabels: SegLabel[] = [];
  listClassificationLabels: ClassLabel[] = [];

  private _treeNode: TreeNode[] | null = null;
  activeLabel: SegLabel | null = null;


  constructor() {
  }

  addSegLabel(label: SegLabel) {
    this.listSegmentationLabels.push(label)
    if (!this.activeLabel) {
      this.activeLabel = label;
    }
  }
  removeSegLabel(SegLabel: SegLabel) {
      // Check if current active label is the one being removed
      if (this.activeLabel && this.activeLabel.label === SegLabel.label) {
        this.activeLabel = null;
      }
      this.listSegmentationLabels = this.listSegmentationLabels.filter((label) => label.label !== SegLabel.label);
      this._treeNode = constructLabelTreeNode(this.listSegmentationLabels);
  }

  addClassLabel(label: ClassLabel) {
    this.listClassificationLabels.push(label);
  }
  removeClassLabel(label: ClassLabel) {
    this.listClassificationLabels = this.listClassificationLabels.filter((l) => l !== label);
  }


  getActiveIndex(): number {
    if (this.activeLabel) {
      return this.listSegmentationLabels.findIndex((label) => label.label === this.activeLabel!.label);
    }
    return -1;
  }

  getTreeNode(): TreeNode[] {
    if(!this._treeNode) {
      this._treeNode = constructLabelTreeNode(this.listSegmentationLabels);

    }
    
    return this._treeNode;

  }

  rebuildTreeNodes() {
    this._treeNode = constructLabelTreeNode(this.listSegmentationLabels); 
  }



}
