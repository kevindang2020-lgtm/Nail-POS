// reviews-center.pgtest — Reviews & Reputation guide (Oct 30 2026, migration 752) on the REAL schema. REV-numbers are the guide's
// §17 verification matrix. The four-review baseline (4 × 5★, star-only, all linked to Vishal verma, all public) is seeded here as a
// FIXTURE that mirrors the photographed snapshot — the screen values are never hardcoded in product code.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { ReviewsCenter, ReviewsCenterError } from './reviews-center';
import { TeamPerformanceScreenRepository } from '../../../workforce/src/team-screens/team-performance-screen.repository';
import { evaluateRequestEligibility } from '../../../ai/src/ai-review-reputation/ai-review-reputation-requests';

const P = 'd7520000-0000-4000-8000-';
const id = (n: number) => P + String(n).padStart(12, '0');
const T = id(1), B = id(2), X = id(3), BX = id(4), OWNER = id(10);
const V = id(20), G = id(21), TECH2 = id(22), XT = id(23);   // Vishal verma, his global profile, a second technician, another salon's technician
const C = { ava: id(101), ben: id(102), cara: id(103), xena: id(109) };
const SVC = id(30), CAT = id(31);
const ctx = (tenantId = T, branchId = B) => ({ tenantId, branchId, userId: OWNER, role: 'OWNER', permissions: ['pos.marketing.view', 'pos.marketing.manage', 'pos.customers.view'] }) as any;
let db: any; let rc: ReviewsCenter; let n = 0;
const q = async (s: any) => (await s.execute(db)).rows as any[];
const audits: any[] = [];
const audit = async (_trx: any, meta: any) => { audits.push(meta); };
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e) { return e instanceof ReviewsCenterError ? e.code : `${(e as any)?.code ?? ''}:${(e as Error).message}`; } }
async function review(o: { rating: number; comment?: string | null; tech?: string | null; customer?: string | null; ticket?: string | null; line?: string | null; at?: string; source?: string; isPublic?: boolean; tenant?: string; branch?: string; spam?: boolean; ext?: string }) {
  const rid = id(3000 + ++n);
  await q(sql`insert into reviews (id, tenant_id, branch_id, customer_id, ticket_id, ticket_service_line_id, rating, comment, technician_id, global_tech_profile_id, is_public, source, is_spam, external_review_id, created_at)
    values (${rid}, ${o.tenant ?? T}, ${o.branch ?? B}, ${o.customer ?? null}, ${o.ticket ?? null}, ${o.line ?? null}, ${o.rating}, ${o.comment ?? null}, ${o.tech === undefined ? V : o.tech},
      ${(o.tech === undefined || o.tech === V) && (o.tenant ?? T) === T ? G : null}, ${o.isPublic !== false}, ${o.source ?? 'internal'}, ${!!o.spam}, ${o.ext ?? null}, ${o.at ?? new Date().toISOString()}::timestamptz)`);
  return rid;
}

beforeAll(async () => {
  db = kyselyFor(await migratedPglite()); rc = new ReviewsCenter(db);
  await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'R', 'Pilot Nail Salon', 'rv-752', 'RV752', 'active'), (${X}, 'X', 'Other Salon', 'rv-752x', 'RV752X', 'active')`);
  await q(sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Main', 'America/New_York'), (${BX}, ${X}, 'Other', 'America/New_York')`);
  await q(sql`insert into users (id, tenant_id, full_name, email, status, role) values (${OWNER}, ${T}, 'Owner One', 'owner@rv.test', 'active', 'OWNER')`);
  await q(sql`insert into global_tech_profiles (id, tech_code, public_slug, display_name, status) values (${G}, 'RV752V', 'vishal-rv752', 'Vishal verma', 'active')`);
  await q(sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, global_tech_profile_id) values (${V}, ${T}, ${B}, 'Vishal', 'verma', 'Vishal verma', ${G}),
    (${TECH2}, ${T}, ${B}, 'Lan', 'Tran', 'Lan Tran', null), (${XT}, ${X}, ${BX}, 'Xavier', 'Other', 'Xavier Other', null)`);
  for (const [cid, name, phone, tenant, branch] of [[C.ava, 'Ava Kim', '+16095550201', T, B], [C.ben, 'Ben Lee', '+16095550202', T, B], [C.cara, 'Cara Diaz', '+16095550203', T, B], [C.xena, 'Xena Kim', '+16095550299', X, BX]] as const)
    await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, email, status) values (${cid}, ${tenant}, ${branch}, ${name.split(' ')[0]}, ${name.split(' ')[1]}, ${name}, ${phone}, ${name.split(' ')[0].toLowerCase() + '@rv.test'}, 'active')`);
  await q(sql`insert into service_categories (id, tenant_id, branch_id, name) values (${CAT}, ${T}, ${B}, 'Nails')`);
  await q(sql`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values (${SVC}, ${T}, ${B}, ${CAT}, 'Gel Manicure', 45, 4500)`);
  // the photographed baseline: four 5★ star-only reviews for Vishal verma (Sep 14, Aug 31 ×3)
  await review({ rating: 5, at: '2026-09-14T16:00:00Z' }); await review({ rating: 5, at: '2026-08-31T15:00:00Z' });
  await review({ rating: 5, at: '2026-08-31T16:00:00Z' }); await review({ rating: 5, at: '2026-08-31T17:00:00Z' });
}, 240_000);

