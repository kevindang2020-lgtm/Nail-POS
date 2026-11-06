// ai-review-reputation.module.ts — wires the AI Review & Reputation Assistant. Kysely-backed when DATABASE is present,
// honest in-memory otherwise (dev/offline/tests). The one remaining binding is the real integration adapters
// (Google/Facebook publish + communications dispatch); until a real publish integration is connected, publication
// honestly reports INTEGRATION_DISCONNECTED. Nothing here issues money.
import { CommunicationsModule, CommunicationsService } from '@aipowersalon/communications';
import { systemContext } from '@aipowersalon/tenant-context';
import { Module } from '@nestjs/common';
import { AiReviewReputationController } from './ai-review-reputation.controller';
import { ReputationCenter } from './reputation-center';
import { ReputationCenterController, REPUTATION_CENTER } from './reputation-center.controller';
import { ReputationSettingsCenter } from './reputation-settings-center';
import { ReputationSettingsCenterController, REPUTATION_SETTINGS_CENTER } from './reputation-settings-center.controller';
import { KyselyAiAccessRepo } from '../ai/ai-access.kysely.repository';
import { evaluateAiAccess } from '../ai/ai-access-gate';
import { enforcementMode } from '../ai-entitlement/ai-entitlement.guard';
import { AiReviewReputationService, type ReviewReadPort, type SettingsPort } from './ai-review-reputation.service';
import { ReviewDraftingService, type DraftLlmPort, type DraftStorePort, type ApprovalStorePort, type PublicationPort } from './ai-review-reputation-drafting.service';
import { EscalationService, type EscalationStorePort, type SecureNotifyPort, type RecoveryStorePort, type ReviewStatusPort } from './ai-review-reputation-escalation.service';
import { ReviewIngestionService } from './ai-review-reputation-ingest';
import { ReviewRequestService, type RequestStorePort, type ConsentPort, type DispatchPort } from './ai-review-reputation-requests.service';
import { CommunicationsDispatchAdapter, MessengerDispatchAdapter, type ReviewMessenger } from './ai-review-reputation.integrations';
import { ReviewRequestSenderJob, REVIEW_SENDER_ACCESS, type ReviewSenderAccess } from './ai-review-reputation-sender.job';
import { ReviewAutoReplier } from './ai-review-reputation-auto-reply';
import { resolveSettings, rowsToLayers, PLATFORM_DEFAULTS } from './ai-review-reputation-settings';

/** packages/notifications TENANT_MESSENGER (the salon's one send path), by its string token */
const TENANT_MESSENGER = 'TENANT_MESSENGER';
import { KyselyReviewStore, KyselyDraftStore, KyselyApprovalStore, KyselyEscalationStore, KyselyRecoveryStore, KyselyReviewStatus, KyselyReviewRead, KyselySettings, KyselyRequestStore, KyselyConsent, KyselyReviewRequestProfile } from './ai-review-reputation.kysely';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { ReviewPublishAdapter, KyselyReviewTarget, KyselyConnectionCredentialResolver, FetchHttpJson } from './ai-review-reputation-publish';
import { PROVIDER_SECRETS, type ProviderSecrets } from '@aipowersalon/security';
import { hasTenantWideScope } from '@aipowersalon/permissions';

// honest in-memory fallbacks (used only when DATABASE is null)
const memRead: ReviewReadPort = { async inbox() { return { items: [], pagination: { page: 1, pageSize: 25, totalItems: 0, totalPages: 0 } }; }, async detail() { return null; }, async metricsInputs() { return { reviews: [], responses: [], requests: [] }; }, async branchMetricsInputs() { return []; }, async authorizedBranches(ctx) { return hasTenantWideScope(ctx as any) ? 'all' : (ctx.branchId ? [ctx.branchId] : []); }, async addNote() { return { id: 'note' }; }, async setResolution() {}, async integrationStatus() { return []; } };
const memSettings: SettingsPort = { async load() { return []; }, async tenantContextInput(ctx, config) { return { tenantId: ctx.tenantId, brandName: config.salonName || '', config }; } };
const memDraftStore: DraftStorePort = { async get() { return null; }, async save() {}, async addVersion() {} };
const memApprovalStore: ApprovalStorePort = { async record() {} };
const templateLlm: DraftLlmPort = { async draft() { return 'Thank you for your feedback. We appreciate you taking the time to share it and would be glad to make things right.'; } };
const disconnectedPublication: PublicationPort = { async publish() { throw new Error('INTEGRATION_DISCONNECTED'); } };
const memEscStore: EscalationStorePort = { async findByReview() { return null; }, async create() { return { id: 'esc' }; }, async setStatus() {}, async assign() {}, async listOpen() { return []; } };
const noopNotify: SecureNotifyPort = { async sendSecure() {} };
const memRecovery: RecoveryStorePort = { async record() { return { id: 'rec', status: 'recommended' }; } };
const memReviewStatus: ReviewStatusPort = { async setEscalationStatus() {}, async setResolution() {} };
const memRequestStore: RequestStorePort = { async findByIdem() { return null; }, async create() { return { id: 'rq' }; }, async listDue() { return []; }, async markStatus() {}, async recordEvent() {}, async countInPeriod() { return 0; }, async lastRequestAt() { return null; } };
const memConsent: ConsentPort = { async isOptedOut() { return true; }, async hasContact() { return false; }, async recordOptOut() {} };
const noDispatch: DispatchPort = { async send() { throw new Error('DISPATCH_FAILED'); } };

