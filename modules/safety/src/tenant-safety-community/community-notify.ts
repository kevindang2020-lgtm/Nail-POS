// community-notify.ts — who gets alerted about a published advisory, and what the message may say.
//
// Two safety rules from the spec drive this file:
//   1. "Do not include sensitive incident details in insecure notifications. Provide a secure authenticated
//      link." → the composer NEVER puts the advisory body (even redacted) into an SMS/email. It sends the
//      category + severity + a link the recipient must authenticate to open.
//   2. "SMS only for critical alerts when explicitly enabled." → the channel decision is explicit: SMS is
//      reserved for critical severity and only when the tenant turned it on; everything else goes to email.
//
// The recipient decision is pure and testable; delivery binds to the platform's EXISTING NotificationsService
// (which already enforces opt-outs and credits) — no parallel notification system.
//
// LINK BASE: the deep link must point at the host that actually serves the tenant POS app. That host is
// CONFIGURED, never hard-coded here — a wrong guess sends staff to a dead domain. Resolution order:
//   explicit constructor argument → TENANT_PORTAL_URL env → the platform's canonical resolver
//   (common/platform-urls.tenantPortalBaseUrl: APP_BASE_URL/PUBLIC_APP_URL/ADMIN_BASE_URL, else derived from
//   WEB_CORS_ORIGINS) → a RELATIVE path.
// The resolver's last-resort default is deliberately NOT used here: it self-reports `guessed`, and a guessed
// hostname in a staff SMS is exactly the fabricated link this module refuses to send. A relative path is safe —
// it resolves against whatever origin renders the message instead of naming a host nobody provisioned.
// (The old pos.* vs app.* ambiguity is settled: platform-settings-defaults now defaults `urls.tenant_portal` to
// pos.aipowersalon.com, the host in DEPLOY_RUNBOOK/WEB_CORS_ORIGINS/Terraform, and
// platform-urls-consistency.vitest.spec.ts fails if the two ever drift apart again.)
import type { PostRow } from './community.repository';
import { tenantPortalBaseUrl } from '@aipowersalon/config';
import { followMatches, type FollowRecord } from './community-follows';
import { workerPrincipal } from '@aipowersalon/permissions';

/** Resolved per construction (not at import) so deployment env changes are picked up by the module factory. */
export function defaultLinkBase(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env?.TENANT_PORTAL_URL;
  if (explicit) return explicit.replace(/\/+$/, '');
  const derived = tenantPortalBaseUrl(env);
  return derived.guessed ? '' : derived.url;   // never ship a guessed hostname in a staff alert
}

/** @deprecated kept for callers that captured the import-time value; prefer defaultLinkBase(). */
export const DEFAULT_LINK_BASE = (typeof process !== 'undefined' && process.env?.TENANT_PORTAL_URL) || '';

export type NotifyChannel = 'sms' | 'email';

export interface CommunitySubscriber {
  tenantId: string;
  address: string;                 // email address or phone, per channel
  followsCategories: string[];     // empty = follows all
  region: string | null;           // null = all regions
  criticalSmsEnabled: boolean;     // tenant explicitly enabled SMS for critical alerts
  communityEnabled: boolean;
}

export interface NotifyPlanItem { tenantId: string; address: string; channel: NotifyChannel; subject: string; body: string; }

const SEV_RANK: Record<string, number> = { informational: 0, low: 1, moderate: 2, high: 3, critical: 4 };

/** Does this subscriber want this advisory? Never notifies the posting tenant about its own post, never
 *  notifies a tenant with the community disabled. */
export function shouldNotify(sub: CommunitySubscriber, post: PostRow): boolean {
  if (!sub.communityEnabled) return false;
  if (sub.tenantId === post.originTenantId) return false;                       // don't alert the author
  if (sub.followsCategories.length && !sub.followsCategories.includes(post.category)) return false;
  if (sub.region && post.region && sub.region !== post.region) return false;
  return true;
}

