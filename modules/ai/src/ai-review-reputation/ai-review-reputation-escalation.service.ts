// ai-review-reputation-escalation.service.ts — serious-complaint escalation + recovery. `raise` is idempotent per review
// (called by ingestion/analysis), sends a secure-link-only notification (never review content), and flags the review.
// Recovery actions are RECORDED as recommendations; financial ones carry requiresAuthorization and must be executed by
// the existing refund/credit/loyalty/discount systems — this service never issues money and has no payment port.
import { recommendRecoveryActions, buildEscalation, buildSecureNotification, transitionEscalation, isFinancialAction, type EscalationStatus, type RecoveryActionType, type RecoveryRecommendation } from './ai-review-reputation-recovery';
import { hasPermission } from '@aipowersalon/permissions';
import type { ReviewAnalysis } from './ai-review-reputation-core';

export class EscalationForbiddenError extends Error { constructor(m: string) { super(m); this.name = 'EscalationForbiddenError'; } }
const CAP_MANAGE = 'pos.ai_review_reputation.manage';

export interface EscCtx { tenantId: string; branchId?: string | null; userId: string; role: string; permissions: string[]; }

export interface EscalationStorePort {
  findByReview(ctx: EscCtx, reviewId: string): Promise<{ id: string; status: EscalationStatus } | null>;
  create(ctx: EscCtx, reviewId: string, severity: string, signals: string[]): Promise<{ id: string }>;
  setStatus(ctx: EscCtx, id: string, status: EscalationStatus, at: string): Promise<void>;
  assign(ctx: EscCtx, id: string, userId: string): Promise<void>;
  listOpen(ctx: EscCtx): Promise<{ id: string; reviewId: string; severity: string; status: EscalationStatus; createdAt: string }[]>;
}
export interface SecureNotifyPort { sendSecure(ctx: EscCtx, recipients: string[], n: { severity: string; reviewId: string; secureLink: string; summary: string; containsPii: false }): Promise<void>; }
export interface RecoveryStorePort { record(ctx: EscCtx, reviewId: string, type: RecoveryActionType, requiresAuthorization: boolean, delegatesTo: string | null): Promise<{ id: string; status: 'recommended' }>; }
export interface ReviewStatusPort { setEscalationStatus(ctx: EscCtx, reviewId: string, status: string): Promise<void>; setResolution(ctx: EscCtx, reviewId: string, status: string): Promise<void>; }
export interface EscAuditPort { record(who: { tenantId: string; userId: string; role: string }, ev: { action: string; reviewId?: string; escalationId?: string; metadata?: Record<string, unknown> }): void; }

const SEV_RANK: Record<string, number> = { low: 0, medium: 1, high: 2, critical: 3 };

export class EscalationService {
  constructor(
    private readonly store: EscalationStorePort,
    private readonly notify: SecureNotifyPort,
    private readonly recovery: RecoveryStorePort,
    private readonly reviewStatus: ReviewStatusPort,
    private readonly auditSvc?: EscAuditPort,
    private readonly baseUrl = '',
  ) {}

  private need(ctx: EscCtx, cap: string) { if (!ctx?.userId || !ctx?.tenantId) throw new EscalationForbiddenError('Not authenticated'); if (!hasPermission(ctx as any, cap)) throw new EscalationForbiddenError('Missing ' + cap); }
  private audit(ctx: EscCtx, action: string, ev: { reviewId?: string; escalationId?: string; metadata?: Record<string, unknown> }) { this.auditSvc?.record({ tenantId: ctx.tenantId, userId: ctx.userId, role: ctx.role }, { action, ...ev }); }

