// ai-money-protection.kysely.repository.ts — Kysely-backed repo. Reads authoritative `payments` (tenant-scoped)
// for the deterministic engine and persists alerts to money_protection_alerts with dedup upsert. No card data is
// read or stored. Every query is scoped by tenant_id (and branch where relevant).
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { canMoveToSql } from '@aipowersalon/database';
import { MONEY_PROTECTION_ALERT } from '../ai-lifecycles';
import type {
  MoneyProtectionContext, MoneyProtectionAlert, AlertCandidate, MoneyProtectionState,
} from './ai-money-protection.dto';
import type { MoneyProtectionRepositoryPort, AlertFilters } from './ai-money-protection.repository';
import type { NormalizedPayment, NormalizedRefund, NormalizedTicket, NormalizedAttempt } from './ai-money-protection-rules';
import type { ReconciliationData, PlatformAggregate } from './ai-money-protection.repository';
import type { RuleSetting, RuleSettingsMap } from './ai-money-protection-settings';
import { REFUND_STATUSES } from '@aipowersalon/api-contracts';

const REFUND_SET = new Set((REFUND_STATUSES as readonly string[]).map((s) => s.toLowerCase()));

function rowToAlert(r: any): MoneyProtectionAlert {
  const evidence = typeof r.evidence === 'string' ? safeJson(r.evidence) : (r.evidence ?? {});
  const related = typeof r.related === 'string' ? safeJson(r.related) : (r.related ?? {});
  return {
    id: r.id, tenantId: r.tenant_id, branchId: r.branch_id ?? null, ruleId: r.rule_id, alertType: r.alert_type,
    severity: r.severity, status: r.status, riskScore: Number(r.risk_score) || 0, confidence: r.confidence,
    amountCents: Number(r.amount_cents) || 0, entityFingerprint: r.entity_fingerprint,
    evaluationWindow: r.evaluation_window ?? '', evidence, related,
    eventCount: Number(r.event_count) || 1,
    firstSeenAt: iso(r.first_seen_at), lastSeenAt: iso(r.last_seen_at),
    assignedUserId: r.assigned_user_id ?? null, investigationId: r.investigation_id ?? null,
    createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
  };
}
function safeJson(s: string): any { try { return JSON.parse(s); } catch { return {}; } }
function iso(v: any): string { try { return new Date(v).toISOString(); } catch { return String(v ?? ''); } }

export class KyselyMoneyProtectionRepository implements MoneyProtectionRepositoryPort {
  constructor(private readonly db: Kysely<DB>) {}

  async upsertAlert(ctx: MoneyProtectionContext, c: AlertCandidate) {
    const ins: any = await this.db
      .insertInto('money_protection_alerts')
      .values({
        tenant_id: ctx.tenantId, branch_id: c.branchId, rule_id: c.ruleId, alert_type: c.alertType,
        severity: c.severity, confidence: c.confidence, risk_score: c.riskScore, amount_cents: c.amountCents,
        entity_fingerprint: c.entityFingerprint, evaluation_window: c.evaluationWindow,
        evidence: JSON.stringify(c.evidence), related: JSON.stringify(c.related),
      } as any)
      .onConflict((oc) => oc
        .columns(['tenant_id', 'rule_id', 'entity_fingerprint', 'evaluation_window'])
        .doUpdateSet({ event_count: sql`money_protection_alerts.event_count + 1`, last_seen_at: sql`now()`, updated_at: sql`now()` } as any))
      .returning(['id', 'event_count'])
      .executeTakeFirst();
    // Distinguish created vs bumped: a fresh insert has event_count = 1.
    const created = Number(ins?.event_count ?? 1) === 1;
    const alert = await this.getById(ctx, String(ins?.id));
    return { created, alert: alert! };
  }

  private async getById(ctx: MoneyProtectionContext, id: string): Promise<MoneyProtectionAlert | null> {
    const r: any = await this.db.selectFrom('money_protection_alerts').selectAll()
      .where('tenant_id', '=', ctx.tenantId).where('id', '=', id).executeTakeFirst();
    return r ? rowToAlert(r) : null;
  }

