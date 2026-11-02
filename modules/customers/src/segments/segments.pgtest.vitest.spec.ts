// segments.pgtest — Customer Segments Complete Build Guide (30 Oct 2026) §16, against the REAL schema (every migration).
//   Segmentation   0 / 1 / 2 / 15 visits → Never Visited / New / Returning / Returning; VIP overlaps; a "Regular" tier is not VIP
//   Visit integrity canceled + voided + removed tickets are not visits; one ticket with three services = ONE visit; refunds
//                  reduce lifetime spend; a visit at another branch still counts tenant-wide, a branch filter limits it
//   Search         partial name, phone digits, e-mail, customer id, beyond page 1; shared phone numbers stay two customers
//   Calendar       salon-local whole days (23:30 New York on the DST-start day is that day, not the next)
//   Pagination     10 / 20 / 50, exact totals, newest account first, a page past the end clamps
//   Snapshots      idempotent per day; a COMPLETE day records VIP, a reconstructed day leaves VIP unrecorded (null);
//                  the September / October example (New then Returning); no day before ticket history is invented
//   Audience       opted out / no consent / shared number / never visited (win-back) are excluded with reasons; a draft
//                  sends nothing; the same key twice is one draft; consent re-checked later; discard; expiry; Campaign link
//   Security       another salon's customer is invisible (search, qualification, audience); unauthorized branch → 403
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { SegmentsRepository, SegmentsError } from './segments.repository';
import { RetentionSnapshotRepository } from '../retention/retention-snapshots';

