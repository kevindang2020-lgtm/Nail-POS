// ai-money-protection.repository.ts — port + in-memory impl. Kysely impl is separate. All methods are
// tenant-scoped by an explicit MoneyProtectionContext; nothing trusts client identity.
import type {
  MoneyProtectionContext, MoneyProtectionAlert, AlertCandidate, MoneyProtectionState,
} from './ai-money-protection.dto';
import type { NormalizedPayment, NormalizedRefund, NormalizedTicket, NormalizedAttempt } from './ai-money-protection-rules';
import type { NormalizedMembershipPayment, NormalizedGiftCard, NormalizedGiftCardTxn, NormalizedCashSession } from './ai-money-protection-reconciliation';
import type { RuleSetting, RuleSettingsMap } from './ai-money-protection-settings';

export interface ReconciliationData {
  membershipPayments: NormalizedMembershipPayment[];
  giftCards: NormalizedGiftCard[];
  giftCardTxns: NormalizedGiftCardTxn[];
  cashSessions: NormalizedCashSession[];
}

export interface AlertFilters {
  severity?: string;
  status?: string;
  alertType?: string;
  branchId?: string;
  limit?: number;
  cursor?: string; // created_at cursor (ISO) for pagination
}

export interface MoneyProtectionRepositoryPort {
  // Upsert on (tenant, rule, entity_fingerprint, window): insert new, else bump last_seen/event_count.
  upsertAlert(ctx: MoneyProtectionContext, c: AlertCandidate): Promise<{ created: boolean; alert: MoneyProtectionAlert }>;
  listAlerts(ctx: MoneyProtectionContext, f: AlertFilters): Promise<{ items: MoneyProtectionAlert[]; nextCursor: string | null }>;
  getState(ctx: MoneyProtectionContext): Promise<MoneyProtectionState>;
  // Fetch specific alerts (tenant-scoped) — used when opening an investigation from alerts.
  getAlertsByIds(ctx: MoneyProtectionContext, ids: string[]): Promise<MoneyProtectionAlert[]>;
  // Attach alerts to an investigation: set investigation_id + move status to INVESTIGATING (tenant-scoped).
  attachInvestigation(ctx: MoneyProtectionContext, alertIds: string[], investigationId: string): Promise<void>;
  // Read authoritative recent activity (payments + refunds + tickets) for the deterministic engine — tenant-scoped.
  loadActivity(ctx: MoneyProtectionContext, sinceMs: number): Promise<{ payments: NormalizedPayment[]; refunds: NormalizedRefund[]; tickets: NormalizedTicket[]; attempts: NormalizedAttempt[] }>;
  // Read authoritative domain data for batch reconciliation (membership/gift-card/cash) — tenant-scoped.
  loadReconciliationData(ctx: MoneyProtectionContext, sinceMs: number): Promise<ReconciliationData>;
  // Super-Admin platform aggregate — cross-tenant COUNTS ONLY, no tenant identifiers or private detail (spec §76/§78).
  platformAggregate(): Promise<PlatformAggregate>;
  // Tenant rule settings (spec §33/§69/§84).
  getRuleSettings(ctx: MoneyProtectionContext): Promise<RuleSettingsMap>;
  upsertRuleSetting(ctx: MoneyProtectionContext, s: RuleSetting, updatedByUserId: string): Promise<RuleSetting>;
}

export interface PlatformAggregate {
  tenantsWithOpenAlerts: number;
  totalOpenAlerts: number;
  bySeverity: { severity: string; count: number }[];
  openInvestigations: number;
}

const OPEN_STATUSES = new Set(['NEW', 'ACKNOWLEDGED', 'INVESTIGATING', 'WAITING_FOR_INFORMATION', 'ESCALATED']);

export class InMemoryMoneyProtectionRepository implements MoneyProtectionRepositoryPort {
  private alerts: MoneyProtectionAlert[] = [];
  private activity = new Map<string, { payments: NormalizedPayment[]; refunds: NormalizedRefund[]; tickets: NormalizedTicket[]; attempts: NormalizedAttempt[] }>();
  private recon = new Map<string, ReconciliationData>();
  private settings = new Map<string, RuleSettingsMap>();

  async getRuleSettings(ctx: MoneyProtectionContext): Promise<RuleSettingsMap> {
    return this.settings.get(ctx.tenantId) ?? {};
  }
  async upsertRuleSetting(ctx: MoneyProtectionContext, s: RuleSetting): Promise<RuleSetting> {
    const map = this.settings.get(ctx.tenantId) ?? {};
    map[s.ruleId] = s; this.settings.set(ctx.tenantId, map);
    return s;
  }

  seedReconciliation(tenantId: string, data: ReconciliationData) { this.recon.set(tenantId, data); }
  async loadReconciliationData(ctx: MoneyProtectionContext, _sinceMs: number): Promise<ReconciliationData> {
    return this.recon.get(ctx.tenantId) ?? { membershipPayments: [], giftCards: [], giftCardTxns: [], cashSessions: [] };
  }

