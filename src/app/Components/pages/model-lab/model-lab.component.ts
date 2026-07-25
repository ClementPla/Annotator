import {
  Component,
  NgZone,
  OnDestroy,
  OnInit,
  computed,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

import { ButtonModule } from 'primeng/button';
import { CardModule } from 'primeng/card';
import { ProgressBarModule } from 'primeng/progressbar';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';

import {
  api,
  CurvePoint,
  CurveReport,
  DatasetSummary,
  EncoderStatus,
  MlProgress,
  TrainSummary,
  TrainTick,
} from '../../../lib/api';

/** One budget's aggregated result: mean Dice plus the spread across draws. */
interface CurveRow {
  nFrames: number;
  mean: number;
  min: number;
  max: number;
  accuracy: number;
  runs: number;
}

@Component({
  selector: 'app-model-lab',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ButtonModule,
    CardModule,
    ProgressBarModule,
    TableModule,
    TagModule,
    ToastModule,
  ],
  providers: [MessageService],
  templateUrl: './model-lab.component.html',
  styleUrl: './model-lab.component.scss',
})
export class ModelLabComponent implements OnInit, OnDestroy {
  readonly encoders = signal<EncoderStatus[]>([]);
  readonly summary = signal<DatasetSummary | null>(null);
  readonly report = signal<CurveReport | null>(null);

  /** `null` means "local feature basis only" — the encoder ablation. */
  readonly selectedEncoder = signal<string | null>(null);
  readonly running = signal(false);
  readonly downloading = signal<string | null>(null);
  readonly progress = signal<MlProgress | null>(null);
  readonly tick = signal<TrainTick | null>(null);
  readonly error = signal<string | null>(null);

  /** What the running job is, so the UI can label it accurately. */
  readonly job = signal<'curve' | 'train' | null>(null);
  readonly model = signal<TrainSummary | null>(null);
  /** Rolling loss history for the current fit, for a sparkline. */
  readonly lossHistory = signal<number[]>([]);

  // Training knobs, deliberately few: these are the ones that change the
  // answer rather than the aesthetics.
  workingSize = 384;
  pixelsPerFrame = 4000;
  epochs = 40;
  curveRepeats = 3;

  private unlisten: UnlistenFn[] = [];

  constructor(
    private messages: MessageService,
    private zone: NgZone,
  ) {}

  async ngOnInit(): Promise<void> {
    // Tauri event callbacks fire outside Angular's zone, so a signal set here
    // marks the component dirty but nothing ever schedules change detection —
    // the UI would silently never repaint. `TauriEventBase` exists in this
    // codebase for the same reason; these listeners need the same treatment.
    this.unlisten.push(
      await listen<MlProgress>('ml-progress', (e) =>
        this.zone.run(() => this.progress.set(e.payload)),
      ),
      await listen<TrainTick>('ml-train-progress', (e) =>
        this.zone.run(() => {
          const t = e.payload;
          this.tick.set(t);
          // Reset the trace when a new fit starts, so the sparkline shows this
          // fit's convergence rather than every fit concatenated.
          this.lossHistory.update((h) =>
            t.epoch <= 1 ? [t.loss] : [...h.slice(-199), t.loss],
          );
        }),
      ),
    );
    await this.refresh();
  }

  ngOnDestroy(): void {
    this.unlisten.forEach((u) => u());
  }

  async refresh(): Promise<void> {
    try {
      const [encoders, summary] = await Promise.all([
        api.mlListEncoders(),
        api.mlDatasetSummary(),
      ]);
      this.encoders.set(encoders);
      this.summary.set(summary);
      this.model.set(await api.mlModelStatus());
    } catch (e) {
      this.error.set(String(e));
    }
  }

  /** Too few annotated frames to hold any out. */
  readonly canRun = computed(() => {
    const s = this.summary();
    return !!s && s.annotated_frames >= 2 && s.labels > 0 && !this.running();
  });

  readonly blockedReason = computed(() => {
    const s = this.summary();
    if (!s) return 'Loading project…';
    if (s.labels === 0) return 'This project defines no segmentation labels.';
    if (s.annotated_frames < 2)
      return `Only ${s.annotated_frames} annotated frame(s). At least 2 are needed so one can be held out.`;
    return null;
  });

  async download(enc: EncoderStatus): Promise<void> {
    this.downloading.set(enc.id);
    try {
      await api.mlDownloadEncoder(enc.id);
      await this.refresh();
      this.messages.add({
        severity: 'success',
        summary: 'Encoder ready',
        detail: enc.name,
      });
    } catch (e) {
      this.messages.add({
        severity: 'error',
        summary: 'Download failed',
        detail: String(e),
      });
    } finally {
      this.downloading.set(null);
    }
  }

  selectEncoder(id: string | null): void {
    this.selectedEncoder.set(id);
  }

  private options() {
    return {
      encoderId: this.selectedEncoder(),
      workingSize: this.workingSize,
      pixelsPerFrame: this.pixelsPerFrame,
      epochs: this.epochs,
      curveRepeats: this.curveRepeats,
    };
  }

  private begin(job: 'curve' | 'train'): void {
    this.running.set(true);
    this.job.set(job);
    this.error.set(null);
    this.progress.set(null);
    this.tick.set(null);
    this.lossHistory.set([]);
  }

  private end(): void {
    this.running.set(false);
    this.job.set(null);
    this.progress.set(null);
    this.tick.set(null);
  }

  async run(): Promise<void> {
    this.begin('curve');
    this.report.set(null);
    try {
      this.report.set(await api.mlRunLearningCurve(this.options()));
    } catch (e) {
      this.error.set(String(e));
    } finally {
      this.end();
    }
  }

