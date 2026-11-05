// community-interactions.providers.ts — BUILD_PLAN Phase 8 (agent C owns this file): the interactions half's providers
// and extra Nest imports, spread into TenantSafetyCommunityModule. Provides COMMUNITY_FANOUT and
// COMMUNITY_EVIDENCE_MODERATION; consumes COMMUNITY_CORE (agent A) and COMMUNITY_EVENTS (the outbox, lead).
//
// No database (dev / some unit harnesses): every route answers 503 `community_unavailable` rather than pretending — the
// fan-out is a no-op and evidence moderation refuses. Storage / scanner: the PRIVATE evidence bucket (EVIDENCE_S3_BUCKET)
// and the S3-tag scanner; with no bucket the honest NotConnected store makes evidence routes 503
// `evidence_storage_not_configured` and the scanner can never say `clean`.
import type { Provider } from '@nestjs/common';
import { DATABASE, type AppDatabase } from '@aipowersalon/database';
import { STORAGE_QUOTA, type StorageQuotaPort } from '@aipowersalon/media';
import { NotificationsModule, NotificationsService, PushModule, PushService } from '@aipowersalon/communications';
import { COMMUNITY_FANOUT, COMMUNITY_EVIDENCE_MODERATION, COMMUNITY_CORE, COMMUNITY_EVENTS, type CommunityFanoutPort, type CommunityEvidenceModerationPort, type CommunityCorePort, type CommunityEventsPort } from './community.ports';
import { CommunityError } from './community.service';
import { KyselyCommunityAuditSink, InMemoryCommunityAuditSink } from './community-audit';
import { makeEvidenceBlobStore, type EvidenceBlobStore } from './evidence-blob-store';
import { makeEvidenceScanner } from './evidence-scanner';
import { KyselyInteractionsRepo, KyselyRiskFingerprintStore } from './community-interactions.repository';
import { CommunityInteractionsService, CommunityEvidenceModeration, type InteractionsAudit } from './community-interactions.service';
import { CommunityFanoutService } from './community-fanout';
import { CommunityJobsScheduler, COMMUNITY_BLOB, COMMUNITY_AUDIT } from './community-jobs';
import { RiskMatchingService } from './community-risk-matching';

const noFanout: CommunityFanoutPort = { async advisoryPublished() { /* no database: nobody to alert */ }, async advisoryChanged() { /* idem */ } };
const noEvidence: CommunityEvidenceModerationPort = {
  async moderatorAccess() { throw new CommunityError('community_unavailable', 503); },
  async review() { throw new CommunityError('community_unavailable', 503); },
};
/** Every method of the interactions service answers 503 when there is no database (never a fake empty success). */
const SERVICE_METHODS = new Set(Object.getOwnPropertyNames(CommunityInteractionsService.prototype).filter((m) => m !== 'constructor'));
const unavailableService = new Proxy({}, {
  // only the service's own methods answer (Nest probes providers for lifecycle hooks — those stay undefined)
  get: (_t, p) => (typeof p === 'string' && SERVICE_METHODS.has(p) ? async () => { throw new CommunityError('community_unavailable', 503); } : undefined),
}) as unknown as CommunityInteractionsService;

export const COMMUNITY_INTERACTIONS_PROVIDERS: Provider[] = [
  { provide: COMMUNITY_BLOB, useFactory: (): EvidenceBlobStore => makeEvidenceBlobStore() },
  { provide: COMMUNITY_AUDIT, useFactory: (db: AppDatabase | null): InteractionsAudit => (db ? new KyselyCommunityAuditSink(db) : new InMemoryCommunityAuditSink()), inject: [{ token: DATABASE, optional: true }] },
  {
    provide: CommunityInteractionsService,
    useFactory: (db: AppDatabase | null, core: CommunityCorePort, events: CommunityEventsPort, audit: InteractionsAudit, blob: EvidenceBlobStore, quota?: StorageQuotaPort) => {
      if (!db) return unavailableService;
      const svc = new CommunityInteractionsService(core, new KyselyInteractionsRepo(db as any), events, audit, blob, makeEvidenceScanner());
      svc.storageQuota = quota ?? null;   // Phase 12 (#34): evidence uploads count against the salon's storage quota
      return svc;
    },
    inject: [{ token: DATABASE, optional: true }, COMMUNITY_CORE, COMMUNITY_EVENTS, COMMUNITY_AUDIT, COMMUNITY_BLOB, { token: STORAGE_QUOTA, optional: true }],
  },
  {
    provide: CommunityFanoutService,
    useFactory: (db: AppDatabase | null, events: CommunityEventsPort, push: PushService | null, notifications: NotificationsService | null) =>
      (db ? new CommunityFanoutService(new KyselyInteractionsRepo(db as any), events, push ?? null, notifications ?? null) : null),
    inject: [{ token: DATABASE, optional: true }, COMMUNITY_EVENTS, { token: PushService, optional: true }, { token: NotificationsService, optional: true }],
  },
  { provide: COMMUNITY_FANOUT, useFactory: (f: CommunityFanoutService | null): CommunityFanoutPort => f ?? noFanout, inject: [CommunityFanoutService] },
  {
    provide: COMMUNITY_EVIDENCE_MODERATION,
    useFactory: (db: AppDatabase | null, blob: EvidenceBlobStore, audit: InteractionsAudit): CommunityEvidenceModerationPort =>
      (db ? new CommunityEvidenceModeration(new KyselyInteractionsRepo(db as any), blob, audit) : noEvidence),
    inject: [{ token: DATABASE, optional: true }, COMMUNITY_BLOB, COMMUNITY_AUDIT],
  },
  // privacy-preserving related-reports matching — OFF unless the platform flag + an approved policy + a salt are all present
  {
    provide: RiskMatchingService,
    useFactory: (db: AppDatabase | null) => (db ? new RiskMatchingService(new KyselyRiskFingerprintStore(db as any), new KyselyInteractionsRepo(db as any)) : new RiskMatchingService({ findHits: async () => [], record: async () => undefined, retire: async () => undefined }, { platformFlag: async () => false })),
    inject: [{ token: DATABASE, optional: true }],
  },
  CommunityJobsScheduler,
];
/** Push (owner / approver devices) and the notifications service (email, critical SMS) for the fan-out. */
export const COMMUNITY_INTERACTIONS_IMPORTS: any[] = [NotificationsModule, PushModule];
