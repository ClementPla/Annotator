import { Component, ElementRef, ChangeDetectionStrategy, inject, input } from '@angular/core';
import { NgStyle, NgClass } from '@angular/common';
import { BlockableUI } from 'primeng/api';

@Component({
    selector: 'blockable-div',
    imports: [NgStyle, NgClass],
    template: `        
        <div [ngStyle]="style()" [ngClass]="class()" ><ng-content></ng-content></div>
    `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BlockableDiv implements BlockableUI {
    private el = inject(ElementRef);


    readonly style = input<any>();
    readonly class = input<any>();

    getBlockableElement(): HTMLElement { 
        return this.el.nativeElement;
    }

}