describe('P0 — the four-review baseline (REV-01, REV-02, REV-18)', () => {
  it('REV-01/02: total 4, average 5.0, public 4, hidden 0, 5-star share 100%, 0 written comments — from the rows, not the photo', async () => {
    const snap = { preset: 'custom', from: '2026-08-31', to: '2026-09-14' };   // the photographed snapshot's window (the stand-in runs every beforeAll first)
    const s = await rc.summary(ctx(), snap);
    expect({ total: s.totalReviews, avg: s.averageRating, pub: s.publicCount, hid: s.hiddenCount, five: s.fiveStarPercent, written: s.withCommentCount, starOnly: s.starOnlyCount })
      .toEqual({ total: 4, avg: 5, pub: 4, hid: 0, five: 100, written: 0, starOnly: 4 });
    expect(s.ratingDistribution).toEqual([{ star: 5, count: 4 }, { star: 4, count: 0 }, { star: 3, count: 0 }, { star: 2, count: 0 }, { star: 1, count: 0 }]);
    const l = await rc.list(ctx(), snap);
    expect(l.items.map((r) => [r.technician?.name, r.starOnly, r.visibility])).toEqual(Array(4).fill(['Vishal verma', true, 'public']));
    expect(l.items[0].submittedAt).toBe('2026-09-14T16:00:00.000Z');
  });
  it('REV-18: Reviews, Team Performance and the public technician profile agree on Vishal (and spam no longer lifts the public figure)', async () => {
    const mine = await rc.technicianStats(ctx(), V);
    const team: any = await new TeamPerformanceScreenRepository(db).technician(ctx(), V, { preset: 'year' });
    expect(team.score.allTimeReviews).toBe(mine.verifiedCount);
    expect(team.score.allTimeRating).toBe(mine.verifiedAverage);
    const spam = await review({ rating: 1, spam: true });
    const { recomputeTechRatingDenorm } = await import('./reviews-center');
    await recomputeTechRatingDenorm(db, G);
    const g = (await q(sql`select overall_rating, rating_count from global_tech_profiles where id = ${G}`))[0];
    expect({ r: Number(g.overall_rating), n: Number(g.rating_count) }).toEqual({ r: 5, n: 4 });
    expect((await rc.technicianStats(ctx(), V)).verifiedCount).toBe(4);
    await q(sql`update reviews set is_spam = false where id = ${spam}`); await q(sql`delete from reviews where id = ${spam}`);
  });
});

