// ai-review-reputation.kysely.ts — Kysely-backed implementations of the module's ports. All queries are tenant-scoped
// from ctx (never a client value). Column names match migration 322. Publication stays external (INTEGRATION_DISCONNECTED
// until a real Google/Facebook adapter is wired) — this file is the DB binding, not the integration binding.
import type { Kysely } from 'kysely';
import { applyListQuery, parseListQuery, type DB } from '@aipowersalon/database';
import { canMoveToSql } from '@aipowersalon/database';
import { REVIEW_ESCALATION } from '../ai-lifecycles';
import { REVIEW_INBOX_SPEC } from './ai-review-reputation.list-queries';
import { computeContentHash, type NormalizedReview, type ReviewStorePort, type IngestContext } from './ai-review-reputation-ingest';
import type { ReviewAnalysis } from './ai-review-reputation-core';
import type { DraftStorePort, ApprovalStorePort } from './ai-review-reputation-drafting.service';
import type { ResponseStatus } from './ai-review-reputation-drafting';
import type { EscalationStorePort, RecoveryStorePort, ReviewStatusPort, EscCtx } from './ai-review-reputation-escalation.service';
import type { RecoveryActionType } from './ai-review-reputation-recovery';
import type { RequestStorePort, ConsentPort, ReqCtx } from './ai-review-reputation-requests.service';
import type { ReviewReadPort, SettingsPort, RepCtx } from './ai-review-reputation.service';
import type { SettingsRow, ReputationConfig } from './ai-review-reputation-settings';
import type { TenantContextInput } from './ai-review-reputation-context';
import { hasTenantWideScope } from '@aipowersalon/permissions';

const now = () => new Date().toISOString();
const tid = (ctx: { tenantId: string }) => ctx.tenantId;

// ---- ingestion: reviews + review_analysis ----
export class KyselyReviewStore implements ReviewStorePort {
  constructor(private readonly db: Kysely<DB>) {}
  async findByDedupeKey(ctx: IngestContext, source: string, externalReviewId: string) {
    const r: any = await this.db.selectFrom('reviews').select(['id', 'rating', 'comment', 'is_public']).where('tenant_id', '=', tid(ctx)).where('source', '=', source).where('external_review_id', '=', externalReviewId).executeTakeFirst().catch(() => null);
    if (!r) return null;
    // recompute the content hash from the stored row so re-sync detects real changes without an extra column
    return { id: String(r.id), contentHash: computeContentHash(r.rating == null ? null : Number(r.rating), r.comment ?? null, !!r.is_public) };
  }
  async insert(ctx: IngestContext, n: NormalizedReview, analysis: ReviewAnalysis) {
    const row: any = await this.db.insertInto('reviews').values({
      tenant_id: tid(ctx), branch_id: n.branchId, customer_id: n.customerId, source: n.source, external_review_id: n.externalReviewId,
      appointment_id: n.appointmentId, rating: n.rating ?? 0, comment: n.comment, reviewer_name: n.reviewerName, reviewer_url: n.reviewerUrl,
      review_date: n.reviewDate, is_public: n.isPublic, sentiment: analysis.sentiment, severity: analysis.severity,
      ai_confidence: analysis.confidence, is_spam: analysis.isSpam, escalation_status: analysis.escalationRequired ? 'flagged' : 'none',
      response_status: 'analyzed', last_synced_at: now(),
    } as any).returning(['id']).executeTakeFirstOrThrow();
    await this.writeAnalysis(ctx, String(row.id), n.branchId, analysis);
    return { id: String(row.id) };
  }
  async update(ctx: IngestContext, id: string, n: NormalizedReview, analysis: ReviewAnalysis) {
    await this.db.updateTable('reviews').set({ rating: n.rating ?? 0, comment: n.comment, is_public: n.isPublic, sentiment: analysis.sentiment, severity: analysis.severity, ai_confidence: analysis.confidence, is_spam: analysis.isSpam, last_synced_at: now(), updated_at: now() }).where('tenant_id', '=', tid(ctx)).where('id', '=', id).execute().catch(() => {});
    await this.writeAnalysis(ctx, id, n.branchId, analysis);
  }
  private async writeAnalysis(ctx: IngestContext, reviewId: string, branchId: string | null, a: ReviewAnalysis) {
    await this.db.insertInto('review_analysis').values({
      tenant_id: tid(ctx), branch_id: branchId, review_id: reviewId, sentiment: a.sentiment, severity: a.severity,
      categories: JSON.stringify(a.categories), serious_signals: JSON.stringify(a.seriousSignals), escalation_required: a.escalationRequired,
      auto_response_eligible: a.autoResponseEligible, is_spam: a.isSpam, injection_suspected: a.injectionSuspected, confidence: a.confidence,
      analysis_source: a.source, processing_status: 'done',
    }).execute().catch(() => {});
  }
}

