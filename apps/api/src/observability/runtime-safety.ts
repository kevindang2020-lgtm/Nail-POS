// runtime-safety.ts — BUILD_PLAN Phase 11 (Constitution 4 §116, §131, §133, §139, §12): the runtime safety switches on
// the Super Admin System Operations screen, in one read:
//   schema           which migrations this database has vs the files in this image (schema-version.ts)
//   breakGlass       MAINTENANCE_BREAK_GLASS as THIS instance reads it (env — no database involved)
//   rateLimiter      the per-tenant limiter: on/off, store, budget
//   redis            configured? and why it is required (multi-process reasons)
//   strandedPayments card attempts the sweep handed to a human (needs_review) or could not verify, newest first
// Read-only. No URLs, keys or SQL leave this endpoint.
import { SuperAdminGuard, RequirePermission } from '@aipowersalon/permissions/guards';
import { Controller, Get, Inject, Injectable, Optional, UseGuards } from '@nestjs/common';
import { sql } from 'kysely';
import { DATABASE } from '@aipowersalon/database';
import { strandedMinutes } from '@aipowersalon/checkout';
import { cachedSchemaVersion } from './schema-version';
import { breakGlassStatus } from '../common/maintenance-break-glass';
import { rateLimiterDescription } from '../common/tenant-rate-limit';
import { multiProcessReasons } from '../common/production-config';

import type { RuntimeSafety } from '@aipowersalon/api-contracts/platform';   // the wire contract (Constitution 13 §15)

@Injectable()
export class RuntimeSafetyService {
  constructor(@Optional() @Inject(DATABASE) private readonly db: any) {}

  async read(now = new Date()): Promise<RuntimeSafety> {
    return {
      generatedAt: now.toISOString(),
      schema: await cachedSchemaVersion(this.db),
      breakGlass: breakGlassStatus(),
      rateLimiter: rateLimiterDescription(),
      redis: { configured: !!String(process.env.REDIS_URL ?? '').trim(), requiredBecause: multiProcessReasons() },
      strandedPayments: await this.stranded(),
    };
  }

  private async stranded(): Promise<RuntimeSafety['strandedPayments']> {
    const thresholdMinutes = strandedMinutes();
    if (!this.db) return { thresholdMinutes, needsReview: 0, unverifiedCards: 0, recent: [] };
    try {
      const counts = (await sql<any>`select
          (select count(*)::int from payment_attempts where status = 'needs_review') as needs_review,
          (select count(*)::int from payments where status = 'processing' and stranded_at is not null) as unverified`.execute(this.db)).rows[0];
      const rows = (await sql<any>`
          select * from (
            select a.id, 'split_attempt' as kind, a.tenant_id, t.display_name as tenant_name, a.ticket_id, a.amount_cents, a.status, a.resolution, a.created_at, a.stranded_at
              from payment_attempts a left join tenants t on t.id = a.tenant_id where a.status = 'needs_review'
            union all
            select p.id, 'card_payment', p.tenant_id, t.display_name, p.ticket_id, p.amount_cents, p.status, null, p.created_at, p.stranded_at
              from payments p left join tenants t on t.id = p.tenant_id where p.status = 'processing' and p.stranded_at is not null
          ) x order by stranded_at desc nulls last limit 20`.execute(this.db)).rows;
      return {
        thresholdMinutes, needsReview: Number(counts?.needs_review ?? 0), unverifiedCards: Number(counts?.unverified ?? 0),
        recent: rows.map((r: any) => ({ id: r.id, kind: r.kind, tenantId: r.tenant_id, tenantName: r.tenant_name ?? null, ticketId: r.ticket_id, amountCents: Number(r.amount_cents), status: r.status, resolution: r.resolution ?? null, createdAt: new Date(r.created_at).toISOString(), strandedAt: r.stranded_at ? new Date(r.stranded_at).toISOString() : null })),
      };
    } catch {
      // §332 no fake green: say it could not be read rather than showing zero.
      return { thresholdMinutes, needsReview: 0, unverifiedCards: 0, recent: [], error: 'Stranded payments could not be read.' };
    }
  }
}

@UseGuards(SuperAdminGuard)
@Controller('super-admin/system')
export class RuntimeSafetyController {
  constructor(private readonly svc: RuntimeSafetyService) {}
  @Get('runtime-safety') @RequirePermission('super_admin.system_operations.view') runtimeSafety() { return this.svc.read(); }
}