describe('search, filters, dates, pages (REV-03 … REV-11)', () => {
  let anon: string, linked: string, other: string;
  beforeAll(async () => {
    const tk = (await q(sql`insert into tickets (tenant_id, branch_id, customer_id, status, total_cents, paid_at, ticket_number) values (${T}, ${B}, ${C.ava}, 'paid', 4500, '2026-10-01T15:00:00Z', '7521') returning id`))[0].id;
    const line = (await q(sql`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, technician_id)
      values (${T}, ${B}, ${tk}, ${SVC}, 'Gel Manicure', 4500, 45, 4500, ${TECH2}) returning id`))[0].id;
    linked = await review({ rating: 4, comment: 'Lovely gel, will return', tech: TECH2, customer: C.ava, ticket: tk, line, at: '2026-10-02T14:00:00Z' });
    anon = await review({ rating: 3, comment: 'ok visit', tech: null, customer: null, at: '2026-10-03T14:00:00Z' });
    other = await review({ rating: 5, comment: 'Ava Kim loved it', tenant: X, branch: BX, tech: XT, customer: C.xena });
    for (let i = 0; i < 25; i++) await review({ rating: 4, tech: TECH2, at: new Date(Date.UTC(2026, 5, 1 + i, 12)).toISOString(), comment: i === 0 ? 'needle-in-page-4' : null });
  });
  it('REV-03/04: a customer name / phone / email / id finds only the LINKED review; the anonymous one stays anonymous', async () => {
    for (const term of ['Ava', '5550201', 'ava@rv.test', C.ava]) expect((await rc.list(ctx(), { q: term })).items.map((r) => r.id)).toEqual([linked]);
    const a = (await rc.list(ctx(), { q: 'ok visit' })).items[0];
    expect([a.id, a.customer]).toEqual([anon, null]);
    expect((await rc.detail(ctx(), anon, { fullContact: true, audit })).anonymous).toBe(true);
  });
  it('REV-05: technician search returns exactly the Vishal-linked reviews', async () => {
    const r = await rc.list(ctx(), { q: 'vishal' });
    expect(r.totalItems).toBe(4); expect(r.items.every((x) => x.technician?.id === V)).toBe(true);
  });
  it('REV-06: the search runs on the server — a match that sorts onto page 4 is found from page 1', async () => {
    const all = await rc.list(ctx(), { pageSize: 10, page: 4 });
    expect(all.items.some((x) => x.comment === 'needle-in-page-4')).toBe(true);
    expect((await rc.list(ctx(), { pageSize: 10, page: 1 })).items.some((x) => x.comment === 'needle-in-page-4')).toBe(false);
    const s = await rc.list(ctx(), { q: 'needle', pageSize: 10 });
    expect([s.totalItems, s.items[0].comment]).toEqual([1, 'needle-in-page-4']);
  });
  it('REV-07: rating + comment + visibility + service + source filters combine', async () => {
    expect((await rc.list(ctx(), { rating: 4, comment: 'written', service: SVC, source: 'internal', visibility: 'public' })).items.map((x) => x.id)).toEqual([linked]);
    expect((await rc.list(ctx(), { rating: 5, comment: 'written' })).totalItems).toBe(0);
    expect(await code(rc.list(ctx(), { rating: 7 }))).toBe('REVIEWS_FILTER_INVALID');
  });
  it('REV-08: a custom From/To across months uses the salon day (start inclusive, the whole end day included)', async () => {
    const r = await rc.list(ctx(), { preset: 'custom', from: '2026-08-31', to: '2026-09-14' });
    expect(r.totalItems).toBe(4);
    expect((await rc.list(ctx(), { preset: 'custom', from: '2026-09-15', to: '2026-12-31' })).items.map((x) => x.id).sort()).toEqual([linked, anon].sort());
    // 2026-09-14T16:00Z is Sep 14 in New York; a To of Sep 13 excludes it
    expect((await rc.list(ctx(), { preset: 'custom', from: '2026-09-01', to: '2026-09-13' })).totalItems).toBe(0);
    expect(await code(rc.list(ctx(), { preset: 'custom', from: '2026-10-01', to: '2026-09-01' }))).toBe('REVIEWS_RANGE_INVALID');
  });
  it('REV-09: the date basis switches between submitted, service and moderation dates', async () => {
    expect((await rc.list(ctx(), { basis: 'service', preset: 'custom', from: '2026-10-01', to: '2026-10-01' })).items.map((x) => x.id)).toEqual([linked]);
    expect((await rc.list(ctx(), { basis: 'submitted', preset: 'custom', from: '2026-10-01', to: '2026-10-01' })).totalItems).toBe(0);
    expect((await rc.list(ctx(), { basis: 'moderated', preset: 'year' })).totalItems).toBe(0);
  });
  it('REV-10/11: pages of 10/20/50, newest first with the id tie-breaker; a new matching review lands first on page 1', async () => {
    const p1 = await rc.list(ctx(), { pageSize: 10 }); const p2 = await rc.list(ctx(), { pageSize: 10, page: 2 });
    expect(p1.totalItems).toBe(31); expect([p1.totalPages, (await rc.list(ctx(), { pageSize: 50 })).totalPages, (await rc.list(ctx(), { pageSize: 7 })).pageSize]).toEqual([4, 1, 20]);
    expect(new Set([...p1.items, ...p2.items].map((x) => x.id)).size).toBe(20);
    const ts = [...p1.items, ...p2.items].map((x) => x.submittedAt!);
    expect(ts.every((t, i) => i === 0 || ts[i - 1] >= t)).toBe(true);
    const fresh = await review({ rating: 2, comment: 'Polish chipped next day', tech: TECH2 });
    expect((await rc.list(ctx(), { pageSize: 10 })).items[0].id).toBe(fresh);
    expect((await rc.list(ctx(), { sort: 'attention' })).items[0].id).toBe(fresh);
  });
  it('REV-24: another salon\'s reviews never appear, cannot be opened, cannot be moderated', async () => {
    expect((await rc.list(ctx(), { q: 'Xena' })).totalItems).toBe(0);
    expect((await rc.list(ctx(), { q: other })).totalItems).toBe(0);
    expect(await code(rc.detail(ctx(), other, { fullContact: true, audit }))).toBe('REVIEW_NOT_FOUND');
    expect(await code(rc.moderate(ctx(), other, { action: 'hide', reasonCode: 'spam', expectedVersion: 0, idempotencyKey: 'x-tenant-1' }, audit))).toBe('REVIEW_NOT_FOUND');
    expect((await q(sql`select is_hidden_by_manager from reviews where id = ${other}`))[0].is_hidden_by_manager).toBe(false);
  });
  it('the overlay masks contact without pos.customers.view, shows the linked visit, and audits the open of a linked customer', async () => {
    audits.length = 0;
    const d: any = await rc.detail(ctx(), linked, { fullContact: false, audit });
    expect([d.customer.name, d.customer.phone, d.customer.email, d.customer.contactMasked]).toEqual(['Ava Kim', '•••• 0201', 'a•••@rv.test', true]);
    expect([d.visit.ticketNumber, d.visit.serviceName, d.technician.name, d.metric.countsInVerifiedRating]).toEqual(['7521', 'Gel Manicure', 'Lan Tran', true]);
    expect(audits).toEqual([{ reviewId: linked, customerId: C.ava, fullContact: false }]);
  });
});