  async listAlerts(ctx: MoneyProtectionContext, f: AlertFilters) {
    const limit = Math.min(100, Math.max(1, f.limit ?? 50));
    let q = this.db.selectFrom('money_protection_alerts').selectAll().where('tenant_id', '=', ctx.tenantId);
    if (f.severity) q = q.where('severity', '=', f.severity);
    if (f.status) q = q.where('status', '=', f.status);
    if (f.alertType) q = q.where('alert_type', '=', f.alertType);
    if (f.branchId) q = q.where('branch_id', '=', f.branchId);
    if (f.cursor) q = q.where('created_at', '<', f.cursor as any);
    const rows: any[] = await q.orderBy('created_at', 'desc').limit(limit + 1).execute();
    const page = rows.slice(0, limit).map(rowToAlert);
    return { items: page, nextCursor: rows.length > limit ? page[page.length - 1].createdAt : null };
  }

  async getState(ctx: MoneyProtectionContext): Promise<MoneyProtectionState> {
    const open = "status in ('NEW','ACKNOWLEDGED','INVESTIGATING','WAITING_FOR_INFORMATION','ESCALATED')";
    try {
      const agg: any = await sql`
        SELECT
          count(*) FILTER (WHERE status = 'NEW')::int AS new_alerts,
          count(*) FILTER (WHERE ${sql.raw(open)} AND severity = 'HIGH')::int AS high_sev,
          count(*) FILTER (WHERE ${sql.raw(open)} AND severity = 'CRITICAL')::int AS crit,
          count(DISTINCT investigation_id) FILTER (WHERE ${sql.raw(open)} AND investigation_id IS NOT NULL)::int AS open_inv,
          count(*) FILTER (WHERE status IN ('NEW','ACKNOWLEDGED'))::int AS awaiting,
          count(*) FILTER (WHERE status = 'DISMISSED_FALSE_POSITIVE')::int AS fp,
          coalesce(sum(amount_cents) FILTER (WHERE ${sql.raw(open)}), 0)::bigint AS value_under_review
        FROM money_protection_alerts WHERE tenant_id = ${ctx.tenantId}`.execute(this.db);
      const byType: any = await sql`
        SELECT alert_type AS type, count(*)::int AS count FROM money_protection_alerts
        WHERE tenant_id = ${ctx.tenantId} AND ${sql.raw(open)} GROUP BY alert_type ORDER BY count DESC`.execute(this.db);
      const a = agg.rows?.[0] ?? {};
      return {
        newAlerts: Number(a.new_alerts) || 0, highSeverityAlerts: Number(a.high_sev) || 0,
        criticalAlerts: Number(a.crit) || 0, openInvestigations: Number(a.open_inv) || 0,
        alertsAwaitingReview: Number(a.awaiting) || 0,
        byType: (byType.rows ?? []).map((x: any) => ({ type: x.type, count: Number(x.count) || 0 })),
        valueUnderReviewCents: Number(a.value_under_review) || 0,
        resolvedFalsePositives: Number(a.fp) || 0, dataFreshness: 'realtime', generatedAt: new Date().toISOString(),
      };
    } catch {
      // honest zeros on failure — never fabricated
      return { newAlerts: 0, highSeverityAlerts: 0, criticalAlerts: 0, openInvestigations: 0, alertsAwaitingReview: 0, byType: [], valueUnderReviewCents: 0, resolvedFalsePositives: 0, dataFreshness: 'unavailable', generatedAt: new Date().toISOString() };
    }
  }

  async getAlertsByIds(ctx: MoneyProtectionContext, ids: string[]): Promise<MoneyProtectionAlert[]> {
    if (!ids.length) return [];
    const rows: any[] = await this.db.selectFrom('money_protection_alerts').selectAll()
      .where('tenant_id', '=', ctx.tenantId).where('id', 'in', ids).execute().catch(() => []);
    return rows.map(rowToAlert);
  }

  async attachInvestigation(ctx: MoneyProtectionContext, alertIds: string[], investigationId: string): Promise<void> {
    if (!alertIds.length) return;
    await this.db.updateTable('money_protection_alerts')
      .set({ investigation_id: investigationId, updated_at: sql`now()` } as any)
      .where('tenant_id', '=', ctx.tenantId).where('id', 'in', alertIds)
      .execute().catch(() => {});
    // move NEW/ACKNOWLEDGED alerts into INVESTIGATING
    await this.db.updateTable('money_protection_alerts')
      .set({ status: 'INVESTIGATING', updated_at: sql`now()` } as any)
      .where('tenant_id', '=', ctx.tenantId).where('id', 'in', alertIds)
      .where('status', 'in', ['NEW', 'ACKNOWLEDGED'])
      .where(canMoveToSql(MONEY_PROTECTION_ALERT, 'INVESTIGATING') as any)
      .execute().catch(() => {});
  }