  /** Idempotent per review. System-invoked (ingestion/analysis) — no user permission gate; notification is link-only. */
  async raise(ctx: EscCtx, reviewId: string, analysis: ReviewAnalysis, recipients: string[] = []): Promise<{ escalationId: string; created: boolean }> {
    const esc = buildEscalation(analysis);
    if (!esc) return { escalationId: '', created: false };
    const existing = await this.store.findByReview(ctx, reviewId);
    if (existing) return { escalationId: existing.id, created: false };   // idempotent — one escalation per review
    const { id } = await this.store.create(ctx, reviewId, esc.severity, esc.signals);
    await this.reviewStatus.setEscalationStatus(ctx, reviewId, 'escalated');
    const n = buildSecureNotification(reviewId, esc.severity, this.baseUrl);
    if (recipients.length) await this.notify.sendSecure(ctx, recipients, n);   // NO review text leaves the system
    this.audit(ctx, 'escalation_raised', { reviewId, escalationId: id, metadata: { severity: esc.severity, signals: esc.signals } });
    return { escalationId: id, created: true };
  }

  async acknowledge(ctx: EscCtx, escalationId: string) {
    this.need(ctx, CAP_MANAGE);
    const cur = await this.currentStatus(ctx, escalationId);
    await this.store.setStatus(ctx, escalationId, transitionEscalation(cur, 'acknowledged'), new Date().toISOString());
    this.audit(ctx, 'escalation_acknowledged', { escalationId }); return { status: 'acknowledged' as EscalationStatus };
  }
  async assign(ctx: EscCtx, escalationId: string, userId: string) {
    this.need(ctx, CAP_MANAGE);
    await this.store.assign(ctx, escalationId, userId);
    this.audit(ctx, 'escalation_assigned', { escalationId, metadata: { userId } }); return { assigned: true };
  }
  async resolve(ctx: EscCtx, escalationId: string, reviewId: string) {
    this.need(ctx, CAP_MANAGE);
    const cur = await this.currentStatus(ctx, escalationId);
    await this.store.setStatus(ctx, escalationId, transitionEscalation(cur, 'resolved'), new Date().toISOString());
    await this.reviewStatus.setResolution(ctx, reviewId, 'resolved');
    this.audit(ctx, 'escalation_resolved', { escalationId, reviewId }); return { status: 'resolved' as EscalationStatus };
  }
  private async currentStatus(ctx: EscCtx, escalationId: string): Promise<EscalationStatus> {
    const open = await this.store.listOpen(ctx);
    const row = open.find((r) => r.id === escalationId);
    return row?.status ?? 'open';
  }

  /** Urgent queue: open escalations, critical first. */
  async urgentQueue(ctx: EscCtx) {
    this.need(ctx, 'pos.ai_review_reputation.view');
    const rows = await this.store.listOpen(ctx);
    return rows.slice().sort((a, b) => (SEV_RANK[b.severity] ?? 0) - (SEV_RANK[a.severity] ?? 0) || a.createdAt.localeCompare(b.createdAt));
  }

  /** Read-only recovery recommendations. */
  async recommendRecovery(ctx: EscCtx, _reviewId: string, analysis: ReviewAnalysis, rating: number | null): Promise<RecoveryRecommendation[]> {
    this.need(ctx, 'pos.ai_review_reputation.view');
    return recommendRecoveryActions(analysis, rating);
  }

  /** Record a chosen recovery action as a RECOMMENDATION. Financial actions carry requiresAuthorization and are executed
   *  ONLY by the existing refund/credit/loyalty/discount systems — never here. */
  async recordRecoveryAction(ctx: EscCtx, reviewId: string, type: RecoveryActionType) {
    this.need(ctx, CAP_MANAGE);
    const requiresAuthorization = isFinancialAction(type);
    const rec = await this.recovery.record(ctx, reviewId, type, requiresAuthorization, requiresAuthorization ? financialSystem(type) : null);
    this.audit(ctx, 'recovery_action_recorded', { reviewId, metadata: { type, requiresAuthorization } });
    return { ...rec, requiresAuthorization, executed: false };   // never executed by this module
  }
}

function financialSystem(t: RecoveryActionType): string {
  const map: Partial<Record<RecoveryActionType, string>> = { partial_refund_review: 'refunds', full_refund_review: 'refunds', account_credit: 'credits', loyalty_points: 'loyalty', discount_future: 'discounts', complimentary_addon: 'services' };
  return map[t] ?? 'unknown';
}