describe('moderation (REV-14 … REV-17, REV-21)', () => {
  it('REV-14/15: Hide needs a reason, keeps the text, records actor / reason / time, and is version-checked + idempotent', async () => {
    const rid = (await rc.list(ctx(), { q: 'Lovely gel' })).items[0].id;
    expect(await code(rc.moderate(ctx(), rid, { action: 'hide', expectedVersion: 0, idempotencyKey: 'h-1' }, audit))).toBe('HIDE_REVIEW_REASON_REQUIRED');
    expect(await code(rc.moderate(ctx(), rid, { action: 'hide', reasonCode: 'other', reasonText: 'x', expectedVersion: 0, idempotencyKey: 'h-1' }, audit))).toBe('HIDE_REVIEW_REASON_REQUIRED');
    const h = await rc.moderate(ctx(), rid, { action: 'hide', reasonCode: 'personal_information', reasonText: 'Contains a phone number', expectedVersion: 0, idempotencyKey: 'h-1' }, audit);
    expect([h.isHidden, h.moderationVersion, h.replayed]).toEqual([true, 1, false]);
    expect((await rc.moderate(ctx(), rid, { action: 'hide', reasonCode: 'personal_information', reasonText: 'Contains a phone number', expectedVersion: 0, idempotencyKey: 'h-1' }, audit)).replayed).toBe(true);
    expect(await code(rc.moderate(ctx(), rid, { action: 'unhide', expectedVersion: 0, idempotencyKey: 'u-1' }, audit))).toBe('VERSION_CONFLICT');
    expect(await code(rc.moderate(ctx(), rid, { action: 'unhide', expectedVersion: 1, idempotencyKey: 'h-1' }, audit))).toBe('IDEMPOTENCY_KEY_REUSED');
    const row = (await q(sql`select comment, rating from reviews where id = ${rid}`))[0];
    expect([row.comment, Number(row.rating)]).toEqual(['Lovely gel, will return', 4]);
    const d: any = await rc.detail(ctx(), rid, { fullContact: true, audit });
    expect(d.moderation[0]).toMatchObject({ action: 'hide', previousHidden: false, newHidden: true, reasonCode: 'personal_information', reasonText: 'Contains a phone number', actor: { id: OWNER, name: 'Owner One' } });
    expect(d.metric.countsInVerifiedRating).toBe(false);
    await rc.moderate(ctx(), rid, { action: 'unhide', expectedVersion: 1, idempotencyKey: 'u-1' }, audit);
    expect((await rc.detail(ctx(), rid, { fullContact: true, audit })).moderation.map((e: any) => e.action)).toEqual(['unhide', 'hide']);
    expect(await code(sql`update review_moderation_events set reason_text = 'edited' where review_id = ${rid}`.execute(db))).toMatch(/append-only/);
  });
  it('REV-16: a low rating is never a reason to hide — 1–2★ needs a policy reason; nothing is auto-hidden', async () => {
    const low = (await rc.list(ctx(), { q: 'Polish chipped' })).items[0];
    expect(low.needsAttention).toBe(true);
    expect(await code(rc.moderate(ctx(), low.id, { action: 'hide', reasonCode: 'other', reasonText: 'Hurts our average', expectedVersion: 0, idempotencyKey: 'l-1' }, audit))).toBe('HIDE_LOW_RATING_POLICY');
    const s = await rc.summary(ctx());
    expect([s.hiddenCount, s.needsAttention]).toEqual([0, 1]);
  });
  it('REV-17: an external (Google) review — hiding is AI PowerSalon-only, and replies need a provider connection', async () => {
    const g = await review({ rating: 4, comment: 'Nice place', tech: null, source: 'google', ext: 'accounts/1/locations/2/reviews/3' });
    const d: any = await rc.detail(ctx(), g, { fullContact: true, audit });
    expect(d.moderationScope).toMatch(/stays on google; AI PowerSalon cannot remove it there/);
    expect(d.response.publishable).toBe('needs_connection');
    expect(await code(sql`insert into reviews (tenant_id, branch_id, rating, source, external_review_id) values (${T}, ${B}, 4, 'google', 'accounts/1/locations/2/reviews/3')`.execute(db))).toMatch(/duplicate key|reviews_source_external_uniq/);
  });
  it('REV-21: the same customer rating the same technician for the same visit twice is refused by the database', async () => {
    const tk = (await q(sql`select id from tickets where tenant_id = ${T} and ticket_number = '7521'`))[0].id;
    expect(await code(sql`insert into reviews (tenant_id, branch_id, customer_id, ticket_id, technician_id, rating) values (${T}, ${B}, ${C.ava}, ${tk}, ${TECH2}, 5)`.execute(db))).toMatch(/duplicate key|uq_reviews_tech_once/);
  });
});

