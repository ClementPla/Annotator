import { Directive, TemplateRef, inject, input } from '@angular/core';

@Directive({
  selector: '[appMenuGroup]',
  standalone: true
})
export class MenuGroupDirective {
  templateRef = inject<TemplateRef<any>>(TemplateRef);

  readonly title = input('', { alias: "appMenuGroup" });
}