  async loadActivity(ctx: MoneyProtectionContext, sinceMs: number) {
    const since = new Date(sinceMs).toISOString();
    const rows: any[] = await this.db.selectFrom('payments')
      .select(['id', 'branch_id', 'ticket_id', 'amount_cents', 'method', 'status', 'idempotency_key', 'processor_transaction_id', 'created_by_user_id', 'created_at'])
      .where('tenant_id', '=', ctx.tenantId)
      .where('created_at', '>=', since as any)
      .orderBy('created_at', 'desc')
      .limit(50000)
      .execute()
      .catch(() => []);
    const payments: NormalizedPayment[] = [];
    const refunds: NormalizedRefund[] = [];
    for (const r of rows) {
      const status = String(r.status || '').toLowerCase();
      const createdAtMs = Date.parse(iso(r.created_at)) || 0;
      if (REFUND_SET.has(status)) {
        refunds.push({ id: r.id, branchId: r.branch_id ?? null, ticketId: r.ticket_id ?? null, amountCents: Math.abs(Number(r.amount_cents) || 0), method: r.method ?? undefined, byUserId: r.created_by_user_id ?? null, status, createdAtMs });
      } else {
        payments.push({
          id: r.id, branchId: r.branch_id ?? null, ticketId: r.ticket_id ?? null, amountCents: Number(r.amount_cents) || 0,
          method: r.method ?? '', status, idempotencyKey: r.idempotency_key ?? null, processorTxnId: r.processor_transaction_id ?? null,
          createdByUserId: r.created_by_user_id ?? null, createdAtMs,
        });
      }
    }
    // Tickets touched in the window (for discount-integrity rules) — tenant-scoped.
    const ticketRows: any[] = await this.db.selectFrom('tickets')
      .select(['id', 'branch_id', 'subtotal_cents', 'discount_cents', 'total_cents', 'status'])
      .where('tenant_id', '=', ctx.tenantId)
      .where('updated_at', '>=', since as any)
      .limit(50000)
      .execute()
      .catch(() => []);
    const tickets: NormalizedTicket[] = ticketRows.map((t) => ({
      id: t.id, branchId: t.branch_id ?? null, subtotalCents: Number(t.subtotal_cents) || 0,
      discountCents: Number(t.discount_cents) || 0, totalCents: Number(t.total_cents) || 0, status: String(t.status || ''),
    }));
    // Payment attempts in the window (for retry-loop detection) — tenant-scoped.
    const attemptRows: any[] = await this.db.selectFrom('payment_attempts')
      .select(['id', 'branch_id', 'ticket_id', 'status', 'method', 'created_at'])
      .where('tenant_id', '=', ctx.tenantId)
      .where('created_at', '>=', since as any)
      .limit(50000)
      .execute()
      .catch(() => []);
    const attempts: NormalizedAttempt[] = attemptRows.map((a) => ({
      id: a.id, branchId: a.branch_id ?? null, ticketId: a.ticket_id ?? null,
      status: String(a.status || '').toLowerCase(), method: a.method ?? '', createdAtMs: Date.parse(iso(a.created_at)) || 0,
    }));
    return { payments, refunds, tickets, attempts };
  }

