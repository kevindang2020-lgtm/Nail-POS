// loyalty-corrections.service.ts — detects VERIFIABLE arithmetic inconsistencies in real loyalty data and manages an
// append-only correction review workflow (detected → proposed → approved | rejected). Records a compensating correction
// record with actor/reason/difference; NEVER silently edits customer_loyalty_profiles balances or redemption history.
import { type OverviewScope, tenantPred } from '@aipowersalon/database';
import { sql, type Kysely } from 'kysely';
import type { AdminCtx } from './loyalty-dashboard.service';
import { expectedBalance, differencePoints, correctionBucket, canCorrectionTransition, type DiscrepancyType } from './loyalty-corrections-core';

export interface CorrectionCase { id: string; tenantId: string; customerId: string | null; discrepancyType: DiscrepancyType; expectedPoints: number; actualPoints: number; differencePoints: number; status: string; proposedAdjustmentPoints: number | null; rootCause: string | null; reason: string | null; detail: any; detectedAt: string; updatedAt: string }

const isUuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const n = (v: unknown) => (v == null ? 0 : Number(v) || 0);

export class LoyaltyCorrectionsService {
  constructor(private readonly db: Kysely<any> | null) {}

  private async audit(ctx: AdminCtx, action: string, tenantId: string | null, entityId: string | null, meta: Record<string, unknown>): Promise<void> {
    if (!this.db) return;
    try {
      await sql`INSERT INTO audit_logs (tenant_id, branch_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
                VALUES (${tenantId}, ${null}, ${ctx.userId ?? null}, 'super_admin', ${action}, 'loyalty_correction', ${entityId}, ${JSON.stringify(meta)}::jsonb)`.execute(this.db);
    } catch { /* best-effort */ }
  }

  /** Scan real profiles/redemptions for verifiable inconsistencies and upsert correction cases (idempotent). */
  async detect(ctx: AdminCtx, scope?: OverviewScope): Promise<{ ok: true; upserted: number; open: number }> {
    if (!this.db) return { ok: true, upserted: 0, open: 0 };
    let upserted = 0;

    // balance_mismatch + negative_balance from profile aggregates
    const prof = await sql<any>`
      select tenant_id, customer_id, points_balance, total_earned_points, total_redeemed_points
      from customer_loyalty_profiles where ${tenantPred(scope)}
        and (points_balance <> (total_earned_points - total_redeemed_points) or points_balance < 0)`.execute(this.db);
    for (const r of prof.rows) {
      const exp = expectedBalance(n(r.total_earned_points), n(r.total_redeemed_points));
      const act = n(r.points_balance);
      if (act < 0) upserted += await this.upsert(String(r.tenant_id), r.customer_id ? String(r.customer_id) : null, 'negative_balance', exp, act, { earned: n(r.total_earned_points), redeemed: n(r.total_redeemed_points) });
      if (exp !== act) upserted += await this.upsert(String(r.tenant_id), r.customer_id ? String(r.customer_id) : null, 'balance_mismatch', exp, act, { earned: n(r.total_earned_points), redeemed: n(r.total_redeemed_points) });
    }

    // redeemed_mismatch: profile.total_redeemed_points vs sum of actual redemptions for that member
    const red = await sql<any>`
      select p.tenant_id, p.customer_id, p.total_redeemed_points as stated,
             coalesce((select sum(points_spent) from loyalty_redemptions rd where rd.tenant_id = p.tenant_id and rd.customer_id = p.customer_id), 0) as actual_sum
      from customer_loyalty_profiles p where ${tenantPred(scope, 'p.tenant_id')}
        and p.total_redeemed_points <> coalesce((select sum(points_spent) from loyalty_redemptions rd where rd.tenant_id = p.tenant_id and rd.customer_id = p.customer_id), 0)`.execute(this.db);
    for (const r of red.rows) {
      upserted += await this.upsert(String(r.tenant_id), r.customer_id ? String(r.customer_id) : null, 'redeemed_mismatch', n(r.actual_sum), n(r.stated), { statedRedeemed: n(r.stated), actualRedeemed: n(r.actual_sum) });
    }

    const open = await this.countOpen(scope);
    await this.audit(ctx, 'loyalty_correction.detect', scope?.tenantId ?? null, null, { upserted, open });
    return { ok: true, upserted, open };
  }

