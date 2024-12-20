import { Injectable } from '@angular/core';
import { ClassLabel, SegInstance, SegLabel } from '../../Core/interface';
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
  
  activeSegInstance: SegInstance | null = null;
  showAllLabels: boolean = true;

  constructor() {
  }

  addSegLabel(label: SegLabel) {

    // Only add label if it does not already exist in the list

    if (this.listSegmentationLabels.find((l) => l.label === label.label)) {
      return;
    }
  
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

  switchVisibilityAllSegLabels() {
    this.showAllLabels = !this.showAllLabels;
    this.listSegmentationLabels.forEach((label) => {
      label.isVisible = this.showAllLabels;
    })
  }

  incrementActiveInstance(){
    if (!this.activeLabel) {
      return;
    }
    if (!this.activeSegInstance) {
      this.activeSegInstance = { label: this.activeLabel, instance: 1, shade: "" };
    } else {
      let current_instance =  this.activeSegInstance.instance;
      if(current_instance >= this.activeLabel.shades!.length - 1){
        current_instance = -1;
      }
      current_instance++;
      let new_shade = this.activeLabel.shades![current_instance]

      this.activeSegInstance = { label: this.activeLabel, instance: current_instance, shade: new_shade };
    }

  }


}
