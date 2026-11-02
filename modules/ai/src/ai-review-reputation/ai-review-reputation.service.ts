// ai-review-reputation.service.ts — the facade the controller talks to. It composes the verified sub-services
// (drafting/approval, escalation/recovery, requests, analytics) and adds read/settings/sync/notes ports. Business logic
// lives in the sub-services and the pure cores; this layer only orchestrates and enforces auth/tenant context.
import { hasPermission } from '@aipowersalon/permissions';
import { analyzeReview, type ReviewAnalysis } from './ai-review-reputation-core';
import { resolveSettings, rowsToLayers, PLATFORM_DEFAULTS, type ReputationConfig, type EffectiveSettings, type SettingsRow } from './ai-review-reputation-settings';
import { buildTenantContext, type TenantContextInput } from './ai-review-reputation-context';
import { computeReputationMetrics, computeTrend, compareBranches, type ReviewForMetrics, type ResponseForMetrics, type RequestForMetrics, type BranchMetrics } from './ai-review-reputation-analytics';
import { ReviewDraftingService } from './ai-review-reputation-drafting.service';
import { EscalationService } from './ai-review-reputation-escalation.service';
import { ReviewIngestionService, REVIEW_SOURCES, type ReviewSourceAdapter } from './ai-review-reputation-ingest';

export class ReputationForbiddenError extends Error { constructor(m = 'FORBIDDEN') { super(m); this.name = 'ReputationForbiddenError'; } }
const VIEW = 'pos.ai_review_reputation.view';
const MANAGE = 'pos.ai_review_reputation.manage';

export interface RepCtx { tenantId: string; branchId?: string | null; userId: string; role: string; permissions: string[]; }

export interface ReviewReadPort {
  inbox(ctx: RepCtx, filters: Record<string, unknown>): Promise<{ items: any[]; pagination: { page: number; pageSize: number; totalItems: number; totalPages: number } }>;
  detail(ctx: RepCtx, reviewId: string): Promise<any | null>;
  metricsInputs(ctx: RepCtx, range: { from?: string; to?: string; branchId?: string }): Promise<{ reviews: ReviewForMetrics[]; responses: ResponseForMetrics[]; requests: RequestForMetrics[] }>;
  branchMetricsInputs(ctx: RepCtx, range: { from?: string; to?: string }): Promise<BranchMetrics[]>;
  authorizedBranches(ctx: RepCtx): Promise<'all' | string[]>;
  addNote(ctx: RepCtx, reviewId: string, note: string): Promise<{ id: string }>;
  setResolution(ctx: RepCtx, reviewId: string, status: string): Promise<void>;
  integrationStatus(ctx: RepCtx): Promise<{ source: string; connected: boolean; lastSyncAt: string | null }[]>;
}
export interface SettingsPort { load(ctx: RepCtx): Promise<SettingsRow[]>; save(ctx: RepCtx, level: 'tenant' | 'branch', branchId: string | null, enabled: boolean | null, config: Partial<ReputationConfig> | null): Promise<void>; tenantContextInput(ctx: RepCtx, config: ReputationConfig): Promise<TenantContextInput>; }

export class AiReviewReputationService {
  constructor(
    private readonly read: ReviewReadPort,
    private readonly settings: SettingsPort,
    private readonly drafting: ReviewDraftingService,
    private readonly escalation: EscalationService,
    private readonly ingestion: ReviewIngestionService,
    private readonly adapters: Map<string, ReviewSourceAdapter> = new Map(),
  ) {}

  private need(ctx: RepCtx, cap: string) { if (!ctx?.userId || !ctx?.tenantId) throw new ReputationForbiddenError('NOT_AUTHENTICATED'); if (!hasPermission(ctx as any, cap)) throw new ReputationForbiddenError('FORBIDDEN'); }

  async effectiveSettings(ctx: RepCtx): Promise<EffectiveSettings> {
    const rows = await this.settings.load(ctx);
    return resolveSettings({ platform: PLATFORM_DEFAULTS, ...rowsToLayers(rows as SettingsRow[], { branchId: ctx.branchId ?? undefined }) });
  }

  // ---- reads ----
  async inbox(ctx: RepCtx, filters: Record<string, unknown>) { this.need(ctx, VIEW); return this.read.inbox(ctx, filters); }
  async detail(ctx: RepCtx, reviewId: string) { this.need(ctx, VIEW); const d = await this.read.detail(ctx, reviewId); if (!d) throw new Error('REVIEW_NOT_FOUND'); return d; }
  async integrationStatus(ctx: RepCtx) { this.need(ctx, VIEW); return this.read.integrationStatus(ctx); }

