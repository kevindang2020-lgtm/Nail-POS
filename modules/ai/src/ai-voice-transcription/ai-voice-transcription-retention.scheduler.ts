// ai-voice-transcription-retention.scheduler.ts — arms the transcript retention sweep as an in-process daily job.
// Mirrors ai-trial-sweep: CJS-safe, no external scheduler dependency, gated by VOICE_RETENTION_SWEEP_CRON_ENABLED
// (OFF by default so dev/test/CI never sweep), non-overlapping, and unref'd so it never holds the process open.
// The actual work (find expired non-held transcripts across tenants, erase idempotently store + provider) lives in
// VoiceTranscriptionService.runRetentionSweep — this file only schedules it. Ops can also trigger it by hand via
// POST super-admin/voice-transcription/retention-sweep.
import { runTick } from '@aipowersalon/observability';
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { VoiceTranscriptionService } from './ai-voice-transcription.service';
import { runsBackgroundJob } from '@aipowersalon/config';

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily

export function voiceRetentionSweepCronEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.VOICE_RETENTION_SWEEP_CRON_ENABLED ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

@Injectable()
export class VoiceRetentionSweepScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('VoiceRetentionSweepScheduler');
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(private readonly svc: VoiceTranscriptionService) {}

  onModuleInit(): void {
    if (!runsBackgroundJob('ai')) return;   // Constitution 13 Phase 8: this process may not run 'ai' jobs (PROCESS_ROLE / WORKER_JOB_CLASSES)
    if (!voiceRetentionSweepCronEnabled()) return;
    void runTick({ jobType: 'ai.voice.transcription.retention', jobClass: 'ai', everyMs: CHECK_INTERVAL_MS }, () => this.tick()).catch(() => undefined);
    this.timer = setInterval(() => { void runTick({ jobType: 'ai.voice.transcription.retention', jobClass: 'ai', everyMs: CHECK_INTERVAL_MS }, () => this.tick()).catch(() => undefined); }, CHECK_INTERVAL_MS);
    if (typeof this.timer.unref === 'function') this.timer.unref();
    this.log.log('Voice transcript retention sweep armed (daily).');
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  private async tick(): Promise<void> {
    if (this.running) return; // never overlap
    this.running = true;
    try {
      const r = await this.svc.runRetentionSweep();
      if (r.deleted || r.failed) this.log.log(`Retention sweep: ${r.deleted} erased, ${r.failed} failed of ${r.scanned} scanned.`);
    } catch (e: any) {
      this.log.error(`Retention sweep failed: ${e?.message ?? e}`);
    } finally {
      this.running = false;
    }
  }
}