describe('assistant, requests, health (REV-19, REV-22, Check Review System)', () => {
  it('REV-19: with star-only reviews the assistant reports insufficient written feedback and invents nothing', async () => {
    const i: any = await rc.insights(ctx(), { preset: 'custom', from: '2026-08-31', to: '2026-09-14' });
    expect([i.status, i.writtenComments, i.starOnly, i.themes]).toEqual(['insufficient_written_feedback', 0, 4, []]);
    expect(i.message).toMatch(/none of these reviews include a written comment/);
  });
  it('REV-22: review requests refuse opted-out customers and take no rating (no gating); one request per visit by key', async () => {
    const policy: any = { enabled: true, minVisitValueCents: 0, maxPerCustomerPerPeriod: 3, cooldownDays: 0 };
    expect(evaluateRequestEligibility({ tenantId: T, customerId: C.ben, completedAt: new Date().toISOString(), visitValueCents: 4500 }, policy, { optedOut: true, lastRequestAt: null, requestsInPeriod: 0, hasContact: true }, new Date()).reason).toBe('opted_out');
    await q(sql`insert into review_requests (tenant_id, customer_id, channel, idempotency_key, scheduled_for) values (${T}, ${C.ben}, 'sms', 'rq-visit-1', now())`);
    expect(await code(sql`insert into review_requests (tenant_id, customer_id, channel, idempotency_key, scheduled_for) values (${T}, ${C.ben}, 'sms', 'rq-visit-1', now())`.execute(db))).toMatch(/duplicate key|review_requests_idem/);
  });
  it('Check Review System is read-only and honest: calculation READY, a hidden review without a trail FAILS the moderation check', async () => {
    const before = (await q(sql`select count(*)::int as n, coalesce(sum(moderation_version), 0)::int as v from reviews where tenant_id = ${T}`))[0];
    const c1 = await rc.check(ctx());
    expect(c1.checks.map((c) => c.key)).toEqual(['records', 'aggregation', 'relationships', 'cross_module', 'moderation', 'anomalies', 'delivery']);
    expect(c1.checks.find((c) => c.key === 'aggregation')!.state).toBe('READY');
    expect(c1.checks.find((c) => c.key === 'cross_module')!.state).toBe('READY');
    const legacy = await review({ rating: 5, tech: TECH2 });
    await q(sql`update reviews set is_hidden_by_manager = true, hidden_reason = 'old' where id = ${legacy}`);
    const c2 = await rc.check(ctx());
    expect(c2.checks.find((c) => c.key === 'moderation')!.state).toBe('FAILED');
    expect(c2.overall).toBe('FAILED');
    // Nov 6 2026: every "next step" carries its code — the POS shows its own EN / VI text by code, never this English
    expect(c2.checks.find((c) => c.key === 'moderation')!.actionCode).toBe('moderation_no_trail');
    for (const c of [...c1.checks, ...c2.checks]) if (c.action) expect(c.actionCode, c.action).toBeTruthy();
    const after = (await q(sql`select count(*)::int as n, coalesce(sum(moderation_version), 0)::int as v from reviews where tenant_id = ${T}`))[0];
    expect(after.v).toBe(before.v);
  });
});

