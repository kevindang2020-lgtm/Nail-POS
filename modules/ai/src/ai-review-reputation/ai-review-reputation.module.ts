// ai-review-reputation.module.ts — wires the AI Review & Reputation Assistant. Kysely-backed when DATABASE is present,
// honest in-memory otherwise (dev/offline/tests). The one remaining binding is the real integration adapters
// (Google/Facebook publish + communications dispatch); until a real publish integration is connected, publication
// honestly reports INTEGRATION_DISCONNECTED. Nothing here issues money.
import { CommunicationsModule, CommunicationsService } from '@aipowersalon/communications';
import { systemContext } from '@aipowersalon/tenant-context';
import { Module } from '@nestjs/common';
import { AiReviewReputationController } from './ai-review-reputation.controller';
import { AiReviewReputationService, type ReviewReadPort, type SettingsPort } from './ai-review-reputation.service';
import { ReviewDraftingService, type DraftLlmPort, type DraftStorePort, type ApprovalStorePort, type PublicationPort } from './ai-review-reputation-drafting.service';
import { EscalationService, type EscalationStorePort, type SecureNotifyPort, type RecoveryStorePort, type ReviewStatusPort } from './ai-review-reputation-escalation.service';
import { ReviewIngestionService } from './ai-review-reputation-ingest';
import { ReviewRequestService, type RequestStorePort, type ConsentPort, type DispatchPort } from './ai-review-reputation-requests.service';
import { CommunicationsDispatchAdapter } from './ai-review-reputation.integrations';
import { KyselyReviewStore, KyselyDraftStore, KyselyApprovalStore, KyselyEscalationStore, KyselyRecoveryStore, KyselyReviewStatus, KyselyReviewRead, KyselySettings, KyselyRequestStore, KyselyConsent } from './ai-review-reputation.kysely';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { ReviewPublishAdapter, KyselyReviewTarget, KyselyConnectionCredentialResolver, FetchHttpJson } from './ai-review-reputation-publish';
import { PROVIDER_SECRETS, type ProviderSecrets } from '@aipowersalon/security';
import { hasTenantWideScope } from '@aipowersalon/permissions';

// honest in-memory fallbacks (used only when DATABASE is null)
const memRead: ReviewReadPort = { async inbox() { return { items: [], pagination: { page: 1, pageSize: 25, totalItems: 0, totalPages: 0 } }; }, async detail() { return null; }, async metricsInputs() { return { reviews: [], responses: [], requests: [] }; }, async branchMetricsInputs() { return []; }, async authorizedBranches(ctx) { return hasTenantWideScope(ctx as any) ? 'all' : (ctx.branchId ? [ctx.branchId] : []); }, async addNote() { return { id: 'note' }; }, async setResolution() {}, async integrationStatus() { return []; } };
const memSettings: SettingsPort = { async load() { return []; }, async save() {}, async tenantContextInput(ctx, config) { return { tenantId: ctx.tenantId, brandName: config.salonName || '', config }; } };
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
  controllers: [AiReviewReputationController],
  providers: [
    { provide: ReviewDraftingService, useFactory: (db: AppDatabase, secrets: ProviderSecrets) => new ReviewDraftingService(templateLlm, db ? new KyselyDraftStore(db) : memDraftStore, db ? new KyselyApprovalStore(db) : memApprovalStore, db ? new ReviewPublishAdapter(new KyselyReviewTarget(db), new KyselyConnectionCredentialResolver(db, (enc: string) => secrets.decrypt(enc), () => secrets.isConfigured()), new FetchHttpJson()) : disconnectedPublication), inject: [DATABASE, PROVIDER_SECRETS] },
    { provide: EscalationService, useFactory: (db: AppDatabase) => new EscalationService(db ? new KyselyEscalationStore(db) : memEscStore, noopNotify, db ? new KyselyRecoveryStore(db) : memRecovery, db ? new KyselyReviewStatus(db) : memReviewStatus, undefined, ''), inject: [DATABASE] },
    { provide: ReviewIngestionService, useFactory: (db: AppDatabase, esc: EscalationService) => new ReviewIngestionService(db ? new KyselyReviewStore(db) : { async findByDedupeKey() { return null; }, async insert() { return { id: 'r' }; }, async update() {} }, { async raise(ctx, reviewId, analysis) { await esc.raise({ ...ctx, ...systemContext({ tenantId: ctx.tenantId, branchId: ctx.branchId, actor: 'review-ingestion' }) }, reviewId, analysis); } }), inject: [DATABASE, EscalationService] },
    { provide: ReviewRequestService, useFactory: (db: AppDatabase, comm: CommunicationsService) => new ReviewRequestService(db ? new KyselyRequestStore(db) : memRequestStore, db ? new KyselyConsent(db) : memConsent, comm ? new CommunicationsDispatchAdapter(comm, db ? { languageOf: async (tenantId: string, customerId: string) => ((await db.selectFrom('customers').select(['preferred_language']).where('tenant_id', '=', tenantId).where('id', '=', customerId).executeTakeFirst()) as { preferred_language?: string | null } | undefined)?.preferred_language ?? null } : undefined) : noDispatch), inject: [DATABASE, CommunicationsService] },
    { provide: AiReviewReputationService, useFactory: (db: AppDatabase, drafting: ReviewDraftingService, escalation: EscalationService, ingestion: ReviewIngestionService) => new AiReviewReputationService(db ? new KyselyReviewRead(db) : memRead, db ? new KyselySettings(db) : memSettings, drafting, escalation, ingestion, new Map()), inject: [DATABASE, ReviewDraftingService, EscalationService, ReviewIngestionService] },
  ],
  exports: [AiReviewReputationService, ReviewIngestionService, EscalationService, ReviewRequestService],
})
export class AiReviewReputationModule {}
