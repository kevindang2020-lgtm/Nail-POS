// access-governance.module.ts — BUILD_PLAN Phase 9: the owner's access governance (/pos/security) and the daily
// dormant-account alert job.
import { Inject, Injectable, Logger, Module, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { DATABASE, runAsSingleOwner, type AppDatabase } from '@aipowersalon/database';
import { OutboxWriter } from '@aipowersalon/events';
import { EventsCoreModule } from '@aipowersalon/events/nest';
import { runsBackgroundJob } from '@aipowersalon/config';
import { runTick } from '@aipowersalon/observability';
import { utcDate } from '@aipowersalon/date-time';
import { AuthModule, AUTHORIZATION_STATE, type AuthorizationStateCache } from '@aipowersalon/identity';
import { AccessGovernanceController, ACCESS_GOVERNANCE_SERVICE } from './access-governance.controller';
import { AccessGovernanceService } from './access-governance.service';
import { DORMANT_DEFAULT_DAYS } from './access-governance.core';

export const DORMANT_CHECK_MS = 60 * 60_000;   // an hourly tick; the work runs once per UTC day
/** On unless AUTHZ_DORMANT_ALERTS is explicitly off. */
export function dormantAlertsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.AUTHZ_DORMANT_ALERTS ?? '').trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'no' || v === 'off');
}
/** The UTC calendar day of an instant ('YYYY-MM-DD') — the shared helper (§87). */
export const utcDay = (ms: number): string => utcDate(new Date(ms));

/** Daily, per salon: one owner alert per dormant account (active, no sign-in for > 60 days), as worker:dormant-accounts.
 *  Idempotent by construction (dormant_account_alerts is unique per account per dormancy episode), single-owner per tick. */
@Injectable()
export class DormantAccountScheduler implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null; private running = false; private lastDay: string | null = null;
  private readonly log = new Logger('DormantAccountScheduler');
  constructor(@Optional() @Inject(DATABASE) private readonly db: AppDatabase | null,
              @Optional() @Inject(ACCESS_GOVERNANCE_SERVICE) private readonly svc: AccessGovernanceService | null) {}
  onModuleInit(): void {
    if (!this.db || !this.svc || !runsBackgroundJob('standard') || !dormantAlertsEnabled()) return;
    this.timer = setInterval(() => { void runTick({ jobType: 'access.dormant_accounts', jobClass: 'standard', everyMs: DORMANT_CHECK_MS }, () => this.tick()).catch(() => undefined); }, DORMANT_CHECK_MS);
    this.timer.unref?.();
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }
  async tick(now: number = Date.now()): Promise<number> {
    const day = utcDay(now);
    if (this.lastDay === day) return 0;
    const n = await this.runOnce();
    this.lastDay = day;
    return n;
  }
  async runOnce(): Promise<number> {
    if (!this.db || !this.svc || this.running) return 0;
    this.running = true; let raised = 0;
    try {
      const out = await runAsSingleOwner(this.db as any, 'dormant-accounts', async () => {
        let n = 0;
        for (const tenantId of await this.svc!.tenantsWithDormant(DORMANT_DEFAULT_DAYS)) {
          try { n += await this.svc!.alertDormantForTenant(tenantId, DORMANT_DEFAULT_DAYS); }
          catch (e) { this.log.warn(`dormant-account alerts failed for a salon: ${(e as Error).message}`); }
        }
        return n;
      });
      raised = out.ran ? out.result : 0;
    } finally { this.running = false; }
    return raised;
  }
}

@Module({
  imports: [EventsCoreModule, AuthModule],
  controllers: [AccessGovernanceController],
  providers: [
    { provide: ACCESS_GOVERNANCE_SERVICE, useFactory: (db: AppDatabase, outbox: OutboxWriter, authz: AuthorizationStateCache | null) => (db ? new AccessGovernanceService(db as any, outbox, authz ?? null) : null), inject: [DATABASE, OutboxWriter, { token: AUTHORIZATION_STATE, optional: true }] },
    DormantAccountScheduler,
  ],
})
export class AccessGovernanceModule {}