describe('Nov 3 audit — KPIs follow the technician / source filters', () => {
  it('the KPI strip counts only the filtered technician and source; "none" means no technician', async () => {
    const snap = { preset: 'custom', from: '2026-08-31', to: '2026-09-14' };
    await review({ rating: 2, tech: TECH2, at: '2026-09-01T15:00:00Z', comment: 'Chipped next day' });
    await review({ rating: 4, tech: null, at: '2026-09-02T15:00:00Z', source: 'google' });
    const all = await rc.summary(ctx(), snap), v = await rc.summary(ctx(), { ...snap, technician: V }), lan = await rc.summary(ctx(), { ...snap, technician: TECH2 });
    const none = await rc.summary(ctx(), { ...snap, technician: 'none' }), g = await rc.summary(ctx(), { ...snap, source: 'google' });
    expect(all.totalReviews).toBe(6);
    expect([v.totalReviews, v.averageRating]).toEqual([4, 5]);
    expect([lan.totalReviews, lan.averageRating]).toEqual([1, 2]);
    expect(none.totalReviews).toBe(1); expect(g.totalReviews).toBe(1);
    expect(v.scope.technician).toBe('one technician');
  });
});

describe('A17 Nov 6 — assign, first/last name search, communication history, recorded check runs (migration 831)', () => {
  it('assigns a review to active salon staff (audited), filters by assignee / me / none, and takes it back; another salon cannot', async () => {
    const r = (await rc.list(ctx(), {})).items[0];
    expect(await code(rc.assign(ctx(), r.id, { assignedUserId: id(999) }, audit))).toBe('REVIEWS_FILTER_INVALID');          // not staff here
    audits.length = 0;
    expect(await rc.assign(ctx(), r.id, { assignedUserId: OWNER }, audit)).toEqual({ id: r.id, assignedUserId: OWNER });
    expect(audits[0]).toMatchObject({ reviewId: r.id, to: OWNER });
    expect((await rc.list(ctx(), { assignee: 'me' })).items.map((x) => x.id)).toEqual([r.id]);
    expect((await rc.list(ctx(), { assignee: OWNER })).items.map((x) => x.id)).toEqual([r.id]);
    expect((await rc.list(ctx(), { assignee: 'none' })).items.map((x) => x.id)).not.toContain(r.id);
    expect((await rc.detail(ctx(), r.id, { fullContact: true, audit })).assignment).toMatchObject({ userId: OWNER, name: 'Owner One' });
    await rc.assign(ctx(), r.id, { assignedUserId: null }, audit);
    expect((await rc.list(ctx(), { assignee: 'me' })).items).toHaveLength(0);
    expect(await code(rc.assign(ctx(X, BX), r.id, { assignedUserId: null }, audit))).toBe('REVIEW_NOT_FOUND');
  });
  it('"first last" (either order) matches the customer’s first and last name; the overlay lists the customer’s messages', async () => {
    const [first, last] = ['Ava', (await q(sql`select last_name from customers where id = ${C.ava}`))[0].last_name as string];
    const a = (await rc.list(ctx(), { q: `${first} ${last}` })).items.map((x) => x.id);
    const b = (await rc.list(ctx(), { q: `${last} ${first}` })).items.map((x) => x.id);
    expect(a.length).toBeGreaterThan(0); expect(b).toEqual(a);
    await q(sql`insert into notifications (tenant_id, channel, to_address, body, status, customer_id) values (${T}, 'sms', '+16095550201', 'Thanks for visiting!', 'sent', ${C.ava})`);
    const d = await rc.detail(ctx(), a[0], { fullContact: true, audit });
    expect(d.communications.messages.map((m: any) => m.preview)).toContain('Thanks for visiting!');
  });
  it('GET check stays read-only; POST check/run records a run that is returned as the last one', async () => {
    const n0 = (await q(sql`select count(*)::int n from reviews_health_runs where tenant_id = ${T}`))[0].n;
    await rc.check(ctx());
    expect((await q(sql`select count(*)::int n from reviews_health_runs where tenant_id = ${T}`))[0].n).toBe(n0);
    const r = await rc.check(ctx(), { record: true });
    const last = await rc.lastCheck(ctx());
    expect(last?.overall).toBe(r.overall);
    expect(await rc.lastCheck(ctx(X, BX))).toBeNull();
  });
});