/** SMS is reserved for CRITICAL alerts and only when the tenant explicitly enabled it. Everything else: email. */
export function channelFor(sub: CommunitySubscriber, post: PostRow): NotifyChannel {
  const critical = (SEV_RANK[post.severity] ?? 0) >= 4;
  return critical && sub.criticalSmsEnabled ? 'sms' : 'email';
}

/**
 * Compose a SAFE message. Deliberately excludes the advisory body — a notification may travel over an insecure
 * channel, so it carries only the category, severity, and an authenticated deep link.
 */
export function composeSafeMessage(post: PostRow, linkBase: string): { subject: string; body: string } {
  // With no configured host, emit a RELATIVE path rather than inventing a hostname that may not resolve.
  const base = (linkBase || '').replace(/\/$/, '');
  const link = `${base}/community/posts/${post.id}`;
  const sev = post.severity.toUpperCase();
  return {
    subject: `Safety advisory (${sev}): ${post.category}`,
    // no incident detail, no title text that could carry specifics — category + severity + secure link only
    body: `A ${post.severity} safety advisory was published in the ${post.category} category${post.region ? ` for ${post.region}` : ''}. Sign in to read it: ${link}`,
  };
}

/** The full plan: which subscribers get alerted, on which channel, with what safe copy. Pure. */
export function planNotifications(post: PostRow, subs: CommunitySubscriber[], linkBase: string): NotifyPlanItem[] {
  return subs.filter((s) => shouldNotify(s, post)).map((s) => {
    const { subject, body } = composeSafeMessage(post, linkBase);
    return { tenantId: s.tenantId, address: s.address, channel: channelFor(s, post), subject, body };
  });
}

// ── Delivery port, bound to the platform's existing NotificationsService ──
export interface CommunityNotifier { notifyPublished(post: PostRow, subs: CommunitySubscriber[]): Promise<{ sent: number; failed: number }>; }

/** Structural contract satisfied by the real NotificationsService (send(ctx, {channel,to,subject,body})). */
export interface NotificationsBackend {
  send(ctx: { tenantId: string; userId: string; role: string; salonName?: string }, req: { channel: NotifyChannel; to: string; subject?: string; body: string }): Promise<unknown>;
}

/** Sends via the EXISTING notifications service — which already enforces opt-outs, credits, and delivery logs.
 *  Failures are counted, never fabricated as success, and never block publication. */
export class PlatformCommunityNotifier implements CommunityNotifier {
  constructor(private readonly notifications: NotificationsBackend, private readonly linkBase = defaultLinkBase()) {}
  async notifyPublished(post: PostRow, subs: CommunitySubscriber[]): Promise<{ sent: number; failed: number }> {
    const plan = planNotifications(post, subs, this.linkBase);
    let sent = 0, failed = 0;
    for (const item of plan) {
      try {
        await this.notifications.send(
          workerPrincipal('community-notify', { tenantId: item.tenantId }),   // BUILD_PLAN Phase 9: the named worker principal
          { channel: item.channel, to: item.address, subject: item.subject, body: item.body },
        );
        sent++;
      } catch { failed++; }   // opt-out / credit / provider failure — recorded, never faked
    }
    return { sent, failed };
  }
}

/** No-op notifier (dev/tests, and when no notifications backend is bound). Never pretends to have sent. */
export class InMemoryCommunityNotifier implements CommunityNotifier {
  plans: NotifyPlanItem[] = [];
  constructor(private readonly linkBase = defaultLinkBase()) {}
  async notifyPublished(post: PostRow, subs: CommunitySubscriber[]) {
    const plan = planNotifications(post, subs, this.linkBase);
    this.plans.push(...plan);
    return { sent: plan.length, failed: 0 };
  }
}