  async trainModel(): Promise<void> {
    this.begin('train');
    try {
      const summary = await api.mlTrainModel(this.options());
      this.model.set(summary);
      this.messages.add({
        severity: 'success',
        summary: 'Model ready',
        detail: `Dice ${summary.metrics.meanDice.toFixed(3)} on ${summary.valFrames} held-out frames`,
      });
    } catch (e) {
      this.error.set(String(e));
    } finally {
      this.end();
    }
  }

  /**
   * Overall completion. Feature extraction and training are reported by
   * different events, so this picks whichever phase is currently live rather
   * than showing a bar that resets between them.
   */
  readonly progressPercent = computed(() => {
    const t = this.tick();
    if (t) {
      const perFit = t.epochs > 0 ? t.epoch / t.epochs : 0;
      if (t.points > 0) {
        return Math.round(((t.point + perFit) / t.points) * 100);
      }
      return Math.round(perFit * 100);
    }
    const p = this.progress();
    if (!p || p.total === 0) return 0;
    return Math.round((p.done / p.total) * 100);
  });

  /** Human-readable description of what is happening right now. */
  readonly progressLabel = computed(() => {
    const t = this.tick();
    if (t) {
      const fit =
        t.points > 1 ? `fit ${t.point + 1}/${t.points} · ${t.budget} frames · ` : '';
      return `Training — ${fit}epoch ${t.epoch}/${t.epochs} · loss ${t.loss.toFixed(4)} · ${Math.round(t.epochMs)} ms/epoch`;
    }
    const p = this.progress();
    if (p) {
      return `Extracting features — frame ${p.done}/${p.total} · ${Math.round(p.lastMs)} ms/frame`;
    }
    return this.job() === 'train' ? 'Preparing…' : 'Starting…';
  });

  /** Remaining time for the whole job, from whichever phase is live. */
  readonly etaLabel = computed(() => {
    const ms = this.tick()?.etaMs ?? this.progress()?.etaMs ?? 0;
    if (ms <= 0) return null;
    const s = Math.round(ms / 1000);
    if (s < 60) return `~${s}s left`;
    const m = Math.floor(s / 60);
    return m < 60 ? `~${m}m ${s % 60}s left` : `~${Math.floor(m / 60)}h ${m % 60}m left`;
  });

  /** Device + workload, so compute placement is never left implicit. */
  readonly deviceLabel = computed(() => {
    const t = this.tick();
    if (!t) return null;
    return `${t.device} · ${t.samples.toLocaleString()} samples × ${t.features} features`;
  });

  /** Sparkline path for the current fit's loss trace. */
  readonly lossPath = computed(() => {
    const h = this.lossHistory();
    if (h.length < 2) return null;
    const w = 240;
    const ht = 34;
    const max = Math.max(...h);
    const min = Math.min(...h);
    const span = max - min || 1;
    return h
      .map((v, i) => {
        const x = (i / (h.length - 1)) * w;
        const y = ht - ((v - min) / span) * ht;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  });

  /** Aggregate repeats per budget into mean and spread. */
  readonly rows = computed<CurveRow[]>(() => {
    const r = this.report();
    if (!r) return [];
    const byBudget = new Map<number, CurvePoint[]>();
    for (const p of r.points) {
      const list = byBudget.get(p.nFrames) ?? [];
      list.push(p);
      byBudget.set(p.nFrames, list);
    }
    return [...byBudget.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([nFrames, pts]) => {
        const dice = pts.map((p) => p.metrics.meanDice);
        const acc = pts.map((p) => p.metrics.accuracy);
        return {
          nFrames,
          mean: dice.reduce((a, b) => a + b, 0) / dice.length,
          min: Math.min(...dice),
          max: Math.max(...dice),
          accuracy: acc.reduce((a, b) => a + b, 0) / acc.length,
          runs: pts.length,
        };
      });
  });

  // ── Chart geometry ─────────────────────────────────────────────────────────
  // Budgets are spaced evenly by index rather than by value: they form a
  // doubling ladder, so linear spacing would crush the small-budget end, which
  // is precisely the region of interest.
  readonly chart = computed(() => {
    const rows = this.rows();
    const w = 640;
    const h = 300;
    const padL = 46;
    const padR = 16;
    const padT = 14;
    const padB = 38;
    if (rows.length === 0) return null;

    const innerW = w - padL - padR;
    const innerH = h - padT - padB;
    const xOf = (i: number) =>
      padL + (rows.length === 1 ? innerW / 2 : (i / (rows.length - 1)) * innerW);
    const yOf = (v: number) => padT + (1 - Math.max(0, Math.min(1, v))) * innerH;

    const meanPts = rows.map((r, i) => `${xOf(i)},${yOf(r.mean)}`).join(' ');
    // Spread band: max across the top, min back along the bottom.
    const band = [
      ...rows.map((r, i) => `${xOf(i)},${yOf(r.max)}`),
      ...rows
        .slice()
        .reverse()
        .map((r, i) => `${xOf(rows.length - 1 - i)},${yOf(r.min)}`),
    ].join(' ');

    return {
      w,
      h,
      padL,
      padT,
      innerW,
      innerH,
      meanPts,
      band,
      dots: rows.map((r, i) => ({
        cx: xOf(i),
        cy: yOf(r.mean),
        label: String(r.nFrames),
        lx: xOf(i),
        ly: h - padB + 16,
        mean: r.mean,
      })),
      yTicks: [0, 0.25, 0.5, 0.75, 1].map((v) => ({
        y: yOf(v),
        label: v.toFixed(2),
        x2: w - padR,
        x1: padL,
      })),
    };
  });

  readonly hasSpread = computed(() => this.rows().some((r) => r.runs > 1));

  fmt(v: number): string {
    return v.toFixed(3);
  }
}