// ---- drafting: review_response_drafts + _versions ----
export class KyselyDraftStore implements DraftStorePort {
  constructor(private readonly db: Kysely<DB>) {}
  async get(ctx: { tenantId: string }, reviewId: string) {
    const r: any = await this.db.selectFrom('review_response_drafts').select(['status', 'current_text', 'current_version']).where('tenant_id', '=', tid(ctx)).where('review_id', '=', reviewId).executeTakeFirst().catch(() => null);
    return r ? { status: r.status as ResponseStatus, text: r.current_text ?? null, version: Number(r.current_version) || 0 } : null;
  }
  async save(ctx: { tenantId: string; branchId?: string | null }, reviewId: string, patch: { status?: ResponseStatus; text?: string; version?: number; isAuto?: boolean }) {
    // Review & Reputation guide (Nov 2 2026): writes no longer swallow errors (an approval that did not save used to answer
    // "approved"), and the review's own response_status follows the draft — the inbox, the KPIs and the approval queue
    // read the same state (Awaiting approval / Response rate were stuck at 0 because nothing updated reviews.response_status).
    const existing = await this.get(ctx, reviewId);
    if (!existing) {
      await this.db.insertInto('review_response_drafts').values({ tenant_id: tid(ctx), branch_id: ctx.branchId ?? null, review_id: reviewId, status: patch.status ?? 'draft_generated', current_text: patch.text ?? null, current_version: patch.version ?? 1, is_auto: !!patch.isAuto }).execute();
    } else {
      const set: any = { updated_at: now() };
      if (patch.status) set.status = patch.status; if (patch.text !== undefined) set.current_text = patch.text; if (patch.version !== undefined) set.current_version = patch.version; if (patch.isAuto !== undefined) set.is_auto = patch.isAuto;
      await this.db.updateTable('review_response_drafts').set(set).where('tenant_id', '=', tid(ctx)).where('review_id', '=', reviewId).execute();
    }
    const status = patch.status ?? (existing ? undefined : 'draft_generated');
    if (status) await this.db.updateTable('reviews').set({ response_status: status, updated_at: now() }).where('tenant_id', '=', tid(ctx)).where('id', '=', reviewId).execute();
  }
  async addVersion(ctx: { tenantId: string }, reviewId: string, version: number, text: string, editedByUserId: string | null, isAi: boolean) {
    const d: any = await this.db.selectFrom('review_response_drafts').select(['id']).where('tenant_id', '=', tid(ctx)).where('review_id', '=', reviewId).executeTakeFirst();
    await this.db.insertInto('review_response_versions').values({ tenant_id: tid(ctx), draft_id: d ? String(d.id) : reviewId, review_id: reviewId, version, text, edited_by_user_id: editedByUserId, is_ai_generated: isAi }).execute();
  }
}
export class KyselyApprovalStore implements ApprovalStorePort {
  constructor(private readonly db: Kysely<DB>) {}
  async record(ctx: { tenantId: string }, reviewId: string, action: string, reason?: string | null, version?: number | null) {
    // the real draft id (it used to store the review id), the acting user, and no swallowed failure
    const d: any = await this.db.selectFrom('review_response_drafts').select(['id']).where('tenant_id', '=', tid(ctx)).where('review_id', '=', reviewId).executeTakeFirst();
    await this.db.insertInto('review_approvals').values({ tenant_id: tid(ctx), review_id: reviewId, draft_id: d ? String(d.id) : reviewId, action, actor_user_id: (ctx as { userId?: string }).userId ?? null, reason: reason ?? null, version: version ?? null }).execute();
  }
}