// ── BUILD_PLAN Phase 8 (agent C): the publication fan-out plan ─────────────────────────────────────────────────────
// Who hears about a published advisory, and on which channels. PURE — the store supplies every enabled salon with its
// preferences; delivery (community-fanout.ts) writes one COMMUNITY_ALERT_DELIVERED per recipient + the in-app alert, push,
// email and (critical only) SMS.
//   • never the posting salon; never a salon with the community disabled
//   • CRITICAL → every enabled salon (region preferences do not filter a critical alert)
//   • otherwise the salon's region preferences must allow the post's region, and then: a matching follow, OR the
//     category is in its notify categories, OR it has set no preferences at all (no follows, no categories → it hears
//     everything; the moment it configures anything it hears only what it chose)
//   • channels: in-app always; push / email per the salon's toggles (narrowed to the follow's channels when it was a
//     follow that matched); SMS ONLY for critical AND critical_sms_enabled AND a business phone on file.
export interface FanoutRecipient {
  tenantId: string; communityEnabled: boolean;
  notifyCategories: string[]; regionPreferences: string[]; follows: Pick<FollowRecord, 'category' | 'region' | 'severityMin' | 'channels'>[];
  pushEnabled: boolean; emailEnabled: boolean; criticalSmsEnabled: boolean;
  email: string | null; phone: string | null;
}
export type FanoutReason = 'critical' | 'follow' | 'category' | 'default';
export interface FanoutPlanItem { tenantId: string; reason: FanoutReason; push: boolean; email: string | null; sms: string | null }

export function planFanout(post: Pick<PostRow, 'originTenantId' | 'category' | 'region' | 'severity'>, recipients: FanoutRecipient[]): FanoutPlanItem[] {
  const critical = post.severity === 'critical';
  const out: FanoutPlanItem[] = [];
  const seen = new Set<string>();
  for (const r of recipients) {
    if (!r.communityEnabled || r.tenantId === post.originTenantId || seen.has(r.tenantId)) continue;
    let reason: FanoutReason | null = null;
    let follow: FanoutRecipient['follows'][number] | undefined;
    if (critical) reason = 'critical';
    else {
      const prefs = r.regionPreferences.map((x) => x.toLowerCase());
      if (prefs.length && post.region && !prefs.includes(post.region.toLowerCase())) continue;
      follow = r.follows.find((f) => followMatches(f, post));
      if (follow) reason = 'follow';
      else if (r.notifyCategories.includes(post.category)) reason = 'category';
      else if (!r.follows.length && !r.notifyCategories.length) reason = 'default';
    }
    if (!reason) continue;
    seen.add(r.tenantId);
    const allow = (ch: 'push' | 'email') => !follow || follow.channels.includes(ch) || follow.channels.length === 0;
    out.push({
      tenantId: r.tenantId, reason,
      push: r.pushEnabled && allow('push'),
      email: r.emailEnabled && allow('email') && r.email ? r.email : null,
      sms: critical && r.criticalSmsEnabled && r.phone ? r.phone : null,
    });
  }
  return out;
}

export type AdvisoryChange = 'edited' | 'update_added' | 'label' | 'severity' | 'resolved' | 'disputed' | 'corrected' | 'removed' | 'restored' | 'merged';
const CHANGE_WORDS: Record<AdvisoryChange, string> = {
  edited: 'was edited', update_added: 'has a new update', label: 'has a new verification label', severity: 'changed severity',
  resolved: 'was marked resolved', disputed: 'is disputed', corrected: 'was corrected', removed: 'was removed by moderators',
  restored: 'was restored', merged: 'was merged into another advisory',
};
/** A followed advisory changed — the same rule: category + severity + an authenticated link, never the body. */
export function composeChangeMessage(post: Pick<PostRow, 'id' | 'category' | 'severity'>, change: AdvisoryChange, linkBase: string): { subject: string; body: string } {
  const base = (linkBase || '').replace(/\/$/, '');
  return {
    subject: `Followed advisory ${CHANGE_WORDS[change] ?? 'changed'}`,
    body: `A ${post.severity} advisory you follow in the ${post.category} category ${CHANGE_WORDS[change] ?? 'changed'}. Sign in to read it: ${base}/community/posts/${post.id}`,
  };
}

/** owner_alerts.severity for an advisory severity (its CHECK: info | warning | high | critical). */
export function ownerAlertSeverity(sev: string): 'info' | 'warning' | 'high' | 'critical' {
  return sev === 'critical' ? 'critical' : sev === 'high' ? 'high' : sev === 'moderate' ? 'warning' : 'info';
}
