// retention.pgtest — Customer Retention mandate (Oct 29 2026), against the REAL schema.
//   • the reported defect: a customer with NO completed visit is "Never Visited", never "60+ days at risk" (a canceled
//     ticket is not a visit); At Risk is ordered by the longest absence first, ties broken by customer id;
//   • KPIs from settled tickets only, refunds netted out of Lapsed Value; "Returning Rate" is null (not 0 %) with no visits;
//   • SMS: consent / opt-out / phone / duplicate destination / other-salon ids are excluded at preview; confirm is
//     idempotent and revalidates (an audience that shrank needs a second confirmation); one job per recipient; the worker
//     sends ONCE, re-checks consent at send time, and a recipient interrupted mid-hand-off becomes `unknown`, never re-sent.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { RetentionRepository, RetentionError, composeRetentionSms } from './retention.repository';
import { RetentionSmsService, RETENTION_SMS_JOB } from './retention-sms.service';
import { runRetentionSmsJob } from './retention-sms.worker';

const P = 'c5e82000-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), B2 = id('b2');
// A 400 days away (consent) · B 310 (no consent) · C 220 (opted out) · D 90 (no phone) · E 61 (invalid phone) · E2 61 (same
// day as E: id tie-break) · F never visited, account 500 days old · G visited 10 days ago · H returned this month after 120
// days · I only a CANCELED ticket · J same phone as A (consent) · X the other salon
const [A, Bc, C, D, E, E2, F, G, H, I, J, X] = ['c01', 'c02', 'c03', 'c04', 'c05', 'c06', 'c07', 'c08', 'c09', 'c10', 'c11', 'c99'].map(id);
const key = (n: number) => `c5e82000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ctx = { tenantId: T, branchId: B, userId: id('ee1'), role: 'OWNER', permissions: ['pos.customers.view', 'pos.marketing.manage', 'pos.marketing.view'], salonName: 'Lotus Nails' };
const ctx2 = { ...ctx, tenantId: T2, branchId: B2, salonName: 'Other Nails' };
let pg: any; let db: any; let repo: RetentionRepository; let svc: RetentionSmsService;
const q = (s: string, p: unknown[] = []) => pg.query(s, p);
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e) { return e instanceof RetentionError ? e.code : String((e as Error).message); } }
const sent: { to: string; body: string; tenantId: string }[] = [];
const audited: { tenantId: string; action: string; resourceId: string | null | undefined }[] = [];
const auditor = { record: async (c: any, i: any) => { audited.push({ tenantId: c.tenantId, action: i.action, resourceId: i.resourceId }); } };
const messenger: any = { sendSms: async (m: any) => { sent.push({ to: m.to, body: m.body, tenantId: m.tenantId }); return { sent: true, status: 'sent', providerId: 'SM' + String(sent.length).padStart(30, '0'), simulated: true }; } };

beforeAll(async () => {
  pg = await migratedPglite();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Lotus LLC','Lotus Nails','rt-lotus','RTL001','active'), ($2,'Other LLC','Other Nails','rt-other','RTL002','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York'), ($3,$4,'Other','active','America/New_York')`, [B, T, B2, T2]);
  const cust = async (cid: string, tenant: string, branch: string, name: string, phone: string | null, consent: boolean, ageDays = 600) =>
    q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, marketing_sms_opt_in, created_at) values ($1,$2,$3,$4,'X',$4,$5,$6, now() - make_interval(days => $7))`, [cid, tenant, branch, name, phone, consent, ageDays]);
  await cust(A, T, B, 'Ann', '+12155550101', true); await cust(Bc, T, B, 'Bea', '+12155550102', false); await cust(C, T, B, 'Cara', '+12155550103', true);
  await cust(D, T, B, 'Dee', null, true); await cust(E, T, B, 'Eve', '12345', true); await cust(E2, T, B, 'Eda', '+12155550106', true);
  await cust(F, T, B, 'Fay', '+12155550107', true, 500); await cust(G, T, B, 'Gia', '+12155550108', true); await cust(H, T, B, 'Hoa', '+12155550109', true);
  await cust(I, T, B, 'Ivy', '+12155550110', true); await cust(J, T, B, 'Jo', '+12155550101', true); await cust(X, T2, B2, 'Xena', '+12155550199', true);
  await q(`insert into notification_opt_outs (tenant_id, channel, address) values ($1,'sms','+1 (215) 555-0103')`, [T]);
  const tk = async (tid: string, tenant: string, branch: string, cid: string, daysAgo: number, cents: number, status = 'closed') =>
    q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, total_cents, created_at) values ($1,$2,$3,$4,$5,$6, (((now() at time zone 'America/New_York')::date)::timestamp at time zone 'America/New_York') - make_interval(days => $7) + interval '12 hours')`, [tid, tenant, branch, cid, status, cents, daysAgo]);
  await tk(id('d01'), T, B, A, 400, 10000); await tk(id('d02'), T, B, Bc, 310, 5000); await tk(id('d03'), T, B, C, 220, 4000); await tk(id('d04'), T, B, D, 90, 3000);
  await tk(id('d05'), T, B, E, 61, 2000); await tk(id('d06'), T, B, E2, 61, 2500); await tk(id('d07'), T, B, G, 10, 6000); await tk(id('d08'), T, B, H, 120, 4500);
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, total_cents, created_at) values ($1,$2,$3,$4,'closed',3500, now() - interval '1 minute')`, [id('d09'), T, B, H]);
  await tk(id('d10'), T, B, I, 300, 9900, 'canceled'); await tk(id('d11'), T, B, J, 200, 1000); await tk(id('d99'), T2, B2, X, 500, 7777);
  // $25 of Ann's $100 visit was refunded
  await q(`insert into payments (id, tenant_id, branch_id, ticket_id, method, amount_cents, status) values ($1,$2,$3,$4,'cash',10000,'succeeded')`, [id('e01'), T, B, id('d01')]);
  await q(`insert into payment_refunds (tenant_id, branch_id, payment_id, amount_cents, status, reason) values ($1,$2,$3,2500,'refunded','test')`, [T, B, id('e01')]);
  db = kyselyFor(pg); repo = new RetentionRepository(db); svc = new RetentionSmsService(db, repo, auditor);
}, 180_000);

describe('Customer Retention — cohorts (the Never Visited defect)', () => {
  it('Never Visited customers are not At Risk; KPIs reconcile with the segments', async () => {
    const s = await repo.summary(ctx);
    // at risk = visited before and away ≥ 60 days: A B C D E E2 J (H returned this month, G is recent)
    expect(s.segments.at_risk).toBe(7);
    expect(s.kpis.atRisk).toBe(7);
    expect(s.segments.never).toBe(2);               // F (no ticket) and I (only a canceled ticket)
    expect(s.segments.at_risk_90).toBe(5);          // A B C D J
    expect(s.segments.at_risk_180).toBe(4);         // A B C J
    expect(s.segments.returned).toBe(1);            // H
    expect(s.segments.contactable).toBe(3);         // A, E2, J (B no consent, C opted out, D no phone, E invalid)
    expect(s.kpis.returningCustomers).toBe(1); expect(s.kpis.visitedThisMonth).toBeGreaterThanOrEqual(1);
    // lapsed value = at-risk lifetime spend net of refunds: 75 + 50 + 40 + 30 + 20 + 25 + 10 = $250
    expect(s.kpis.lapsedValueCents).toBe(25000);
  });

  it('the at-risk list is the longest absence first, ties on customer id, numbered pages clamp', async () => {
    expect((await repo.customers(ctx, { segment: 'at_risk', page: 1, pageSize: 3 })).sort).toBe('priority');   // Win-Back default = Smart Priority (guide §10)
    const p1 = await repo.customers(ctx, { segment: 'at_risk', sort: 'oldest_visit', page: 1, pageSize: 3 });
    expect(p1.sort).toBe('oldest_visit'); expect(p1.totalItems).toBe(7); expect(p1.totalPages).toBe(3);
    expect(p1.items.map((r) => r.customerId)).toEqual([A, Bc, C]);
    expect(p1.items[0]!.daysAway).toBe(400);
    const p3 = await repo.customers(ctx, { segment: 'at_risk', sort: 'oldest_visit', page: 9, pageSize: 3 });
    expect(p3.page).toBe(3);
    const all = await repo.customers(ctx, { segment: 'at_risk', sort: 'oldest_visit', page: 1, pageSize: 50 });
    expect(all.items.map((r) => r.customerId)).toEqual([A, Bc, C, J, D, E, E2]);   // E and E2 tie on the day → id order
    expect(new Set(all.items.map((r) => r.customerId)).size).toBe(7);
    expect(all.items.find((r) => r.customerId === F)).toBeUndefined();
    const st = Object.fromEntries(all.items.map((r) => [r.customerId, r.smsStatus]));
    expect(st).toMatchObject({ [A]: 'eligible', [Bc]: 'no_consent', [C]: 'opted_out', [D]: 'no_phone', [E]: 'invalid_phone', [E2]: 'eligible', [J]: 'eligible' });
    const never = await repo.customers(ctx, { segment: 'never', page: 1, pageSize: 10 });
    expect(never.items.map((r) => r.customerId).sort()).toEqual([F, I].sort());
    expect(never.items.every((r) => r.lastVisitAt === null && r.daysAway === null)).toBe(true);
    expect(await code(repo.customers(ctx, { segment: 'nope' }))).toBe('RETENTION_INVALID_SEGMENT');
  });

  it('another salon is never listed, counted or reachable', async () => {
    const s2 = await repo.summary(ctx2);
    expect(s2.segments.all).toBe(1);
    const all = await repo.customers(ctx, { segment: 'all', page: 1, pageSize: 50 });
    expect(all.items.some((r) => r.customerId === X)).toBe(false);
    expect(await repo.customerSnapshot(ctx, X)).toBeNull();
  });
});

describe('Customer Retention — win-back SMS', () => {
  let previewId = ''; let campaignId = '';
  it('composes the salon name + STOP line once', () => {
    const b = composeRetentionSms('We miss you! Book again.', 'Lotus Nails');
    expect(b.startsWith('Lotus Nails')).toBe(true); expect(b.match(/Reply STOP to opt out\./g)?.length).toBe(1);
    expect(composeRetentionSms(b, 'Lotus Nails')).toBe(b);
  });

  it('preview excludes no-consent, opted-out, missing / invalid phones, duplicate destinations and other-salon ids', async () => {
    const p = await svc.preview(ctx, { customerIds: [A, Bc, C, D, E, J, X, A], body: 'We miss you! Book your next visit.' });
    expect(p.selected).toBe(7);                 // A once (deduplicated by id)
    expect(p.eligible).toBe(1);                 // A (J has the same phone → duplicate_destination)
    expect(p.excludedReasons).toMatchObject({ no_consent: 1, opted_out: 1, no_phone: 1, invalid_phone: 1, duplicate_destination: 1, not_found: 1 });
    expect(p.finalBody).toContain('Reply STOP to opt out.');
    expect(p.costEstimateCents).toBeNull();
    previewId = p.previewId;
    expect((await q(`select count(*)::int n from jobs where job_type = $1`, [RETENTION_SMS_JOB])).rows[0].n).toBe(0);   // nothing queued at preview
  });

  it('C5 gap (Nov 5 2026): First Visit Invitation — only never-visited customers, checked like anyone else; "we miss you" wording refused', async () => {
    await expect(svc.preview(ctx, { customerIds: [F, I], body: 'We miss you! Come back soon.', audience: 'first_visit' })).rejects.toMatchObject({ code: 'SMS_BODY_INVALID' });
    const inv = await svc.preview(ctx, { customerIds: [F, I, A], body: 'Welcome! Your first manicure is 20% off this month.', audience: 'first_visit' });
    expect(inv.excludedReasons.has_visited).toBe(1);                // A has visited — not a first-visit invitation
    expect(inv.excludedReasons.never_visited ?? 0).toBe(0);         // never-visited customers are the audience here
    const winback = await svc.preview(ctx, { customerIds: [F, I], body: 'We miss you! Book your next visit.' });
    expect(winback.excludedReasons.never_visited).toBe(2);           // and still never in a win-back text
    const stored = (await q(`select audience_json from retention_sms_campaigns where id = $1`, [inv.previewId])).rows[0].audience_json;
    expect(stored.kind).toBe('first_visit');
  });

  it('confirm queues ONE job per eligible recipient and is idempotent', async () => {
    expect(await code(svc.confirm(ctx, { previewId, idempotencyKey: 'x' }))).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(await code(svc.confirm(ctx2, { previewId, idempotencyKey: key(1) }))).toBe('SMS_PREVIEW_NOT_FOUND');   // another salon cannot confirm it
    const c1 = await svc.confirm(ctx, { previewId, idempotencyKey: key(1) });
    const c2 = await svc.confirm(ctx, { previewId, idempotencyKey: key(1) });
    expect(c1.duplicate).toBe(false); expect(c1.queued).toBe(1); expect(c2.duplicate).toBe(true); expect(c2.campaignId).toBe(c1.campaignId);
    campaignId = c1.campaignId;
    const jobs = (await q(`select payload from jobs where job_type = $1 and tenant_id = $2`, [RETENTION_SMS_JOB, T])).rows;
    expect(jobs).toHaveLength(1);
    expect(await code(svc.confirm(ctx, { previewId, idempotencyKey: key(2) }))).toBe('ok');   // a different key on a confirmed preview: the same campaign, no new jobs
    expect((await q(`select count(*)::int n from jobs where job_type = $1 and tenant_id = $2`, [RETENTION_SMS_JOB, T])).rows[0].n).toBe(1);
    const a = audited.filter((x) => x.action === 'sms_campaign_confirmed').length;
    expect(a).toBe(1);
  });

  it('the worker sends once; a re-run does nothing; the campaign completes', async () => {
    const job = (await q(`select payload from jobs where job_type = $1 and tenant_id = $2`, [RETENTION_SMS_JOB, T])).rows[0].payload;
    const r1 = await runRetentionSmsJob(db, messenger, job);
    const r2 = await runRetentionSmsJob(db, messenger, job);
    expect(r1.outcome).toBe('sent'); expect(r2.outcome).toBe('done');
    expect(sent).toHaveLength(1); expect(sent[0]!.to).toBe('+12155550101'); expect(sent[0]!.tenantId).toBe(T);
    const d = await repo.campaignDetail(ctx, campaignId, { page: 1, pageSize: 20 });
    expect(d!.campaign.status).toBe('completed');
    expect(d!.campaign.counts.sent).toBe(1); expect(d!.campaign.counts.delivered).toBe(0);   // no carrier report → never "delivered"
    expect(await repo.campaignDetail(ctx2, campaignId, { page: 1, pageSize: 20 })).toBeNull();
    const snap = await repo.customerSnapshot(ctx, A);
    expect(snap!.smsStatus).toBe('recently_contacted');
  });

  it('confirm revalidates: consent withdrawn after the preview needs a second confirmation', async () => {
    const p = await svc.preview(ctx, { customerIds: [E2], body: 'We miss you! Book your next visit.' });
    expect(p.eligible).toBe(1);
    await q(`update customers set marketing_sms_opt_in = false where id = $1`, [E2]);
    expect(await code(svc.confirm(ctx, { previewId: p.previewId, idempotencyKey: key(3) }))).toBe('SMS_AUDIENCE_CHANGED');
    expect(await code(svc.confirm(ctx, { previewId: p.previewId, idempotencyKey: key(4), acceptChanges: true }))).toBe('SMS_NO_ELIGIBLE');
    await q(`update customers set marketing_sms_opt_in = true where id = $1`, [E2]);
  });

  it('send time re-checks consent; an interrupted hand-off is `unknown` and never re-sent', async () => {
    const p = await svc.preview(ctx, { customerIds: [E2, J], body: 'Come back soon!' });
    expect(p.eligible).toBe(2);
    const c = await svc.confirm(ctx, { previewId: p.previewId, idempotencyKey: key(5) });
    const jobs = (await q(`select payload from jobs where job_type = $1 and tenant_id = $2 and payload->>'campaignId' = $3`, [RETENTION_SMS_JOB, T, c.campaignId])).rows.map((r: any) => r.payload);
    expect(jobs).toHaveLength(2);
    const byCustomer = async (cid: string) => (await q(`select id from retention_sms_recipients where campaign_id = $1 and customer_id = $2`, [c.campaignId, cid])).rows[0].id;
    const rE2 = await byCustomer(E2), rJ = await byCustomer(J);
    await q(`insert into notification_opt_outs (tenant_id, channel, address) values ($1,'sms','+12155550106')`, [T]);   // E2 replied STOP after the confirmation
    await q(`update retention_sms_recipients set status = 'submitting' where id = $1`, [rJ]);                            // J: a worker died after the hand-off
    const before = sent.length;
    expect((await runRetentionSmsJob(db, messenger, jobs.find((j: any) => j.recipientId === rE2))).outcome).toBe('blocked');
    expect((await runRetentionSmsJob(db, messenger, jobs.find((j: any) => j.recipientId === rJ))).outcome).toBe('unknown');
    expect(sent.length).toBe(before);
    const d = await repo.campaignDetail(ctx, c.campaignId, { page: 1, pageSize: 20 });
    expect(d!.campaign.counts).toMatchObject({ blocked: 1, unknown: 1, sent: 0 });
    expect(d!.campaign.status).toBe('failed');
  });

  it('C5 audit: a template placeholder is refused (a campaign sends the same text to everyone)', async () => {
    expect(await code(svc.preview(ctx, { customerIds: [A], body: 'Hi {first_name}, we miss you!' }))).toBe('SMS_BODY_INVALID');
    expect(await code(svc.preview(ctx, { customerIds: [A], body: 'Book here: {{booking_link}}' }))).toBe('SMS_BODY_INVALID');
  });

  it('C5 audit: Cancel Campaign stops the unsent texts (audited); a finished campaign cannot be canceled', async () => {
    const r = (await q(`select r.id, r.campaign_id from retention_sms_recipients r where r.tenant_id = $1 and r.status = 'unknown' limit 1`, [T])).rows[0];
    await q(`update retention_sms_recipients set status = 'queued' where id = $1`, [r.id]);
    await q(`update retention_sms_campaigns set status = 'sending' where id = $1`, [r.campaign_id]);
    const metas: any[] = [];
    expect(await code(svc.cancel(ctx, r.campaign_id, 'x', async () => {}))).toBe('REASON_REQUIRED');
    expect(await code(svc.cancel(ctx2, r.campaign_id, 'wrong salon', async () => {}))).toBe('CAMPAIGN_NOT_FOUND');
    const out = await svc.cancel(ctx, r.campaign_id, 'Typo in the message', async (_t, m) => { metas.push(m); });
    expect(out).toMatchObject({ status: 'canceled', stoppedTexts: 1 });
    expect(metas[0]).toMatchObject({ previousStatus: 'sending', stoppedTexts: 1, reason: 'Typo in the message' });
    expect((await q(`select status, error from retention_sms_recipients where id = $1`, [r.id])).rows[0]).toEqual({ status: 'blocked', error: 'campaign_canceled' });
    expect(await code(svc.cancel(ctx, r.campaign_id, 'again please', async () => {}))).toBe('CAMPAIGN_NOT_CANCELABLE');
    await q(`update retention_sms_recipients set status = 'unknown', error = null where id = $1`, [r.id]);
  });

  it('C5 audit: a queued text whose turn falls inside quiet hours waits for the end of them (never sent inside)', async () => {
    const r = (await q(`select r.id, r.campaign_id from retention_sms_recipients r where r.tenant_id = $1 and r.status = 'unknown' limit 1`, [T])).rows[0];
    await q(`update retention_sms_recipients set status = 'queued' where id = $1`, [r.id]);
    const tz = (await q(`select coalesce(timezone, 'America/New_York') tz from branches where tenant_id = $1 limit 1`, [T])).rows[0]?.tz ?? 'America/New_York';
    const h = Number((await q(`select extract(hour from now() at time zone $1)::int h`, [tz])).rows[0].h);
    const lim = (await q(`insert into campaign_limits (quiet_hours_start, quiet_hours_end, active) values ($1, $2, true) returning id`, [h, (h + 2) % 24])).rows[0].id;
    try {
      const before = sent.length;
      expect((await runRetentionSmsJob(db, messenger, { tenantId: T, recipientId: r.id, campaignId: r.campaign_id })).outcome).toBe('deferred_quiet_hours');
      expect(sent.length).toBe(before);
      expect((await q(`select status from retention_sms_recipients where id = $1`, [r.id])).rows[0].status).toBe('queued');
      const later = (await q(`select run_after > now() as later from jobs where job_type = $1 and payload->>'recipientId' = $2 and idempotency_key like '%:quiet:%'`, [RETENTION_SMS_JOB, r.id])).rows;
      expect(later).toEqual([{ later: true }]);
    } finally { await q(`delete from campaign_limits where id = $1`, [lim]); await q(`update retention_sms_recipients set status = 'unknown' where id = $1`, [r.id]); }
  });

  it('campaign history lists only this salon, newest first', async () => {
    const l = await repo.listCampaigns(ctx, { page: 1, pageSize: 10 });
    expect(l.items.length).toBe(2); expect(l.items[0]!.createdAt! >= l.items[1]!.createdAt!).toBe(true);
    expect((await repo.listCampaigns(ctx2, { page: 1, pageSize: 10 })).totalItems).toBe(0);
  });
});