// ---- escalation + recovery + review status ----
export class KyselyEscalationStore implements EscalationStorePort {
  constructor(private readonly db: Kysely<DB>) {}
  async findByReview(ctx: EscCtx, reviewId: string) {
    const r: any = await this.db.selectFrom('review_escalations').select(['id', 'status']).where('tenant_id', '=', tid(ctx)).where('review_id', '=', reviewId).executeTakeFirst().catch(() => null);
    return r ? { id: String(r.id), status: r.status } : null;
  }
  async create(ctx: EscCtx, reviewId: string, severity: string, signals: string[]) {
    const r: any = await this.db.insertInto('review_escalations').values({ tenant_id: tid(ctx), branch_id: ctx.branchId ?? null, review_id: reviewId, severity, signals: JSON.stringify(signals), status: 'open' }).returning(['id']).executeTakeFirstOrThrow();
    return { id: String(r.id) };
  }
  async setStatus(ctx: EscCtx, id: string, status: any, at: string) {
    const set: any = { status }; if (status === 'acknowledged') set.acknowledged_at = at; if (status === 'resolved') set.resolved_at = at;
    await this.db.updateTable('review_escalations').set(set).where('tenant_id', '=', tid(ctx)).where('id', '=', id).where(canMoveToSql(REVIEW_ESCALATION, status) as any).execute();   // Phase 12 (#27)
  }
  async assign(ctx: EscCtx, id: string, userId: string) { await this.db.updateTable('review_escalations').set({ assigned_user_id: userId }).where('tenant_id', '=', tid(ctx)).where('id', '=', id).execute(); }
  async listOpen(ctx: EscCtx) {
    const rows: any[] = await this.db.selectFrom('review_escalations').select(['id', 'review_id', 'severity', 'status', 'created_at']).where('tenant_id', '=', tid(ctx)).where('status', '!=', 'resolved').limit(500).execute().catch(() => []);
    return rows.map((r) => ({ id: String(r.id), reviewId: String(r.review_id), severity: String(r.severity), status: r.status, createdAt: r.created_at ? new Date(r.created_at).toISOString() : '' }));
  }
}
export class KyselyRecoveryStore implements RecoveryStorePort {
  constructor(private readonly db: Kysely<DB>) {}
  async record(ctx: EscCtx, reviewId: string, type: RecoveryActionType, _req: boolean, _del: string | null) {
    // §163 run 3: the review must be this salon's — an unknown id is REVIEW_NOT_FOUND (404), never a foreign-key 500
    const review = await this.db.selectFrom('reviews').select('id').where('tenant_id', '=', tid(ctx)).where('id', '=', reviewId).executeTakeFirst();
    if (!review) throw new Error('REVIEW_NOT_FOUND');
    const r: any = await this.db.insertInto('review_recovery_actions').values({ tenant_id: tid(ctx), review_id: reviewId, action_type: type, status: 'recommended', created_by_user_id: ctx.userId }).returning(['id']).executeTakeFirstOrThrow();
    return { id: String(r.id), status: 'recommended' as const };
  }
}
export class KyselyReviewStatus implements ReviewStatusPort {
  constructor(private readonly db: Kysely<DB>) {}
  async setEscalationStatus(ctx: EscCtx, reviewId: string, status: string) { await this.db.updateTable('reviews').set({ escalation_status: status, updated_at: now() }).where('tenant_id', '=', tid(ctx)).where('id', '=', reviewId).execute().catch(() => {}); }
  async setResolution(ctx: EscCtx, reviewId: string, status: string) { await this.db.updateTable('reviews').set({ resolution_status: status, updated_at: now() }).where('tenant_id', '=', tid(ctx)).where('id', '=', reviewId).execute().catch(() => {}); }
}

