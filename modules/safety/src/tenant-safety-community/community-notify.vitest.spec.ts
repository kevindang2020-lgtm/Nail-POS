// community-notify.vitest.spec.ts — proves the notification safety rules: no incident detail ever leaves in a
// notification (secure link only), SMS is reserved for critical + explicitly-enabled tenants, the posting tenant
// is never self-notified, and delivery binds to the real NotificationsService contract without faking success.
import { describe, it, expect } from 'vitest';
import { shouldNotify, channelFor, composeSafeMessage, planNotifications, PlatformCommunityNotifier, type CommunitySubscriber, type NotificationsBackend } from './community-notify';
import type { PostRow } from './community.repository';

const post = (o: Partial<PostRow> = {}): PostRow => ({
  id: 'p1', originTenantId: 'T1', originBranchId: null, classification: 'community_advisory',
  visibility: 'community_published', status: 'published_unverified', category: 'Gift Card Fraud',
  severity: 'moderate', region: 'New Jersey', title: 'Caller demands gift cards',
  redactedBody: 'A caller asked for gift cards and mentioned [REDACTED_PHONE]. Very specific incident detail.',
  privacyScanFlags: [], moderationRequired: false, verificationLabel: 'unverified', version: 1,
  createdByUserId: 'u1', createdAt: '', ...o,
});
const sub = (o: Partial<CommunitySubscriber> = {}): CommunitySubscriber => ({
  tenantId: 'T2', address: 'salon@example.com', followsCategories: [], region: null,
  criticalSmsEnabled: false, communityEnabled: true, ...o,
});

describe('notification message safety', () => {
  it('NEVER includes the advisory body or title text in the message — secure link only', () => {
    const p = post();
    const m = composeSafeMessage(p, 'https://app.aipowersalon.com');
    expect(m.body).not.toContain('gift cards and mentioned');       // no incident detail
    expect(m.body).not.toContain('[REDACTED_PHONE]');               // not even redacted content
    expect(m.body).not.toContain(p.redactedBody);
    expect(m.body).toContain('/community/posts/p1');                // authenticated deep link
    expect(m.subject).toContain('Gift Card Fraud');                 // category + severity only
    expect(m.subject).toContain('MODERATE');
  });
});

describe('recipient selection', () => {
  it('never notifies the posting tenant about its own advisory', () => {
    expect(shouldNotify(sub({ tenantId: 'T1' }), post({ originTenantId: 'T1' }))).toBe(false);
    expect(shouldNotify(sub({ tenantId: 'T2' }), post({ originTenantId: 'T1' }))).toBe(true);
  });
  it('respects community-disabled tenants', () => {
    expect(shouldNotify(sub({ communityEnabled: false }), post())).toBe(false);
  });
  it('respects followed categories and region', () => {
    expect(shouldNotify(sub({ followsCategories: ['Phone Scam'] }), post({ category: 'Gift Card Fraud' }))).toBe(false);
    expect(shouldNotify(sub({ followsCategories: ['Gift Card Fraud'] }), post({ category: 'Gift Card Fraud' }))).toBe(true);
    expect(shouldNotify(sub({ region: 'New York' }), post({ region: 'New Jersey' }))).toBe(false);
    expect(shouldNotify(sub({ region: null }), post({ region: 'New Jersey' }))).toBe(true); // all regions
  });
});

describe('channel selection', () => {
  it('SMS only for CRITICAL severity AND explicitly enabled', () => {
    expect(channelFor(sub({ criticalSmsEnabled: true }), post({ severity: 'critical' }))).toBe('sms');
    expect(channelFor(sub({ criticalSmsEnabled: false }), post({ severity: 'critical' }))).toBe('email'); // not enabled
    expect(channelFor(sub({ criticalSmsEnabled: true }), post({ severity: 'high' }))).toBe('email');      // not critical
  });
});

describe('delivery bound to the real NotificationsService contract', () => {
  it('sends one safe message per eligible subscriber', async () => {
    const sentReqs: any[] = [];
    const backend: NotificationsBackend = { async send(_ctx, req) { sentReqs.push(req); return {}; } };
    const notifier = new PlatformCommunityNotifier(backend, 'https://pos.aipowersalon.com');
    const res = await notifier.notifyPublished(post({ severity: 'critical' }), [
      sub({ tenantId: 'T2', criticalSmsEnabled: true, address: '+15551234567' }),
      sub({ tenantId: 'T3', address: 't3@example.com' }),
      sub({ tenantId: 'T1' }), // the author — skipped
    ]);
    expect(res).toEqual({ sent: 2, failed: 0 });
    expect(sentReqs.map((r) => r.channel)).toEqual(['sms', 'email']);
    expect(sentReqs.every((r) => !r.body.includes('gift cards and mentioned'))).toBe(true); // no detail leaked
  });

  it('a failing/opted-out send is counted as failed — never fabricated as sent', async () => {
    const backend: NotificationsBackend = { async send() { throw new Error('opted_out'); } };
    const res = await new PlatformCommunityNotifier(backend, 'https://pos.aipowersalon.com').notifyPublished(post(), [sub({ tenantId: 'T2' })]);
    expect(res).toEqual({ sent: 0, failed: 1 });
  });

  it('plan skips ineligible subscribers entirely', () => {
    const plan = planNotifications(post(), [sub({ communityEnabled: false }), sub({ tenantId: 'T1' })], 'https://x');
    expect(plan).toEqual([]);
  });
});

// ── service integration: publication actually fires alerts ──

describe('publication fires community alerts', () => {
  // "publication fires alerts only when a post becomes community-visible" is now the core's call into COMMUNITY_FANOUT
  // (agent A's specs); the fan-out itself (who, which channels, idempotency) is proven in community-interactions.pgtest.
  it('never fabricates a hostname: with no configured link base it emits a RELATIVE path', () => {
    const m = composeSafeMessage(post(), '');
    expect(m.body).toContain('/community/posts/p1');
    expect(m.body).not.toMatch(/https?:\/\//);          // no invented domain
  });

  it('uses the configured host when one is supplied', () => {
    const m = composeSafeMessage(post(), 'https://pos.aipowersalon.com');
    expect(m.body).toContain('https://pos.aipowersalon.com/community/posts/p1');
  });
});

// ---- link-base resolution (Jul 26, 2026) ----
// Community deep links must never contain a hostname nobody provisioned. defaultLinkBase() therefore honors the
// platform's canonical portal resolution (explicit env → derived from the CORS allowlist) but drops the
// resolver's last-resort GUESS in favor of a relative path.
import { defaultLinkBase } from './community-notify';
describe('community link base resolution', () => {
  it('explicit TENANT_PORTAL_URL wins and is trailing-slash normalized', () => {
    expect(defaultLinkBase({ TENANT_PORTAL_URL: 'https://staff.example.com/' } as any)).toBe('https://staff.example.com');
  });

  it('falls back to the platform resolver (derived from the CORS allowlist), skipping admin + marketing origins', () => {
    const env = { WEB_CORS_ORIGINS: 'https://aipowersalon.com,https://admin.aipowersalon.com,https://pos.aipowersalon.com' } as any;
    expect(defaultLinkBase(env)).toBe('https://pos.aipowersalon.com');
  });

  it('nothing configured → RELATIVE path, never the resolver\'s guessed hostname', () => {
    expect(defaultLinkBase({} as any)).toBe('');
  });

  it('a relative base still produces a usable, non-fabricated link', () => {
    const m = composeSafeMessage(post(), defaultLinkBase({} as any));
    expect(m.body).toContain('/community/posts/p1');
    expect(m.body).not.toContain('aipowersalon.com');
  });
});
