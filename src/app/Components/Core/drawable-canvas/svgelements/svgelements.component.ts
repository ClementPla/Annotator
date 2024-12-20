import { Component, ElementRef, Input, ViewChild } from '@angular/core';
import { LabelsService } from '../../../../Services/Project/labels.service';
import { Point2D, Rect } from '../../../../Core/interface';

@Component({
  selector: 'app-svgelements',
  standalone: true,
  imports: [],
  templateUrl: './svgelements.component.html',
  styleUrl: './svgelements.component.scss',
})
export class SVGElementsComponent {
  @Input() UIPoints: string = '';

  @ViewChild('svg') svg: ElementRef<SVGElement>;

  constructor(public labelService: LabelsService) {}

  setViewBox(viewbox: Rect) {
    this.svg.nativeElement.setAttribute(
      'viewBox',
      `${viewbox.x} ${viewbox.y} ${viewbox.width} ${viewbox.height}`
    );
  }
}
