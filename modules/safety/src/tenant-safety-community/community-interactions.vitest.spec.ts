// community-interactions.vitest.spec — BUILD_PLAN Phase 8 (agent C): the PURE rules of the interactions half — the
// comment thread a reader sees, follow matching + validation, who a published advisory alerts (and on which channels),
// related / duplicate thresholds, evidence upload validation, the analytics range, and the change-alert wording.
import { describe, it, expect } from 'vitest';
import { buildCommentTree, commentView, replyDepth, REMOVED_BY_MODERATOR, DELETED_BY_AUTHOR, AUTHOR_DELETE_REASON, type CommentRecord } from './community-comments';
import { normalizeFollow, followMatches } from './community-follows';
import { planFanout, composeChangeMessage, ownerAlertSeverity, type FanoutRecipient } from './community-notify';
import { relationFor, relationScore, normTags } from './community-related';
import { validateEvidenceUpload, sha256HexToBase64, evidenceStorageKey, EVIDENCE_MAX_BYTES } from './community-evidence';
import { parseAnalyticsRange, shapeAnalytics, previewAlerts } from './community-analytics';
import { extractIndicators } from './community-risk-matching';

const T1 = '11111111-0000-4000-8000-000000000001', T2 = '11111111-0000-4000-8000-000000000002', U1 = '11111111-0000-4000-8000-0000000000a1', U2 = '11111111-0000-4000-8000-0000000000a2';
const c = (id: string, over: Partial<CommentRecord> = {}): CommentRecord => ({ id, postId: 'p', parentId: null, depth: 0, tenantId: T2, createdByUserId: U2, visibility: 'community_published', body: `body ${id}`, authorLabel: 'Bella Nails', version: 1, editedAt: null, removedReason: null, createdAt: `2026-10-08T10:00:0${id.length}Z`, ...over });

describe('comment thread', () => {
  it('nests replies under their parent, oldest first, at every depth', () => {
    const rows = [c('c', { parentId: 'b', depth: 2, createdAt: '2026-10-08T10:00:03Z' }), c('a', { createdAt: '2026-10-08T10:00:01Z' }), c('b', { parentId: 'a', depth: 1, createdAt: '2026-10-08T10:00:02Z' }), c('d', { createdAt: '2026-10-08T10:00:04Z' })];
    const tree = buildCommentTree(rows, { tenantId: T1, userId: U1 });
    expect(tree.map((n) => n.id)).toEqual(['a', 'd']);
    expect(tree[0].replies.map((n) => n.id)).toEqual(['b']);
    expect(tree[0].replies[0].replies.map((n) => n.id)).toEqual(['c']);
  });
  it('a removed comment keeps its place; moderator vs author wording; never its text', () => {
    const [mod] = buildCommentTree([c('m', { visibility: 'removed', removedReason: 'abusive', body: 'secret words' })], { tenantId: T1, userId: U1 });
    expect(mod).toMatchObject({ body: REMOVED_BY_MODERATOR, removed: true, mine: false, edited: false });
    const [own] = buildCommentTree([c('o', { visibility: 'removed', removedReason: AUTHOR_DELETE_REASON, body: 'secret words' })], { tenantId: T2, userId: U2 });
    expect(own.body).toBe(DELETED_BY_AUTHOR);
    expect(own.mine).toBe(false);
  });
  it('the author is a label only; own salon / mine are derived, never ids', () => {
    const v = commentView(c('x', { editedAt: '2026-10-08T11:00:00Z' }), { tenantId: T2, userId: U2 });
    expect(v.author).toEqual({ label: 'Bella Nails', isOwnSalon: true, anonymous: false });
    expect(v.mine).toBe(true);
    expect(v.edited).toBe(true);
    expect(JSON.stringify(v)).not.toContain(T2);
    expect(JSON.stringify(v)).not.toContain(U2);
    expect(commentView(c('y', { authorLabel: 'A salon in NJ' }), { tenantId: T1, userId: U1 }).author).toEqual({ label: 'A salon in NJ', isOwnSalon: false, anonymous: true });
    expect(commentView(c('z', { tenantId: T2, createdByUserId: U2 }), { tenantId: T1, userId: U2 }).mine).toBe(false);   // same user id, other salon → not mine
  });
  it('an orphan reply surfaces at the top level instead of vanishing', () => {
    expect(buildCommentTree([c('r', { parentId: 'gone', depth: 1 })], { tenantId: T1, userId: U1 }).map((n) => n.id)).toEqual(['r']);
  });
  it('depth: top level 0, replies to depth 3 at most', () => {
    expect(replyDepth(null)).toBe(0);
    expect(replyDepth({ depth: 0 })).toBe(1);
    expect(replyDepth({ depth: 2 })).toBe(3);
    expect(replyDepth({ depth: 3 })).toBeNull();
  });
});