describe('Reviews & Reputation 05 — reputation anomaly monitor (read-only)', () => {
  it('flags a burst day, repeated text and provider-sync gaps for investigation; nothing is hidden or changed; another salon is not counted', async () => {
    const c0 = (await rc.check(ctx())).checks.find((c) => c.key === 'anomalies')!;
    const before = (await q(sql`select id, is_hidden_by_manager, is_spam, moderation_version from reviews where tenant_id = ${T} order by id`));
    const burstAt = new Date(Date.now() - 3 * 86400000); burstAt.setUTCHours(16, 0, 0, 0);
    for (let i = 0; i < 6; i++) await review({ rating: 5, tech: TECH2, at: new Date(burstAt.getTime() + i * 60000).toISOString(), comment: i < 2 ? 'Amazing   service, best nails ever!' : null });
    await review({ rating: 1, tech: TECH2, comment: 'amazing service, best nails ever!', at: new Date(Date.now() - 10 * 86400000).toISOString() });                          // same text, other case / spacing
    await q(sql`update reviews set last_synced_at = now() where id = ${await review({ rating: 4, tech: null, source: 'google', ext: 'g-1', at: new Date(Date.now() - 20 * 86400000).toISOString() })}`);
    await q(sql`update reviews set last_synced_at = now() - interval '10 days' where id = ${await review({ rating: 3, tech: null, source: 'google', ext: 'g-2', at: new Date(Date.now() - 21 * 86400000).toISOString() })}`);
    await review({ rating: 2, tech: null, source: 'google', at: new Date(Date.now() - 22 * 86400000).toISOString() });                                                           // no provider id
    for (let i = 0; i < 6; i++) await review({ rating: 5, tech: XT, tenant: X, branch: BX, at: burstAt.toISOString(), comment: 'Amazing service, best nails ever!' });
    const c = (await rc.check(ctx())).checks.find((x) => x.key === 'anomalies')!;
    expect(c.state).toBe('WARNING'); expect(c.actionCode).toBe('anomalies_investigate');
    const nums = (e: string) => { const m = /^(\d+) burst.*?; (\d+) written comment\(s\) repeated on more than one review \((\d+) reviews.*?; (\d+) provider review\(s\) with no provider id; (\d+) provider review\(s\) not re-synced/.exec(e); return m ? m.slice(1).map(Number) : null; };
    const [b0, g0, r0, n0, s0] = nums(c0.evidence)!; const [b1, g1, r1, n1, s1] = nums(c.evidence)!;
    expect([b1 - b0, g1 - g0, r1 - r0, n1 - n0, s1 - s0]).toEqual([1, 1, 3, 1, 1]);   // the burst day, one repeated text on 3 reviews, one without a provider id, one stale
    expect(c.evidence).toMatch(/\(\d{4}-\d{2}-\d{2}: 6\)/);
    const after = (await q(sql`select id, is_hidden_by_manager, is_spam, moderation_version from reviews where tenant_id = ${T} and id = any(${before.map((r: any) => r.id)}::uuid[]) order by id`));
    expect(after).toEqual(before);   // flagged, never suppressed
  });
});