  // ---- sync + analyze ----
  async sync(ctx: RepCtx, source: string, since?: string | null) {
    this.need(ctx, MANAGE);
    // §163 run 3 (Oct 27 2026): a source outside the vocabulary is the caller's mistake (400), not a disconnected integration (502)
    if (!(REVIEW_SOURCES as readonly string[]).includes(source)) throw new Error('VALIDATION_ERROR');
    const adapter = this.adapters.get(source); if (!adapter) throw new Error('INTEGRATION_DISCONNECTED');
    return this.ingestion.sync({ tenantId: ctx.tenantId, branchId: ctx.branchId ?? null }, adapter, since ?? null);
  }
  analyze(text: string | null, rating: number | null): ReviewAnalysis { return analyzeReview({ text, rating }); }

  // ---- drafting / approval (delegates) ----
  async draft(ctx: RepCtx, reviewId: string, directive: any, review: { text: string | null }) {
    const eff = await this.effectiveSettings(ctx);
    const tc = buildTenantContext(await this.settings.tenantContextInput(ctx, eff.config));
    const analysis = this.analyze(review.text, null);
    return this.drafting.generateDraft(ctx, reviewId, { analysis, config: eff.config, tenantContext: tc, reviewText: review.text, directive });
  }
  requestApproval(ctx: RepCtx, id: string) { return this.drafting.requestApproval(ctx, id); }
  approve(ctx: RepCtx, id: string) { return this.drafting.approve(ctx, id); }
  reject(ctx: RepCtx, id: string, reason: string) { return this.drafting.reject(ctx, id, reason); }
  publish(ctx: RepCtx, id: string) { return this.drafting.publish(ctx, id); }

  // ---- escalation / recovery (delegates) ----
  acknowledge(ctx: RepCtx, escId: string) { return this.escalation.acknowledge(ctx, escId); }
  assign(ctx: RepCtx, escId: string, userId: string) { return this.escalation.assign(ctx, escId, userId); }
  resolve(ctx: RepCtx, escId: string, reviewId: string) { return this.escalation.resolve(ctx, escId, reviewId); }
  urgentQueue(ctx: RepCtx) { return this.escalation.urgentQueue(ctx); }
  recommendRecovery(ctx: RepCtx, reviewId: string, analysis: ReviewAnalysis, rating: number | null) { return this.escalation.recommendRecovery(ctx, reviewId, analysis, rating); }
  recordRecovery(ctx: RepCtx, reviewId: string, type: any) { return this.escalation.recordRecoveryAction(ctx, reviewId, type); }
  async addNote(ctx: RepCtx, reviewId: string, note: string) { this.need(ctx, MANAGE); if (!note?.trim()) throw new Error('VALIDATION_ERROR'); return this.read.addNote(ctx, reviewId, note.trim().slice(0, 4000)); }

  // ---- analytics + branch comparison ----
  async analytics(ctx: RepCtx, range: { from?: string; to?: string; branchId?: string }, prevRange?: { from?: string; to?: string; branchId?: string }) {
    this.need(ctx, VIEW);
    const cur = await this.read.metricsInputs(ctx, range);
    const metrics = computeReputationMetrics(cur.reviews, cur.responses, cur.requests);
    let trend = null;
    if (prevRange) { const prev = await this.read.metricsInputs(ctx, prevRange); trend = computeTrend(metrics, computeReputationMetrics(prev.reviews, prev.responses, prev.requests)); }
    return { metrics, trend };
  }
  async branchComparison(ctx: RepCtx, range: { from?: string; to?: string }) {
    this.need(ctx, VIEW);
    const [branches, visible] = await Promise.all([this.read.branchMetricsInputs(ctx, range), this.read.authorizedBranches(ctx)]);
    return compareBranches(branches, visible);
  }

  // ---- settings ----
  async getSettings(ctx: RepCtx) { this.need(ctx, VIEW); return this.effectiveSettings(ctx); }
  async updateSettings(ctx: RepCtx, level: 'tenant' | 'branch', branchId: string | null, enabled: boolean | null, config: Partial<ReputationConfig> | null) {
    this.need(ctx, MANAGE);
    if (level === 'branch' && !branchId) throw new Error('VALIDATION_ERROR');
    await this.settings.save(ctx, level, branchId, enabled, config);
    return this.effectiveSettings(ctx);
  }
}
