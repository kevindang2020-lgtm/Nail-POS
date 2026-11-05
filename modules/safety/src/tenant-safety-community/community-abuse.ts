// community-abuse.ts — abuse prevention for the Safety Community. Pure, deterministic decisions; the caller
// supplies the counters (from the repo) and a clock, so everything here is testable without a database.
//
// The threats the spec names map to three mechanisms:
//   1. RATE LIMITS — mass posting, spam, comment floods, report floods, and scraping (bulk reads/searches).
//   2. PROBE DETECTION — "mass identity searches". The search layer already REFUSES identifier lookups; the
//      security signal is someone doing it repeatedly. Repeated refusals escalate to a temporary restriction,
//      because a tenant probing the community for a person's phone/email is trying to use it as the lookup tool
//      it must never be.
//   3. REPUTATION → ESCALATED VERIFICATION — a tenant whose posts keep getting removed/upheld-against doesn't
//      get silently banned; its high-risk claims are routed to moderation before publication. Enforcement stays
//      with humans; this only decides "needs a human first".
//
// Deliberate design choice: restrictions are TEMPORARY and never auto-delete content or auto-deny a customer
// service — consistent with the module's core rule that nothing here punishes automatically.

export type AbuseAction = 'post' | 'comment' | 'report' | 'search' | 'search_rejected' | 'evidence_upload' | 'dispute';

export interface AbuseCounters {
  postsLastHour: number;
  postsLastDay: number;
  commentsLastHour: number;
  reportsLastDay: number;
  searchesLastHour: number;
  rejectedSearchesLastDay: number;   // refused identifier lookups — the probe signal
  disputesLastDay?: number;          // BUILD_PLAN Phase 8 (bug 10): disputes were unlimited
}

/** Per-tenant limits. Conservative by default; a salon posting more than this is either in a real emergency
 *  (which goes through moderation anyway) or abusing the channel. */
export const LIMITS = {
  postsPerHour: 5,
  postsPerDay: 20,
  commentsPerHour: 30,
  reportsPerDay: 20,
  searchesPerHour: 120,              // generous for humans; blocks scripted scraping
  rejectedSearchesPerDay: 5,         // repeated identifier probing → restrict
  disputesPerDay: 5,                 // a salon disputing more than this a day is campaigning, not correcting
} as const;

export type AbuseDecision =
  | { allowed: true }
  | { allowed: false; reason: AbuseReason; retryAfterMinutes: number; message: string };

export type AbuseReason =
  | 'post_rate_limited' | 'comment_rate_limited' | 'report_rate_limited'
  | 'search_rate_limited' | 'identity_probe_restricted' | 'tenant_restricted' | 'dispute_rate_limited';

const deny = (reason: AbuseReason, retryAfterMinutes: number, message: string): AbuseDecision =>
  ({ allowed: false, reason, retryAfterMinutes, message });

/**
 * Gate an action. `restrictedUntil` is a moderator- or system-applied temporary restriction (ISO string).
 * Fail-closed on an active restriction; otherwise apply the per-action rate limit.
 */
export function checkAbuse(action: AbuseAction, c: AbuseCounters, opts: { restrictedUntil?: string | null; now?: Date } = {}): AbuseDecision {
  const now = opts.now ?? new Date();

  if (opts.restrictedUntil && new Date(opts.restrictedUntil) > now) {
    const mins = Math.max(1, Math.ceil((new Date(opts.restrictedUntil).getTime() - now.getTime()) / 60000));
    return deny('tenant_restricted', mins, 'Your salon’s community access is temporarily restricted while moderators review recent activity.');
  }

  // Identity probing outranks the ordinary search limit: it is a safety signal, not a volume problem.
  if ((action === 'search' || action === 'search_rejected') && c.rejectedSearchesLastDay >= LIMITS.rejectedSearchesPerDay) {
    return deny('identity_probe_restricted', 24 * 60,
      'Community search is paused for your salon. Repeated attempts to look up personal identifiers were detected — the community is not a customer lookup tool.');
  }

  switch (action) {
    case 'post':
      if (c.postsLastHour >= LIMITS.postsPerHour) return deny('post_rate_limited', 60, `You can publish up to ${LIMITS.postsPerHour} advisories an hour. For an active emergency, contact support.`);
      if (c.postsLastDay >= LIMITS.postsPerDay) return deny('post_rate_limited', 24 * 60, `You’ve reached the daily limit of ${LIMITS.postsPerDay} advisories.`);
      return { allowed: true };
    case 'comment':
      if (c.commentsLastHour >= LIMITS.commentsPerHour) return deny('comment_rate_limited', 60, `You can post up to ${LIMITS.commentsPerHour} comments an hour.`);
      return { allowed: true };
    case 'report':
      if (c.reportsLastDay >= LIMITS.reportsPerDay) return deny('report_rate_limited', 24 * 60, `You’ve reached the daily limit of ${LIMITS.reportsPerDay} reports.`);
      return { allowed: true };
    case 'search':
      if (c.searchesLastHour >= LIMITS.searchesPerHour) return deny('search_rate_limited', 60, 'Too many searches. Try again shortly.');
      return { allowed: true };
    case 'dispute':
      if ((c.disputesLastDay ?? 0) >= LIMITS.disputesPerDay) return deny('dispute_rate_limited', 24 * 60, `You can dispute up to ${LIMITS.disputesPerDay} advisories a day.`);
      return { allowed: true };
    default:
      return { allowed: true };
  }
}

// ── Reputation → escalated verification (never an automatic ban) ──

export interface TenantReputation {
  postsPublished: number;
  postsRemovedByModeration: number;
  disputesUpheldAgainst: number;     // disputes decided against this tenant's posts
}

export type ReputationBand = 'good' | 'watch' | 'escalate';

/** A tenant with a poor track record doesn't get banned — its claims get a human check first. */
export function reputationBand(r: TenantReputation): ReputationBand {
  const strikes = r.postsRemovedByModeration + r.disputesUpheldAgainst;
  if (strikes === 0) return 'good';
  const ratio = r.postsPublished > 0 ? strikes / r.postsPublished : strikes;
  if (strikes >= 3 || ratio >= 0.5) return 'escalate';
  return 'watch';
}

/** Does this submission need moderation before publication, on reputation grounds alone? */
export function requiresEscalatedVerification(r: TenantReputation): boolean {
  return reputationBand(r) === 'escalate';
}
