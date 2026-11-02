// community-jobs.ts — BUILD_PLAN Phase 8 (agent C): the Safety Community's background work on the platform's ONE durable
// job queue (Phase 2: jobs table, registerJobHandler, the worker loop; runTick so ONE process dispatches).
//
// Every hour one process runs the dispatcher (COMMUNITY_JOBS=off disables the timer). It enqueues one job PER salon
// (tenant-partitioned; idempotency keys make a re-dispatch a no-op):
//   community.retention       daily per salon with community data: drafts + private incidents older than the salon's
//                             retention_days, and the evidence of stale drafts / removed / archived posts (blob deleted,
//                             row marked removed)
//   community.archive         daily per salon with resolved advisories untouched for 90 days → archived
//   community.related         daily per salon that published in the last 14 days → related / duplicate detection
//   community.evidence_rescan hourly per salon with uploaded evidence still `unscanned` → ask the scanner again
// and, platform-wide in the dispatcher itself, deletes risk fingerprints past their expires_at (no tenant column; the
// table is keyed by post and never browsable). Handlers run with systemContext() and re-check their salon when they RUN.
import { Inject, Injectable, Logger, Optional, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { DATABASE, enqueueJob, registerJobHandler, jobHandlerFor, PermanentJobError, type AppDatabase } from '@aipowersalon/database';
import { runTick } from '@aipowersalon/observability';
import { runsBackgroundJob } from '@aipowersalon/config';
import { utcDate } from '@aipowersalon/date-time';
import { DOMAIN_EVENTS } from '@aipowersalon/events';
import type { Kysely } from 'kysely';
import type { CommunityEventsPort } from './community.ports';
import { COMMUNITY_EVENTS } from './community.ports';
import type { EvidenceBlobStore } from './evidence-blob-store';
import { KyselyInteractionsRepo, KyselyRiskFingerprintStore } from './community-interactions.repository';
import { CommunityInteractionsService, type InteractionsAudit } from './community-interactions.service';
import { CommunityFanoutService } from './community-fanout';
import { RELATED_WINDOW_DAYS } from './community-related';
import { workerPrincipal } from '@aipowersalon/permissions';

export const COMMUNITY_JOB = { retention: 'community.retention', archive: 'community.archive', related: 'community.related', evidenceRescan: 'community.evidence_rescan' } as const;
export const COMMUNITY_TICK_MS = 60 * 60_000;
export const ARCHIVE_AFTER_DAYS = 90;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** On unless COMMUNITY_JOBS is explicitly off. */
export function communityJobsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = String(env.COMMUNITY_JOBS ?? '').trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'no' || v === 'off');
}

export interface CommunityJobDeps {
  db: Kysely<any>;
  repo: KyselyInteractionsRepo;
  events: CommunityEventsPort;
  blob: EvidenceBlobStore;
  interactions: Pick<CommunityInteractionsService, 'scan'>;
  fanout: Pick<CommunityFanoutService, 'detectRelated'>;
  fingerprints: Pick<KyselyRiskFingerprintStore, 'purgeExpired'>;
  audit?: InteractionsAudit | null;
  now?: () => number;
}

export async function dispatchCommunityJobs(deps: Pick<CommunityJobDeps, 'db' | 'repo' | 'fingerprints'>, nowMs = Date.now()) {
  const day = utcDate(new Date(nowMs));
  const hour = Math.floor(nowMs / COMMUNITY_TICK_MS);
  const out = { retention: 0, archive: 0, related: 0, rescan: 0, fingerprintsPurged: 0 };
  const enqueue = async (jobType: string, tenantId: string, key: string, priority: 0 | 1 | 2 | 3 = 3) =>
    !(await enqueueJob(deps.db, { jobClass: 'standard', jobType, tenantId, payload: {}, priority, maxAttempts: 3, idempotencyKey: key })).duplicate;
  for (const t of (await deps.repo.salonsWithCommunityData()).filter((x) => UUID.test(x))) if (await enqueue(COMMUNITY_JOB.retention, t, `${t}:${day}`)) out.retention++;
  for (const t of (await deps.repo.salonsWithDueArchive(ARCHIVE_AFTER_DAYS)).filter((x) => UUID.test(x))) if (await enqueue(COMMUNITY_JOB.archive, t, `${t}:${day}`)) out.archive++;
  for (const t of (await deps.repo.salonsWithRecentPublished(RELATED_WINDOW_DAYS)).filter((x) => UUID.test(x))) if (await enqueue(COMMUNITY_JOB.related, t, `${t}:${day}`)) out.related++;
  for (const t of (await deps.repo.salonsWithUnscannedEvidence()).filter((x) => UUID.test(x))) if (await enqueue(COMMUNITY_JOB.evidenceRescan, t, `${t}:${hour}`, 2)) out.rescan++;
  out.fingerprintsPurged = await deps.fingerprints.purgeExpired();
  return out;
}

/** The job's own actor as the audit sees it — the named worker principal (BUILD_PLAN Phase 9: worker:<job>, only its
 *  declared keys), never a fabricated user id. */
function jobCtx(tenantId: string, job: 'community-retention' | 'community-archive') { const c = workerPrincipal(job, { tenantId }); return { tenantId: c.tenantId, branchId: null, userId: c.userId, role: c.role, permissions: c.permissions }; }

const need = (tenantId: string | null, what: string): string => { if (!tenantId || !UUID.test(tenantId)) throw new PermanentJobError(`${what} needs its salon`); return tenantId; };

