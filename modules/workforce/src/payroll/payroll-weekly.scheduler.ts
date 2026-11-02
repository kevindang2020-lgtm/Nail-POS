// payroll-weekly.scheduler.ts — Weekly Paycheck mandate §3 / §18: when a salon turned "prepare each week automatically"
// on (payroll_schedules.auto_prepare), the last completed period (a week — or, since Oct 27 2026, two weeks, a half month
// or a month, by the salon's frequency) is opened as a payroll period and CALCULATED (statements + the default 50 / 50
// plans) so the manager finds it ready for review, and the manager is told (§17.7). It never submits and never approves —
// a person does both. In-process like the bill reminders: non-overlapping, unref'd, OFF by default (PAYROLL_WEEKLY_PREP_ENABLED=1)
// so dev, test and CI never create payroll. Idempotent: the week is unique per salon (uq_payroll_periods_schedule_week),
// so a restart or a second replica opens nothing twice.
import { runTick } from '@aipowersalon/observability';
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { runsBackgroundJob } from '@aipowersalon/config';
import type { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { systemContext } from '@aipowersalon/tenant-context';
import type { PayrollPaycheckService } from './payroll-paycheck.service';

const CHECK_INTERVAL_MS = 60 * 60 * 1000;   // hourly: a week is day-granular; the salon's own calendar day decides
/** the weekly worker's identity: it holds exactly the permissions it needs (open + calculate), nothing to approve or pay */
export const PAYROLL_WEEKLY_ACTOR = 'payroll-weekly';

export function payrollWeeklyPrepEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.PAYROLL_WEEKLY_PREP_ENABLED ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

@Injectable()
export class PayrollWeeklyScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('PayrollWeekly');
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly db: Kysely<DB> | null, private readonly paychecks: PayrollPaycheckService | null) {}

  onModuleInit(): void {
    if (!this.db || !this.paychecks) return;
    if (!runsBackgroundJob('standard')) return;
    if (!payrollWeeklyPrepEnabled()) return;
    this.timer = setInterval(() => { void runTick({ jobType: 'payroll.weekly_prepare', jobClass: 'standard', everyMs: CHECK_INTERVAL_MS }, () => this.tick()).catch((e: Error) => this.log.error(`weekly payroll tick failed: ${e.message}`)); }, CHECK_INTERVAL_MS);
    this.timer.unref?.();
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }

  /** Public so ops can trigger it by hand and tests need not wait. Non-overlapping; one salon's failure never stops the rest. */
  async tick(): Promise<{ opened: number; failed: number } | null> {
    if (this.running || !this.db || !this.paychecks) return null;
    this.running = true;
    let opened = 0, failed = 0;
    try {
      // §3.3 (Oct 27 2026): every frequency — the service opens the salon's last completed week / two weeks / half month / month
      const salons = await this.db.selectFrom('payroll_schedules').select(['tenant_id']).where('active', '=', true).where('auto_prepare', '=', true).execute();
      for (const s of salons) {
        try {
          const sys = systemContext({ tenantId: String(s.tenant_id), actor: PAYROLL_WEEKLY_ACTOR, permissions: ['pos.payroll.view', 'pos.payroll.manage'] });
          const r = await this.paychecks.openWeek({ ...sys, branchId: null });
          if (r.created) opened++;
        } catch (e) { failed++; this.log.error(`weekly payroll for salon ${s.tenant_id} failed: ${(e as Error).message}`); }
      }
      if (opened || failed) this.log.log(`weekly payroll: ${opened} week(s) opened, ${failed} failed`);
      return { opened, failed };
    } catch (e) { this.log.error(`weekly payroll sweep failed: ${(e as Error).message}`); return null; }
    finally { this.running = false; }
  }
}
