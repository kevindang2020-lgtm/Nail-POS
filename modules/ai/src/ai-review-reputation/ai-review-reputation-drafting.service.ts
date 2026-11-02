// ai-review-reputation-drafting.service.ts — orchestrates draft generation, the approval workflow, publication, and the
// controlled auto-response path. Every generated draft (from any model, any directive) is re-validated for safety before
// it can be stored/approved/published. A public response reaches `published` only from `approved` (manual) or the audited
// auto-response gate — and even the auto path re-runs the safety validator and is disabled the moment config says so.
import { autoResponseDecision, validateDraftSafety, transitionResponse, canPublish, type ResponseStatus, type DraftDirective } from './ai-review-reputation-drafting';
import { hasPermission } from '@aipowersalon/permissions';
import { buildDraftingPayload, type TenantAiContext } from './ai-review-reputation-context';
import type { ReviewAnalysis } from './ai-review-reputation-core';
import type { ReputationConfig } from './ai-review-reputation-settings';

export class DraftingForbiddenError extends Error { constructor(m: string) { super(m); this.name = 'DraftingForbiddenError'; } }

const CAP_MANAGE = 'pos.ai_review_reputation.manage';   // reuse existing reputation/marketing write capability (no new mint)

export interface DraftLlmPort { draft(ctx: DraftingCtx, payload: { system: string; fencedReview: string; guardrails: string[] }, directive: DraftDirective, priorText?: string | null): Promise<string>; }
export interface DraftStorePort {
  get(ctx: DraftingCtx, reviewId: string): Promise<{ status: ResponseStatus; text: string | null; version: number } | null>;
  save(ctx: DraftingCtx, reviewId: string, patch: { status?: ResponseStatus; text?: string; version?: number; isAuto?: boolean }): Promise<void>;
  addVersion(ctx: DraftingCtx, reviewId: string, version: number, text: string, editedByUserId: string | null, isAi: boolean): Promise<void>;
}
export interface ApprovalStorePort { record(ctx: DraftingCtx, reviewId: string, action: string, reason?: string | null, version?: number | null): Promise<void>; }
export interface PublicationPort { publish(ctx: DraftingCtx, reviewId: string, text: string, isAuto: boolean): Promise<{ externalResponseId: string }>; }
export interface DraftAuditPort { record(who: { tenantId: string; branchId?: string | null; userId: string; role: string }, ev: { action: string; reviewId: string; metadata?: Record<string, unknown> }): void; }

export interface DraftingCtx { tenantId: string; branchId?: string | null; userId: string; role: string; permissions: string[]; }

export interface GenerateInput { analysis: ReviewAnalysis; config: ReputationConfig; tenantContext: TenantAiContext; reviewText: string | null; employeeNames?: string[]; directive?: DraftDirective; }

export class ReviewDraftingService {
  constructor(
    private readonly llm: DraftLlmPort,
    private readonly drafts: DraftStorePort,
    private readonly approvals: ApprovalStorePort,
    private readonly publication: PublicationPort,
    private readonly auditSvc?: DraftAuditPort,
  ) {}

  private need(ctx: DraftingCtx, cap: string) {
    if (!ctx?.userId || !ctx?.tenantId) throw new DraftingForbiddenError('Not authenticated');
    if (!hasPermission(ctx as any, cap)) throw new DraftingForbiddenError('Missing ' + cap);
  }
  private audit(ctx: DraftingCtx, action: string, reviewId: string, meta?: Record<string, unknown>) {
    this.auditSvc?.record({ tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, role: ctx.role }, { action, reviewId, metadata: meta });
  }

  /** Generate or transform a draft. ALWAYS validates the output; an unsafe draft is blocked (never stored/published). */
  async generateDraft(ctx: DraftingCtx, reviewId: string, input: GenerateInput): Promise<{ text: string; version: number; status: ResponseStatus }> {
    this.need(ctx, CAP_MANAGE);
    const directive = input.directive ?? 'generate';
    const prior = (await this.drafts.get(ctx, reviewId))?.text ?? null;
    const payload = buildDraftingPayload(input.tenantContext, input.reviewText, { sentiment: input.analysis.sentiment, severity: input.analysis.severity, categories: input.analysis.categories });
    const text = (await this.llm.draft(ctx, payload, directive, prior)).trim();

    const safety = validateDraftSafety(text, { employeeNames: input.employeeNames });
    if (!safety.safe) { this.audit(ctx, 'draft_blocked_unsafe', reviewId, { violations: safety.violations }); const e: any = new Error('DRAFT_UNSAFE'); e.violations = safety.violations; throw e; }

    const existing = await this.drafts.get(ctx, reviewId);
    const version = (existing?.version ?? 0) + 1;
    await this.drafts.save(ctx, reviewId, { status: 'draft_generated', text, version });
    await this.drafts.addVersion(ctx, reviewId, version, text, ctx.userId, true);
    this.audit(ctx, 'draft_generated', reviewId, { directive, version });
    return { text, version, status: 'draft_generated' };
  }