export async function runRetentionJob(deps: CommunityJobDeps, tenantIdIn: string | null) {
  const tenantId = need(tenantIdIn, 'a community retention purge');
  const days = await deps.repo.retentionDays(tenantId);
  const evidence = await deps.repo.evidenceToPurge(tenantId, days);
  let blobsRemoved = 0;
  for (const e of evidence) { try { await deps.blob.remove(e.storageKey); blobsRemoved++; } catch { /* the row is still marked removed; the blob is retried never — storage lifecycle rules catch strays */ } }
  const r = await deps.repo.purgeSalon(tenantId, days, evidence.map((e) => e.id));
  if (r.drafts || r.incidents || r.evidence) await deps.audit?.record(jobCtx(tenantId, 'community-retention'), 'retention.purged', tenantId, { retentionDays: days, ...r, blobsRemoved });
  return { retentionDays: days, ...r, blobsRemoved };
}

export async function runArchiveJob(deps: CommunityJobDeps, tenantIdIn: string | null) {
  const tenantId = need(tenantIdIn, 'a community archive sweep');
  const archived = await deps.repo.archiveResolved(tenantId, ARCHIVE_AFTER_DAYS);
  for (const p of archived) {
    await deps.events.emit({ tenantId, branchId: null, userId: null }, DOMAIN_EVENTS.COMMUNITY_ADVISORY_UPDATED, { type: 'community_post', id: p.id, version: p.version }, { postId: p.id, status: 'archived', change: 'archived' });
  }
  if (archived.length) await deps.audit?.record(jobCtx(tenantId, 'community-archive'), 'advisory.archived', tenantId, { postIds: archived.map((p) => p.id) });
  return { archived: archived.length };
}

export async function runRelatedJob(deps: CommunityJobDeps, tenantIdIn: string | null) {
  const tenantId = need(tenantIdIn, 'related-post detection');
  let linked = 0;
  for (const id of await deps.repo.recentPublishedByOrigin(tenantId, RELATED_WINDOW_DAYS)) linked += await deps.fanout.detectRelated(id);
  return { linked };
}

export async function runEvidenceRescanJob(deps: CommunityJobDeps, tenantIdIn: string | null) {
  const tenantId = need(tenantIdIn, 'an evidence rescan');
  const out = { checked: 0, clean: 0, infected: 0, unscanned: 0 };
  for (const ev of await deps.repo.unscannedUploaded(tenantId)) {
    out.checked++;
    const r = await deps.interactions.scan(tenantId, ev, null);
    out[r.scanStatus === 'clean' ? 'clean' : r.scanStatus === 'infected' ? 'infected' : 'unscanned']++;
  }
  return out;
}

export function registerCommunityJobHandlers(deps: CommunityJobDeps): void {
  if (!jobHandlerFor(COMMUNITY_JOB.retention)) registerJobHandler(COMMUNITY_JOB.retention, async (_p, ctx) => runRetentionJob(deps, ctx.tenantId));
  if (!jobHandlerFor(COMMUNITY_JOB.archive)) registerJobHandler(COMMUNITY_JOB.archive, async (_p, ctx) => runArchiveJob(deps, ctx.tenantId));
  if (!jobHandlerFor(COMMUNITY_JOB.related)) registerJobHandler(COMMUNITY_JOB.related, async (_p, ctx) => runRelatedJob(deps, ctx.tenantId));
  if (!jobHandlerFor(COMMUNITY_JOB.evidenceRescan)) registerJobHandler(COMMUNITY_JOB.evidenceRescan, async (_p, ctx) => runEvidenceRescanJob(deps, ctx.tenantId));
}

export const COMMUNITY_BLOB = 'CommunityEvidenceBlobStore';
export const COMMUNITY_AUDIT = 'CommunityInteractionsAudit';

@Injectable()
export class CommunityJobsScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('CommunityJobs');
  private timer: NodeJS.Timeout | null = null;
  constructor(
    @Optional() @Inject(DATABASE) private readonly db: AppDatabase | null,
    @Inject(COMMUNITY_EVENTS) private readonly events: CommunityEventsPort,
    @Inject(COMMUNITY_BLOB) private readonly blob: EvidenceBlobStore,
    @Inject(CommunityInteractionsService) private readonly interactions: CommunityInteractionsService,
    @Inject(CommunityFanoutService) private readonly fanout: CommunityFanoutService,
    @Optional() @Inject(COMMUNITY_AUDIT) private readonly audit: InteractionsAudit | null = null,
  ) {}

  deps(): CommunityJobDeps | null {
    if (!this.db) return null;
    const db = this.db as unknown as Kysely<any>;
    return { db, repo: new KyselyInteractionsRepo(db), events: this.events, blob: this.blob, interactions: this.interactions, fanout: this.fanout, fingerprints: new KyselyRiskFingerprintStore(db), audit: this.audit };
  }
  onModuleInit(): void {
    const deps = this.deps();
    if (!deps) return;
    registerCommunityJobHandlers(deps);           // every process: a worker anywhere may take the job
    if (!runsBackgroundJob('standard') || !communityJobsEnabled()) return;
    this.timer = setInterval(() => { void runTick({ jobType: 'community.dispatch', jobClass: 'standard', everyMs: COMMUNITY_TICK_MS }, () => this.dispatch()).catch(() => undefined); }, COMMUNITY_TICK_MS);
    this.timer.unref?.();
  }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }
  async dispatch() {
    const deps = this.deps();
    if (!deps) return null;
    const r = await dispatchCommunityJobs(deps);
    this.log.debug?.(`community jobs: ${JSON.stringify(r)}`);
    return r;
  }
}