@Module({
  imports: [CommunicationsModule],
  controllers: [AiReviewReputationController, ReputationCenterController, ReputationSettingsCenterController],   // + the workspace read side (Review & Reputation guide, Nov 2026)
  providers: [
    { provide: REPUTATION_CENTER, useFactory: (db: AppDatabase) => (db ? new ReputationCenter(db) : null), inject: [DATABASE] },
    // Review & Reputation Settings (Nov 2026): provenance, safe salon-level writes with history, the entitlement gate's own decision
    { provide: REPUTATION_SETTINGS_CENTER, useFactory: (db: AppDatabase) => {
        if (!db) return null;
        const access = new KyselyAiAccessRepo(db);
        return new ReputationSettingsCenter(db,
          async (ctx) => { const d = evaluateAiAccess(await access.loadSnapshot(ctx.tenantId, 'ai_review_reputation_assistant', ctx.userId ?? null, { branchId: ctx.branchId || null }));
            return { allowed: d.allowed, reason: d.reason, subscriptionStatus: String(d.subscriptionStatus) }; },
          () => enforcementMode());
      }, inject: [DATABASE] },
    { provide: ReviewDraftingService, useFactory: (db: AppDatabase, secrets: ProviderSecrets) => new ReviewDraftingService(templateLlm, db ? new KyselyDraftStore(db) : memDraftStore, db ? new KyselyApprovalStore(db) : memApprovalStore, db ? new ReviewPublishAdapter(new KyselyReviewTarget(db), new KyselyConnectionCredentialResolver(db, (enc: string) => secrets.decrypt(enc), () => secrets.isConfigured()), new FetchHttpJson()) : disconnectedPublication), inject: [DATABASE, PROVIDER_SECRETS] },
    { provide: EscalationService, useFactory: (db: AppDatabase) => new EscalationService(db ? new KyselyEscalationStore(db) : memEscStore, noopNotify, db ? new KyselyRecoveryStore(db) : memRecovery, db ? new KyselyReviewStatus(db) : memReviewStatus, undefined, ''), inject: [DATABASE] },
    { provide: ReviewIngestionService, useFactory: (db: AppDatabase, esc: EscalationService, drafting: ReviewDraftingService, access: ReviewSenderAccess | null) => new ReviewIngestionService(db ? new KyselyReviewStore(db) : { async findByDedupeKey() { return null; }, async insert() { return { id: 'r' }; }, async update() {} }, { async raise(ctx, reviewId, analysis) { await esc.raise({ ...ctx, ...systemContext({ tenantId: ctx.tenantId, branchId: ctx.branchId, actor: 'review-ingestion' }) }, reviewId, analysis); } },
      // G8 (Nov 6 2026): new reviews are offered to the automatic-reply policy — OFF unless the salon turns it on with approval off
      new ReviewAutoReplier(db ? new KyselySettings(db) : memSettings, drafting, access)), inject: [DATABASE, EscalationService, ReviewDraftingService, { token: REVIEW_SENDER_ACCESS, optional: true }] },
    // G8 (Nov 6 2026): the salon's messenger is the real send path (its number, opt-outs, ledger); the inbox-thread adapter
    // remains only for a process without the notifications module (it records, it does not deliver)
    { provide: ReviewRequestService, useFactory: (db: AppDatabase, comm: CommunicationsService, messenger: ReviewMessenger | null) => new ReviewRequestService(db ? new KyselyRequestStore(db) : memRequestStore, db ? new KyselyConsent(db) : memConsent,
      db && messenger ? new MessengerDispatchAdapter(messenger, new KyselyReviewRequestProfile(db), async (t, b) => {
        const rows = await new KyselySettings(db).load(systemContext({ tenantId: t, branchId: b, actor: 'review-request-sender' }) as any);
        return resolveSettings({ platform: PLATFORM_DEFAULTS, ...rowsToLayers(rows as any, { branchId: b ?? undefined }) }).config.salonName || null;
      }) : comm ? new CommunicationsDispatchAdapter(comm, db ? { languageOf: async (tenantId: string, customerId: string) => ((await db.selectFrom('customers').select(['preferred_language']).where('tenant_id', '=', tenantId).where('id', '=', customerId).executeTakeFirst()) as { preferred_language?: string | null } | undefined)?.preferred_language ?? null } : undefined) : noDispatch), inject: [DATABASE, CommunicationsService, { token: TENANT_MESSENGER, optional: true }] },
    // the AI package decision the automatic paths honour (G8): the shared gate, enforced only when the platform enforces
    { provide: REVIEW_SENDER_ACCESS, useFactory: (db: AppDatabase): ReviewSenderAccess | null => {
        if (!db) return null;
        const repo = new KyselyAiAccessRepo(db);
        return async (tenantId, branchId) => {
          const d = evaluateAiAccess(await repo.loadSnapshot(tenantId, 'ai_review_reputation_assistant', null, { branchId }));
          // a system job has no user: only the salon's package / payment decides, never a missing user permission
          return { allowed: d.allowed || d.reason === 'permission_denied', reason: String(d.reason), enforce: enforcementMode() === 'enforce' };
        };
      }, inject: [DATABASE] },
    ReviewRequestSenderJob,
    { provide: AiReviewReputationService, useFactory: (db: AppDatabase, drafting: ReviewDraftingService, escalation: EscalationService, ingestion: ReviewIngestionService) => new AiReviewReputationService(db ? new KyselyReviewRead(db) : memRead, db ? new KyselySettings(db) : memSettings, drafting, escalation, ingestion, new Map()), inject: [DATABASE, ReviewDraftingService, EscalationService, ReviewIngestionService] },
  ],
  exports: [AiReviewReputationService, ReviewIngestionService, EscalationService, ReviewRequestService],
})
export class AiReviewReputationModule {}