  private async upsert(tenantId: string, customerId: string | null, type: DiscrepancyType, expected: number, actual: number, detail: Record<string, unknown>): Promise<number> {
    if (!this.db) return 0;
    const diff = differencePoints(expected, actual);
    await sql`
      INSERT INTO loyalty_calculation_corrections (tenant_id, customer_id, discrepancy_type, expected_points, actual_points, difference_points, status, bucket_key, detail_json)
      VALUES (${tenantId}, ${customerId}, ${type}, ${expected}, ${actual}, ${diff}, 'detected', ${correctionBucket(tenantId, customerId, type)}, ${JSON.stringify(detail)}::jsonb)
      ON CONFLICT (bucket_key) DO UPDATE SET
        expected_points = CASE WHEN loyalty_calculation_corrections.status IN ('detected','proposed') THEN EXCLUDED.expected_points ELSE loyalty_calculation_corrections.expected_points END,
        actual_points = CASE WHEN loyalty_calculation_corrections.status IN ('detected','proposed') THEN EXCLUDED.actual_points ELSE loyalty_calculation_corrections.actual_points END,
        difference_points = CASE WHEN loyalty_calculation_corrections.status IN ('detected','proposed') THEN EXCLUDED.difference_points ELSE loyalty_calculation_corrections.difference_points END,
        detail_json = CASE WHEN loyalty_calculation_corrections.status IN ('detected','proposed') THEN EXCLUDED.detail_json ELSE loyalty_calculation_corrections.detail_json END,
        updated_at = now()`.execute(this.db);
    return 1;
  }

  async countOpen(scope?: OverviewScope): Promise<number> {
    if (!this.db) return 0;
    const r = await sql<any>`select count(*)::int c from loyalty_calculation_corrections where status in ('detected','proposed') and ${tenantPred(scope)}`.execute(this.db);
    return Number(r.rows[0]?.c ?? 0);
  }

  async listCorrections(scope?: OverviewScope, status?: string, limit = 50): Promise<CorrectionCase[]> {
    if (!this.db) return [];
    const statusPred = status && ['detected', 'proposed', 'approved', 'rejected'].includes(status) ? sql`and status = ${status}` : sql``;
    const r = await sql<any>`
      select id, tenant_id, customer_id, discrepancy_type, expected_points, actual_points, difference_points, status, proposed_adjustment_points, root_cause, reason, detail_json, detected_at, updated_at
      from loyalty_calculation_corrections where ${tenantPred(scope)} ${statusPred}
      order by (status in ('detected','proposed')) desc, abs(difference_points) desc limit ${Math.min(Math.max(limit, 1), 200)}`.execute(this.db);
    return r.rows.map((x: any) => ({ id: String(x.id), tenantId: String(x.tenant_id), customerId: x.customer_id ? String(x.customer_id) : null, discrepancyType: x.discrepancy_type, expectedPoints: n(x.expected_points), actualPoints: n(x.actual_points), differencePoints: n(x.difference_points), status: x.status, proposedAdjustmentPoints: x.proposed_adjustment_points == null ? null : n(x.proposed_adjustment_points), rootCause: x.root_cause ?? null, reason: x.reason ?? null, detail: typeof x.detail_json === 'string' ? JSON.parse(x.detail_json) : x.detail_json, detectedAt: new Date(x.detected_at).toISOString(), updatedAt: new Date(x.updated_at).toISOString() }));
  }

  /** Record a review transition. Approving records the append-only compensating correction (does NOT edit balances). */
  async review(ctx: AdminCtx, id: string, input: { to: 'proposed' | 'approved' | 'rejected'; proposedAdjustment?: number; rootCause?: string; reason?: string }): Promise<{ ok: boolean; error?: string; status?: string }> {
    if (!this.db) return { ok: false, error: 'unavailable' };
    if (!isUuid(id)) return { ok: false, error: 'invalid_id' };
    const cur = await sql<any>`select tenant_id, status, difference_points from loyalty_calculation_corrections where id = ${id} limit 1`.execute(this.db);
    const row = cur.rows[0];
    if (!row) return { ok: false, error: 'not_found' };
    if (!canCorrectionTransition(String(row.status), input.to)) return { ok: false, error: 'invalid_transition' };
    if ((input.to === 'proposed' || input.to === 'approved') && !String(input.reason ?? '').trim()) return { ok: false, error: 'reason_required' };
    const adjustment = input.to === 'rejected' ? null : Number.isFinite(Number(input.proposedAdjustment)) ? Math.trunc(Number(input.proposedAdjustment)) : n(row.difference_points);
    await sql`update loyalty_calculation_corrections set status = ${input.to},
             proposed_adjustment_points = ${adjustment}, root_cause = ${String(input.rootCause ?? '').slice(0, 200) || null}, reason = ${String(input.reason ?? '').slice(0, 2000) || null},
             reviewed_by = ${ctx.userId ?? null}, updated_at = now() where id = ${id}`.execute(this.db);
    await this.audit(ctx, 'loyalty_correction.review', String(row.tenant_id), id, { from: row.status, to: input.to, proposedAdjustment: adjustment, note: 'compensating record only; tenant balance not mutated' });
    return { ok: true, status: input.to };
  }
}
