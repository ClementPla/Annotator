import { Injectable, signal } from '@angular/core';

import { LabelsService } from './Labels/labels.service';
import { SequenceService } from './sequence.service';
import { IOService } from './io.service';
import { NotificationService } from './notification.service';
import { CanvasManagerService } from '../Components/pages/editor/drawable-canvas/service/canvas-manager.service';
import { StateManagerService } from '../Components/pages/editor/drawable-canvas/service/state-manager.service';
import { UndoRedoService } from '../Components/pages/editor/drawable-canvas/service/undo-redo.service';

import { api, ScribbleInput } from '../lib/api';

/**
 * Applies the trained segmentation head to the frame currently open in the
 * editor.
 *
 * # Why this is undoable rather than confirmed
 *
 * A prediction overwrites every label layer, which would otherwise discard work
 * silently. Rather than interrupt with a dialog on each run — the point is to
 * predict, correct, predict again — the whole replacement is pushed as one undo
 * group, so a single Ctrl+Z restores exactly what was there before.
 */
@Injectable({ providedIn: 'root' })
export class PredictionService {
  readonly running = signal(false);
  readonly lastError = signal<string | null>(null);

  constructor(
    private labelService: LabelsService,
    private sequenceService: SequenceService,
    private canvasManager: CanvasManagerService,
    private stateManager: StateManagerService,
    private undoRedo: UndoRedoService,
    private io: IOService,
    private notifications: NotificationService,
  ) {}

  /**
   * Turn what the user has already drawn into scribble conditioning.
   *
   * The head's conditioning is binary, so the mapping is: pixels of the
   * **active** label are positive, pixels of any **other** label are negative.
   * That reads naturally in the editor — mark some of the thing you want, mark
   * some of what you don't — and needs no separate scribble tool.
   *
   * Returns `undefined` when nothing is drawn, which the backend treats as an
   * unconditioned prediction rather than as an error.
   */
  private deriveScribbles(): ScribbleInput | undefined {
    const labels = this.labelService.listSegmentationLabels;
    const active = this.labelService.activeLabel;
    const activeIndex = active ? labels.indexOf(active) : -1;
    const masks = this.canvasManager.getAllMasks();
    if (!masks.length) return undefined;

    const positive: number[] = [];
    const negative: number[] = [];
    for (let li = 0; li < masks.length; li++) {
      const mask = masks[li];
      if (!mask) continue;
      const sink = li === activeIndex ? positive : negative;
      for (let i = 0; i < mask.length; i++) {
        if (mask[i] > 0) sink.push(i);
      }
    }
    if (!positive.length && !negative.length) return undefined;
    return { positive, negative };
  }

  /**
   * Predict the open frame and load the result into the label layers.
   *
   * @param useScribbles condition on the current annotation. Turning this off
   * shows what the model does unaided, which is the honest read of its quality.
   */
  async predictCurrentFrame(useScribbles = true): Promise<void> {
    const frame = this.sequenceService.currentFrame();
    if (!frame) return;

    this.running.set(true);
    this.lastError.set(null);
    try {
      const scribbles = useScribbles ? this.deriveScribbles() : undefined;
      const result = await api.mlPredictFrame(frame.id, scribbles);

      const labels = this.labelService.listSegmentationLabels;
      const touched: number[] = [];
      const applied: { index: number; mask: Uint8Array }[] = [];
      for (const m of result.masks) {
        const index = labels.findIndex((l) => l.id === m.labelId);
        if (index < 0) continue;
        touched.push(index);
        applied.push({ index, mask: base64ToUint8(m.maskBase64) });
      }

      if (!applied.length) {
        this.notifications.warn(
          'Nothing applied',
          'The model returned no labels matching this project.',
        );
        return;
      }

      // Snapshot before mutating so the whole replacement is one undo step.
      this.undoRedo.beginGroup();
      this.undoRedo.snapshotLayers(touched);
      for (const { index, mask } of applied) {
        this.canvasManager.setMask(index, mask);
        this.io.markLabelDirty(index);
      }
      this.undoRedo.endGroup();
      this.stateManager.recomputeCanvasSum = true;

      const covered = result.masks
        .filter((m) => m.coverage > 0)
        .map((m) => `${(m.coverage * 100).toFixed(1)}%`)
        .join(' · ');
      this.notifications.notify({
        severity: 'success',
        summary: 'Prediction applied',
        detail: covered ? `Coverage ${covered} — Ctrl+Z to revert` : 'Ctrl+Z to revert',
        life: 3000,
      });
    } catch (error) {
      const message = String(error);
      this.lastError.set(message);
      this.notifications.error('Prediction failed', message);
    } finally {
      this.running.set(false);
    }
  }
}

/** Decode a base64 mask into the flat uint8 buffer the canvas manager holds. */
function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}
