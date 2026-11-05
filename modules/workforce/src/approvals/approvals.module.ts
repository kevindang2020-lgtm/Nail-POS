// approvals.module.ts — BUILD_PLAN Phase 9: mounts the salon approvals engine. @Global so the domains that move onto it
// (checkout refunds, deals, purchase orders) can inject the narrow string token TENANT_APPROVALS @Optional WITHOUT importing
// this module or depending on @aipowersalon/workforce (no module cycle): each registers its EXECUTOR at construction, and
// files requests through the same port. In a process without this module the token is absent and every domain keeps its
// pre-engine behaviour (a refund past the limit is a 403, approve routes act directly).
//
// The expiry job: every 5 minutes (standard background class; APPROVALS_JOBS=off disables the timer) pending requests past
// expires_at become `expired`, per salon, each with its approval.decided event. The UPDATE is guarded on status, so two
// processes running it at once expire each row once.
import { Global, Inject, Injectable, Logger, Module, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { OutboxWriter } from '@aipowersalon/events';
import { EventsCoreModule } from '@aipowersalon/events/nest';
import { runsBackgroundJob } from '@aipowersalon/config';
import { runTick } from '@aipowersalon/observability';
import { PosApprovalsController, OwnerApprovalsController } from './approvals.controller';
import { TenantApprovalsService, TENANT_APPROVALS } from './approvals.service';

export const APPROVALS_TICK_MS = 5 * 60_000;
export function approvalsJobsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.APPROVALS_JOBS ?? '').trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'no' || v === 'off');
}

/** One sweep: every salon with overdue pending requests. Returns how many requests expired. */
export async function runApprovalExpiry(svc: Pick<TenantApprovalsService, 'salonsWithDueExpiry' | 'expireDue'>): Promise<number> {
  let n = 0;
  for (const t of await svc.salonsWithDueExpiry()) n += await svc.expireDue(t);
  return n;
}

@Injectable()
export class ApprovalsExpiryScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('ApprovalsExpiry');
  private timer: NodeJS.Timeout | null = null;
  constructor(@Inject(TenantApprovalsService) private readonly svc: TenantApprovalsService, @Optional() @Inject(DATABASE) private readonly db: AppDatabase | null = null) {}
  onModuleInit(): void {
    if (!this.db || !runsBackgroundJob('standard') || !approvalsJobsEnabled()) return;
    this.timer = setInterval(() => { void runTick({ jobType: 'approvals.expiry', jobClass: 'standard', everyMs: APPROVALS_TICK_MS }, () => this.sweep()).catch(() => undefined); }, APPROVALS_TICK_MS);
    this.timer.unref?.();
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }
  async sweep(): Promise<number> {
    try { const n = await runApprovalExpiry(this.svc); if (n) this.log.log(`expired ${n} approval request(s)`); return n; }
    catch (e) { this.log.warn(`approval expiry sweep failed: ${(e as Error)?.message ?? e}`); return 0; }
  }
}

@Global()
@Module({
  imports: [EventsCoreModule],
  controllers: [PosApprovalsController, OwnerApprovalsController],
  providers: [
    { provide: TenantApprovalsService, useFactory: (db: AppDatabase | null, outbox: OutboxWriter) => new TenantApprovalsService((db as any) ?? null, outbox), inject: [{ token: DATABASE, optional: true }, OutboxWriter] },
    { provide: TENANT_APPROVALS, useExisting: TenantApprovalsService },
    ApprovalsExpiryScheduler,
  ],
  exports: [TenantApprovalsService, TENANT_APPROVALS],
})
export class TenantApprovalsModule {}