  async requestApproval(ctx: DraftingCtx, reviewId: string) {
    this.need(ctx, CAP_MANAGE);
    const d = await this.drafts.get(ctx, reviewId); if (!d) throw new Error('DRAFT_NOT_FOUND');
    const status = transitionResponse(d.status, 'awaiting_approval');
    await this.drafts.save(ctx, reviewId, { status });
    await this.approvals.record(ctx, reviewId, 'requested', null, d.version);
    this.audit(ctx, 'approval_requested', reviewId, {}); return { status };
  }

  async approve(ctx: DraftingCtx, reviewId: string) {
    this.need(ctx, CAP_MANAGE);
    const d = await this.drafts.get(ctx, reviewId); if (!d) throw new Error('DRAFT_NOT_FOUND');
    const status = transitionResponse(d.status, 'approved');
    await this.drafts.save(ctx, reviewId, { status });
    await this.approvals.record(ctx, reviewId, 'approved', null, d.version);
    this.audit(ctx, 'approved', reviewId, {}); return { status };
  }

  async reject(ctx: DraftingCtx, reviewId: string, reason: string) {
    this.need(ctx, CAP_MANAGE);
    const d = await this.drafts.get(ctx, reviewId); if (!d) throw new Error('DRAFT_NOT_FOUND');
    const status = transitionResponse(d.status, 'rejected');
    await this.drafts.save(ctx, reviewId, { status });
    await this.approvals.record(ctx, reviewId, 'rejected', String(reason || '').slice(0, 500), d.version);
    this.audit(ctx, 'rejected', reviewId, {}); return { status };
  }

  /** Publish an APPROVED draft (delegates to the source integration). */
  async publish(ctx: DraftingCtx, reviewId: string) {
    this.need(ctx, CAP_MANAGE);
    const d = await this.drafts.get(ctx, reviewId); if (!d || !d.text) throw new Error('DRAFT_NOT_FOUND');
    if (!canPublish(d.status)) throw new Error('NOT_APPROVED');
    // final safety re-validation immediately before publishing
    if (!validateDraftSafety(d.text).safe) throw new Error('DRAFT_UNSAFE');
    await this.drafts.save(ctx, reviewId, { status: transitionResponse(d.status, 'publishing') });
    try {
      const { externalResponseId } = await this.publication.publish(ctx, reviewId, d.text, false);
      await this.drafts.save(ctx, reviewId, { status: 'published' });
      this.audit(ctx, 'published', reviewId, { externalResponseId }); return { status: 'published' as ResponseStatus, externalResponseId };
    } catch (e: any) {
      await this.drafts.save(ctx, reviewId, { status: 'publish_failed' });
      this.audit(ctx, 'publish_failed', reviewId, { error: String(e?.message || 'error') });
      throw new Error('PUBLISH_FAILED');
    }
  }

  /** Controlled auto-response. Only proceeds when the gate allows AND the generated draft passes safety. Falls back to
   *  human approval otherwise. Disabled the instant config says so (the gate re-checks live config). */
  async autoRespond(ctx: DraftingCtx, reviewId: string, input: GenerateInput & { rating: number | null }): Promise<{ autoResponded: boolean; reason: string; externalResponseId?: string }> {
    const gate = autoResponseDecision(input.analysis, input.rating, input.config);
    if (!gate.allow) { this.audit(ctx, 'auto_response_skipped', reviewId, { reason: gate.reason }); return { autoResponded: false, reason: gate.reason }; }

    // generate via an approved template/policy path, then re-validate
    const payload = buildDraftingPayload(input.tenantContext, input.reviewText, { sentiment: input.analysis.sentiment, severity: input.analysis.severity, categories: input.analysis.categories });
    const text = (await this.llm.draft(ctx, payload, 'generate', null)).trim();
    const safety = validateDraftSafety(text, { employeeNames: input.employeeNames });
    if (!safety.safe) { this.audit(ctx, 'auto_response_blocked_unsafe', reviewId, { violations: safety.violations }); return { autoResponded: false, reason: 'draft_unsafe_fell_back_to_human' }; }

    const version = ((await this.drafts.get(ctx, reviewId))?.version ?? 0) + 1;
    await this.drafts.save(ctx, reviewId, { status: 'draft_generated', text, version, isAuto: true });
    await this.drafts.addVersion(ctx, reviewId, version, text, null, true);
    await this.approvals.record(ctx, reviewId, 'auto_approved', null, version);
    const { externalResponseId } = await this.publication.publish(ctx, reviewId, text, true);
    await this.drafts.save(ctx, reviewId, { status: 'published' });
    this.audit(ctx, 'auto_response_published', reviewId, { version, externalResponseId });
    return { autoResponded: true, reason: 'ok', externalResponseId };
  }
}
