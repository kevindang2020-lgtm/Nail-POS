// ai-revenue.kysely.repository.ts — Postgres AiRevenueRepo. Idempotent insert (ON CONFLICT do nothing). Tenant/branch
// scoped from session, never client. Money is integer cents.
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { AiRevenueRepo, AiRevenueScope } from './ai-revenue.repository';
import { summarizeRevenue, type RevenueAttributionInput, type RevenueAttributionRow, type AiRevenueSummary } from './ai-revenue.dto';

export class KyselyAiRevenueRepo implements AiRevenueRepo {
  constructor(private readonly db: Kysely<DB>) {}
  async record(e: RevenueAttributionInput): Promise<{ id: string; deduped: boolean }> {
    const r: any = await sql`
      insert into ai_revenue_attributions
        (tenant_id, branch_id, dedupe_key, source, kind, ticket_id, ticket_service_line_id, customer_id, amount_cents, accepted_at)
      values (${e.tenantId}, ${e.branchId ?? null}, ${e.dedupeKey}, ${e.source}, ${e.kind ?? 'upsell'}, ${e.ticketId ?? null},
        ${e.ticketServiceLineId ?? null}, ${e.customerId ?? null}, ${Math.round(e.amountCents || 0)}, ${e.acceptedAt ?? new Date().toISOString()})
      on conflict (tenant_id, dedupe_key) do nothing
      returning id
    `.execute(this.db as any);
    const id = r.rows?.[0]?.id;
    return { id, deduped: !id };
  }
  async summary(scope: AiRevenueScope): Promise<AiRevenueSummary> {
    let q = this.db.selectFrom('ai_revenue_attributions')
      .where('tenant_id', '=', scope.tenantId)
      .where('accepted_at', '>=', sql<Date>`now() - interval '7 days'`);
    if (scope.branchId) q = q.where((eb: any) => eb.or([eb('branch_id', '=', scope.branchId), eb('branch_id', 'is', null)]));
    const rows: any[] = await q.selectAll().execute().catch(() => []);
    const mapped: RevenueAttributionRow[] = rows.map((x) => ({
      id: x.id, tenantId: x.tenant_id, branchId: x.branch_id, dedupeKey: x.dedupe_key, source: x.source, kind: x.kind,
      ticketId: x.ticket_id, ticketServiceLineId: x.ticket_service_line_id, customerId: x.customer_id,
      amountCents: Number(x.amount_cents ?? 0), acceptedAt: typeof x.accepted_at === 'string' ? x.accepted_at : new Date(x.accepted_at).toISOString(),
    }));
    return summarizeRevenue(mapped);
  }
}
