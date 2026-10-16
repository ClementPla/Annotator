import { Injectable, OnDestroy } from '@angular/core';
import { Subject, fromEvent } from 'rxjs';
import { filter, takeUntil } from 'rxjs/operators';
import { ALL_TOOLS, Tool } from '../../../core/tools';

interface ShortcutConfig {
  keys: string[];
  action: string;
}

@Injectable({
  providedIn: 'root'
})
export class KeyboardShortcutService implements OnDestroy {
  private destroy$ = new Subject<void>();
  private actions$ = new Subject<string>();
  public action$ = this.actions$.asObservable();
  /** Tool picked by one of its `Tool.keys`. */
  private tools$ = new Subject<Tool>();
  public tool$ = this.tools$.asObservable();

  private heldModifiers = new Set<string>();

  private shortcuts: ShortcutConfig[] = [
    { keys: ['ctrl+z'], action: 'undo' },
    { keys: ['ctrl+y'], action: 'redo' },

    { keys: ['tab'], action: 'toggleAllVisibility' },
    { keys: ['ctrl+tab'], action: 'nextLabel' },
    { keys: ['ctrl+shift+tab'], action: 'previousLabel' },
    { keys: ['ctrl+e'], action: 'toggleEdges' },
    { keys: ['q'], action: 'toggleImageProcessing' },
    { keys: ['d'], action: 'togglePostProcessing' },
    { keys: ['=', '+', 'shift++'], action: 'zoomIn' },
    { keys: ['-', '_', 'shift+_'], action: 'zoomOut' },

    { keys: ['ctrl+s'], action: 'save' },
    // Left/right move between sequences, up/down between frames.
    { keys: ['arrowright'], action: 'nextSequence' },
    { keys: ['arrowleft'], action: 'previousSequence' },
    { keys: ['arrowup'], action: 'nextFrame' },
    { keys: ['arrowdown'], action: 'previousFrame' },
  ];

  private holdKeys = new Map<string, string>([
    [' ', 'panMode'],      // Space for pan
    ['alt', 'quickMenu'],  // Alt for quick access menu
  ]);

  constructor() {
    this.initKeydownListener();
    this.initKeyupListener();
    this.initBlurListener();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private initKeydownListener() {
    fromEvent<KeyboardEvent>(window, 'keydown')
      .pipe(
        filter(() => !this.isInputFocused()),
        takeUntil(this.destroy$)
      )
      .subscribe(event => {
        const holdAction = this.holdKeys.get(event.key.toLowerCase());
        if (holdAction && !this.heldModifiers.has(event.key.toLowerCase())) {
          this.heldModifiers.add(event.key.toLowerCase());
          this.actions$.next(`${holdAction}:start`);
          event.preventDefault();
          return;
        }

        const key = this.normalizeKey(event);
        const tool = ALL_TOOLS.find(t => t.keys.includes(key));
        if (tool) {
          event.preventDefault();
          this.tools$.next(tool);
          return;
        }

        const action = this.matchShortcut(key);
        if (action) {
          event.preventDefault();
          this.actions$.next(action);
        }
      });
  }

  private initKeyupListener() {
    fromEvent<KeyboardEvent>(window, 'keyup')
      .pipe(takeUntil(this.destroy$))
      .subscribe(event => {
        const key = event.key.toLowerCase();
        if (this.heldModifiers.has(key)) {
          this.heldModifiers.delete(key);
          const holdAction = this.holdKeys.get(key);
          if (holdAction) {
            this.actions$.next(`${holdAction}:end`);
          }
        }
      });
  }

  private initBlurListener() {
    fromEvent(window, 'blur')
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.heldModifiers.forEach(key => {
          const holdAction = this.holdKeys.get(key);
          if (holdAction) {
            this.actions$.next(`${holdAction}:end`);
          }
        });
        this.heldModifiers.clear();
      });
  }

  private matchShortcut(normalizedKey: string): string | null {
    for (const shortcut of this.shortcuts) {
      if (shortcut.keys.some(k => k.toLowerCase() === normalizedKey)) {
        return shortcut.action;
      }
    }
    return null;
  }

  private normalizeKey(event: KeyboardEvent): string {
    const parts: string[] = [];
    
    if (event.ctrlKey || event.metaKey) parts.push('ctrl');
    if (event.shiftKey) parts.push('shift');
    if (event.altKey) parts.push('alt');
    
    let key = event.key.toLowerCase();
    if (key === ' ') key = 'space';
    
    parts.push(key);
    return parts.join('+');
  }

  private isInputFocused(): boolean {
    const activeElement = document.activeElement;
    if (!activeElement) return false;
    
    const tagName = activeElement.tagName.toUpperCase();
    const isEditable = activeElement.getAttribute('contenteditable') === 'true';
    
    return tagName === 'INPUT' || tagName === 'TEXTAREA' || isEditable;
  }
}
