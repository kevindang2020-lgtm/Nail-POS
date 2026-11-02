// super-admin-ai-review-reputation.service.ts — platform oversight for ai_review_reputation. Exposes only platform-
// OPERATIONAL aggregates (counts, rates, integration/queue health — never review text or customer content) plus a
// controlled, audited, reason-required per-tenant OPERATIONAL drill-down. Super Admin cannot browse tenant reviews here:
// tenantView returns counts and health, not review bodies. The SuperAdminGuard on the controller is the auth boundary.
import type { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { AppDatabase } from '@aipowersalon/database';
import type { AuditService } from '@aipowersalon/audit';

export interface SuperAdminCtx { userId?: string; email?: string; ip?: string }

export interface ReputationPlatformOverview {
  totalTenants: number; tenantsEnabled: number; tenantsDisabled: number;
  connectedIntegrations: number; syncFailures: number;
  reviewsIngested: number; reviewsAnalyzed: number; draftsGenerated: number; aiFailures: number;
  publicationFailures: number; reviewRequestFailures: number; escalationsOpen: number;
  aiUsageMessages: number; aiCostCents: number; generatedAt: string;
}

/** PURE: shape platform operational counts. No cross-tenant review content is ever included. */
export function buildReputationPlatformOverview(input: {
  totalTenants: number; settingsRows: Array<{ enabled: boolean | null }>;
  connectedIntegrations: number; syncFailures: number;
  reviewsIngested: number; reviewsAnalyzed: number; draftsGenerated: number; aiFailures: number;
  publicationFailures: number; reviewRequestFailures: number; escalationsOpen: number;
  aiUsageMessages: number; aiCostCents: number;
}): ReputationPlatformOverview {
  const disabled = input.settingsRows.filter((r) => r.enabled === false).length;
  return {
    totalTenants: input.totalTenants, tenantsDisabled: disabled, tenantsEnabled: Math.max(0, input.totalTenants - disabled),
    connectedIntegrations: input.connectedIntegrations, syncFailures: input.syncFailures,
    reviewsIngested: input.reviewsIngested, reviewsAnalyzed: input.reviewsAnalyzed, draftsGenerated: input.draftsGenerated, aiFailures: input.aiFailures,
    publicationFailures: input.publicationFailures, reviewRequestFailures: input.reviewRequestFailures, escalationsOpen: input.escalationsOpen,
    aiUsageMessages: input.aiUsageMessages, aiCostCents: input.aiCostCents, generatedAt: new Date().toISOString(),
  };
}

export interface ReputationTenantView {
  tenantId: string; disabled: boolean;
  reviewsIngested: number; reviewsAnalyzed: number; draftsGenerated: number; published: number; publicationFailures: number;
  escalationsOpen: number; requestsSent: number; requestFailures: number;
  integrations: { source: string; connected: boolean; lastSyncAt: string | null }[];
  supportMode: true; generatedAt: string;
}

/** PURE: shape one tenant's OPERATIONAL stats for the support drill-down. Deliberately contains no review bodies. */
export function buildReputationTenantView(tenantId: string, input: Omit<ReputationTenantView, 'tenantId' | 'supportMode' | 'generatedAt'>): ReputationTenantView {
  return { tenantId, ...input, supportMode: true, generatedAt: new Date().toISOString() };
}

export class SuperAdminReputationError extends Error {}

export class SuperAdminAiReviewReputationService {
  constructor(private readonly db: AppDatabase, private readonly auditSvc?: AuditService) {}

  async platformOverview(_ctx: SuperAdminCtx): Promise<ReputationPlatformOverview> {
    const empty = { totalTenants: 0, settingsRows: [], connectedIntegrations: 0, syncFailures: 0, reviewsIngested: 0, reviewsAnalyzed: 0, draftsGenerated: 0, aiFailures: 0, publicationFailures: 0, reviewRequestFailures: 0, escalationsOpen: 0, aiUsageMessages: 0, aiCostCents: 0 };
    if (!this.db) return buildReputationPlatformOverview(empty);
    const db = this.db as Kysely<DB>;
    const count = (q: Promise<any>) => q.then((r) => Number(r?.n ?? 0)).catch(() => 0);
    const [tenants, settingsRows, reviews, analyzed, drafts, pubFail, reqFail, escOpen] = await Promise.all([
      count(db.selectFrom('tenants').select((eb) => eb.fn.countAll<number>().as('n')).where('status', '=', 'active').executeTakeFirst()),
      db.selectFrom('tenant_ai_reputation_settings').select(['enabled']).where('level', '=', 'tenant').execute().catch(() => [] as any[]),
      count(db.selectFrom('reviews').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst()),
      count(db.selectFrom('review_analysis').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst()),
      count(db.selectFrom('review_response_drafts').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst()),
      count(db.selectFrom('review_publications').select((eb) => eb.fn.countAll<number>().as('n')).where('result', '=', 'failed').executeTakeFirst()),
      count(db.selectFrom('review_requests').select((eb) => eb.fn.countAll<number>().as('n')).where('status', '=', 'failed').executeTakeFirst()),
      count(db.selectFrom('review_escalations').select((eb) => eb.fn.countAll<number>().as('n')).where('status', '=', 'open').executeTakeFirst()),
    ]);
    return buildReputationPlatformOverview({
      totalTenants: tenants, settingsRows: settingsRows.map((r) => ({ enabled: r.enabled ?? null })),
      connectedIntegrations: 0, syncFailures: 0, reviewsIngested: reviews, reviewsAnalyzed: analyzed, draftsGenerated: drafts,
      aiFailures: 0, publicationFailures: pubFail, reviewRequestFailures: reqFail, escalationsOpen: escOpen, aiUsageMessages: 0, aiCostCents: 0,
    });
  }

  /** Audited, reason-required, per-tenant OPERATIONAL drill-down. Returns counts/health only — never review bodies. */
  async tenantView(ctx: SuperAdminCtx, tenantId: string, reason: string): Promise<ReputationTenantView> {
    if (!reason || !reason.trim()) throw new SuperAdminReputationError('SUPPORT_REASON_REQUIRED');
    this.auditSvc?.record?.({ tenantId, userId: ctx.userId || 'super_admin', role: 'SUPER_ADMIN' } as any, { action: 'reputation_support_view', metadata: { reason: reason.trim().slice(0, 200), ip: ctx.ip } } as any);
    if (!this.db) return buildReputationTenantView(tenantId, { disabled: false, reviewsIngested: 0, reviewsAnalyzed: 0, draftsGenerated: 0, published: 0, publicationFailures: 0, escalationsOpen: 0, requestsSent: 0, requestFailures: 0, integrations: [] });
    const db = this.db as Kysely<DB>;
    const c = (q: Promise<any>) => q.then((r) => Number(r?.n ?? 0)).catch(() => 0);
    const [disabledRow, reviews, analyzed, drafts, published, pubFail, escOpen, reqSent, reqFail] = await Promise.all([
      db.selectFrom('tenant_ai_reputation_settings').select(['enabled']).where('tenant_id', '=', tenantId).where('level', '=', 'tenant').executeTakeFirst().catch(() => null),
      c(db.selectFrom('reviews').select((eb) => eb.fn.countAll<number>().as('n')).where('tenant_id', '=', tenantId).executeTakeFirst()),
      c(db.selectFrom('review_analysis').select((eb) => eb.fn.countAll<number>().as('n')).where('tenant_id', '=', tenantId).executeTakeFirst()),
      c(db.selectFrom('review_response_drafts').select((eb) => eb.fn.countAll<number>().as('n')).where('tenant_id', '=', tenantId).executeTakeFirst()),
      c(db.selectFrom('review_publications').select((eb) => eb.fn.countAll<number>().as('n')).where('tenant_id', '=', tenantId).where('result', '=', 'published').executeTakeFirst()),
      c(db.selectFrom('review_publications').select((eb) => eb.fn.countAll<number>().as('n')).where('tenant_id', '=', tenantId).where('result', '=', 'failed').executeTakeFirst()),
      c(db.selectFrom('review_escalations').select((eb) => eb.fn.countAll<number>().as('n')).where('tenant_id', '=', tenantId).where('status', '=', 'open').executeTakeFirst()),
      c(db.selectFrom('review_requests').select((eb) => eb.fn.countAll<number>().as('n')).where('tenant_id', '=', tenantId).where('status', '=', 'sent').executeTakeFirst()),
      c(db.selectFrom('review_requests').select((eb) => eb.fn.countAll<number>().as('n')).where('tenant_id', '=', tenantId).where('status', '=', 'failed').executeTakeFirst()),
    ]);
    return buildReputationTenantView(tenantId, {
      disabled: disabledRow?.enabled === false, reviewsIngested: reviews, reviewsAnalyzed: analyzed, draftsGenerated: drafts,
      published, publicationFailures: pubFail, escalationsOpen: escOpen, requestsSent: reqSent, requestFailures: reqFail, integrations: [],
    });
  }
}
