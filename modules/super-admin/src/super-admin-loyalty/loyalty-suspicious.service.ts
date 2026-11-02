// loyalty-suspicious.service.ts — detects suspicious redemption SIGNALS over real loyalty_redemptions rows and manages a
// case store (open → reviewing → resolved | dismissed). Detection is idempotent (upsert by bucket_key). Review/resolve/
// dismiss are audited. NEVER mutates points, balances, tiers, or redemptions — cases are oversight metadata only.
import { type OverviewScope, tenantPred } from '@aipowersalon/database';
import { sql, type Kysely } from 'kysely';
import type { AdminCtx } from './loyalty-dashboard.service';
import { DETECTION_DEFAULTS, severityForVelocity, severityForValue, severityForRepeat, bucketKey, canTransition, type DetectionThresholds, type SignalType, type Severity } from './loyalty-suspicious-core';

export interface SuspiciousCase { id: string; tenantId: string; customerId: string | null; signalType: SignalType; severity: Severity; status: string; detail: any; detectedAt: string; updatedAt: string }

const isUuid = (s: unknown): s is string => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export class LoyaltySuspiciousService {
  constructor(private readonly db: Kysely<any> | null) {}

  private async audit(ctx: AdminCtx, action: string, tenantId: string | null, entityId: string | null, meta: Record<string, unknown>): Promise<void> {
    if (!this.db) return;
    try {
      await sql`INSERT INTO audit_logs (tenant_id, branch_id, user_id, role, action_type, entity_type, entity_id, metadata_json)
                VALUES (${tenantId}, ${null}, ${ctx.userId ?? null}, 'super_admin', ${action}, 'loyalty_suspicious', ${entityId}, ${JSON.stringify(meta)}::jsonb)`.execute(this.db);
    } catch { /* best-effort */ }
  }

  /** Scan real redemptions for documented signals and upsert cases (idempotent). Returns the number of open cases. */
  async detect(ctx: AdminCtx, scope?: OverviewScope, thresholds: DetectionThresholds = DETECTION_DEFAULTS): Promise<{ ok: true; upserted: number; open: number }> {
    if (!this.db) return { ok: true, upserted: 0, open: 0 };
    let upserted = 0;

    // velocity: member with many redemptions in a day-bucket
    const vel = await sql<any>`
      select tenant_id, customer_id, to_char(date_trunc('day', created_at),'YYYY-MM-DD') as day,
             count(*)::int as cnt, coalesce(sum(points_spent),0)::bigint as points
      from loyalty_redemptions rd where ${tenantPred(scope)}
      group by 1,2,3 having count(*) >= ${thresholds.velocityCount}`.execute(this.db);
    for (const r of vel.rows) {
      const sev = severityForVelocity(Number(r.cnt), thresholds);
      upserted += await this.upsert(String(r.tenant_id), r.customer_id ? String(r.customer_id) : null, 'velocity', sev, bucketKey(String(r.tenant_id), r.customer_id, 'velocity', r.day), { count: Number(r.cnt), points: Number(r.points), day: r.day });
    }

    // high_value: a single redemption at/above the threshold
    const hv = await sql<any>`
      select id, tenant_id, customer_id, points_spent, to_char(date_trunc('day', created_at),'YYYY-MM-DD') as day
      from loyalty_redemptions rd where ${tenantPred(scope)} and points_spent >= ${thresholds.highValuePoints}`.execute(this.db);
    for (const r of hv.rows) {
      const sev = severityForValue(Number(r.points_spent), thresholds);
      upserted += await this.upsert(String(r.tenant_id), r.customer_id ? String(r.customer_id) : null, 'high_value', sev, bucketKey(String(r.tenant_id), r.customer_id, 'high_value', r.day, String(r.id)), { redemptionId: String(r.id), points: Number(r.points_spent), day: r.day });
    }

    // rapid_repeat: same member + same reward repeated in a day-bucket
    const rep = await sql<any>`
      select tenant_id, customer_id, reward_id, to_char(date_trunc('day', created_at),'YYYY-MM-DD') as day, count(*)::int as cnt
      from loyalty_redemptions rd where ${tenantPred(scope)}
      group by 1,2,3,4 having count(*) >= ${thresholds.repeatCount}`.execute(this.db);
    for (const r of rep.rows) {
      const sev = severityForRepeat(Number(r.cnt), thresholds);
      upserted += await this.upsert(String(r.tenant_id), r.customer_id ? String(r.customer_id) : null, 'rapid_repeat', sev, bucketKey(String(r.tenant_id), r.customer_id, 'rapid_repeat', r.day, String(r.reward_id)), { rewardId: String(r.reward_id), count: Number(r.cnt), day: r.day });
    }

    const open = await this.countOpen(scope);
    await this.audit(ctx, 'loyalty_suspicious.detect', scope?.tenantId ?? null, null, { upserted, open });
    return { ok: true, upserted, open };
  }

  private async upsert(tenantId: string, customerId: string | null, signal: SignalType, severity: Severity, key: string, detail: Record<string, unknown>): Promise<number> {
    if (!this.db) return 0;
    // Only refresh detail/severity for still-open cases; resolved/dismissed cases are left as the reviewer set them.
    await sql`
      INSERT INTO loyalty_suspicious_cases (tenant_id, customer_id, signal_type, severity, status, bucket_key, detail_json)
      VALUES (${tenantId}, ${customerId}, ${signal}, ${severity}, 'open', ${key}, ${JSON.stringify(detail)}::jsonb)
      ON CONFLICT (bucket_key) DO UPDATE SET
        severity = CASE WHEN loyalty_suspicious_cases.status IN ('open','reviewing') THEN EXCLUDED.severity ELSE loyalty_suspicious_cases.severity END,
        detail_json = CASE WHEN loyalty_suspicious_cases.status IN ('open','reviewing') THEN EXCLUDED.detail_json ELSE loyalty_suspicious_cases.detail_json END,
        updated_at = now()`.execute(this.db);
    return 1;
  }

  async countOpen(scope?: OverviewScope): Promise<number> {
    if (!this.db) return 0;
    const r = await sql<any>`select count(*)::int c from loyalty_suspicious_cases where status in ('open','reviewing') and ${tenantPred(scope)}`.execute(this.db);
    return Number(r.rows[0]?.c ?? 0);
  }

  async listCases(scope?: OverviewScope, status?: string, limit = 50): Promise<SuspiciousCase[]> {
    if (!this.db) return [];
    const statusPred = status && ['open', 'reviewing', 'resolved', 'dismissed'].includes(status) ? sql`and status = ${status}` : sql``;
    const r = await sql<any>`
      select id, tenant_id, customer_id, signal_type, severity, status, detail_json, detected_at, updated_at
      from loyalty_suspicious_cases where ${tenantPred(scope)} ${statusPred}
      order by (status in ('open','reviewing')) desc, detected_at desc limit ${Math.min(Math.max(limit, 1), 200)}`.execute(this.db);
    return r.rows.map((x: any) => ({ id: String(x.id), tenantId: String(x.tenant_id), customerId: x.customer_id ? String(x.customer_id) : null, signalType: x.signal_type, severity: x.severity, status: x.status, detail: typeof x.detail_json === 'string' ? JSON.parse(x.detail_json) : x.detail_json, detectedAt: new Date(x.detected_at).toISOString(), updatedAt: new Date(x.updated_at).toISOString() }));
  }

  async transition(ctx: AdminCtx, id: string, to: 'reviewing' | 'resolved' | 'dismissed' | 'open', note?: string): Promise<{ ok: boolean; error?: string; status?: string }> {
    if (!this.db) return { ok: false, error: 'unavailable' };
    if (!isUuid(id)) return { ok: false, error: 'invalid_id' };
    const cur = await sql<any>`select tenant_id, status from loyalty_suspicious_cases where id = ${id} limit 1`.execute(this.db);
    const row = cur.rows[0];
    if (!row) return { ok: false, error: 'not_found' };
    if (!canTransition(String(row.status), to)) return { ok: false, error: 'invalid_transition' };
    await sql`update loyalty_suspicious_cases set status = ${to}, reviewed_by = ${ctx.userId ?? null},
             detail_json = detail_json || ${JSON.stringify(note ? { note: String(note).slice(0, 2000) } : {})}::jsonb, updated_at = now() where id = ${id}`.execute(this.db);
    await this.audit(ctx, 'loyalty_suspicious.transition', String(row.tenant_id), id, { from: row.status, to });
    return { ok: true, status: to };
  }
}
