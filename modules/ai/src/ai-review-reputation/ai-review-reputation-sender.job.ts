// ai-review-reputation-sender.job.ts — G8 (Nov 6 2026): SENDS the post-visit review requests checkout schedules.
//
// Before this, CheckoutReviewRequestHook wrote review_requests rows and nothing ever sent them (ReviewRequestService.sendDue
// had no caller). Every 5 minutes, one process at a time (runAsSingleOwner), for each salon/branch with work:
//   1. rows that waited more than 48 h past their send time are EXPIRED, never sent late (this also keeps every row
//      scheduled before the sender existed from firing at once on the first tick);
//   2. the salon's CURRENT settings decide — assistant off or review requests off → nothing is sent (rows wait, then expire);
//   3. the AI package: when the platform enforces AI entitlements, a salon without the package sends nothing;
//   4. quiet hours in the salon's zone are checked again at send time (scheduling already avoided them; a late tick may not);
//   5. sendDue: opt-out re-checked per customer, each row claimed before the send (no double texts), through the salon's
//      messenger (its own number, opt-out list, notification ledger);
//   6. the one controlled reminder, only when the salon turned "one reminder" on: 72 h after the first send, not after a
//      review from that customer, not to an opted-out customer, at most once.
// The job sends nothing a salon did not switch on: review requests are OFF by default (PLATFORM_DEFAULTS.reviewRequest).
// REVIEW_REQUEST_SENDER=off stops it.
import { Injectable, Inject, Optional, Logger, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { runAsSingleOwner, branchTimeZone, DATABASE, type AppDatabase } from '@aipowersalon/database';
import { logException, runTick } from '@aipowersalon/observability';
import { runsBackgroundJob } from '@aipowersalon/config';
import { systemContext } from '@aipowersalon/tenant-context';
import { ReviewRequestService } from './ai-review-reputation-requests.service';
import { inQuietHours } from './ai-review-reputation-requests';
import { resolveSettings, rowsToLayers, PLATFORM_DEFAULTS, type SettingsRow } from './ai-review-reputation-settings';
import { KyselySettings } from './ai-review-reputation.kysely';

export const REVIEW_REQUEST_SENDER_JOB = 'ai.review_request.send';
/** The salon's AI package decision for this assistant (bound in the module to the shared access gate). */
export const REVIEW_SENDER_ACCESS = 'REVIEW_SENDER_ACCESS';
export type ReviewSenderAccess = (tenantId: string, branchId: string | null) => Promise<{ allowed: boolean; reason: string; enforce: boolean }>;

export interface ScopeResult { tenantId: string; branchId: string | null; expired: number; outcome: 'sent' | 'disabled' | 'not_entitled' | 'quiet_hours'; sent: number; failed: number; optedOut: number; reminded: number }

@Injectable()
export class ReviewRequestSenderJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('ReviewRequestSender');
  private timer: ReturnType<typeof setInterval> | null = null;
  static readonly FRESHNESS_HOURS = 48;

  constructor(
    private readonly requests: ReviewRequestService,
    @Optional() @Inject(DATABASE) private readonly db: AppDatabase | null = null,
    @Optional() @Inject(REVIEW_SENDER_ACCESS) private readonly access: ReviewSenderAccess | null = null,
  ) {}

  onModuleInit(): void {
    if (!runsBackgroundJob('standard')) return;
    if (!this.db || process.env.REVIEW_REQUEST_SENDER === 'off' || process.env.NODE_ENV === 'test') return;
    const every = 5 * 60_000;
    this.timer = setInterval(() => {
      void runTick({ jobType: REVIEW_REQUEST_SENDER_JOB, jobClass: 'standard', everyMs: every },
        () => runAsSingleOwner(this.db as Kysely<any>, REVIEW_REQUEST_SENDER_JOB, () => this.sweep()))
        .catch((e) => logException(e, { where: 'ai.review_request.send.tick' }));
    }, every);
    this.timer.unref?.();
  }
  onModuleDestroy(): void { if (this.timer) { clearInterval(this.timer); this.timer = null; } }

  /** One pass over every active salon/branch that has a due request or a possible reminder. */
  async sweep(now: Date = new Date()): Promise<ScopeResult[]> {
    if (!this.db) return [];
    const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
    const scopes = (await sql<{ tenant_id: string; branch_id: string | null }>`
      select distinct rr.tenant_id, rr.branch_id from review_requests rr join tenants t on t.id = rr.tenant_id and t.status = 'active'
      where (rr.status = 'scheduled' and rr.scheduled_for <= ${now})
         or (rr.status = 'sent' and rr.reminder_sent_at is null and rr.sent_at >= ${weekAgo})
      limit 2000`.execute(this.db as Kysely<any>)).rows;
    const out: ScopeResult[] = [];
    for (const s of scopes) {
      try { out.push(await this.sweepScope(String(s.tenant_id), s.branch_id ? String(s.branch_id) : null, now)); }
      catch (e) { logException(e, { where: 'ai.review_request.send.scope', tenantId: String(s.tenant_id) }); }   // one salon's failure never stops the others
    }
    const sent = out.reduce((n, r) => n + r.sent + r.reminded, 0);
    if (sent) this.logger.log(`review requests: ${sent} message(s) sent across ${out.length} branch(es)`);
    return out;
  }

  async sweepScope(tenantId: string, branchId: string | null, now: Date = new Date()): Promise<ScopeResult> {
    const ctx: any = systemContext({ tenantId, branchId, actor: 'review-request-sender', permissions: ['pos.communications.send'] });
    const base: ScopeResult = { tenantId, branchId, expired: 0, outcome: 'sent', sent: 0, failed: 0, optedOut: 0, reminded: 0 };
    base.expired = await this.requests.expireStale(ctx, now, ReviewRequestSenderJob.FRESHNESS_HOURS);

    const rows = await new KyselySettings(this.db as any).load(ctx);
    const eff = resolveSettings({ platform: PLATFORM_DEFAULTS, ...rowsToLayers(rows as SettingsRow[], { branchId: branchId ?? undefined }) });
    if (!eff.enabled || !eff.config.reviewRequest.enabled) return { ...base, outcome: 'disabled' };

    if (this.access) {
      const d = await this.access(tenantId, branchId);
      if (!d.allowed && d.enforce) return { ...base, outcome: 'not_entitled' };
    }
    const tz = await branchTimeZone(this.db as any, tenantId, branchId).catch(() => null);
    if (inQuietHours(now, eff.config.reviewRequest, tz)) return { ...base, outcome: 'quiet_hours' };

    const r = await this.requests.sendDue(ctx, now);
    const rem = await this.requests.sendReminders(ctx, eff.config.reviewRequest, now);
    return { ...base, sent: r.sent, failed: r.failed + rem.failed, optedOut: r.skippedOptOut, reminded: rem.reminded };
  }
}