  async loadReconciliationData(ctx: MoneyProtectionContext, sinceMs: number): Promise<ReconciliationData> {
    const since = new Date(sinceMs).toISOString();
    const mp: any[] = await this.db.selectFrom('membership_payments')
      .select(['id', 'branch_id', 'customer_id', 'amount_cents', 'status', 'processor_ref', 'idempotency_key', 'created_at'])
      .where('tenant_id', '=', ctx.tenantId).where('created_at', '>=', since as any).limit(50000).execute().catch(() => []);
    const gc: any[] = await this.db.selectFrom('gift_cards')
      .select(['id', 'branch_id', 'balance_cents', 'status']).where('tenant_id', '=', ctx.tenantId).limit(50000).execute().catch(() => []);
    const gct: any[] = await this.db.selectFrom('gift_card_transactions')
      .select(['id', 'gift_card_id', 'type', 'amount_cents', 'balance_after_cents', 'created_at'])
      .where('tenant_id', '=', ctx.tenantId).where('created_at', '>=', since as any).limit(50000).execute().catch(() => []);
    const cs: any[] = await this.db.selectFrom('cash_drawer_sessions')
      .select(['id', 'branch_id', 'business_date', 'variance_cents', 'counted_cents', 'expected_cash_cents', 'status'])
      .where('tenant_id', '=', ctx.tenantId).where('created_at', '>=', since as any).limit(50000).execute().catch(() => []);
    return {
      membershipPayments: mp.map((r) => ({ id: r.id, branchId: r.branch_id ?? null, customerId: r.customer_id ?? null, amountCents: Number(r.amount_cents) || 0, status: String(r.status || ''), processorRef: r.processor_ref ?? null, idempotencyKey: r.idempotency_key ?? null, createdAtMs: Date.parse(iso(r.created_at)) || 0 })),
      giftCards: gc.map((r) => ({ id: r.id, branchId: r.branch_id ?? null, balanceCents: Number(r.balance_cents) || 0, status: String(r.status || '') })),
      giftCardTxns: gct.map((r) => ({ id: r.id, giftCardId: r.gift_card_id, branchId: null, type: String(r.type || ''), amountCents: Number(r.amount_cents) || 0, balanceAfterCents: Number(r.balance_after_cents) || 0 })),
      cashSessions: cs.map((r) => ({ id: r.id, branchId: r.branch_id ?? null, businessDate: String(r.business_date || ''), varianceCents: r.variance_cents == null ? null : Number(r.variance_cents), countedCents: r.counted_cents == null ? null : Number(r.counted_cents), expectedCents: r.expected_cash_cents == null ? null : Number(r.expected_cash_cents), status: String(r.status || '') })),
    };
  }

  async platformAggregate(): Promise<PlatformAggregate> {
    const open = "status in ('NEW','ACKNOWLEDGED','INVESTIGATING','WAITING_FOR_INFORMATION','ESCALATED')";
    try {
      const agg: any = await sql`
        SELECT count(DISTINCT tenant_id)::int AS tenants, count(*)::int AS total,
               count(DISTINCT investigation_id) FILTER (WHERE investigation_id IS NOT NULL)::int AS inv
        FROM money_protection_alerts WHERE ${sql.raw(open)}`.execute(this.db);
      const sev: any = await sql`
        SELECT severity, count(*)::int AS count FROM money_protection_alerts WHERE ${sql.raw(open)} GROUP BY severity`.execute(this.db);
      const a = agg.rows?.[0] ?? {};
      return {
        tenantsWithOpenAlerts: Number(a.tenants) || 0, totalOpenAlerts: Number(a.total) || 0,
        bySeverity: (sev.rows ?? []).map((x: any) => ({ severity: x.severity, count: Number(x.count) || 0 })),
        openInvestigations: Number(a.inv) || 0,
      };
    } catch {
      return { tenantsWithOpenAlerts: 0, totalOpenAlerts: 0, bySeverity: [], openInvestigations: 0 };
    }
  }

  async getRuleSettings(ctx: MoneyProtectionContext): Promise<RuleSettingsMap> {
    const rows: any[] = await this.db.selectFrom('money_protection_rule_settings').selectAll()
      .where('tenant_id', '=', ctx.tenantId).execute().catch(() => []);
    const map: RuleSettingsMap = {};
    for (const r of rows) {
      const thresholds = typeof r.thresholds === 'string' ? safeJson(r.thresholds) : (r.thresholds ?? {});
      map[r.rule_id] = { ruleId: r.rule_id, enabled: r.enabled !== false, severityOverride: r.severity_override ?? null, thresholds };
    }
    return map;
  }
  async upsertRuleSetting(ctx: MoneyProtectionContext, s: RuleSetting, updatedByUserId: string): Promise<RuleSetting> {
    await this.db.insertInto('money_protection_rule_settings')
      .values({ tenant_id: ctx.tenantId, rule_id: s.ruleId, enabled: s.enabled, severity_override: s.severityOverride, thresholds: JSON.stringify(s.thresholds), updated_by_user_id: updatedByUserId } as any)
      .onConflict((oc) => oc.columns(['tenant_id', 'rule_id']).doUpdateSet({ enabled: s.enabled, severity_override: s.severityOverride, thresholds: JSON.stringify(s.thresholds), updated_by_user_id: updatedByUserId, updated_at: sql`now()` } as any))
      .execute();
    return s;
  }
}
