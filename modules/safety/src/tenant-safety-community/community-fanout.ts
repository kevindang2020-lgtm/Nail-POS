// community-fanout.ts — BUILD_PLAN Phase 8 (agent C): COMMUNITY_FANOUT. How a published advisory reaches salon B.
//
//   advisoryPublished(post)  (called by the core when an approver publishes, by moderation on publish / restore)
//     1. recipients = every ENABLED, ACTIVE salon except the author, with its preferences (repository.fanoutRecipients)
//     2. planFanout (community-notify.ts, pure): critical → everyone; else region prefs, then a matching follow / notify
//        category / no preferences at all; channels per the salon's toggles; SMS only critical + critical_sms_enabled
//     3. per recipient, in ONE transaction: the in-app alert (owner_alerts, category community_advisory, idempotent per
//        salon + post + kind) and ONE outbox event COMMUNITY_ALERT_DELIVERED with tenantId = THAT salon (payload
//        { postId, severity, category, title, kind, branchIds }) — the realtime projection turns it into
//        `community_alert` in that salon's owner room and every one of its branch rooms (refetch "community" + "dashboard")
//     4. then, only for a newly written alert: push to the salon's owner / approvers, email to the salon address, and an
//        SMS only for a critical advisory with the opt-in. Text = category + severity + an authenticated deep link
//        (/community/posts/:id) — never the body.
//     5. related / duplicate detection for the post.
//   advisoryChanged(post, change)  → each salon whose users FOLLOW the post: an in-app alert + COMMUNITY_ALERT_DELIVERED
//     (kind = the change) + a push to those users; related detection again on edits.
// NEVER throws into the caller: a publication stands even if every alert fails (failures are logged, never faked).
import type { PushCategory } from '@aipowersalon/api-contracts';   // Phase 13 D: typed push categories
import { Logger } from '@nestjs/common';
import { DOMAIN_EVENTS } from '@aipowersalon/events';
import type { CommunityEventsPort, CommunityFanoutPort } from './community.ports';
import type { PostRow } from './community.repository';
import { composeSafeMessage, composeChangeMessage, ownerAlertSeverity, planFanout, defaultLinkBase, type AdvisoryChange, type FanoutPlanItem, type NotificationsBackend } from './community-notify';
import { relationFor, relationScore, RELATED_WINDOW_DAYS, RELATED_MIN_SIMILARITY } from './community-related';
import type { InteractionsRepo } from './community-interactions.service';
import { workerPrincipal } from '@aipowersalon/permissions';

export interface PushBackend { dispatchToUser(tenantId: string | null, userId: string, msg: { title: string; body: string; reference?: string; category?: PushCategory; data?: Record<string, string> }): Promise<unknown> }

export interface FanoutResult { recipients: number; delivered: number; push: number; email: number; sms: number; related: number }

export class CommunityFanoutService implements CommunityFanoutPort {
  private readonly log = new Logger('CommunityFanout');
  constructor(
    private readonly repo: InteractionsRepo,
    private readonly events: CommunityEventsPort,
    private readonly push: PushBackend | null,
    private readonly notifications: NotificationsBackend | null,
    private readonly linkBase: string = defaultLinkBase(),
  ) {}

  async advisoryPublished(post: PostRow): Promise<void> { await this.publish(post).catch((e) => this.log.warn(`fan-out failed for ${post?.id}: ${e?.message ?? e}`)); }

  /** The work behind advisoryPublished, with its counts (tests and ops read them). Throws only on a read failure. */
  async publish(post: PostRow): Promise<FanoutResult> {
    const out: FanoutResult = { recipients: 0, delivered: 0, push: 0, email: 0, sms: 0, related: 0 };
    if (!post || post.visibility !== 'community_published') return out;
    const plan = planFanout(post, await this.repo.fanoutRecipients(post.originTenantId));
    out.recipients = plan.length;
    for (const item of plan) {
      try { await this.deliver(post, item, out); }
      catch (e: any) { this.log.warn(`community alert to one salon failed (post ${post.id}): ${e?.message ?? e}`); }
    }
    out.related = await this.detectRelated(post.id).catch(() => 0);
    return out;
  }

