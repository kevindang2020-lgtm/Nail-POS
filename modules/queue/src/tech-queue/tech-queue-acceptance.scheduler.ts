/**
 * tech-queue-acceptance.scheduler.ts — §12 server-driven acceptance timeout. Every few seconds it asks the service to
 * expire any tech-queue offer whose acceptance_deadline has passed without a technician accepting, then fans out a
 * realtime queue-updated event per affected tenant/technician so the POS panels and the Tech App drop the dead offer.
 * Plain unref'd setInterval via Nest lifecycle hooks (same pattern as DailyFollowUpScheduler) — no extra dependency,
 * never blocks process exit. Disable with TECH_ACCEPTANCE_SCHEDULER_DISABLED=1; tune cadence with
 * TECH_ACCEPTANCE_SCHEDULER_INTERVAL_MS (default 15s — the timeout itself is TECH_ACCEPTANCE_TIMEOUT_SECONDS).
 */
import { EVENTS, type RealtimeEmitter } from '@aipowersalon/realtime-contracts';
import { runTick } from '@aipowersalon/observability';
import { Injectable, Logger, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { TechQueueService } from './tech-queue.service';
import { runsBackgroundJob } from '@aipowersalon/config';

@Injectable()
export class TechQueueAcceptanceScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('TechQueueAcceptanceScheduler');
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly intervalMs = Number(process.env.TECH_ACCEPTANCE_SCHEDULER_INTERVAL_MS || 15 * 1000);

  constructor(private readonly svc: TechQueueService, private readonly realtime?: RealtimeEmitter) {}

  onModuleInit(): void {
    if (!runsBackgroundJob('critical')) return;   // Constitution 13 Phase 8: this process may not run 'critical' jobs (PROCESS_ROLE / WORKER_JOB_CLASSES)
    if (process.env.TECH_ACCEPTANCE_SCHEDULER_DISABLED === '1') return;
    if (!Number.isFinite(this.intervalMs) || this.intervalMs < 1000) return;
    this.timer = setInterval(() => { void runTick({ jobType: 'tech.queue.acceptance', jobClass: 'critical', everyMs: this.intervalMs }, () => this.sweep()).catch(() => undefined); }, this.intervalMs);
    if (typeof this.timer?.unref === 'function') this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  private async sweep(): Promise<void> {
    try {
      const { expired, offers } = await this.svc.expireDueOffers(Date.now());
      if (!expired) return;
      this.logger.log(`expired ${expired} unaccepted tech-queue offer(s)`);
      if (this.svc.emitsDomainEvents()) return;   // §343: each expiry was recorded as tech_queue.offer_expired; the projection delivers it
      for (const o of offers) {
        try {
          this.realtime?.toTenant({ tenantId: o.tenantId, branchId: o.branchId ?? '' }, EVENTS.queueUpdated, { reason: 'offer_expired', techQueueTicketId: o.id });
          if (o.technicianId) this.realtime?.toTechnician(o.technicianId, EVENTS.queueUpdated, { reason: 'offer_expired', techQueueTicketId: o.id });
        } catch { /* a broken bus must not stop the sweep */ }
      }
    } catch (e: any) {
      this.logger.warn(`sweep failed: ${e?.message ?? e}`);
    }
  }
}
