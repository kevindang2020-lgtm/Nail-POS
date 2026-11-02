// platform-notice.pgtest — Super Admin POS Top-Bar Announcement mandate (Oct 22 2026) §140–§164 on the REAL schema (PGlite,
// every migration incl. 674): global / selected-tenant / selected-branch targeting decided by the server, priority order,
// schedule and expiry on the database clock, pause / resume, per-user dismissal (a material edit brings it back),
// non-dismissible, acknowledgement records, XSS refused, platform-only publishing, version conflict, duplicate publish,
// the confirmation rule, archive (never delete), duplicate-to-draft, audit, and no leakage into another salon's
// snapshot or realtime events.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { permissionsFor } from '@aipowersalon/permissions';
import { DOMAIN_EVENTS as E } from '@aipowersalon/events';
import { PlatformNoticeService } from './platform-notice.service';

const U = (n: number) => `f1a70000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TA = U(1), TB = U(2), TC = U(3), A1 = U(11), A2 = U(12), B1 = U(21), C1 = U(31), ADMIN = U(90), CLERK = U(91), MIA = U(92), LEO = U(93), BOB = U(94);
let pg: any; let db: any; let svc: PlatformNoticeService;
const events: Array<{ eventType: string; tenantId?: string; payload: any }> = [];
const audits: Array<{ action: string; resourceId: string }> = [];
const q = async (s: string, p: unknown[] = []) => (await pg.query(s, p)).rows as any[];
const admin = () => ({ userId: ADMIN, role: 'SUPER_ADMIN', permissions: ['super_admin.communications.view', 'super_admin.communications.manage'] });
const viewer = () => ({ userId: CLERK, role: 'PLATFORM_SUPPORT', permissions: ['super_admin.communications.view'] });
const pos = (tenantId: string, branchId: string | null, userId: string) => ({ tenantId, branchId, userId, role: 'FRONT_DESK', permissions: permissionsFor('FRONT_DESK') as string[] });
const ids = async (tenantId: string, branchId: string | null, userId = MIA) => (await svc.active(pos(tenantId, branchId, userId))).announcements.map((a) => a.id);
// WP-F §57: a critical notice (maintenance / warning / urgent / critical priority) needs a reviewed Vietnamese version or
// English only — the older tests below are about other rules, so their critical notices are explicitly English only.
const isCrit = (o: Record<string, unknown>) => ['maintenance', 'warning', 'urgent'].includes(String(o.type)) || o.priority === 'critical';
const make = (over: Record<string, unknown> = {}) => svc.create(admin(), { message: 'Scheduled update tonight 11 PM – 11:15 PM.', type: 'update', priority: 'normal', audience: 'all_tenants', dismissible: true, requiresAcknowledgement: false,
  ...(isCrit(over) && !('messageVi' in over) && !('englishOnly' in over) ? { englishOnly: true } : {}), ...over } as any);

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  for (const [id, code] of [[TA, 'PNA'], [TB, 'PNB'], [TC, 'PNC']]) await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,$2,$2,$3,$4,'active')`, [id, `Salon ${code}`, `pn-${code}`.toLowerCase(), code]);
  for (const [id, t, n] of [[A1, TA, 'A Main'], [A2, TA, 'A Second'], [B1, TB, 'B Main'], [C1, TC, 'C Main']]) await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,$3,'active','America/New_York')`, [id, t, n]);
  const outbox = { write: async (_t: unknown, e: any) => { events.push({ eventType: e.eventType, tenantId: e.tenantId, payload: e.payload }); } } as any;
  const audit = { recordPlatform: async (i: any) => { audits.push({ action: i.action, resourceId: i.resourceId }); } } as any;
  svc = new PlatformNoticeService(db, { outbox, audit });
}, 240_000);
beforeEach(async () => { await q(`update platform_notices set lifecycle_status = 'archived', archived_at = now() where lifecycle_status <> 'archived'`); events.length = 0; });

describe('Platform Announcements — targeting decided by the server', () => {
  it('§140 an all-tenants message reaches every salon (A, B and C) once published, never as a draft', async () => {
    const n = await make();
    expect(await ids(TA, A1)).not.toContain(n.id);                 // §15: a draft never renders
    await expect(svc.publish(admin(), n.id, { expectedVersion: n.version })).rejects.toMatchObject({ code: 'PLATFORM_ANNOUNCEMENT_CONFIRMATION_REQUIRED' });   // §120
    await svc.publish(admin(), n.id, { expectedVersion: n.version, confirm: true });
    for (const [t, b] of [[TA, A1], [TB, B1], [TC, C1]] as const) expect(await ids(t, b)).toContain(n.id);
    expect(new Set(events.filter((e) => e.eventType === E.PLATFORM_ANNOUNCEMENT_PUBLISHED).map((e) => e.tenantId))).toEqual(new Set([TA, TB, TC]));
  });
  it('§141 / §164 a selected-tenant message: Tenant A receives it, Tenant B does not — not in its snapshot, not in its events', async () => {
    const n = await make({ audience: 'selected_tenants', tenantIds: [TA], message: 'Your payment setup needs one more step.' });
    await svc.publish(admin(), n.id, { expectedVersion: n.version });
    expect(await ids(TA, A1)).toContain(n.id);
    expect(await ids(TA, A2)).toContain(n.id);
    expect(await ids(TB, B1)).not.toContain(n.id);
    expect(events.map((e) => e.tenantId)).toEqual([TA]);
    expect(JSON.stringify(events)).not.toContain('payment setup');   // realtime carries ids + version, never the text
  });
  it('§142 a selected-branch message: Branch 1 receives it, Branch 2 of the same salon does not; a branch-less session does not', async () => {
    const n = await make({ audience: 'selected_branches', branchIds: [A1], message: 'Branch 1 card terminal maintenance at 3 PM.', type: 'maintenance', endsAt: new Date(Date.now() + 3_600_000).toISOString() });
    await svc.publish(admin(), n.id, { expectedVersion: n.version });
    expect(await ids(TA, A1)).toContain(n.id);
    expect(await ids(TA, A2)).not.toContain(n.id);
    expect(await ids(TA, null)).not.toContain(n.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ tenantId: TA, payload: { branchIds: [A1] } });
  });
  it('a branch from another salon cannot be smuggled into a selected salon', async () => {
    await expect(make({ audience: 'selected_branches', tenantIds: [TA], branchIds: [B1] })).rejects.toMatchObject({ code: 'PLATFORM_ANNOUNCEMENT_INVALID_AUDIENCE' });
    await expect(make({ audience: 'selected_tenants', tenantIds: [] })).rejects.toMatchObject({ code: 'PLATFORM_ANNOUNCEMENT_INVALID_AUDIENCE' });
  });
});

describe('Platform Announcements — order, schedule, pause, dismiss, acknowledge', () => {
  it('§147 priority order is deterministic: critical, high, normal, low', async () => {
    const made = [];
    for (const p of ['low', 'critical', 'normal', 'high']) { const n = await make({ priority: p, message: `${p} message` }); await svc.publish(admin(), n.id, { expectedVersion: n.version, confirm: true }); made.push(n); }
    const s = await svc.active(pos(TB, B1, MIA));
    expect(s.announcements.map((a) => a.priority)).toEqual(['critical', 'high', 'normal', 'low']);
  });
  it('§149 / §148 a scheduled message does not appear early, appears at its start, and disappears at its end — the next change instant is reported', async () => {
    const start = new Date(Date.now() + 3_600_000).toISOString();
    const n = await make({ endsAt: new Date(Date.now() + 7_200_000).toISOString() });
    await svc.publish(admin(), n.id, { expectedVersion: n.version, confirm: true, publishNow: false, startsAt: start });
    expect((await svc.get(admin(), n.id)).status).toBe('scheduled');
    const s0 = await svc.active(pos(TA, A1, MIA));
    expect(s0.announcements.map((a) => a.id)).not.toContain(n.id);
    expect(s0.nextChangeAt).toBe(start);
    await q(`update platform_notices set starts_at = now() - interval '1 minute' where id = $1`, [n.id]);   // the clock reaches the start
    expect(await ids(TA, A1)).toContain(n.id);
    expect((await svc.get(admin(), n.id)).status).toBe('active');
    await q(`update platform_notices set ends_at = now() - interval '1 second' where id = $1`, [n.id]);    // …and the end
    expect(await ids(TA, A1)).not.toContain(n.id);
    expect((await svc.get(admin(), n.id)).status).toBe('expired');                                          // §19: kept and auditable
  });
  it('§150 / §151 pause removes it everywhere (and tells each salon); resume brings it back', async () => {
    const n = await make({ audience: 'selected_tenants', tenantIds: [TA, TC] });
    let d = await svc.publish(admin(), n.id, { expectedVersion: n.version });
    events.length = 0;
    d = await svc.pause(admin(), n.id, { expectedVersion: d.version });
    expect(await ids(TA, A1)).not.toContain(n.id);
    expect(events.map((e) => e.tenantId).sort()).toEqual([TA, TC].sort());
    d = await svc.resume(admin(), n.id, { expectedVersion: d.version });
    expect(await ids(TC, C1)).toContain(n.id);
  });
  it('§152 / §133 a dismissible message disappears for THAT user only; a material edit brings it back', async () => {
    const n = await make();
    const d = await svc.publish(admin(), n.id, { expectedVersion: n.version, confirm: true });
    await svc.receipt(pos(TA, A1, MIA), n.id, 'dismissed', d.contentVersion);
    await svc.receipt(pos(TA, A1, MIA), n.id, 'dismissed', d.contentVersion);   // repeated: one record
    expect(await ids(TA, A1, MIA)).not.toContain(n.id);
    expect(await ids(TA, A1, LEO)).toContain(n.id);                                // another employee on the same terminal still sees it
    expect((await q(`select count(*)::int c from platform_notice_receipts where notice_id = $1 and kind = 'dismissed'`, [n.id]))[0].c).toBe(1);
    await svc.update(admin(), n.id, { message: 'Update moved to 11:30 PM.', expectedVersion: d.version });
    expect(await ids(TA, A1, MIA)).toContain(n.id);
    await svc.update(admin(), n.id, { endsAt: new Date(Date.now() + 9_000_000).toISOString(), expectedVersion: (await svc.get(admin(), n.id)).version });
    const s = await svc.active(pos(TA, A1, MIA));
    expect(s.announcements.find((a) => a.id === n.id)!.contentVersion).toBe(2);      // a schedule-only edit is not material
  });
  it('§153 a non-dismissible message cannot be dismissed', async () => {
    const n = await make({ priority: 'critical', type: 'urgent', dismissible: false, message: 'Card payments are degraded — take cash or retry.' });
    const d = await svc.publish(admin(), n.id, { expectedVersion: n.version, confirm: true });
    await expect(svc.receipt(pos(TB, B1, BOB), n.id, 'dismissed', d.contentVersion)).rejects.toMatchObject({ code: 'PLATFORM_ANNOUNCEMENT_INVALID_STATE' });
    expect(await ids(TB, B1, BOB)).toContain(n.id);
  });
  it('§154 acknowledgement stores the user, the announcement, its version, the salon, the branch and the time', async () => {
    const n = await make({ requiresAcknowledgement: true, dismissible: false });
    const d = await svc.publish(admin(), n.id, { expectedVersion: n.version, confirm: true });
    const r = await svc.receipt(pos(TB, B1, BOB), n.id, 'acknowledged', d.contentVersion);
    expect(r.recorded).toBe(true);
    const [row] = await q(`select tenant_id, branch_id, user_id, content_version, created_at from platform_notice_receipts where notice_id = $1 and kind = 'acknowledged'`, [n.id]);
    expect(row).toMatchObject({ tenant_id: TB, branch_id: B1, user_id: BOB, content_version: 1 });
    expect(row.created_at).toBeTruthy();
    expect((await svc.active(pos(TB, B1, BOB))).announcements.find((a) => a.id === n.id)!.acknowledged).toBe(true);
    await expect(svc.receipt(pos(TB, B1, BOB), n.id, 'acknowledged', 99)).rejects.toMatchObject({ code: 'PLATFORM_ANNOUNCEMENT_VERSION_CONFLICT' });
  });
});

describe('Platform Announcements — security, versions, audit, history', () => {
  it('§155 script / HTML input is refused; plain text with line breaks is kept exactly', async () => {
    for (const bad of ['<script>alert(1)</script>', 'Hi <img src=x onerror=alert(1)>', '<b>bold</b>', 'click javascript:alert(1)']) await expect(make({ message: bad })).rejects.toMatchObject({ code: 'PLATFORM_ANNOUNCEMENT_INVALID_MESSAGE' });
    await expect(make({ message: '   \n  ' })).rejects.toMatchObject({ code: 'PLATFORM_ANNOUNCEMENT_INVALID_MESSAGE' });
    await expect(make({ message: 'x'.repeat(2001) })).rejects.toMatchObject({ code: 'PLATFORM_ANNOUNCEMENT_INVALID_MESSAGE' });
    const n = await make({ message: 'Line one\r\nLine two\u0007\n\n\n\nLine three  ' });
    expect(n.message).toBe('Line one\nLine two\n\nLine three');
  });
  it('§156 / §157 publishing without the platform permission is denied — including a salon owner\'s permissions', async () => {
    const n = await make();
    await expect(svc.publish(viewer(), n.id, { confirm: true })).rejects.toMatchObject({ code: 'PLATFORM_ANNOUNCEMENT_ACCESS_DENIED' });
    await expect(svc.create(viewer(), { message: 'x', type: 'info', priority: 'normal', audience: 'all_tenants' } as any)).rejects.toMatchObject({ code: 'PLATFORM_ANNOUNCEMENT_ACCESS_DENIED' });
    const owner = { userId: U(95), role: 'OWNER', permissions: permissionsFor('OWNER') as string[] };
    await expect(svc.publish(owner, n.id, { confirm: true })).rejects.toMatchObject({ code: 'PLATFORM_ANNOUNCEMENT_ACCESS_DENIED' });
    await expect(svc.list(owner)).rejects.toMatchObject({ code: 'PLATFORM_ANNOUNCEMENT_ACCESS_DENIED' });
  });
  it('§161 a stale editor gets PLATFORM_ANNOUNCEMENT_VERSION_CONFLICT', async () => {
    const n = await make();
    await svc.update(admin(), n.id, { message: 'First editor', expectedVersion: n.version });
    await expect(svc.update(admin(), n.id, { message: 'Second editor (stale)', expectedVersion: n.version })).rejects.toMatchObject({ code: 'PLATFORM_ANNOUNCEMENT_VERSION_CONFLICT' });
    expect((await svc.get(admin(), n.id)).message).toBe('First editor');
  });
  it('§162 repeated publish clicks make one publication (one event per salon, one revision)', async () => {
    const n = await make({ audience: 'selected_tenants', tenantIds: [TB] });
    for (let i = 0; i < 5; i++) await svc.publish(admin(), n.id, { expectedVersion: n.version });
    expect(events.filter((e) => e.eventType === E.PLATFORM_ANNOUNCEMENT_PUBLISHED)).toHaveLength(1);
    expect((await q(`select count(*)::int c from platform_notice_revisions where notice_id = $1 and action = 'published'`, [n.id]))[0].c).toBe(1);
  });
  it('§93 / §59 schedule validation: end before start, an end already passed, maintenance with no end', async () => {
    await expect(make({ startsAt: '2026-11-02T10:00:00Z', endsAt: '2026-11-02T09:00:00Z' })).rejects.toMatchObject({ code: 'PLATFORM_ANNOUNCEMENT_INVALID_SCHEDULE' });
    const past = await make({ endsAt: new Date(Date.now() - 60_000).toISOString() });
    await expect(svc.publish(admin(), past.id, { confirm: true })).rejects.toMatchObject({ code: 'PLATFORM_ANNOUNCEMENT_INVALID_SCHEDULE' });
    const maint = await make({ type: 'maintenance' });
    await expect(svc.publish(admin(), maint.id, { confirm: true })).rejects.toMatchObject({ code: 'PLATFORM_ANNOUNCEMENT_INVALID_SCHEDULE' });
  });
  it('§20 / §130 / §131 archive keeps history (never deleted, cannot be edited); duplicate makes a new DRAFT', async () => {
    const n = await make();
    const d = await svc.publish(admin(), n.id, { expectedVersion: n.version, confirm: true });
    const a = await svc.archive(admin(), n.id, { expectedVersion: d.version });
    expect(a.status).toBe('archived');
    expect(await ids(TA, A1)).not.toContain(n.id);
    await expect(svc.update(admin(), n.id, { message: 'x', expectedVersion: a.version })).rejects.toMatchObject({ code: 'PLATFORM_ANNOUNCEMENT_ALREADY_ARCHIVED' });
    await expect(svc.publish(admin(), n.id, { confirm: true })).rejects.toMatchObject({ code: 'PLATFORM_ANNOUNCEMENT_ALREADY_ARCHIVED' });
    const copy = await svc.duplicate(admin(), n.id);
    expect(copy).toMatchObject({ status: 'draft', duplicatedFrom: n.id, message: n.message });
    expect(await ids(TA, A1)).not.toContain(copy.id);
    expect((await q(`select count(*)::int c from platform_notices where id = $1`, [n.id]))[0].c).toBe(1);
  });
  it('§163 create / edit / publish / pause / resume / archive are all audited, and every write leaves a revision', async () => {
    audits.length = 0;
    const n = await make({ audience: 'selected_tenants', tenantIds: [TA] });
    let d = await svc.update(admin(), n.id, { message: 'Edited', expectedVersion: n.version });
    d = await svc.publish(admin(), n.id, { expectedVersion: d.version });
    d = await svc.pause(admin(), n.id, { expectedVersion: d.version });
    d = await svc.resume(admin(), n.id, { expectedVersion: d.version });
    d = await svc.archive(admin(), n.id, { expectedVersion: d.version });
    expect(audits.filter((a) => a.resourceId === n.id).map((a) => a.action)).toEqual(['created', 'edited', 'published', 'paused', 'resumed', 'archived']);
    expect(d.revisions.map((r) => r.action)).toEqual(['archived', 'resumed', 'paused', 'published', 'edited', 'created']);
    expect(d.revisions[4].snapshot).toMatchObject({ message: 'Edited', audience: 'selected_tenants' });
  });
  it('§128–§129 history: filter by status, search by title / message / target salon (server side)', async () => {
    const n = await make({ title: 'Holiday hours', message: 'Support closes early on Nov 26.', audience: 'selected_tenants', tenantIds: [TC] });
    expect((await svc.list(admin(), { q: 'holiday' })).items.map((i) => i.id)).toContain(n.id);
    expect((await svc.list(admin(), { q: 'Salon PNC' })).items.map((i) => i.id)).toContain(n.id);
    expect((await svc.list(admin(), { status: 'draft' })).items.every((i) => i.status === 'draft')).toBe(true);
    expect((await svc.list(admin(), { status: 'archived', q: 'holiday' })).items.map((i) => i.id)).not.toContain(n.id);
  });
  it('§54 / §55 the salon picker is searchable and paged; branches come from the branch rows', async () => {
    const p = await svc.tenantOptions(admin(), { q: 'PNB', pageSize: 5 });
    expect(p.items.map((t) => t.id)).toEqual([TB]);
    expect((await svc.branchOptions(admin(), TA)).map((b) => b.id).sort()).toEqual([A1, A2].sort());
  });
  it('the receipts of one salon are invisible to another (an id from salon A is not found from salon B)', async () => {
    const n = await make({ audience: 'selected_tenants', tenantIds: [TA] });
    const d = await svc.publish(admin(), n.id, { expectedVersion: n.version });
    await expect(svc.receipt(pos(TB, B1, BOB), n.id, 'acknowledged', d.contentVersion)).rejects.toMatchObject({ code: 'PLATFORM_ANNOUNCEMENT_NOT_FOUND' });
    await expect(svc.receipt(pos(TB, B1, BOB), n.id, 'dismissed', d.contentVersion)).rejects.toMatchObject({ code: 'PLATFORM_ANNOUNCEMENT_NOT_FOUND' });
  });
});

// English + Vietnamese POS mandate WP-F (§56–§57): an optional Vietnamese version, written and reviewed by a person; the
// POS snapshot carries both versions (the POS picks by its language); a critical notice needs a reviewed Vietnamese
// version or an explicit English-only decision; version / acknowledgement semantics and tenant isolation unchanged.
describe('Platform Announcements — Vietnamese version (WP-F)', () => {
  const VI_MSG = 'Bảo trì máy quẹt thẻ lúc 3 giờ chiều — thanh toán thẻ có thể chậm vài giây.';
  it('stores the Vietnamese title / message (cleaned by the English rules) and the POS snapshot carries both versions', async () => {
    const n = await make({ audience: 'selected_tenants', tenantIds: [TA], title: 'Card terminal update', titleVi: '  Cập nhật máy quẹt thẻ  ', messageVi: VI_MSG + '\r\n\r\n\r\nCảm ơn.' });
    expect(n).toMatchObject({ titleVi: 'Cập nhật máy quẹt thẻ', messageVi: VI_MSG + '\n\nCảm ơn.', vietnamese: 'unreviewed', critical: false, englishOnly: false });
    await svc.publish(admin(), n.id, { expectedVersion: n.version });
    const a = (await svc.active(pos(TA, A1, MIA))).announcements.find((x) => x.id === n.id)!;
    expect(a).toMatchObject({ title: 'Card terminal update', titleVi: 'Cập nhật máy quẹt thẻ', messageVi: VI_MSG + '\n\nCảm ơn.' });
    expect(a.message).toBe('Scheduled update tonight 11 PM – 11:15 PM.');
    expect((await svc.active(pos(TB, B1, BOB))).announcements.map((x) => x.id)).not.toContain(n.id);   // isolation unchanged
    expect((await svc.get(admin(), n.id)).revisions[0].snapshot).toMatchObject({ titleVi: 'Cập nhật máy quẹt thẻ', englishOnly: false });
  });
  it('markup in the Vietnamese text is refused like in the English; a Vietnamese title without its message is refused', async () => {
    await expect(make({ messageVi: 'Xin chào <script>alert(1)</script>' })).rejects.toMatchObject({ code: 'PLATFORM_ANNOUNCEMENT_INVALID_MESSAGE' });
    await expect(make({ titleVi: 'Chỉ có tiêu đề' })).rejects.toMatchObject({ code: 'PLATFORM_ANNOUNCEMENT_INVALID_MESSAGE' });
    await expect(make({ messageVi: 'x'.repeat(2001) })).rejects.toMatchObject({ code: 'PLATFORM_ANNOUNCEMENT_INVALID_MESSAGE' });
    await expect(make({ messageVi: VI_MSG, englishOnly: true })).rejects.toMatchObject({ code: 'PLATFORM_ANNOUNCEMENT_INVALID_MESSAGE' });
  });
  it('§57 a critical notice cannot go live with no Vietnamese version, or with an UNREVIEWED one; reviewed or English only can', async () => {
    const end = new Date(Date.now() + 3_600_000).toISOString();
    const none = await make({ type: 'maintenance', endsAt: end, englishOnly: false });
    await expect(svc.publish(admin(), none.id, { expectedVersion: none.version, confirm: true })).rejects.toMatchObject({ code: 'PLATFORM_ANNOUNCEMENT_VI_REVIEW_REQUIRED' });
    const unrev = await make({ type: 'warning', messageVi: VI_MSG });
    expect(unrev).toMatchObject({ critical: true, vietnamese: 'unreviewed' });
    await expect(svc.publish(admin(), unrev.id, { expectedVersion: unrev.version, confirm: true })).rejects.toMatchObject({ code: 'PLATFORM_ANNOUNCEMENT_VI_REVIEW_REQUIRED' });
    expect((await svc.get(admin(), unrev.id)).status).toBe('draft');                                   // nothing went live
    const rev = await svc.update(admin(), unrev.id, { viReviewed: true, expectedVersion: unrev.version });
    expect(rev).toMatchObject({ vietnamese: 'reviewed', viReviewedBy: ADMIN });
    expect(rev.viReviewedAt).toBeTruthy();
    await svc.publish(admin(), rev.id, { expectedVersion: rev.version, confirm: true });
    expect(await ids(TB, B1)).toContain(rev.id);
    const eo = await make({ priority: 'critical', englishOnly: true });
    expect(eo.vietnamese).toBe('english_only');
    await svc.publish(admin(), eo.id, { expectedVersion: eo.version, confirm: true });
    expect((await svc.active(pos(TA, A1, MIA))).announcements.find((x) => x.id === eo.id)).toMatchObject({ titleVi: null, messageVi: null });
  });
  it('a review belongs to ONE wording: editing the English or Vietnamese text clears it, and a live critical notice refuses that edit until re-reviewed', async () => {
    const n = await make({ type: 'urgent', messageVi: VI_MSG, viReviewed: true });
    expect(n.vietnamese).toBe('reviewed');
    let d = await svc.publish(admin(), n.id, { expectedVersion: n.version, confirm: true });
    await expect(svc.update(admin(), n.id, { message: 'Card payments are back.', expectedVersion: d.version })).rejects.toMatchObject({ code: 'PLATFORM_ANNOUNCEMENT_VI_REVIEW_REQUIRED' });
    expect((await svc.get(admin(), n.id)).message).toBe('Scheduled update tonight 11 PM – 11:15 PM.');   // refused = unchanged
    d = await svc.update(admin(), n.id, { message: 'Card payments are back.', messageVi: 'Thanh toán thẻ đã hoạt động lại.', viReviewed: true, expectedVersion: d.version });
    expect(d).toMatchObject({ vietnamese: 'reviewed', messageVi: 'Thanh toán thẻ đã hoạt động lại.' });
    const draft = await make({ messageVi: VI_MSG, viReviewed: true });                                 // a non-critical draft: edit clears the review
    const e = await svc.update(admin(), draft.id, { messageVi: VI_MSG + ' Cảm ơn.', expectedVersion: draft.version });
    expect(e).toMatchObject({ vietnamese: 'unreviewed', viReviewedBy: null, viReviewedAt: null });
  });
  it('version / acknowledgement semantics unchanged: a Vietnamese text change is material (content version +1, a dismissed notice returns); the ack is per content version', async () => {
    const n = await make({ audience: 'selected_tenants', tenantIds: [TA], messageVi: VI_MSG, requiresAcknowledgement: true });
    let d = await svc.publish(admin(), n.id, { expectedVersion: n.version });
    await svc.receipt(pos(TA, A1, LEO), n.id, 'acknowledged', d.contentVersion);
    expect((await svc.active(pos(TA, A1, LEO))).announcements.find((x) => x.id === n.id)).toMatchObject({ acknowledged: true });
    await svc.receipt(pos(TA, A1, LEO), n.id, 'dismissed', d.contentVersion);
    expect(await ids(TA, A1, LEO)).not.toContain(n.id);
    d = await svc.update(admin(), n.id, { messageVi: 'Nội dung mới.', expectedVersion: d.version });
    expect(d.contentVersion).toBe(n.contentVersion + 1);
    const back = (await svc.active(pos(TA, A1, LEO))).announcements.find((x) => x.id === n.id)!;
    expect(back).toMatchObject({ messageVi: 'Nội dung mới.', acknowledged: false });
    const v2 = d.version;
    d = await svc.update(admin(), n.id, { endsAt: new Date(Date.now() + 9_000_000).toISOString(), expectedVersion: v2 });   // not material
    expect(d.contentVersion).toBe(n.contentVersion + 1);
  });
  it('duplicate keeps the Vietnamese wording but not its review (the copy is reviewed again before it goes live)', async () => {
    const n = await make({ type: 'maintenance', endsAt: new Date(Date.now() + 3_600_000).toISOString(), messageVi: VI_MSG, viReviewed: true });
    const c = await svc.duplicate(admin(), n.id);
    expect(c).toMatchObject({ messageVi: VI_MSG, vietnamese: 'unreviewed', viReviewedBy: null });
  });
  it('the database refuses an impossible Vietnamese shape even if a writer skips the service', async () => {
    const n = await make({});
    await expect(q(`update platform_notices set english_only = true, message_vi = 'x' where id = $1`, [n.id])).rejects.toThrow();
    await expect(q(`update platform_notices set title_vi = 'x', message_vi = null where id = $1`, [n.id])).rejects.toThrow();
    await expect(q(`update platform_notices set vi_reviewed_at = now() where id = $1`, [n.id])).rejects.toThrow();
  });
});

// Oct 27 2026 — §60: the list's Created by column reads a PLATFORM user's name; a tenant user's name never surfaces.
describe('Platform Announcements — §60 creator name', () => {
  it('list + detail carry createdByName for a platform user; a tenant user id resolves to null', async () => {
    await q(`insert into users (id, tenant_id, full_name, email, role, status) values ($1, null, 'Platform Kevin', 'pk@example.test', 'SUPER_ADMIN', 'active') on conflict (id) do nothing`, [ADMIN]);
    await q(`insert into users (id, tenant_id, full_name, email, role, status) values ($1, $2, 'Mia Front Desk', 'mia@example.test', 'FRONT_DESK', 'active') on conflict (id) do nothing`, [MIA, TA]);
    const n = await make({ message: 'Creator column check.' });
    expect((await svc.list(admin(), { q: 'Creator column' })).items.find((i) => i.id === n.id)).toMatchObject({ createdBy: ADMIN, createdByName: 'Platform Kevin' });
    expect(await svc.get(admin(), n.id)).toMatchObject({ createdByName: 'Platform Kevin' });
    await q(`update platform_notices set created_by = $1 where id = $2`, [MIA, n.id]);
    expect((await svc.list(admin(), { q: 'Creator column' })).items.find((i) => i.id === n.id)!.createdByName).toBeNull();
  });
});

// Oct 27 2026 — §98: the salon-name search was rewritten (salons first, targets through the partial unique indexes)
describe('Platform Announcements — §98 salon search rewrite', () => {
  it('finds a notice by the salon of a selected-TENANT target and of a selected-BRANCH target; not by an untargeted salon', async () => {
    const t = await make({ audience: 'selected_tenants', tenantIds: [TB], message: 'Search rewrite tenant target.' });
    const b = await make({ audience: 'selected_branches', branchIds: [C1], message: 'Search rewrite branch target.' });
    const hit = async (q2: string) => (await svc.list(admin(), { q: q2 })).items.map((i) => i.id);
    expect(await hit('Salon PNB')).toContain(t.id);
    expect(await hit('PNC')).toContain(b.id);
    expect(await hit('Salon PNA')).not.toContain(t.id);
    expect(await hit('Salon PNA')).not.toContain(b.id);
    expect((await svc.list(admin(), { q: 'Salon PNB' })).total).toBeGreaterThanOrEqual(1);
  });
});