describe('follows', () => {
  it('validates category, severity and channels; needs something to follow', () => {
    expect(normalizeFollow({ category: 'phone_scam' })).toEqual({ ok: true, value: { category: 'phone_scam', region: null, severityMin: null, channels: ['in_app'] } });
    expect(normalizeFollow({ category: 'nope' as any })).toMatchObject({ ok: false, invalid: { field: 'category' } });
    expect(normalizeFollow({ severityMin: 'extreme' as any })).toMatchObject({ ok: false, invalid: { field: 'severityMin' } });
    expect(normalizeFollow({ category: 'phone_scam', channels: ['fax'] as any })).toMatchObject({ ok: false, invalid: { field: 'channels' } });
    expect(normalizeFollow({ category: 'phone_scam', channels: [] })).toMatchObject({ ok: false, invalid: { field: 'channels' } });
    expect(normalizeFollow({})).toMatchObject({ ok: false, invalid: { field: 'category' } });
    expect(normalizeFollow({ region: '  NJ ', channels: ['push', 'push', 'email'] })).toEqual({ ok: true, value: { category: null, region: 'NJ', severityMin: null, channels: ['push', 'email'] } });
  });
  it('matches on category, region (case-insensitive) and minimum severity', () => {
    const post = { category: 'phone_scam', region: 'NJ', severity: 'high' };
    expect(followMatches({ category: 'phone_scam', region: null, severityMin: null }, post)).toBe(true);
    expect(followMatches({ category: 'gift_card_scam', region: null, severityMin: null }, post)).toBe(false);
    expect(followMatches({ category: null, region: 'nj', severityMin: null }, post)).toBe(true);
    expect(followMatches({ category: null, region: 'PA', severityMin: null }, post)).toBe(false);
    expect(followMatches({ category: null, region: 'NJ', severityMin: null }, { ...post, region: null })).toBe(false);
    expect(followMatches({ category: null, region: null, severityMin: 'high' }, post)).toBe(true);
    expect(followMatches({ category: null, region: null, severityMin: 'critical' }, post)).toBe(false);
  });
});

