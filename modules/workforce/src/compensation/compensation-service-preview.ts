/**
 * compensation-service-preview.ts — SERVICE PRICING 12, Technician Compensation Preview (Nov 12 2026).
 *
 * For ONE service, at its current price and a proposed one: each active technician's rate exactly as the money path picks
 * it — the ONE precedence of compensation-rule-loader (authored rule by level → the service's own rate → salon default) —
 * with its source / policy, and the canonical engine's (computeTicketCompensation) service earnings at both prices. Nothing
 * here re-implements a rate or a formula; it feeds the same functions hypothetical prices.
 *
 * "Audit the source of actual payout values": the paid lines of this service in the last 90 days, grouped by the source the
 * immutable compensation snapshot recorded (ticket_compensation_snapshots.rule_source / commission_source). History is read,
 * never re-priced. Read only — no row is written, no rule changes, nobody's pay moves.
 */
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { withCode } from '@aipowersalon/api-contracts';
import type { ServiceCompensationPreviewResponse, ServiceCompensationTechRow } from '@aipowersalon/api-contracts/tenant';
import { loadEffectiveRules, resolveFromRules, defaultCommissionForTenant, pickLineCommission, type PickedLineCommission } from './compensation-rule-loader';
import { computeTicketCompensation } from './compensation-engine';

export interface ServicePreviewCtx { tenantId: string; branchId: string | null }
/** carries its code for the controller's run() (→ HTTP { code, message }) and, through withCode, for the coded-error checks */
export class ServicePreviewError extends Error {
  constructor(message: string, readonly code: 'SERVICE_UNAVAILABLE' | 'SERVICE_NOT_FOUND' | 'PRICE_INVALID', readonly status: number) { super(message); }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const N = (v: unknown) => (v == null ? 0 : Number(v) || 0);
export const SERVICE_PREVIEW_MAX_TECHNICIANS = 50;
export const SERVICE_PREVIEW_ACTUAL_DAYS = 90;

/** the engine's service earnings for one technician doing one line at `priceCents` with the picked rate (pure) */
export function earningsAt(tenantId: string, branchId: string | null, serviceId: string, technicianId: string, priceCents: number, rate: PickedLineCommission): number {
  const r = computeTicketCompensation({
    tenantId, branchId, ticketId: 'service-preview',
    serviceLines: [{
      lineId: 'preview', serviceId, priceCents,
      supply: { method: (rate.supplyMethod === 'fixed' || rate.supplyMethod === 'percent' ? rate.supplyMethod : 'none'), value: rate.supplyValue },
      commission: { type: rate.commissionType, value: rate.commissionValue, source: rate.source },
      technicians: [{ technicianId, method: 'percent', value: 100 }],
    }],
  });
  return r.perTechnician.find((p) => p.technicianId === technicianId)?.serviceEarningsCents ?? 0;
}

export class ServiceCompensationPreviewService {
  constructor(private readonly db: Kysely<DB> | null) {}

