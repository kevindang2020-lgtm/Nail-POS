// turn-queue-day-close.scheduler.ts — §125–126: at each branch's business-day boundary (the BRANCH time zone, never UTC
// midnight) close the finished day — a DAY_CLOSE event per technician carrying the day's summary; rows and history stay —
// and start the new day for technicians still clocked in (a JOIN with reason DAY_START, at the start-of-day order).
// Plain unref'd setInterval through Nest lifecycle hooks (the TechQueueAcceptanceScheduler pattern), one tick inline
// runTick(...) + runsBackgroundJob(...). Disable with TURN_DAY_CLOSE_DISABLED=1; cadence TURN_DAY_CLOSE_INTERVAL_MS (5 min).
import { Injectable, Logger, Inject, Optional, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { runTick } from '@aipowersalon/observability';
import { runsBackgroundJob } from '@aipowersalon/config';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { OutboxWriter } from '@aipowersalon/events';
import { unclosedPastDays, turnCloseDay, turnJoin } from './turn-ledger';

@Injectable()
export class TurnQueueDayCloseScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('TurnQueueDayCloseScheduler');
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly intervalMs = Number(process.env.TURN_DAY_CLOSE_INTERVAL_MS || 5 * 60 * 1000);
  constructor(@Inject(DATABASE) private readonly db: AppDatabase, @Optional() private readonly outbox?: OutboxWriter) {}

  onModuleInit(): void {
    if (!this.db || !runsBackgroundJob('standard')) return;
    if (process.env.TURN_DAY_CLOSE_DISABLED === '1') return;
    if (!Number.isFinite(this.intervalMs) || this.intervalMs < 10_000) return;
    this.timer = setInterval(() => { void runTick({ jobType: 'turn.queue.day_close', jobClass: 'standard', everyMs: this.intervalMs }, () => this.sweep()).catch(() => undefined); }, this.intervalMs);
    if (typeof this.timer?.unref === 'function') this.timer.unref();
  }
  onModuleDestroy(): void { if (this.timer) { clearInterval(this.timer); this.timer = null; } }

  /** One pass (exported for the live proof / tests). */
  async sweep(nowMs: number = Date.now()): Promise<{ closed: number; joined: number }> {
    let closed = 0; let joined = 0;
    for (const d of await unclosedPastDays(this.db as any, nowMs)) {
      try {
        const r = await turnCloseDay(this.db as any, { tenantId: d.tenantId, branchId: d.branchId, businessDate: d.businessDate, actor: { type: 'system' } }, { outbox: this.outbox ?? null, nowMs });
        closed += r.closed;
        // still clocked in at this branch → today's rotation (the start-of-day order applies)
        const on: any[] = await (this.db as any).selectFrom('technician_workforce_state').select(['technician_id']).where('tenant_id', '=', d.tenantId).where('branch_id', '=', d.branchId)
          .where('clock_status', '<>', 'CLOCKED_OUT').execute();
        for (const t of on) { await turnJoin(this.db as any, { tenantId: d.tenantId, branchId: d.branchId, technicianId: String(t.technician_id), actor: { type: 'system' }, reasonCode: 'DAY_START' }, { outbox: this.outbox ?? null, nowMs }); joined++; }
      } catch (e: any) { this.logger.warn(`day close ${d.tenantId}/${d.branchId}/${d.businessDate} failed: ${e?.message ?? e}`); }
    }
    return { closed, joined };
  }
}
