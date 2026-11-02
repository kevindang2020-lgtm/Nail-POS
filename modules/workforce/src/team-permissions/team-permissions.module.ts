// team-permissions.module.ts — the read-only role matrix (/pos/team/permissions) and, BUILD_PLAN Phase 9, the salon's
// Roles & Permissions API (/pos/access) with the temporary-access expiry sweep.
import { Inject, Injectable, Logger, Module, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { OutboxWriter } from '@aipowersalon/events';
import { EventsCoreModule } from '@aipowersalon/events/nest';
import { runsBackgroundJob } from '@aipowersalon/config';
import { runTick } from '@aipowersalon/observability';
import { AuthModule, AUTHORIZATION_STATE, type AuthorizationStateCache } from '@aipowersalon/identity';
import { TeamPermissionsController } from './team-permissions.controller';
import { TeamAccessController, TEAM_ACCESS_SERVICE } from './access.controller';
import { TeamAccessService, sweepExpiredOverridesForTenant, tenantsWithExpiredOverrides } from './access.service';

export const OVERRIDE_SWEEP_MS = 60_000;
/** On unless AUTHZ_OVERRIDE_SWEEP is explicitly off. */
export function overrideSweepEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.AUTHZ_OVERRIDE_SWEEP ?? '').trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'no' || v === 'off');
}

/** Every minute: revoke (reason 'expired') and audit the temporary overrides past their expiry, salon by salon. Decisions
 *  already ignore an expired row; this keeps the table, the audit trail and the authorization versions honest. */
@Injectable()
export class OverrideExpiryScheduler implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null; private running = false;
  private readonly log = new Logger('OverrideExpiryScheduler');
  constructor(@Optional() @Inject(DATABASE) private readonly db: AppDatabase | null, @Optional() @Inject(OutboxWriter) private readonly outbox: OutboxWriter | null,
              @Optional() @Inject(AUTHORIZATION_STATE) private readonly authz: AuthorizationStateCache | null) {}
  onModuleInit(): void {
    if (!this.db || !runsBackgroundJob('standard') || !overrideSweepEnabled()) return;
    this.timer = setInterval(() => { void runTick({ jobType: 'permissions.override_expiry', jobClass: 'standard', everyMs: OVERRIDE_SWEEP_MS }, () => this.sweep()).catch(() => undefined); }, OVERRIDE_SWEEP_MS);
    this.timer.unref?.();
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }
  async sweep(): Promise<number> {
    if (!this.db || this.running) return 0;
    this.running = true; let n = 0;
    try {
      for (const tenantId of await tenantsWithExpiredOverrides(this.db)) {
        try { n += await sweepExpiredOverridesForTenant(this.db, this.outbox, tenantId); this.authz?.invalidateTenant(tenantId); }
        catch (e) { this.log.warn(`override expiry sweep failed for a salon: ${(e as Error).message}`); }
      }
    } finally { this.running = false; }
    return n;
  }
}

@Module({
  imports: [EventsCoreModule, AuthModule],
  controllers: [TeamPermissionsController, TeamAccessController],
  providers: [
    { provide: TEAM_ACCESS_SERVICE, useFactory: (db: AppDatabase, outbox: OutboxWriter, authz: AuthorizationStateCache | null) => (db ? new TeamAccessService(db, outbox, authz ?? null) : null), inject: [DATABASE, OutboxWriter, { token: AUTHORIZATION_STATE, optional: true }] },
    OverrideExpiryScheduler,
  ],
})
export class TeamPermissionsModule {}