  async platformAggregate(): Promise<PlatformAggregate> {
    const open = this.alerts.filter((a) => OPEN_STATUSES.has(a.status));
    const bySevMap = new Map<string, number>();
    for (const a of open) bySevMap.set(a.severity, (bySevMap.get(a.severity) ?? 0) + 1);
    return {
      tenantsWithOpenAlerts: new Set(open.map((a) => a.tenantId)).size,
      totalOpenAlerts: open.length,
      bySeverity: [...bySevMap.entries()].map(([severity, count]) => ({ severity, count })),
      openInvestigations: new Set(open.map((a) => a.investigationId).filter(Boolean)).size,
    };
  }

  seedActivity(tenantId: string, payments: NormalizedPayment[], refunds: NormalizedRefund[], tickets: NormalizedTicket[] = [], attempts: NormalizedAttempt[] = []) {
    this.activity.set(tenantId, { payments, refunds, tickets, attempts });
  }

  async upsertAlert(ctx: MoneyProtectionContext, c: AlertCandidate) {
    const existing = this.alerts.find(
      (a) => a.tenantId === ctx.tenantId && a.ruleId === c.ruleId &&
        a.entityFingerprint === c.entityFingerprint && a.evaluationWindow === c.evaluationWindow,
    );
    const now = new Date().toISOString();
    if (existing) {
      existing.eventCount += 1;
      existing.lastSeenAt = now;
      existing.updatedAt = now;
      return { created: false, alert: existing };
    }
    const alert: MoneyProtectionAlert = {
      ...c, id: 'mpa_' + (this.alerts.length + 1), tenantId: ctx.tenantId, status: 'NEW',
      eventCount: 1, firstSeenAt: now, lastSeenAt: now, assignedUserId: null, investigationId: null,
      createdAt: now, updatedAt: now,
    };
    this.alerts.push(alert);
    return { created: true, alert };
  }

  async listAlerts(ctx: MoneyProtectionContext, f: AlertFilters) {
    let rows = this.alerts.filter((a) => a.tenantId === ctx.tenantId);
    if (f.severity) rows = rows.filter((a) => a.severity === f.severity);
    if (f.status) rows = rows.filter((a) => a.status === f.status);
    if (f.alertType) rows = rows.filter((a) => a.alertType === f.alertType);
    if (f.branchId) rows = rows.filter((a) => a.branchId === f.branchId);
    rows = rows.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const limit = Math.min(100, Math.max(1, f.limit ?? 50));
    const page = rows.slice(0, limit);
    return { items: page, nextCursor: rows.length > limit ? page[page.length - 1].createdAt : null };
  }

  async getState(ctx: MoneyProtectionContext): Promise<MoneyProtectionState> {
    const rows = this.alerts.filter((a) => a.tenantId === ctx.tenantId);
    const open = rows.filter((a) => OPEN_STATUSES.has(a.status));
    const byTypeMap = new Map<string, number>();
    for (const a of open) byTypeMap.set(a.alertType, (byTypeMap.get(a.alertType) ?? 0) + 1);
    return {
      newAlerts: rows.filter((a) => a.status === 'NEW').length,
      highSeverityAlerts: open.filter((a) => a.severity === 'HIGH').length,
      criticalAlerts: open.filter((a) => a.severity === 'CRITICAL').length,
      openInvestigations: new Set(open.map((a) => a.investigationId).filter(Boolean)).size,
      alertsAwaitingReview: rows.filter((a) => a.status === 'NEW' || a.status === 'ACKNOWLEDGED').length,
      byType: [...byTypeMap.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
      valueUnderReviewCents: open.reduce((s, a) => s + (a.amountCents || 0), 0),
      resolvedFalsePositives: rows.filter((a) => a.status === 'DISMISSED_FALSE_POSITIVE').length,
      dataFreshness: 'realtime',
      generatedAt: new Date().toISOString(),
    };
  }

  async getAlertsByIds(ctx: MoneyProtectionContext, ids: string[]): Promise<MoneyProtectionAlert[]> {
    const set = new Set(ids);
    return this.alerts.filter((a) => a.tenantId === ctx.tenantId && set.has(a.id));
  }

  async attachInvestigation(ctx: MoneyProtectionContext, alertIds: string[], investigationId: string): Promise<void> {
    const set = new Set(alertIds);
    for (const a of this.alerts) {
      if (a.tenantId === ctx.tenantId && set.has(a.id)) {
        a.investigationId = investigationId;
        if (a.status === 'NEW' || a.status === 'ACKNOWLEDGED') a.status = 'INVESTIGATING';
        a.updatedAt = new Date().toISOString();
      }
    }
  }

  async loadActivity(ctx: MoneyProtectionContext, _sinceMs: number) {
    return this.activity.get(ctx.tenantId) ?? { payments: [], refunds: [], tickets: [], attempts: [] };
  }
}