const P = 'c5e93500-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), B3 = id('b3'), B2 = id('b2');
const [NV, ONE, TWO, R15, VIP, IN, D1, D2, OPT, NOC, SO, DSTA, DSTB, X] = ['c01', 'c02', 'c03', 'c04', 'c05', 'c06', 'c07', 'c08', 'c09', 'c10', 'c11', 'c12', 'c13', 'c99'].map(id);
const ctx = { tenantId: T, branchId: B, userId: id('ee1'), role: 'OWNER', permissions: ['pos.customers.view', 'pos.marketing.manage', 'pos.marketing.view'] } as any;
let draftId = '';
let pg: any; let db: any; let repo: SegmentsRepository; let snaps: RetentionSnapshotRepository;
const q = (s: string, p: unknown[] = []) => pg.query(s, p);
const N = (v: unknown) => Number(v ?? 0);
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e) { return e instanceof SegmentsError ? e.code : String((e as Error).message); } }
const dayAgo = async (n: number) => (await q(`select ((now() at time zone 'America/New_York')::date - $1::int)::text as d`, [n])).rows[0].d as string;
const names = (r: any) => r.items.map((x: any) => x.customerName);
let n = 0;
async function tk(cid: string, daysAgo: number, cents: number, opts: { status?: string; removed?: boolean; branch?: string; tenant?: string } = {}) {
  const tid = id('d' + String(++n).padStart(3, '0'));
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, total_cents, ticket_number, created_at, paid_at, removed_at)
    values ($1,$2,$3,$4,$5,$6,$7, date_trunc('day', now()) - make_interval(days => $8) + interval '15 hours', date_trunc('day', now()) - make_interval(days => $8) + interval '15 hours',
            case when $9::boolean then now() end)`, [tid, opts.tenant ?? T, opts.branch ?? B, cid, opts.status ?? 'closed', cents, String(80000 + n), daysAgo, !!opts.removed]);
  return tid;
}

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg); repo = new SegmentsRepository(db); snaps = new RetentionSnapshotRepository(db);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Pilot LLC','Pilot Nail Salon','sg-pilot','SGP001','active'), ($2,'Other LLC','Other Nails','sg-other','SGP002','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York'), ($3,$2,'Uptown','active','America/New_York'), ($4,$5,'Other','active','America/New_York')`, [B, T, B3, B2, T2]);
  const cust = async (cid: string, tenant: string, name: string, phone: string | null, email: string | null, sms: boolean, mail: boolean, created: string) =>
    q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, email, marketing_sms_opt_in, marketing_email_opt_in, created_at)
       values ($1,$2,$3,$4,'Kumar',$4 || ' Kumar',$5,$6,$7,$8, ${created})`, [cid, tenant, tenant === T ? B : B2, name, phone, email, sms, mail]);
  // created (newest first = NV): NV 1 minute ago … older below; 30 filler never-visited profiles for paging (created 200–229 days ago)
  await cust(NV, T, 'Neve', '+12155550301', 'neve@example.com', true, true, `now() - interval '1 minute'`);
  await cust(ONE, T, 'Oona', '+12155550302', 'oona@example.com', true, true, `now() - interval '10 days'`);
  await cust(TWO, T, 'Tess', '+12155550303', null, true, false, `now() - interval '11 days'`);
  await cust(R15, T, 'Vishaal', '+17762599624', 'vishaal@example.com', true, true, `now() - interval '400 days'`);
  await cust(VIP, T, 'Vera', '+12155550305', 'vera@example.com', true, true, `now() - interval '12 days'`);
  await cust(IN, T, 'Ines', '+12155550306', 'ines@example.com', true, true, `now() - interval '300 days'`);
  await cust(D1, T, 'Dao', '+12155550307', null, true, false, `now() - interval '13 days'`);            // D1 + D2 share a family phone
  await cust(D2, T, 'Dung', '+12155550307', null, true, false, `now() - interval '14 days'`);
  await cust(OPT, T, 'Opal', '+12155550309', null, true, false, `now() - interval '15 days'`);
  await cust(NOC, T, 'Noor', '+12155550310', null, false, false, `now() - interval '16 days'`);
  await cust(SO, T, 'Sora', '+12155550311', null, true, false, `now() - interval '90 days'`);
  // DST start in New York: 2026-03-08. DSTA created 23:30 local that day (03:30Z on the 9th); DSTB 00:30 local on the 9th
  await cust(DSTA, T, 'Dora', null, null, false, false, `(timestamp '2026-03-08 23:30' at time zone 'America/New_York')`);
  await cust(DSTB, T, 'Dina', null, null, false, false, `(timestamp '2026-03-09 00:30' at time zone 'America/New_York')`);
  for (let i = 0; i < 30; i++) await cust(id('f' + String(i).padStart(2, '0')), T, 'Filler' + String(i).padStart(2, '0'), null, null, false, false, `now() - make_interval(days => ${200 + i})`);
  await cust(X, T2, 'Xena', '+12155550399', 'xena@example.com', true, true, `now() - interval '5 days'`);
  // visits
  await tk(NV, 3, 5000, { status: 'canceled' }); await tk(NV, 2, 5000, { status: 'voided' }); await tk(NV, 1, 5000, { removed: true });   // none is a visit
  const one = await tk(ONE, 5, 9000);                                                                                               // ONE ticket, three services
  await q(`insert into service_categories (id, tenant_id, branch_id, name, status) values ($1,$2,$3,'Nails','active')`, [id('a01'), T, B]);
  for (const [i, s] of ['Gel Pedicure', 'Gel Manicure', 'Nail Art'].entries()) {
    const sid = id('a1' + i);
    await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status) values ($1,$2,$3,$4,$5,30,3000,'active')`, [sid, T, B, id('a01'), s]);
    await q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents) values ($1,$2,$3,$4,$5,3000,30,3000)`, [T, B, one, sid, s]);
  }
  await tk(TWO, 20, 3000); await tk(TWO, 4, 3000, { branch: B3 });                                                                  // mixed-branch customer
  let last = '';
  for (let i = 0; i < 15; i++) last = await tk(R15, 2 + i * 10, i < 14 ? 2938 : 2944 + 1000);                                         // 44 076 + 1 000 refunded below
  const pay = (await q(`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status) values ($1,$2,$3,'cash',3944,0,'approved') returning id`, [T, B, last])).rows[0].id;
  await q(`insert into payment_refunds (tenant_id, branch_id, payment_id, amount_cents, status, reason) values ($1,$2,$3,1000,'refunded','test refund')`, [T, B, pay]);
  await q(`insert into customer_loyalty_profiles (tenant_id, branch_id, customer_id, loyalty_tier, points_balance, total_earned_points, total_redeemed_points) values ($1,$2,$3,'Regular',40,40,0)`, [T, B, R15]);
  await tk(VIP, 6, 12000);
  await q(`insert into customer_loyalty_profiles (tenant_id, branch_id, customer_id, loyalty_tier, points_balance, total_earned_points, total_redeemed_points, vip_since) values ($1,$2,$3,'VIP',10,10,0, now() - interval '3 days')`, [T, B, VIP]);
  await tk(IN, 90, 4000);
  for (const c of [D1, D2, OPT, NOC]) await tk(c, 8, 2000);
  await q(`insert into notification_opt_outs (tenant_id, channel, address) values ($1,'sms','+12155550309')`, [T]);
  await tk(SO, 40, 3000); await tk(SO, 5, 3000); await tk(SO, 3, 3000);                                                             // the Sept → Oct example
  await tk(X, 3, 5000, { tenant: T2, branch: B2 });
}, 240_000);

describe('§05 canonical segments (segments-v1)', () => {
  it('0 / 1 / 2 / 15 visits → Never Visited / New / Returning; canceled, voided and removed tickets are not visits; three services = one visit', async () => {
    const qual = async (c: string) => (await repo.qualification(ctx, c));
    expect((await qual(NV)).visitClass).toBe('never_visited'); expect((await qual(NV)).facts.qualifyingVisits).toBe(0);
    expect((await qual(ONE)).visitClass).toBe('new'); expect((await qual(ONE)).facts.qualifyingVisits).toBe(1);
    expect((await qual(TWO)).visitClass).toBe('returning');
    const r15 = await qual(R15);
    expect(r15).toMatchObject({ visitClass: 'returning', isVip: false, loyaltyTier: 'Regular', ruleset: 'segments-v1' });
    expect(r15.facts).toMatchObject({ qualifyingVisits: 15, lifetimeSpendCents: 44076, refundedCents: 1000 });   // $450.76 settled − $10.00 refunded
    expect(r15.reasons.find((x: any) => x.segment === 'vip')).toMatchObject({ met: false });
    expect(r15.reasons.find((x: any) => x.segment === 'vip').text).toMatch(/loyalty tier, not a marketing segment/);
  });
  it('VIP is the authorized flag and overlaps New; Inactive needs a visit (Never Visited is never Inactive); counts are not double-added', async () => {
    const s = await repo.summary(ctx);
    expect(s.counts).toMatchObject({ vip: 1, inactive: 1 });
    expect(s.counts.never + s.counts.new + s.counts.returning).toBe(s.counts.all);
    expect(s.overlaps.vipNew).toBe(1);
    expect(s.counts.never).toBe(1 + 2 + 30);                     // NV + the two DST profiles + 30 fillers
    expect(s.vipRule.text).toMatch(/No automatic spend or visit threshold/);
    const inactive = await repo.members(ctx, { segment: 'inactive' });
    expect(names(inactive)).toEqual(['Ines Kumar']);
    const vip = await repo.members(ctx, { segment: 'vip' });
    expect(vip.items[0]).toMatchObject({ customerName: 'Vera Kumar', visitClass: 'new', isVip: true, segments: ['new', 'vip'] });
  });
  it('a mixed-branch customer counts tenant-wide; the Uptown filter counts only Uptown activity', async () => {
    expect((await repo.members(ctx, { segment: 'returning', q: 'Tess' })).totalItems).toBe(1);
    const up = await repo.members(ctx, { branch: B3, segment: 'all' });
    expect(names(up)).toEqual(['Tess Kumar']);
    expect(up.items[0].visits).toBe(1);
    expect((await repo.members(ctx, { branch: B3, segment: 'returning' })).totalItems).toBe(0);
  });
});

describe('§07 search · §08 calendar · §09 pagination', () => {
  it('newest account first by default; exact totals; 10 / 20 / 50; a page past the end clamps; an odd page size falls back to 10', async () => {
    const p1 = await repo.members(ctx, { segment: 'all' });
    expect(p1).toMatchObject({ page: 1, pageSize: 10, totalItems: 43, totalPages: 5, sort: 'created_desc' });
    expect(p1.items[0].customerName).toBe('Neve Kumar');
    const p3 = await repo.members(ctx, { segment: 'all', page: 3, pageSize: 20 });
    expect(p3).toMatchObject({ page: 3, pageSize: 20, totalPages: 3 }); expect(p3.items.length).toBe(3);
    expect((await repo.members(ctx, { segment: 'all', page: 99, pageSize: 50 })).page).toBe(1);
    expect((await repo.members(ctx, { segment: 'all', pageSize: 7 })).pageSize).toBe(10);
    const all = [...(await repo.members(ctx, { segment: 'all', pageSize: 50 })).items.map((x: any) => x.customerId)];
    expect(new Set(all).size).toBe(43);                          // stable, no duplicate across pages
    expect(await code(repo.members(ctx, { sort: 'bogus' }))).toBe('SEGMENT_INVALID_FILTER');
    expect(await code(repo.members(ctx, { segment: 'bogus' }))).toBe('SEGMENT_INVALID');
    expect(await code(repo.members(ctx, { minVisits: 5, maxVisits: 2 }))).toBe('SEGMENT_INVALID_FILTER');
  });
  it('search beyond page 1 by partial name, phone digits, e-mail and customer id; a shared phone stays two customers', async () => {
    expect(names(await repo.members(ctx, { q: 'filler29' }))).toEqual(['Filler29 Kumar']);    // created 229 days ago: page 5 of the list
    expect(names(await repo.members(ctx, { q: '(776) 259-9624' }))).toEqual(['Vishaal Kumar']);  // display formatting is normalized to digits
    expect(names(await repo.members(ctx, { q: '7762599624' }))).toEqual(['Vishaal Kumar']);
    expect(names(await repo.members(ctx, { q: 'vishaal@exa' }))).toEqual(['Vishaal Kumar']);
    expect(names(await repo.members(ctx, { q: R15 }))).toEqual(['Vishaal Kumar']);
    expect((await repo.members(ctx, { q: '2155550307' })).totalItems).toBe(2);
    expect((await repo.members(ctx, { q: 'xena' })).totalItems).toBe(0);                         // another salon's customer
  });
  it('salon-local whole days on the DST-start day: 23:30 on Mar 8 is Mar 8, 00:30 on Mar 9 is not', async () => {
    const r = await repo.members(ctx, { preset: 'custom', from: '2026-03-08', to: '2026-03-08', basis: 'created' });
    expect(names(r)).toEqual(['Dora Kumar']);
    expect(names(await repo.members(ctx, { preset: 'custom', from: '2026-03-09', to: '2026-03-09', basis: 'created' }))).toEqual(['Dina Kumar']);
    expect(await code(repo.members(ctx, { preset: 'custom', from: '2026-03-09', to: '2026-03-08', basis: 'created' }))).toBe('SEGMENT_INVALID_FILTER');
    const lastWeek = await repo.members(ctx, { preset: 'custom', from: await dayAgo(6), to: await dayAgo(0), basis: 'visit_in_range', segment: 'returning' });
    expect(names(lastWeek).sort()).toEqual(['Sora Kumar', 'Tess Kumar', 'Vishaal Kumar']);
  });
  it('filters: visits / spend range, tier, service, SMS and e-mail eligibility', async () => {
    expect(names(await repo.members(ctx, { minVisits: 10 }))).toEqual(['Vishaal Kumar']);
    expect(names(await repo.members(ctx, { minSpend: 10000, maxSpend: 20000 }))).toEqual(['Vera Kumar']);
    expect(names(await repo.members(ctx, { tier: 'vip' }))).toEqual(['Vera Kumar']);
    expect(names(await repo.members(ctx, { service: 'gel man' }))).toEqual(['Oona Kumar']);
    const smsNo = names(await repo.members(ctx, { segment: 'returning', sms: 'not_eligible' }));
    expect(smsNo).toEqual([]);
    expect(names(await repo.members(ctx, { segment: 'new', sms: 'not_eligible' })).sort()).toEqual(['Noor Kumar', 'Opal Kumar']);
    expect(names(await repo.members(ctx, { segment: 'new', email: 'eligible' })).sort()).toEqual(['Ines Kumar', 'Oona Kumar', 'Vera Kumar']);
  });
});

describe('§11 historical snapshots (stored, rule-versioned, idempotent)', () => {
  it('a complete day records VIP; the job is idempotent; a reconstructed day leaves VIP unrecorded; Sept → Oct example; no invented history', async () => {
    const y = await dayAgo(1);
    const a = await snaps.computeDay(T, y, { kind: 'nightly' }); const b = await snaps.computeDay(T, y, { kind: 'nightly' });
    expect(a.outcome).toBe('computed'); expect(b.outcome).toBe('skipped'); expect(b.rows).toBe(a.rows);
    const day = await repo.snapshotDay(ctx, y);
    expect(day.state).toBe('available');
    expect(day.counts).toMatchObject({ vip: 1 });
    expect(N(day.vipUnrecorded)).toBe(0);
    // 20 days ago Sora had ONE visit (40 days ago) → New that day; yesterday three → Returning
    const old = await dayAgo(20);
    await snaps.computeDay(T, old, { kind: 'backfill' });
    const past = await repo.snapshotDay(ctx, old);
    expect(past.state).toBe('available');
    expect(past.counts!.vip).toBeNull();                                         // a past VIP flag is not reproducible
    const sora = async (d: string) => N((await q(`select visit_count from customer_retention_daily_snapshots where tenant_id = $1 and customer_id = $2 and snapshot_local_date = $3::date`, [T, SO, d])).rows[0]?.visit_count);
    expect(await sora(old)).toBe(1); expect(await sora(y)).toBe(3);
    expect((await repo.snapshotDay(ctx, await dayAgo(0))).state).toBe('not_completed');
    const before = await repo.snapshotDay(ctx, '2020-01-01');
    expect(before.state).toBe('missing'); expect(before.counts).toBeNull();
    await snaps.computeDay(T, '2020-01-01', { kind: 'backfill' });
    expect((await repo.snapshotDay(ctx, '2020-01-01')).state).toBe('incomplete');   // before the salon's first ticket: never invented
  });
});

describe('§10 C audience builder — draft only, consent-checked', () => {
  const counts = async () => (await q(`select (select count(*) from notifications where tenant_id = $1)::int as n, (select count(*) from retention_sms_recipients where tenant_id = $1)::int as r,
    (select count(*) from job_queue where tenant_id = $1)::int as j`, [T]).catch(() => q(`select (select count(*) from notifications where tenant_id = $1)::int as n, (select count(*) from retention_sms_recipients where tenant_id = $1)::int as r, 0 as j`, [T]))).rows[0];
  it('opted out, no consent, a shared family number and another salon\'s customer are excluded with reasons; nothing is sent', async () => {
    const before = await counts();
    const audit: any[] = [];
    const d = await repo.createDraft(ctx, { channel: 'sms', purpose: 'general', selectionMode: 'selected', customerIds: [ONE, TWO, D1, D2, OPT, NOC, X], filters: { segment: 'all' }, message: 'Hi from Pilot Nail Salon', idempotencyKey: 'seg-aud-0001' },
      async (_trx, m) => { audit.push(m); });
    draftId = d.draftId;
    expect(d).toMatchObject({ status: 'draft', channel: 'sms', selected: 7, eligible: 3, excluded: 4, sends: 0, duplicate: false });
    expect(d.excludedReasons).toEqual({ duplicate_destination: 1, opted_out: 1, no_consent: 1, not_found: 1 });
    expect(audit).toHaveLength(1);
    expect(await counts()).toEqual(before);                                        // no message, no job, no recipient row
    const again = await repo.createDraft(ctx, { channel: 'sms', purpose: 'general', selectionMode: 'selected', customerIds: [ONE], filters: {}, message: null, idempotencyKey: 'seg-aud-0001' }, async () => undefined);
    expect(again).toMatchObject({ draftId, duplicate: true, selected: 7 });
  });
  it('win-back purpose: a never-visited customer is never a recipient; all matching resolves on the server', async () => {
    const d = await repo.createDraft(ctx, { channel: 'sms', purpose: 'win_back', selectionMode: 'selected', customerIds: [NV, IN], filters: {}, message: null, idempotencyKey: 'seg-aud-0002' }, async () => undefined);
    expect(d.excludedReasons).toMatchObject({ never_visited: 1 });
    const all = await repo.createDraft(ctx, { channel: 'email', purpose: 'general', selectionMode: 'all_matching', customerIds: null, filters: { segment: 'new', email: 'eligible' }, message: null, idempotencyKey: 'seg-aud-0003' }, async () => undefined);
    expect(all).toMatchObject({ selected: 3, eligible: 3 });
    expect(await code(repo.createDraft(ctx, { channel: 'sms', purpose: 'general', selectionMode: 'selected', customerIds: [], filters: {}, message: null, idempotencyKey: 'seg-aud-0004' }, async () => undefined))).toBe('AUDIENCE_EMPTY');
  });
  it('consent is re-checked later; discard closes the draft; an elapsed draft expires; a Campaign Center draft of THIS salon can be linked', async () => {
    await q(`update customers set marketing_sms_opt_in = false where id = $1`, [ONE]);
    const r = await repo.recheck(ctx, draftId);
    expect(r).toMatchObject({ eligibleAtCreation: 3, eligibleNow: 2, changedCount: 1 });
    expect(r.changed[0]).toMatchObject({ customerId: ONE, from: 'eligible', to: 'no_consent' });
    const camp = (await q(`insert into campaigns (tenant_id, name, status) values ($1,'Returning promo','draft') returning id`, [T])).rows[0].id;
    const other = (await q(`insert into campaigns (tenant_id, name, status) values ($1,'Other','draft') returning id`, [T2])).rows[0].id;
    expect((await repo.linkCampaign(ctx, draftId, camp)).campaignId).toBe(camp);
    expect(await code(repo.linkCampaign(ctx, draftId, other))).toBe('CAMPAIGN_NOT_FOUND');
    expect((await repo.discard(ctx, draftId)).status).toBe('discarded');
    expect(await code(repo.recheck(ctx, draftId))).toBe('AUDIENCE_DRAFT_CLOSED');
    const e = await repo.createDraft(ctx, { channel: 'sms', purpose: 'general', selectionMode: 'selected', customerIds: [TWO], filters: {}, message: null, idempotencyKey: 'seg-aud-0005' }, async () => undefined);
    await q(`update segment_audience_drafts set expires_at = now() - interval '1 minute' where id = $1`, [e.draftId]);
    expect((await repo.draft(ctx, e.draftId)).status).toBe('expired');
    expect(await code(repo.recheck(ctx, e.draftId))).toBe('AUDIENCE_DRAFT_EXPIRED');
  });
});

describe('§13 security', () => {
  it('another salon\'s customer and draft are invisible; an unauthorized branch is refused', async () => {
    expect(await code(repo.qualification(ctx, X))).toBe('CUSTOMER_NOT_FOUND');
    expect(await code(repo.overlay(ctx, X))).toBe('CUSTOMER_NOT_FOUND');
    const ctx2 = { ...ctx, tenantId: T2, branchId: B2 };
    expect(await code(repo.draft(ctx2, draftId))).toBe('AUDIENCE_DRAFT_NOT_FOUND');
    const confined = { ...ctx, authz: { scope: 'BRANCH', branchIds: [B] } };
    expect(await code(repo.members(confined, { branch: B3 }))).toBe('BRANCH_NOT_AUTHORIZED');
    const own = await repo.members(confined, { segment: 'returning' });
    expect(names(own)).not.toContain('Tess Kumar');                               // Tess's second visit is Uptown's, not this user's branch
  });
  it('the overlay is masked and complete: contact, consent, loyalty, visits, refunds, marketing history', async () => {
    const o = await repo.overlay(ctx, R15);
    expect(o.contact.maskedPhone).toBe('(•••) •••-9624'); expect(o.contact.maskedEmail).toBe('v•••@example.com');
    expect(JSON.stringify(o)).not.toContain('7762599624'); expect(JSON.stringify(o)).not.toContain('vishaal@');
    expect(o.loyalty).toEqual({ tier: 'Regular', pointsBalance: 40 });
    expect(o.refunds).toHaveLength(1); expect(o.visits.length).toBeGreaterThan(0);
    // the shared family number: the OLDER profile (Dung) keeps it, Dao is excluded as a duplicate destination — two customers, never merged
    expect((await repo.overlay(ctx, D2)).marketingHistory.audienceDrafts[0]).toMatchObject({ eligibility: 'eligible', channel: 'sms' });
    expect((await repo.overlay(ctx, D1)).marketingHistory.audienceDrafts[0]).toMatchObject({ eligibility: 'duplicate_destination' });
  });
});