// ---- requests + consent ----
export class KyselyRequestStore implements RequestStorePort {
  constructor(private readonly db: Kysely<DB>) {}
  async findByIdem(ctx: ReqCtx, idempotencyKey: string) {
    const r: any = await this.db.selectFrom('review_requests').select(['id']).where('tenant_id', '=', tid(ctx)).where('idempotency_key', '=', idempotencyKey).executeTakeFirst().catch(() => null);
    return r ? { id: String(r.id) } : null;
  }
  async create(ctx: ReqCtx, row: { customerId: string; appointmentId: string | null; channel: string; idempotencyKey: string; scheduledFor: string }) {
    const r: any = await this.db.insertInto('review_requests').values({ tenant_id: tid(ctx), branch_id: ctx.branchId ?? null, customer_id: row.customerId, appointment_id: row.appointmentId, channel: row.channel, status: 'scheduled', idempotency_key: row.idempotencyKey, scheduled_for: row.scheduledFor }).returning(['id']).executeTakeFirstOrThrow();
    return { id: String(r.id) };
  }
  async listDue(ctx: ReqCtx, nowIso: string) {
    const rows: any[] = await this.db.selectFrom('review_requests').select(['id', 'customer_id', 'appointment_id', 'channel']).where('tenant_id', '=', tid(ctx)).where('status', '=', 'scheduled').where('scheduled_for', '<=', new Date(nowIso)).limit(500).execute().catch(() => []);
    return rows.map((r) => ({ id: String(r.id), customerId: String(r.customer_id), appointmentId: r.appointment_id ? String(r.appointment_id) : null, channel: String(r.channel) }));
  }
  async markStatus(ctx: ReqCtx, id: string, status: string, at?: string | null) { const set: any = { status }; if (status === 'sent' && at) set.sent_at = at; await this.db.updateTable('review_requests').set(set).where('tenant_id', '=', tid(ctx)).where('id', '=', id).execute().catch(() => {}); }
  async recordEvent(ctx: ReqCtx, id: string, event: string, detail?: Record<string, unknown>) { await this.db.insertInto('review_request_events').values({ tenant_id: tid(ctx), request_id: id, event, detail: detail ? JSON.stringify(detail) : null }).execute().catch(() => {}); }
  async countInPeriod(ctx: ReqCtx, customerId: string, sinceIso: string) {
    const r: any = await this.db.selectFrom('review_requests').select((eb) => eb.fn.countAll<number>().as('n')).where('tenant_id', '=', tid(ctx)).where('customer_id', '=', customerId).where('created_at', '>=', new Date(sinceIso) as any).executeTakeFirst().catch(() => ({ n: 0 }));
    return Number(r?.n ?? 0);
  }
  async lastRequestAt(ctx: ReqCtx, customerId: string) {
    const r: any = await this.db.selectFrom('review_requests').select(['created_at']).where('tenant_id', '=', tid(ctx)).where('customer_id', '=', customerId).orderBy('created_at', 'desc').executeTakeFirst().catch(() => null);
    return r?.created_at ? new Date(r.created_at).toISOString() : null;
  }
}
export class KyselyConsent implements ConsentPort {
  constructor(private readonly db: Kysely<DB>) {}
  private async contact(ctx: ReqCtx, customerId: string) {
    return this.db.selectFrom('customers').select(['normalized_phone', 'email', 'marketing_sms_opt_in', 'marketing_email_opt_in']).where('tenant_id', '=', tid(ctx)).where('id', '=', customerId).executeTakeFirst().catch(() => null);
  }
  private addr(c: any, channel: string): string | null { return channel === 'email' ? (c?.email ?? null) : (c?.normalized_phone ?? null); }
  async isOptedOut(ctx: ReqCtx, customerId: string, channel: string) {
    const c = await this.contact(ctx, customerId);
    if (!c) return true;                                                   // unknown customer -> do not message (safe default)
    const optIn = channel === 'email' ? c.marketing_email_opt_in : c.marketing_sms_opt_in;
    if (optIn === false) return true;                                      // customer withdrew marketing consent
    const address = this.addr(c, channel);
    if (!address) return true;                                             // no contact method for this channel
    if (channel === 'sms' || channel === 'email') {
      const supp: any = await this.db.selectFrom('notification_opt_outs').select(['address']).where('tenant_id', '=', tid(ctx)).where('channel', '=', channel).where('address', '=', address).executeTakeFirst().catch(() => null);
      if (supp) return true;                                               // address is on the suppression list
    }
    return false;
  }
  async hasContact(ctx: ReqCtx, customerId: string, channel: string) { const c = await this.contact(ctx, customerId); return channel === 'email' ? !!c?.email : !!c?.normalized_phone; }
  async recordOptOut(ctx: ReqCtx, customerId: string, channel: string) {
    const c = await this.contact(ctx, customerId); const address = this.addr(c, channel);
    if (address && (channel === 'sms' || channel === 'email')) await this.db.insertInto('notification_opt_outs').values({ tenant_id: tid(ctx), channel, address, reason: 'review_request_opt_out' }).execute().catch(() => {});
    await this.db.updateTable('customers').set((channel === 'email' ? { marketing_email_opt_in: false } : { marketing_sms_opt_in: false })).where('tenant_id', '=', tid(ctx)).where('id', '=', customerId).execute().catch(() => {});
  }
}