describe('who a published advisory alerts', () => {
  const r = (tenantId: string, o: Partial<FanoutRecipient> = {}): FanoutRecipient => ({ tenantId, communityEnabled: true, notifyCategories: [], regionPreferences: [], follows: [], pushEnabled: true, emailEnabled: true, criticalSmsEnabled: false, email: `${tenantId}@x.test`, phone: '+15550000000', ...o });
  const post = (o: Record<string, unknown> = {}) => ({ originTenantId: 'A', category: 'phone_scam', region: 'NJ', severity: 'high', ...o }) as any;

  it('never the author, never a disabled salon, never twice', () => {
    const plan = planFanout(post(), [r('A'), r('B'), r('C', { communityEnabled: false }), r('B')]);
    expect(plan.map((p) => p.tenantId)).toEqual(['B']);
  });
  it('no preferences → hears everything; preferences → only what it chose', () => {
    expect(planFanout(post(), [r('B')])[0].reason).toBe('default');
    expect(planFanout(post(), [r('B', { notifyCategories: ['gift_card_scam'] })])).toEqual([]);
    expect(planFanout(post(), [r('B', { notifyCategories: ['phone_scam'] })])[0].reason).toBe('category');
    expect(planFanout(post(), [r('B', { follows: [{ category: 'phone_scam', region: null, severityMin: 'critical', channels: ['in_app'] }] })])).toEqual([]);
    expect(planFanout(post(), [r('B', { follows: [{ category: 'phone_scam', region: null, severityMin: null, channels: ['in_app', 'push'] }] })])[0]).toMatchObject({ reason: 'follow', push: true, email: null });
  });
  it('region preferences filter a non-critical alert; a critical one reaches every enabled salon', () => {
    expect(planFanout(post(), [r('B', { regionPreferences: ['PA'] })])).toEqual([]);
    expect(planFanout(post(), [r('B', { regionPreferences: ['nj'] })])).toHaveLength(1);
    expect(planFanout(post({ severity: 'critical' }), [r('B', { regionPreferences: ['PA'], notifyCategories: ['gift_card_scam'] })])[0].reason).toBe('critical');
  });
  it('SMS ONLY for critical AND the opt-in AND a phone on file', () => {
    expect(planFanout(post({ severity: 'critical' }), [r('B', { criticalSmsEnabled: true })])[0].sms).toBe('+15550000000');
    expect(planFanout(post({ severity: 'critical' }), [r('B', { criticalSmsEnabled: false })])[0].sms).toBeNull();
    expect(planFanout(post({ severity: 'high' }), [r('B', { criticalSmsEnabled: true })])[0].sms).toBeNull();
    expect(planFanout(post({ severity: 'critical' }), [r('B', { criticalSmsEnabled: true, phone: null })])[0].sms).toBeNull();
  });
  it('push / email follow the salon toggles; email needs an address', () => {
    expect(planFanout(post(), [r('B', { pushEnabled: false, emailEnabled: false })])[0]).toMatchObject({ push: false, email: null });
    expect(planFanout(post(), [r('B', { email: null })])[0].email).toBeNull();
  });
  it('change alerts say what changed, never the body', () => {
    const m = composeChangeMessage({ id: 'p9', category: 'phone_scam', severity: 'high' }, 'resolved', 'https://pos.example');
    expect(m.body).toContain('was marked resolved');
    expect(m.body).toContain('https://pos.example/community/posts/p9');
    expect(ownerAlertSeverity('critical')).toBe('critical');
    expect(ownerAlertSeverity('moderate')).toBe('warning');
    expect(ownerAlertSeverity('low')).toBe('info');
  });
});

describe('related / duplicate thresholds', () => {
  it('≥ 0.8 possible duplicate, ≥ 0.6 or a shared tag related, else nothing', () => {
    expect(relationFor(0.85, 0)).toBe('possible_duplicate');
    expect(relationFor(0.8, 0)).toBe('possible_duplicate');
    expect(relationFor(0.79, 0)).toBe('related');
    expect(relationFor(0.6, 0)).toBe('related');
    expect(relationFor(0.59, 0)).toBeNull();
    expect(relationFor(0.1, 1)).toBe('related');
    expect(relationFor(NaN, 0)).toBeNull();
    expect(relationScore(0.123456)).toBe(0.123);
    expect(relationScore(4)).toBe(1);
    expect(normTags([' Gift ', 'gift', null, 'Phone'])).toEqual(['gift', 'phone']);
  });
});

