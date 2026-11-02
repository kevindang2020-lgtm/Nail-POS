// voice-fleet.service.ts — platform-wide (cross-tenant) rollup of the AI Receptionist, for Super Admin oversight.
// This is the ONE place cross-tenant reads are legitimate: it's reached only through the SuperAdminGuard-protected
// super-admin/voice controller, and it returns aggregate COUNTs (no tenant row data), so it never exposes one salon's
// details to another. With no database (tests/offline) it returns an honest null-ish summary rather than fabricated
// numbers.
import { Injectable, Inject } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
// Wire types owned by @aipowersalon/api-contracts/platform (Constitution 13 §15).
export type { FleetSummary } from '@aipowersalon/api-contracts/platform';
import type { FleetSummary } from '@aipowersalon/api-contracts/platform';


const EMPTY: FleetSummary = { connected: false, tenantsWithAgents: 0, agentsByStatus: {}, provisioningFailures: 0, openFollowUps: 0 };

@Injectable()
export class VoiceFleetService {
  constructor(@Inject(DATABASE) private readonly db: AppDatabase | null) {}

  async summary(): Promise<FleetSummary> {
    if (!this.db) return EMPTY;
    const database = this.db as unknown as Kysely<any>;
    try {
      const [tenants, byStatus, failures, followUps] = await Promise.all([
        sql`SELECT count(DISTINCT tenant_id)::int AS c FROM ai_receptionist_agents WHERE status <> 'archived'`.execute(database),
        sql`SELECT status, count(*)::int AS c FROM ai_receptionist_agents GROUP BY status`.execute(database),
        sql`SELECT count(*)::int AS c FROM ai_receptionist_provisioning_jobs WHERE status = 'failed'`.execute(database),
        sql`SELECT count(*)::int AS c FROM ai_receptionist_follow_ups WHERE status NOT IN ('resolved','closed')`.execute(database),
      ]);
      const agentsByStatus: Record<string, number> = {};
      for (const row of byStatus.rows as any[]) agentsByStatus[row.status] = Number(row.c);
      return {
        connected: true,
        tenantsWithAgents: Number((tenants.rows[0] as any)?.c ?? 0),
        agentsByStatus,
        provisioningFailures: Number((failures.rows[0] as any)?.c ?? 0),
        openFollowUps: Number((followUps.rows[0] as any)?.c ?? 0),
      };
    } catch {
      return EMPTY; // resilient: oversight must not error out the admin screen
    }
  }
}
