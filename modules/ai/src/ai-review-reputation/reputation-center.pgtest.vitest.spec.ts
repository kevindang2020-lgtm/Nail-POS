// reputation-center.pgtest — AI Review & Reputation guide (Nov 1 2026; migration 768) on the REAL schema.
// KP = the six cards (one definition) · WF = the approval workflow through the real stores · IN = inbox / detail ·
// QU = approvals / complaints / requests queues · TR = trends / branches · SC = security · HL = health.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { ReputationCenter, ReputationCenterError } from './reputation-center';
import { ReviewDraftingService } from './ai-review-reputation-drafting.service';
import { KyselyDraftStore, KyselyApprovalStore } from './ai-review-reputation.kysely';

const P = 'c7680000-0000-4000-8000-';
const id = (n: number) => P + String(n).padStart(12, '0');
const T = id(1), B = id(2), B2 = id(3), X = id(4), BX = id(5), OWNER = id(10), FD = id(11), CUST = id(30);
const R = { g5: id(101), g1: id(102), y4: id(103), int3: id(104), spam: id(105), b2: id(106), other: id(130) };
const ctx = (o: any = {}) => ({ tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: ['pos.ai_review_reputation.view', 'pos.ai_review_reputation.manage'], ...o }) as any;
let db: any; let rc: ReputationCenter; let drafting: ReviewDraftingService;
const q = async (s: any) => (await s.execute(db)).rows as any[];
const published: string[] = [];
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e) { return e instanceof ReputationCenterError ? e.code : (e as Error).message; } }
const review = (rid: string, o: { tenant?: string; branch?: string; rating: number; source: string; text: string; sentiment?: string | null; severity?: string | null; daysAgo: number; spam?: boolean; ext?: string; customer?: string | null }) =>
  q(sql`insert into reviews (id, tenant_id, branch_id, rating, comment, source, external_review_id, reviewer_name, review_date, created_at, last_synced_at, sentiment, severity, is_spam, customer_id, response_status)
    values (${rid}, ${o.tenant ?? T}, ${o.branch ?? B}, ${o.rating}, ${o.text}, ${o.source}, ${o.ext ?? null}, ${'Reviewer ' + rid.slice(-3)}, now() - (${o.daysAgo} || ' days')::interval,
      now() - (${o.daysAgo} || ' days')::interval, now(), ${o.sentiment ?? null}, ${o.severity ?? null}, ${o.spam ?? false}, ${o.customer ?? null}, 'review_received')`);

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  rc = new ReputationCenter(db, () => Date.now());
  drafting = new ReviewDraftingService({ draft: async () => 'Thank you for visiting us. We appreciate your feedback.' } as any, new KyselyDraftStore(db), new KyselyApprovalStore(db),
    { publish: async (_c: any, rid: string) => { published.push(rid); return { externalResponseId: 'ext-' + rid }; } } as any);
  await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'S', 'Pilot', 'rep-768', 'REP768', 'active'), (${X}, 'X', 'Other', 'rep-768x', 'REP768X', 'active')`);
  await q(sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Main', 'America/New_York'), (${B2}, ${T}, 'Second', 'America/New_York'), (${BX}, ${X}, 'Other', 'America/New_York')`);
  await q(sql`insert into users (id, tenant_id, full_name, email, status, role) values (${OWNER}, ${T}, 'Owner', 'o@rep.test', 'active', 'OWNER'), (${FD}, ${T}, 'Front', 'f@rep.test', 'active', 'FRONT_DESK')`);
  await q(sql`set session_replication_role = replica`);
  await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, status) values (${CUST}, ${T}, ${B}, 'Linh', 'Tran', 'Linh Tran', '+14155550199', 'active')`);
  await review(R.g5, { rating: 5, source: 'google', text: 'Loved my gel manicure, very clean salon', sentiment: 'positive', daysAgo: 3, ext: 'accounts/1/locations/1/reviews/a' });
  await review(R.g1, { rating: 1, source: 'google', text: 'Waited 40 minutes and the tools looked dirty', sentiment: 'negative', severity: 'high', daysAgo: 10, ext: 'accounts/1/locations/1/reviews/b' });
  await review(R.y4, { rating: 4, source: 'yelp', text: 'Nice pedicure', sentiment: 'positive', daysAgo: 40 });
  // the 15th of the month three months back — always in the 4th month of a 4-month trend, never in a 3-month one (a fixed
  // "70 days ago" fell inside the 3-month window on the first ~10 days of a month: the Nov 10 2026 red)
  const back3 = (() => { const n = new Date(); return Math.round((n.getTime() - Date.UTC(n.getUTCFullYear(), n.getUTCMonth() - 3, 15, 12)) / 86_400_000); })();
  await review(R.int3, { rating: 3, source: 'internal', text: 'OK visit', sentiment: null, daysAgo: back3, customer: CUST });
  await review(R.spam, { rating: 1, source: 'google', text: 'buy followers', sentiment: 'negative', daysAgo: 2, spam: true });
  await review(R.b2, { branch: B2, rating: 2, source: 'google', text: 'Polish chipped next day', sentiment: 'negative', daysAgo: 5 });
  await review(R.other, { tenant: X, branch: BX, rating: 1, source: 'google', text: 'other salon', sentiment: 'negative', daysAgo: 1 });
  await q(sql`insert into review_escalations (tenant_id, branch_id, review_id, severity, signals, status) values (${T}, ${B}, ${R.g1}, 'high', '["hygiene"]', 'open')`);
  await q(sql`insert into review_requests (tenant_id, branch_id, customer_id, channel, status, idempotency_key, scheduled_for) values
    (${T}, ${B}, ${CUST}, 'sms', 'scheduled', 'k1', now() - interval '1 day'), (${T}, ${B}, ${CUST}, 'email', 'sent', 'k2', now() - interval '3 days')`);
  await q(sql`insert into integration_connections (tenant_id, provider_key, category, ownership_type, connection_status, authentication_status, sync_status, auth_method, provider_account, last_successful_sync_at)
    values (${T}, 'google_business_profile', 'reviews', 'tenant', 'active', 'valid', 'idle', 'oauth', 'accounts/123456789', now())`).catch(() => undefined);
  await q(sql`set session_replication_role = origin`);
});

describe('Review & Reputation — the six cards', () => {
  it('KP-01 one definition: spam excluded, average of rated reviews, negative share with its denominator, the open case counted once', async () => {
    const s: any = await rc.summary(ctx(), {});
    expect(s.metrics).toEqual({ reviews: 5, averageRating: 3, ratedReviews: 5, negativeShare: 40, negativeReviews: 2, classifiedReviews: 4,
      awaitingApproval: 0, seriousComplaints: 1, responseRate: 0, publishedResponses: 0 });
    expect(s.sampleNote).toBe('small_sample');
    expect(s.recent[0].id).toBe(R.g5);
  });
  it('KP-02 filters: source, period, branch — and an empty period says "—", never a 0 average', async () => {
    expect((await rc.summary(ctx(), { source: 'google' }) as any).metrics.reviews).toBe(3);
    expect((await rc.summary(ctx(), { preset: 'last_30' }) as any).metrics.reviews).toBe(3);
    expect((await rc.summary(ctx(), { branch: B2 }) as any).metrics).toMatchObject({ reviews: 1, averageRating: 2 });
    expect((await rc.summary(ctx(), { preset: 'custom', from: '2020-01-01', to: '2020-01-31' }) as any).metrics).toMatchObject({ reviews: 0, averageRating: null, negativeShare: null, responseRate: null });
    expect(await code(rc.summary(ctx(), { preset: 'custom', from: '2026-02-01', to: '2026-01-01' }))).toBe('REPUTATION_INVALID_PERIOD');
  });
});

describe('Review & Reputation — the approval workflow (real stores)', () => {
  it('WF-01 a draft, a request and an approval move the review\'s state; the cards follow (they were stuck at 0)', async () => {
    await drafting.generateDraft(ctx(), R.g1, { analysis: { sentiment: 'negative', severity: 'high', categories: [] } as any, config: {} as any, tenantContext: { tenantId: T, brandName: 'Pilot', tone: 'warm', responseLength: 'short', languages: ['en'], branchNames: [], services: [], policies: { refund: '', cancellation: '', loyalty: '' }, escalationContacts: [], templates: [] } as any, reviewText: 'x' });
    expect((await q(sql`select response_status from reviews where id = ${R.g1}`))[0].response_status).toBe('draft_generated');
    await drafting.requestApproval(ctx(), R.g1);
    expect((await rc.summary(ctx(), {}) as any).metrics.awaitingApproval).toBe(1);
    expect((await rc.approvals(ctx(), {}) as any).items.map((x: any) => x.reviewId)).toEqual([R.g1]);
    await drafting.approve(ctx(), R.g1);
    const a = await q(sql`select a.action, a.draft_id = d.id as real_draft, a.actor_user_id from review_approvals a join review_response_drafts d on d.review_id = a.review_id where a.review_id = ${R.g1} order by a.created_at`);
    expect(a.map((x) => [x.action, x.real_draft, x.actor_user_id])).toEqual([['requested', true, OWNER], ['approved', true, OWNER]]);
    expect((await rc.summary(ctx(), {}) as any).metrics).toMatchObject({ awaitingApproval: 0, responseRate: 0 });   // approved ≠ responded
  });
  it('WF-02 only a provider-confirmed publish counts as a response', async () => {
    await drafting.publish(ctx(), R.g1);
    expect(published).toEqual([R.g1]);
    expect((await rc.summary(ctx(), {}) as any).metrics).toMatchObject({ publishedResponses: 1, responseRate: 20 });
    const d: any = await rc.review(ctx(), R.g1, { customerAccess: true });
    expect(d.response).toMatchObject({ state: 'published', version: 1, canPublishToProvider: true });
    expect(d.response.approvals.map((x: any) => x.action)).toEqual(['approved', 'requested']);
  });
  it('WF-03 a write that fails now fails loudly (it used to answer "approved" without saving)', async () => {
    const broken: any = { selectFrom: () => ({ select: () => ({ where: () => ({ where: () => ({ executeTakeFirst: async () => ({ status: 'awaiting_approval', current_text: 't', current_version: 1 }) }) }) }) }),
      updateTable: () => ({ set: () => ({ where: () => ({ where: () => ({ execute: async () => { throw new Error('db down'); } }) }) }) }) };
    await expect(new KyselyDraftStore(broken).save(ctx(), R.y4, { status: 'approved' })).rejects.toThrow('db down');
  });
});

describe('Review & Reputation — inbox, detail, queues', () => {
  it('IN-01 search, rating, response and complaint filters, sorts and stable pages', async () => {
    const ids = async (f: any) => (await rc.reviews(ctx(), f)).items.map((x: any) => x.id);
    expect(await ids({})).toEqual([R.g5, R.b2, R.g1, R.y4, R.int3]);                       // newest first, spam excluded
    expect(await ids({ q: 'dirty' })).toEqual([R.g1]);
    expect(await ids({ rating: '5' })).toEqual([R.g5]);
    expect(await ids({ response: 'published' })).toEqual([R.g1]);
    expect(await ids({ response: 'unanswered', source: 'google' })).toEqual([R.g5, R.b2]);
    expect(await ids({ complaint: 'open' })).toEqual([R.g1]);
    expect(await ids({ sort: 'rating_low', pageSize: 10 })).toEqual([R.g1, R.b2, R.int3, R.y4, R.g5]);
    expect((await rc.reviews(ctx(), { pageSize: 10, page: 2 })).items).toEqual([]);
    expect(await code(rc.reviews(ctx(), { rating: '9' }))).toBe('REPUTATION_INVALID_FILTER');
  });
  it('IN-02 detail: the stored customer link only with customer access; a public reviewer name is never matched', async () => {
    const withAccess: any = await rc.review(ctx(), R.int3, { customerAccess: true });
    expect(withAccess.customer).toEqual({ id: CUST, name: 'Linh Tran', phone: '(•••) •••-0199' });
    expect((await rc.review(ctx(), R.int3, { customerAccess: false }) as any).customer).toMatchObject({ restricted: true, name: null });
    expect((await rc.review(ctx(), R.g5, { customerAccess: true }) as any).customer).toBeNull();
  });
  it('QU-01 complaints, requests (scheduled is never shown as sent) and integrations', async () => {
    const c: any = await rc.complaints(ctx(), {});
    expect(c.items).toHaveLength(1);
    expect(c.items[0]).toMatchObject({ reviewId: R.g1, status: 'open', severity: 'high', signals: ['hygiene'] });
    expect((await rc.complaints(ctx(), { state: 'resolved' })).total).toBe(0);
    const r: any = await rc.requests(ctx(), {});
    expect(r).toMatchObject({ total: 2, overdueNotSent: 1, counts: { scheduled: 1, sent: 1 }, sender: { running: false } });
    expect(r.items[0].customer).toBe('Linh Tran');
    const i: any = await rc.integrations(ctx());
    expect(i.providers.find((p: any) => p.provider === 'facebook_pages')).toMatchObject({ connected: false, canPublishReplies: false });
    expect(i.imports.map((x: any) => x.source).sort()).toEqual(['google', 'internal', 'yelp']);
  });
});

describe('Review & Reputation — trends, branches, security, health', () => {
  it('TR-01 trends and branches use the same definition; a branch with no reviews is N/A', async () => {
    const t: any = await rc.trends(ctx(), { months: 4 });                 // the 3-months-back review falls in the 4th month back
    expect(t.months).toHaveLength(4);
    expect(t.months.reduce((n: number, m: any) => n + m.reviews, 0)).toBe(5);
    expect((await rc.trends(ctx(), { months: 3 }) as any).months.reduce((n: number, m: any) => n + m.reviews, 0)).toBe(4);
    expect(t.months.at(-1).sample).not.toBe('ok');
    await q(sql`insert into branches (id, tenant_id, name, timezone) values (${id(7)}, ${T}, 'Empty', 'America/New_York')`);
    const b: any = await rc.branches(ctx(), {});
    const by = Object.fromEntries(b.branches.map((x: any) => [x.name, x]));
    expect(by.Main.metrics).toMatchObject({ reviews: 4, publishedResponses: 1 });
    expect(by.Second.metrics).toMatchObject({ reviews: 1, averageRating: 2 });
    expect(by.Empty.metrics).toBeNull();
    expect(by.Main.metrics.reviews + by.Second.metrics.reviews).toBe((await rc.summary(ctx(), {}) as any).metrics.reviews);
  });
  it('SC-01 another salon\'s review is not found; a branch-confined user sees only their branch', async () => {
    expect(await code(rc.review(ctx(), R.other, { customerAccess: true }))).toBe('REVIEW_NOT_FOUND');
    expect((await rc.reviews(ctx(), { q: 'other salon' })).total).toBe(0);
    const confined = ctx({ userId: FD, role: 'FRONT_DESK', authz: { scope: 'BRANCH', branchIds: [B2] } });
    expect((await rc.reviews(confined, {})).items.map((x: any) => x.id)).toEqual([R.b2]);
    expect(await code(rc.review(confined, R.g5, { customerAccess: true }))).toBe('REVIEW_NOT_FOUND');
  });
  it('HL-01 the check is read-only and reports what it found', async () => {
    await q(sql`update reviews set response_status = 'review_received' where id = ${R.g1}`);   // a drifted status (as before the fix)
    const before = await q(sql`select (select count(*) from review_response_drafts)::int a, (select count(*) from review_approvals)::int b`);
    const r: any = await rc.check(ctx());
    const by = Object.fromEntries(r.checks.map((c: any) => [c.key, c]));
    expect(by.response_state_consistent).toMatchObject({ state: 'WARNING', count: 1 });
    expect(by.analysis_coverage).toMatchObject({ state: 'WARNING', count: 1 });               // the internal review has no sentiment
    expect(by.requests_delivery).toMatchObject({ state: 'WARNING', count: 1 });
    expect(by.tenant_isolation.state).toBe('PASSED');
    expect(await q(sql`select (select count(*) from review_response_drafts)::int a, (select count(*) from review_approvals)::int b`)).toEqual(before);
    expect((await rc.check(ctx()) as any).reused).toBe(true);
  });
});
