// ai-ocr-receipt-pipeline.scheduler.ts — M3 (Oct 23 2026): the background step of the receipt pipeline. Every 5 minutes,
// for every salon: quarantined receipts are re-asked for their malware verdict (out-of-band scanners tag minutes after
// the upload — a person used to have to press Rescan), and receipts left in `extracting` (an auto-extraction that failed
// transiently) are extracted. It never approves and never posts. One owner per tick across workers (runAsSingleOwner);
// OCR_PIPELINE_SWEEP=off stops it; a process that may not run background jobs does not arm it.
import { runTick } from '@aipowersalon/observability';
import { runsBackgroundJob } from '@aipowersalon/config';
import { DATABASE, runAsSingleOwner, type AppDatabase } from '@aipowersalon/database';
import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { AiOcrReceiptService } from './ai-ocr-receipt.service';

export const OCR_SWEEP_EVERY_MS = 5 * 60_000;
/** §131 (Oct 27 2026): retention runs once a day (archives, never deletes) */
export const OCR_RETENTION_EVERY_MS = 24 * 60 * 60_000;
export function ocrPipelineSweepEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env.OCR_PIPELINE_SWEEP ?? '').trim().toLowerCase() !== 'off';
}

@Injectable()
export class OcrPipelineScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('OcrPipelineSweep');
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  constructor(private readonly ocr: AiOcrReceiptService, @Optional() @Inject(DATABASE) private readonly db?: AppDatabase) {}

  onModuleInit(): void {
    if (!runsBackgroundJob('standard')) return;
    if (!this.db || !ocrPipelineSweepEnabled()) return;
    this.timer = setInterval(() => { void runTick({ jobType: 'ocr.pipeline_sweep', jobClass: 'standard', everyMs: OCR_SWEEP_EVERY_MS }, () => this.tick()).catch((e: unknown) => this.log.warn(`receipt pipeline tick failed: ${String((e as Error)?.message ?? e)}`)); }, OCR_SWEEP_EVERY_MS);
    this.timer.unref?.();
    this.retentionTimer = setInterval(() => { void runTick({ jobType: 'ocr.retention', jobClass: 'standard', everyMs: OCR_RETENTION_EVERY_MS }, () => this.retentionTick()).catch((e: unknown) => this.log.warn(`receipt retention tick failed: ${String((e as Error)?.message ?? e)}`)); }, OCR_RETENTION_EVERY_MS);
    this.retentionTimer.unref?.();
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); this.timer = null; if (this.retentionTimer) clearInterval(this.retentionTimer); this.retentionTimer = null; }
  private retentionTimer: NodeJS.Timeout | null = null;

  /** §131: once a day, one owner across workers — documents past the salon's retention window are marked archived (never deleted). */
  async retentionTick(): Promise<Awaited<ReturnType<AiOcrReceiptService['sweepRetention']>> | null> {
    if (!this.db) return null;
    try {
      const owned = await runAsSingleOwner(this.db, 'ocr.retention', () => this.ocr.sweepRetention());
      if (!owned.ran) return null;
      if (owned.result.archived || owned.result.keptLiveExpense || owned.result.errors) this.log.log(`receipt retention: ${JSON.stringify(owned.result)}`);
      return owned.result;
    } catch (e: any) { this.log.warn(`receipt retention sweep failed: ${e?.message ?? e}`); return null; }
  }

  /** Public for ops / tests. Non-overlapping within the process. */
  async tick(): Promise<Awaited<ReturnType<AiOcrReceiptService['sweepPipeline']>> | null> {
    if (!this.db || this.running) return null;
    this.running = true;
    try {
      const owned = await runAsSingleOwner(this.db, 'ocr.pipeline_sweep', () => this.ocr.sweepPipeline());
      if (!owned.ran) return null;
      if (owned.result.released || owned.result.extracted || owned.result.errors) this.log.log(`receipt pipeline: ${JSON.stringify(owned.result)}`);
      return owned.result;
    } catch (e: any) { this.log.warn(`receipt pipeline sweep failed: ${e?.message ?? e}`); return null; }
    finally { this.running = false; }
  }
}