  async preview(ctx: ServicePreviewCtx, q: { serviceId?: unknown; priceCents?: unknown }): Promise<ServiceCompensationPreviewResponse> {
    if (!this.db) throw withCode(new ServicePreviewError('Compensation preview needs the database.', 'SERVICE_UNAVAILABLE', 503), 'SERVICE_UNAVAILABLE');
    const T = ctx.tenantId; const sid = String(q.serviceId ?? '');
    if (!UUID.test(sid)) throw withCode(new ServicePreviewError('Service not found.', 'SERVICE_NOT_FOUND', 404), 'SERVICE_NOT_FOUND');
    const B = ctx.branchId && UUID.test(ctx.branchId) ? ctx.branchId : null;
    const svc = (await sql<{ id: string; name: string; price_cents: number; commission_type: string | null; commission_value: number | null; category: string | null; branch_id: string | null }>`
      select s.id, s.name, s.price_cents, s.commission_type, s.commission_value, c.name as category, s.branch_id
      from services s left join service_categories c on c.tenant_id = s.tenant_id and c.id = s.category_id
      where s.tenant_id = ${T} and s.id = ${sid} and (${B}::uuid is null or s.branch_id is null or s.branch_id = ${B}::uuid)`.execute(this.db)).rows[0];
    if (!svc) throw withCode(new ServicePreviewError('Service not found.', 'SERVICE_NOT_FOUND', 404), 'SERVICE_NOT_FOUND');
    const current = N(svc.price_cents);
    const raw = q.priceCents === undefined || q.priceCents === null || q.priceCents === '' ? current : Number(q.priceCents);
    if (!Number.isInteger(raw) || raw < 0 || raw > 10_000_000) throw withCode(new ServicePreviewError('Price must be a whole number of cents, 0 or more.', 'PRICE_INVALID', 400), 'PRICE_INVALID');

    const techW = sql`te.is_active = true and te.archived_at is null and (${B}::uuid is null or te.branch_id = ${B}::uuid)`;
    const total = N((await sql<{ n: number }>`select count(*)::int as n from technicians te where te.tenant_id = ${T} and ${techW}`.execute(this.db)).rows[0]?.n);
    const techs = (await sql<{ id: string; name: string | null; branch_id: string | null }>`select te.id, nullif(btrim(coalesce(nullif(te.full_name, ''), te.first_name || ' ' || te.last_name)), '') as name, te.branch_id
      from technicians te where te.tenant_id = ${T} and ${techW} order by lower(coalesce(te.full_name, te.first_name)), te.id limit ${SERVICE_PREVIEW_MAX_TECHNICIANS}`.execute(this.db)).rows;

    // the money path's precedence, loaded once: authored rules, the salon default, the service row's own rate
    const [rules, tenantDefault] = await Promise.all([loadEffectiveRules(this.db, T), defaultCommissionForTenant(this.db, T)]);
    const technicians: ServiceCompensationTechRow[] = techs.map((te) => {
      const branchId = te.branch_id ?? B;
      const resolved = rules.length ? resolveFromRules(rules, { tenantId: T, branchId, technicianId: te.id, serviceId: sid, serviceCategory: svc.category ?? null, ticketId: null }) : null;
      const rate = pickLineCommission(resolved, { commission_type: svc.commission_type, commission_value: svc.commission_value }, tenantDefault);
      const now = earningsAt(T, branchId, sid, te.id, current, rate); const next = earningsAt(T, branchId, sid, te.id, raw, rate);
      return { technicianId: te.id, name: te.name, commissionType: rate.commissionType, commissionValue: rate.commissionValue, supplyMethod: rate.supplyMethod, supplyValue: rate.supplyValue,
        source: rate.source, policyId: rate.policyId, policyVersion: rate.policyVersion, currentEarningsCents: now, proposedEarningsCents: next, changeCents: next - now };
    });

    // where the ACTUAL payouts for this service came from: the immutable snapshot rows of paid tickets, last 90 days
    const actualRows = (await sql<{ source: string; lines: number; gross: number; earn: number; last_at: Date | string | null }>`
      select coalesce(nullif(cs.rule_source, ''), nullif(cs.commission_source, ''), 'not_recorded') as source, count(*)::int as lines,
        coalesce(sum(cs.gross_price_cents), 0)::bigint as gross, coalesce(sum(cs.tech_service_earnings_cents), 0)::bigint as earn, max(cs.snapshot_at) as last_at
      from ticket_compensation_snapshots cs
      where cs.tenant_id = ${T} and cs.service_id = ${sid} and (${B}::uuid is null or cs.branch_id = ${B}::uuid)
        and cs.snapshot_at >= now() - make_interval(days => ${SERVICE_PREVIEW_ACTUAL_DAYS})
      group by 1 order by count(*) desc, 1`.execute(this.db)).rows;
    const bySource = actualRows.map((r) => ({ source: String(r.source), lines: N(r.lines), grossCents: N(r.gross), techEarningsCents: N(r.earn),
      lastAt: r.last_at == null ? null : new Date(r.last_at).toISOString() }));
    return {
      serviceId: sid, serviceName: String(svc.name ?? ''), currentPriceCents: current, proposedPriceCents: raw,
      technicians, techniciansShown: technicians.length, techniciansTotal: total,
      actual: { days: SERVICE_PREVIEW_ACTUAL_DAYS, lines: bySource.reduce((a, s) => a + s.lines, 0), techEarningsCents: bySource.reduce((a, s) => a + s.techEarningsCents, 0), bySource },
      changesPayNow: false,
    };
  }
}