describe('evidence upload request', () => {
  const ok = { postId: '22222222-0000-4000-8000-000000000001', mimeType: 'image/png', sizeBytes: 1000, sha256: 'a'.repeat(64) };
  it('accepts the allowlisted types up to 15 MB with a hex sha256', () => {
    expect(validateEvidenceUpload(ok)).toMatchObject({ ok: true, value: { postId: ok.postId, incidentId: null, mimeType: 'image/png' } });
    expect(validateEvidenceUpload({ ...ok, sizeBytes: EVIDENCE_MAX_BYTES }).ok).toBe(true);
  });
  it.each([
    [{ ...ok, mimeType: 'image/gif' }, 'mimeType'], [{ ...ok, mimeType: 'text/html' }, 'mimeType'],
    [{ ...ok, sizeBytes: EVIDENCE_MAX_BYTES + 1 }, 'sizeBytes'], [{ ...ok, sizeBytes: 0 }, 'sizeBytes'], [{ ...ok, sizeBytes: 1.5 }, 'sizeBytes'],
    [{ ...ok, sha256: 'xyz' }, 'sha256'], [{ ...ok, postId: null }, 'postId'], [{ ...ok, incidentId: ok.postId }, 'postId'], [{ ...ok, postId: 'nope' }, 'postId'],
  ])('refuses %j (%s)', (body, field) => { expect(validateEvidenceUpload(body)).toMatchObject({ ok: false, field }); });
  it('checksum header is the base64 digest; the key is tenant-namespaced and holds no file name', () => {
    expect(sha256HexToBase64('00'.repeat(32))).toBe('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
    expect(evidenceStorageKey('T', 'E')).toBe('tenants/T/community-evidence/E');
  });
});

describe('analytics range', () => {
  const now = new Date('2026-10-08T15:00:00Z');
  it('defaults to the last 30 days; to is inclusive', () => {
    expect(parseAnalyticsRange({}, now)).toEqual({ ok: true, from: '2026-09-09', to: '2026-10-08', fromTs: '2026-09-09T00:00:00Z', toExclusiveTs: '2026-10-09T00:00:00Z' });
  });
  it('refuses bad dates, reversed ranges and spans over 366 days', () => {
    expect(parseAnalyticsRange({ from: '2026-13-01' }, now)).toMatchObject({ ok: false, field: 'from' });
    expect(parseAnalyticsRange({ to: '2026-02-30' }, now)).toMatchObject({ ok: false, field: 'to' });
    expect(parseAnalyticsRange({ from: '2026-10-09', to: '2026-10-08' }, now)).toMatchObject({ ok: false, field: 'from' });
    expect(parseAnalyticsRange({ from: '2025-10-07', to: '2026-10-08' }, now)).toMatchObject({ ok: false });
    expect(parseAnalyticsRange({ from: '2025-10-08', to: '2026-10-08' }, now).ok).toBe(true);
  });
  it('shapes the response: statuses summed, top 5 categories, hours rounded', () => {
    const a = shapeAnalytics('2026-10-01', '2026-10-08', { byStatus: [{ status: 'published_unverified', n: 2 }, { status: 'incident_draft', n: 1 }], published: 2, avgHoursToPublish: 5.26, comments: 3, similar: 1, followers: 4,
      categories: [{ category: 'phone_scam', n: 1 }, { category: 'gift_card_scam', n: 2 }] });
    expect(a).toEqual({ from: '2026-10-01', to: '2026-10-08', posts: { published_unverified: 2, incident_draft: 1 }, published: 2, comments: 3, similarReports: 1, followers: 4, avgHoursToPublish: 5.3,
      topCategories: [{ category: 'gift_card_scam', count: 2 }, { category: 'phone_scam', count: 1 }] });
    expect(shapeAnalytics('a', 'b', { byStatus: [], published: 0, avgHoursToPublish: null, comments: 0, similar: 0, followers: 0, categories: [] }).avgHoursToPublish).toBeNull();
  });
});

describe('risk indicators (only ever hashed, only when activated)', () => {
  it('pulls phones and emails out of private text, de-duplicated across formats', () => {
    const got = extractIndicators('Call 856-555-0100 or (856) 555-0100, mail Bad@Example.com / bad@example.com');
    expect(got.map((g) => g.kind)).toEqual(['phone', 'email']);
    expect(got.every((g) => g.reliability === 'reliable')).toBe(true);
  });
});

describe('extras Safety Community 07 — previewAlerts (pure)', () => {
  const me = { tenantId: 'me', communityEnabled: true, notifyCategories: [], regionPreferences: [], follows: [], pushEnabled: false, emailEnabled: true, criticalSmsEnabled: false, email: 'me@x.test', phone: '+15550000000' };
  const post = (o: Partial<{ originTenantId: string; category: string; region: string | null; severity: string }> = {}) => ({ originTenantId: 'other', category: 'phone_scam', region: 'NJ', severity: 'low', ...o });
  it('no saved settings → the community is off for this salon: nothing would arrive (never an empty pass)', () => {
    expect(previewAlerts([post(), post()], null)).toMatchObject({ communityEnabled: false, considered: 2, wouldReceive: 0, bySeverity: [], byCategory: [] });
  });
  it('no preferences at all → it hears everything (the default reason); own posts never; SMS only for critical with the opt-in', () => {
    const r = previewAlerts([post(), post({ severity: 'critical' }), post({ originTenantId: 'me' })], me);
    expect(r).toMatchObject({ wouldReceive: 2, byReason: { critical: 1, follow: 0, category: 0, default: 1 }, channels: { inApp: 2, push: 0, email: 2, sms: 0 } });
  });
  it('stops at the cap and says so', () => {
    const r = previewAlerts([post(), post(), post()], me, 2);
    expect(r).toMatchObject({ considered: 2, wouldReceive: 2, truncated: true });
  });
});
