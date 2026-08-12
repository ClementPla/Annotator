import { Component, ElementRef, ChangeDetectionStrategy, inject, input } from '@angular/core';
import { NgStyle, NgClass } from '@angular/common';
import { BlockableUI } from 'primeng/api';

@Component({
    selector: 'blockable-p',
    imports: [NgStyle, NgClass],
    template: `        
        <ng-container [ngStyle]="style()" [ngClass]="class()" ><ng-content></ng-content></ng-container>
    `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BlockableP implements BlockableUI {
    private el = inject(ElementRef);


    readonly style = input<any>();
    readonly class = input<any>();

    getBlockableElement(): HTMLElement { 
        return this.el.nativeElement;
    }

}