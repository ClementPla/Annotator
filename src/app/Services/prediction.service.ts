import { Injectable, NgZone, signal } from '@angular/core';
import { listen } from '@tauri-apps/api/event';

import { LabelsService } from './Labels/labels.service';
import { SequenceService } from './sequence.service';
import { IOService } from './io.service';
import { NotificationService } from './notification.service';
import { CanvasManagerService } from '../Components/pages/editor/drawable-canvas/service/canvas-manager.service';
import { StateManagerService } from '../Components/pages/editor/drawable-canvas/service/state-manager.service';
import { UndoRedoService } from '../Components/pages/editor/drawable-canvas/service/undo-redo.service';

import { api, ScribbleInput, VectorShape, VectorNode } from '../lib/api';
import { VectorEditorService } from '../Components/pages/editor/drawable-canvas/service/vector-editor.service';
import { OrchestratorService } from '../Components/pages/editor/drawable-canvas/service/orchestrator.service';

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
  /** Coarse phase of the in-flight prediction, e.g. "encoder". */
  readonly stage = signal<string | null>(null);

  constructor(
    private labelService: LabelsService,
    private sequenceService: SequenceService,
    private canvasManager: CanvasManagerService,
    private stateManager: StateManagerService,
    private undoRedo: UndoRedoService,
    private io: IOService,
    private notifications: NotificationService,
    private vectorEditor: VectorEditorService,
    private orchestrator: OrchestratorService,
    private zone: NgZone,
  ) {
    // Prediction on a large frame takes seconds; a bare spinner leaves the user
    // guessing. Tauri callbacks fire outside Angular's zone, so this must be
    // wrapped or the signal updates without ever repainting.
    void listen<{ stage: string }>('ml-progress', (e) =>
      this.zone.run(() => {
        if (this.running()) this.stage.set(e.payload.stage);
      }),
    );
  }

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
  /**
   * Turn a traced polygon into an editable path.
   *
   * Corner nodes (handles coincident with the anchor), not smoothed curves: the
   * points come from a pixel contour, so inventing tangents would imply a
   * precision the mask does not have and would pull the outline off the
   * boundary the model actually predicted. The user can smooth what they want.
   */
  private polygonToShape(poly: number[][], labelId: number): VectorShape {
    const nodes: VectorNode[] = poly.map(([x, y]) => ({
      x,
      y,
      inX: x,
      inY: y,
      outX: x,
      outY: y,
      smooth: false,
    }));
    return {
      id: crypto.randomUUID(),
      labelId,
      closed: true,
      filled: true,
      nodes,
    };
  }

  /**
   * Apply a prediction as vector shapes rather than painted pixels.
   *
   * The model still predicts a raster mask — this vectorises its output. That
   * keeps the dense training signal the head needs while giving back something
   * the node editor can actually adjust.
   */
  async predictCurrentFrameAsVectors(useScribbles = true): Promise<void> {
    const frame = this.sequenceService.currentFrame();
    if (!frame) return;

    this.running.set(true);
    this.lastError.set(null);
    try {
      const scribbles = useScribbles ? this.deriveScribbles() : undefined;
      const result = await api.mlPredictFrame(frame.id, scribbles);
      const labels = this.labelService.listSegmentationLabels;

      const shapes: VectorShape[] = [];
      for (const m of result.masks) {
        if (!labels.some((l) => l.id === m.labelId)) continue;
        const polys = await api.vectorizeMask(
          base64ToUint8(m.maskBase64),
          result.width,
          result.height,
        );
        for (const p of polys) shapes.push(this.polygonToShape(p, m.labelId));
      }

      if (!shapes.length) {
        this.notifications.warn(
          'Nothing applied',
          'The prediction produced no traceable regions.',
        );
        return;
      }

      // addShapes commits its own undo entry, so the whole set reverts at once.
      this.vectorEditor.addShapes(shapes);
      this.notifications.notify({
        severity: 'success',
        summary: 'Prediction vectorised',
        detail: `${shapes.length} shape${shapes.length === 1 ? '' : 's'} — Ctrl+Z to revert`,
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
      // Marks the composite stale *and* schedules a frame. Setting the flag
      // alone left the prediction invisible until something else asked for a
      // repaint — toggling a label, or the next brush stroke. The vector path
      // never showed the bug because `addShapes` redraws on commit.
      this.orchestrator.requestRedrawAllCanvas();

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
      this.stage.set(null);
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