// ---- settings ----
export class KyselySettings implements SettingsPort {
  constructor(private readonly db: Kysely<DB>) {}
  /** fail-closed (Nov 2 2026): a read error used to return [] = platform defaults, i.e. the assistant ENABLED past a salon's
   *  Disable. It now throws; drafting stops and the checkout hook schedules nothing. */
  async load(ctx: RepCtx): Promise<SettingsRow[]> {
    const rows: any[] = await this.db.selectFrom('tenant_ai_reputation_settings').select(['level', 'branch_id', 'enabled', 'config']).where('tenant_id', '=', tid(ctx)).execute();
    return rows.map((r) => ({ level: r.level, branch_id: r.branch_id ? String(r.branch_id) : null, enabled: r.enabled ?? null, config: parseJson(r.config) }));
  }
  async tenantContextInput(ctx: RepCtx, config: ReputationConfig): Promise<TenantContextInput> {
    return { tenantId: ctx.tenantId, brandName: config.salonName || '', config };   // branch/service/policy enrichment can be layered from the tenant's own settings later
  }
}

function parseJson(v: unknown): any { if (!v) return null; if (typeof v === 'object') return v; try { return JSON.parse(String(v)); } catch { return null; } }

// ---- reads (inbox / detail / analytics inputs / notes / integration status) ----
export class KyselyReviewRead implements ReviewReadPort {
  constructor(private readonly db: Kysely<DB>) {}
  async inbox(ctx: RepCtx, filters: Record<string, unknown>) {
    // BUILD_PLAN Phase 12 (DoD #21/#22): the filters and order come from the ONE declaration the interceptor validates
    // (REVIEW_INBOX_SPEC) — and the total now counts the same filtered, branch-scoped rows the page shows.
    const lq = parseListQuery(filters, REVIEW_INBOX_SPEC);
    const page = Math.max(1, Number(filters.page) || 1); const pageSize = lq.limit;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scoped = (qb: any) => {
      let q = applyListQuery(qb, lq, { sort: false, limit: false });
      if (!hasTenantWideScope(ctx as any) && ctx.branchId) q = q.where('branch_id', '=', ctx.branchId);
      return q;
    };
    const rows: any[] = await applyListQuery(scoped(this.db.selectFrom('reviews').where('tenant_id', '=', tid(ctx)).select(['id', 'rating', 'comment', 'sentiment', 'severity', 'source', 'response_status', 'escalation_status', 'resolution_status', 'created_at'])), lq, { filters: false, search: false, range: false, limit: false })
      .limit(pageSize).offset((page - 1) * pageSize).execute().catch(() => []);
    const total: any = await scoped(this.db.selectFrom('reviews').where('tenant_id', '=', tid(ctx)).select((eb) => eb.fn.countAll<number>().as('n'))).executeTakeFirst().catch(() => ({ n: 0 }));
    const items = rows.map((r) => ({ id: String(r.id), rating: r.rating == null ? null : Number(r.rating), comment: r.comment ?? null, sentiment: r.sentiment, responseStatus: r.response_status, severity: r.severity }));
    const totalItems = Number(total?.n ?? 0);
    return { items, pagination: { page, pageSize, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / pageSize)) } };
  }
  async detail(ctx: RepCtx, reviewId: string) {
    const r: any = await this.db.selectFrom('reviews').selectAll().where('tenant_id', '=', tid(ctx)).where('id', '=', reviewId).executeTakeFirst().catch(() => null);
    if (!r) return null;
    const [analysis, draft, notes]: any[] = await Promise.all([
      this.db.selectFrom('review_analysis').selectAll().where('tenant_id', '=', tid(ctx)).where('review_id', '=', reviewId).orderBy('analyzed_at', 'desc').executeTakeFirst().catch(() => null),
      this.db.selectFrom('review_response_drafts').selectAll().where('tenant_id', '=', tid(ctx)).where('review_id', '=', reviewId).executeTakeFirst().catch(() => null),
      this.db.selectFrom('review_internal_notes').select(['note', 'created_at']).where('tenant_id', '=', tid(ctx)).where('review_id', '=', reviewId).orderBy('created_at', 'desc').limit(50).execute().catch(() => []),
    ]);
    return { id: String(r.id), rating: r.rating == null ? null : Number(r.rating), comment: r.comment ?? null, source: r.source, sentiment: r.sentiment, severity: r.severity, responseStatus: r.response_status, escalationStatus: r.escalation_status, resolutionStatus: r.resolution_status, analysis, draft: draft ? { status: draft.status, text: draft.current_text } : null, notes };
  }
  async metricsInputs(ctx: RepCtx, range: { from?: string; to?: string; branchId?: string }) {
    let q = this.db.selectFrom('reviews').select(['branch_id', 'rating', 'sentiment', 'escalation_status', 'response_status', 'resolution_status', 'created_at']).where('tenant_id', '=', tid(ctx));
    if (range.from) q = q.where('created_at', '>=', new Date(range.from)); if (range.to) q = q.where('created_at', '<=', new Date(range.to));
    if (range.branchId) q = q.where('branch_id', '=', range.branchId); else if (!hasTenantWideScope(ctx as any) && ctx.branchId) q = q.where('branch_id', '=', ctx.branchId);
    const rows: any[] = await q.limit(20000).execute().catch(() => []);
    const reviews = rows.map((r) => ({ branchId: r.branch_id ? String(r.branch_id) : null, rating: r.rating == null ? null : Number(r.rating), sentiment: r.sentiment, escalationRequired: r.escalation_status === 'escalated' || r.escalation_status === 'flagged', categories: [] as string[], responseStatus: r.response_status, resolutionStatus: r.resolution_status, createdAt: r.created_at ? new Date(r.created_at).toISOString() : '' }));
    const drafts: any[] = await this.db.selectFrom('review_response_drafts').select(['status']).where('tenant_id', '=', tid(ctx)).limit(20000).execute().catch(() => []);
    const responses = drafts.map((d) => ({ drafted: true, published: d.status === 'published', publishFailed: d.status === 'publish_failed', wasEdited: false, wasAccepted: d.status === 'published' }));
    const reqs: any[] = await this.db.selectFrom('review_requests').select(['status']).where('tenant_id', '=', tid(ctx)).limit(20000).execute().catch(() => []);
    const requests = reqs.map((x) => ({ sent: x.status === 'sent' || x.status === 'delivered' || x.status === 'converted', converted: x.status === 'converted' }));
    return { reviews, responses, requests };
  }
  async branchMetricsInputs(_ctx: RepCtx, _range: { from?: string; to?: string }) { return []; }   // per-branch rollup layered on reputation_snapshots when populated
  async authorizedBranches(ctx: RepCtx): Promise<'all' | string[]> { return hasTenantWideScope(ctx as any) ? 'all' : (ctx.branchId ? [ctx.branchId] : []); }   // Phase 9: the tenant-wide scope permission, not the OWNER name
  async addNote(ctx: RepCtx, reviewId: string, note: string) {
    const r: any = await this.db.insertInto('review_internal_notes').values({ tenant_id: tid(ctx), review_id: reviewId, author_user_id: ctx.userId, note }).returning(['id']).executeTakeFirstOrThrow();
    return { id: String(r.id) };
  }
  async setResolution(ctx: RepCtx, reviewId: string, status: string) { await this.db.updateTable('reviews').set({ resolution_status: status, updated_at: now() }).where('tenant_id', '=', tid(ctx)).where('id', '=', reviewId).execute(); }
  async integrationStatus(ctx: RepCtx) {
    const rows: any[] = await this.db.selectFrom('reviews').select(['source']).select((eb) => eb.fn.max('last_synced_at').as('last')).where('tenant_id', '=', tid(ctx)).groupBy('source').execute().catch(() => []);
    return rows.filter((r) => r.source !== 'internal' && r.source !== 'manual').map((r) => ({ source: String(r.source), connected: !!r.last, lastSyncAt: r.last ? new Date(r.last).toISOString() : null }));
  }
}