  private async deliver(post: PostRow, item: FanoutPlanItem, out: FanoutResult): Promise<void> {
    const base = this.linkBase.replace(/\/$/, '');
    const link = `${base}/community/posts/${post.id}`;
    const msg = composeSafeMessage(post, base);
    const branchIds = await this.repo.activeBranchIds(item.tenantId);
    const written = await this.repo.tx(async (trx) => {
      const w = await this.repo.insertOwnerAlert(trx, { tenantId: item.tenantId, postId: post.id, severity: ownerAlertSeverity(post.severity), title: `Safety advisory: ${post.title}`.slice(0, 200), body: msg.body, link, dedupeKey: 'published', kind: 'published' });
      if (w) {
        await this.events.emit({ tenantId: item.tenantId, branchId: null, userId: null }, DOMAIN_EVENTS.COMMUNITY_ALERT_DELIVERED,
          { type: 'community_post', id: post.id, version: post.version }, { postId: post.id, severity: post.severity, category: post.category, title: post.title, kind: 'published', reason: item.reason, branchIds }, trx);
      }
      return w;
    });
    if (!written) return;                       // already alerted (a redelivered publish / restore) — no second push / email / SMS
    out.delivered++;
    if (item.push && this.push) {
      for (const userId of await this.repo.approverUserIds(item.tenantId)) {
        try { await this.push.dispatchToUser(item.tenantId, userId, { title: msg.subject.slice(0, 64), body: msg.body.slice(0, 178), reference: 'community_advisory', category: 'BUSINESS_ALERT', data: { kind: 'community_advisory', postId: post.id, link } }); out.push++; }
        catch { /* push is best-effort per device */ }
      }
    }
    const ctx = workerPrincipal('community-alerts', { tenantId: item.tenantId });   // BUILD_PLAN Phase 9: the named worker principal
    if (item.email && this.notifications) {
      try { const r: any = await this.notifications.send(ctx, { channel: 'email', to: item.email, subject: msg.subject, body: msg.body }); if (r?.sent !== false) out.email++; }
      catch (e: any) { this.log.warn(`community alert email failed: ${e?.message ?? e}`); }
    }
    if (item.sms && this.notifications && post.severity === 'critical') {
      try { const r: any = await this.notifications.send(ctx, { channel: 'sms', to: item.sms, body: msg.body }); if (r?.sent !== false) out.sms++; }
      catch (e: any) { this.log.warn(`community alert sms failed: ${e?.message ?? e}`); }
    }
  }

  async advisoryChanged(post: PostRow, change: AdvisoryChange): Promise<void> { await this.changed(post, change).catch((e) => this.log.warn(`change fan-out failed for ${post?.id}: ${e?.message ?? e}`)); }

  async changed(post: PostRow, change: AdvisoryChange): Promise<{ delivered: number; push: number; related: number }> {
    const res = { delivered: 0, push: 0, related: 0 };
    if (!post) return res;
    const base = this.linkBase.replace(/\/$/, '');
    const link = `${base}/community/posts/${post.id}`;
    const msg = composeChangeMessage(post, change, base);
    const hideTitle = change === 'removed' || change === 'merged';
    for (const f of await this.repo.postFollowers(post.id, post.originTenantId)) {
      try {
        const branchIds = await this.repo.activeBranchIds(f.tenantId);
        const written = await this.repo.tx(async (trx) => {
          const w = await this.repo.insertOwnerAlert(trx, { tenantId: f.tenantId, postId: post.id, severity: ownerAlertSeverity(post.severity), title: hideTitle ? msg.subject : `${msg.subject}: ${post.title}`.slice(0, 200), body: msg.body, link, dedupeKey: `${change}:v${post.version}`, kind: change });
          if (w) {
            await this.events.emit({ tenantId: f.tenantId, branchId: null, userId: null }, DOMAIN_EVENTS.COMMUNITY_ALERT_DELIVERED,
              { type: 'community_post', id: post.id, version: post.version }, { postId: post.id, severity: post.severity, category: post.category, title: hideTitle ? '' : post.title, kind: change, branchIds }, trx);
          }
          return w;
        });
        if (!written) continue;
        res.delivered++;
        if (this.push) for (const userId of f.userIds) {
          try { await this.push.dispatchToUser(f.tenantId, userId, { title: msg.subject.slice(0, 64), body: msg.body.slice(0, 178), reference: 'community_advisory', category: 'BUSINESS_ALERT', data: { kind: 'community_advisory_changed', postId: post.id, change, link } }); res.push++; }
          catch { /* best-effort */ }
        }
      } catch (e: any) { this.log.warn(`followed-advisory alert failed (post ${post.id}): ${e?.message ?? e}`); }
    }
    if (post.visibility === 'community_published' && (change === 'edited' || change === 'severity' || change === 'label' || change === 'restored')) res.related = await this.detectRelated(post.id).catch(() => 0);
    return res;
  }

  /** Same category, published within ±14 days, title similarity ≥ 0.6 or a shared tag → 'related'; ≥ 0.8 → 'possible_duplicate'. */
  async detectRelated(postId: string): Promise<number> {
    let n = 0;
    for (const c of await this.repo.relatedCandidates(postId, RELATED_WINDOW_DAYS, RELATED_MIN_SIMILARITY)) {
      const rel = relationFor(c.similarity, c.sharedTags);
      if (rel) n += (await this.repo.linkRelated(postId, c.id, rel, relationScore(c.similarity))) > 0 ? 1 : 0;
    }
    return n;
  }
}
