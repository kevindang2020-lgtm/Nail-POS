// winback-center.pgtest — Customer Retention & Win-Back Complete Build Guide (Oct 30 2026) on the REAL schema (→ 749).
//   R01–R05  zero / one / two visits / 60+ lapsed — Never Visited is never At Risk; Already Rebooked + Contacted segments;
//            inactivity (minDays) + email + future-booking filters; Delivered only from provider evidence
//   R24–R27  the overlay: communications with honest states (delivered only with evidence), email consent, refunds
//   §09      Check Retention Data: read-only, nine checks with real findings, recorded, one run per salon per minute
//   §10      Win-Back Assistant: factual criteria, eligible / excluded with reasons, never-visited only as a separate count,
//            no writes on plan; saveAudience = an UNSENT win_back Segments draft (idempotent, audited), nothing sent
//   §16      release blocker: the send-time worker blocks a queued win-back text to a customer who no longer has a visit
//   R40–R43  tenant isolation
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { RetentionRepository, RetentionError } from './retention.repository';
import { WinBackCenter, goalFilters } from './winback-center';
import { runRetentionSmsJob } from './retention-sms.worker';

const P = 'c7490000-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), B2 = id('b2'), TECH = id('f1');
// N0 never visited (old profile) · ONE 1 visit 10 d · TWO 2 visits, last 80 d, a delivered marketing text 3 d ago ·
// OLD 120 d, email unsubscribed, a FAILED marketing text · UP 70 d + booking tomorrow · NC 100 d, no SMS consent ·
// DUP two same-amount tickets 2 min apart 40 d ago · NP a visit with no paid time 65 d ago · GONE only a removed ticket +
// a QUEUED win-back text · X the other salon, 90 d
const [N0, ONE, TWO, OLD, UP, NC, DUP, NP, GONE, X] = ['c00', 'c01', 'c02', 'c03', 'c04', 'c05', 'c06', 'c07', 'c08', 'c99'].map(id);
const ctx = { tenantId: T, branchId: B, userId: id('ee1'), role: 'OWNER', permissions: ['pos.customers.view', 'pos.marketing.manage', 'pos.marketing.view'], salonName: 'Lotus Nails' };
const ctx2 = { ...ctx, tenantId: T2, branchId: B2, salonName: 'Other Nails' };
let pg: any; let db: any; let repo: RetentionRepository; let wb: WinBackCenter;
const q = (s: string, p: unknown[] = []) => pg.query(s, p);
const one = async (s: string, p: unknown[] = []) => (await q(s, p)).rows[0];
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e) { return e instanceof RetentionError ? e.code : String((e as Error).message); } }
const ids = (r: any) => r.items.map((x: any) => x.customerId).sort();

beforeAll(async () => {
  pg = await migratedPglite();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Lotus LLC','Lotus Nails','wb-lotus','WBL001','active'), ($2,'Other LLC','Other Nails','wb-other','WBL002','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York'), ($3,$4,'Other','active','America/New_York')`, [B, T, B2, T2]);
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Tam','N','Tam N')`, [TECH, T, B]);
  const cust = (cid: string, tenant: string, branch: string, name: string, phone: string, sms: boolean, email: string | null, age = 300) =>
    q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, email, marketing_sms_opt_in, marketing_email_opt_in, created_at)
       values ($1,$2,$3,$4,'X',$4,$5,$6,$7,$8, now() - make_interval(days => $9))`, [cid, tenant, branch, name, phone, email, sms, !!email, age]);
  await cust(N0, T, B, 'Nora', '+12155550300', true, 'nora@x.test', 500); await cust(ONE, T, B, 'Owen', '+12155550301', true, 'owen@x.test');
  await cust(TWO, T, B, 'Tia', '+12155550302', true, 'tia@x.test'); await cust(OLD, T, B, 'Olga', '+12155550303', true, 'olga@x.test');
  await cust(UP, T, B, 'Uma', '+12155550304', true, null); await cust(NC, T, B, 'Nico', '+12155550305', false, null);
  await cust(DUP, T, B, 'Dee', '+12155550306', true, null); await cust(NP, T, B, 'Nell', '+12155550307', true, null); await cust(GONE, T, B, 'Gus', '+12155550308', true, null);
  await cust(X, T2, B2, 'Xena', '+12155550399', true, 'xena@x.test');
  let n = 0;
  const tk = async (tenant: string, branch: string, cid: string, daysAgo: number, cents: number, o: { removed?: boolean; noPaid?: boolean; minutes?: number } = {}) => {
    const tid = id('d' + String(++n).padStart(3, '0'));
    await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, total_cents, ticket_number, created_at, paid_at, removed_at)
      values ($1,$2,$3,$4,'closed',$5,$6, (((now() at time zone 'America/New_York')::date)::timestamp at time zone 'America/New_York') - make_interval(days => $7) + interval '15 hours' + make_interval(mins => $8),
              case when $9::boolean then null else (((now() at time zone 'America/New_York')::date)::timestamp at time zone 'America/New_York') - make_interval(days => $7) + interval '15 hours' + make_interval(mins => $8) end, case when $10::boolean then now() end)`,
      [tid, tenant, branch, cid, cents, String(74000 + n), daysAgo, o.minutes ?? 0, !!o.noPaid, !!o.removed]);
    return tid;
  };
  await tk(T, B, ONE, 10, 3000);
  await tk(T, B, TWO, 200, 4000); const twoT = await tk(T, B, TWO, 80, 6000);
  await tk(T, B, OLD, 120, 5000); await tk(T, B, UP, 70, 4000); await tk(T, B, NC, 100, 3500);
  await tk(T, B, DUP, 40, 4200); await tk(T, B, DUP, 40, 4200, { minutes: 2 });
  await tk(T, B, NP, 65, 2500, { noPaid: true });
  await tk(T, B, GONE, 90, 3000, { removed: true });
  await tk(T2, B2, X, 90, 5000);
  // $10 of Tia's last ticket refunded
  await q(`insert into payments (id, tenant_id, branch_id, ticket_id, method, amount_cents, status) values ($1,$2,$3,$4,'cash',6000,'succeeded')`, [id('e01'), T, B, twoT]);
  await q(`insert into payment_refunds (tenant_id, branch_id, payment_id, amount_cents, status, reason) values ($1,$2,$3,1000,'refunded','test')`, [T, B, id('e01')]);
  // Uma is booked tomorrow
  await q(`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_id, customer_name, appt_date, start_time, end_time, status, services)
    values ($1,$2,$3,$4,'Uma',(now() at time zone 'America/New_York')::date + 1,'10:00','11:00','booked','[]')`, [T, B, TECH, UP]);
  // marketing messages (sent minutes ago, so they fall in "this month" on any day — 3 days ago fell in last month on the 1st–3rd): Tia delivered (provider evidence), Olga failed; Olga unsubscribed from marketing email
  await q(`insert into notifications (tenant_id, channel, to_address, body, customer_id, status, purpose, created_at, delivered_at) values
    ($1,'sms','+12155550302','We miss you',$2,'delivered','marketing', now() - interval '5 minutes', now() - interval '5 minutes'),
    ($1,'sms','+12155550303','We miss you',$3,'failed','marketing', now() - interval '5 minutes', null)`, [T, TWO, OLD]);
  await q(`insert into notification_opt_outs (tenant_id, channel, address, reason, scope) values ($1,'email','olga@x.test','unsubscribe','marketing')`, [T]);
  // a win-back text still QUEUED for Gus, whose only visit was removed after the confirmation
  await q(`insert into retention_sms_campaigns (id, tenant_id, status, body, body_sha256, eligible_count, confirmed_at) values ($1,$2,'sending','We miss you at Lotus','x',1, now())`, [id('f01'), T]);
  await q(`insert into retention_sms_recipients (id, campaign_id, tenant_id, customer_id, destination, eligibility, status) values ($1,$2,$3,$4,'+12155550308','eligible','queued')`, [id('f11'), id('f01'), T, GONE]);
  db = kyselyFor(pg); repo = new RetentionRepository(db); wb = new WinBackCenter(db, repo);
}, 180_000);

describe('R01–R05 segments (one shared rule)', () => {
  it('never visited is Never Visited — never At Risk — and the KPIs say so', async () => {
    const s = await repo.summary(ctx, {});
    expect(s.kpis.neverVisited).toBe(2);   // Nora + Gus (his only ticket was removed)
    const risk = ids(await repo.customers(ctx, { segment: 'at_risk', pageSize: 50 }));
    expect(risk).not.toContain(N0); expect(risk).not.toContain(GONE);
    expect(risk).toEqual([TWO, OLD, UP, NC, NP].sort());
    expect(ids(await repo.customers(ctx, { segment: 'never', pageSize: 50 }))).toEqual([N0, GONE].sort());
  });
  it('Already Rebooked and Contacted are their own segments with counts', async () => {
    expect(ids(await repo.customers(ctx, { segment: 'rebooked', pageSize: 50 }))).toEqual([UP]);
    expect(ids(await repo.customers(ctx, { segment: 'contacted', pageSize: 50 }))).toEqual([TWO]);   // a FAILED text is not "contacted"
    const s = await repo.summary(ctx, {});
    expect([s.segments.rebooked, s.segments.contacted, s.kpis.contacted, s.kpis.rebooked]).toEqual([1, 1, 1, 1]);
  });
  it('inactivity days / email / future-booking filters; never visited is never "inactive"', async () => {
    expect(ids(await repo.customers(ctx, { segment: 'all', minDays: 100, pageSize: 50 }))).toEqual([OLD, NC].sort());
    expect(await code(repo.customers(ctx, { segment: 'all', minDays: 0 }))).toBe('RETENTION_INVALID_FILTER');
    expect(ids(await repo.customers(ctx, { segment: 'all', email: 'opted_out', pageSize: 50 }))).toEqual([OLD]);
    expect(ids(await repo.customers(ctx, { segment: 'all', future: 'yes', pageSize: 50 }))).toEqual([UP]);
    const r = await repo.customers(ctx, { segment: 'all', q: 'Olga', pageSize: 50 });
    expect(r.items[0]).toMatchObject({ emailStatus: 'opted_out', maskedEmail: 'o•••@x.test' });
  });
  it('Nov 3 audit — search by email, accent-insensitive names, and every word of a first + last name', async () => {
    expect(ids(await repo.customers(ctx, { segment: 'all', q: 'olga@x', pageSize: 50 }))).toEqual([OLD]);
    expect(ids(await repo.customers(ctx, { segment: 'all', q: 'TIA@X.TEST', pageSize: 50 }))).toEqual([TWO]);
    expect(ids(await repo.customers(ctx, { segment: 'all', q: 'xena@x.test', pageSize: 50 }))).toEqual([]);   // another salon's customer
    expect(ids(await repo.customers(ctx, { segment: 'all', q: '%', pageSize: 50 }))).toEqual([]);             // a wildcard is a character, not "everyone"
    await q(`update customers set full_name = 'Nora Nguyễn Thị' where id = $1`, [N0]);
    try {
      expect(ids(await repo.customers(ctx, { segment: 'all', q: 'nguyen', pageSize: 50 }))).toEqual([N0]);
      expect(ids(await repo.customers(ctx, { segment: 'all', q: 'Nora Thi', pageSize: 50 }))).toEqual([N0]);
      expect(ids(await repo.customers(ctx, { segment: 'all', q: 'Nora Olga', pageSize: 50 }))).toEqual([]);
    } finally { await q(`update customers set full_name = 'Nora' where id = $1`, [N0]); }
  });
  it('Delivered comes only from provider evidence — unknown (null) when the salon has none', async () => {
    expect((await repo.summary(ctx, {})).kpis).toMatchObject({ delivered: 1, deliveryEvidence: true });
    expect((await repo.summary(ctx2, {})).kpis).toMatchObject({ delivered: null, deliveryEvidence: false });
  });
});

describe('R24–R27 overlay', () => {
  it('shows communications with honest states, email consent and refunds — and nothing of another salon', async () => {
    const t = await repo.customerSnapshot(ctx, TWO);
    expect(t!.communications[0]).toMatchObject({ channel: 'sms', state: 'delivered', purpose: 'marketing' });
    expect(t!.refunds).toEqual({ count: 1, cents: 1000 });
    expect(t!.marketingEmailConsent).toBe(true);
    expect((await repo.customerSnapshot(ctx, OLD))!.communications[0].state).toBe('failed');
    expect(await repo.customerSnapshot(ctx2, TWO)).toBeNull();
  });
});

describe('§09 Check Retention Data (read-only)', () => {
  it('reports the real findings, writes nothing but the run, and is limited to one run per salon per minute', async () => {
    const before = await one(`select count(*)::int n, max(updated_at) u from tickets where tenant_id = $1`, [T]);
    const r = await wb.runHealth(ctx);
    const by = Object.fromEntries(r.checks.map((c: any) => [c.key, c]));
    expect(by.never_visited_not_lapsed.status).toBe('ready');
    expect(by.queued_to_never_visited).toMatchObject({ status: 'failed', affected: 1, sampleCustomerIds: [GONE] });
    expect(by.visit_timestamps).toMatchObject({ status: 'attention_required', affected: 1, sampleCustomerIds: [NP] });
    expect(by.possible_duplicate_visits).toMatchObject({ status: 'attention_required', sampleCustomerIds: [DUP] });
    expect(by.orphan_visits.status).toBe('ready');
    expect(by.segments_agree.status).toBe('ready');
    expect(by.lapsed_value_reconciles.status).toBe('ready');
    expect(by.snapshots.status).toBe('unknown');           // no snapshot recorded — never invented
    expect(by.messaging_ready.status).toBe('attention_required');
    expect(r.overall).toBe('failed'); expect(r.readOnly).toBe(true);
    expect(by.never_visited_not_lapsed.lastReadyAt).toBeTruthy();
    expect(await one(`select count(*)::int n, max(updated_at) u from tickets where tenant_id = $1`, [T])).toEqual(before);
    expect((await one(`select status from retention_sms_recipients where id = $1`, [id('f11')])).status).toBe('queued');   // never edited by the check
    expect(await code(wb.runHealth(ctx))).toBe('WINBACK_HEALTH_RATE_LIMITED');
    expect((await wb.lastHealth(ctx)).run!.runId).toBe(r.runId);
    expect((await wb.runHealth(ctx2)).overall).toBeTruthy();   // the limit is per salon
  });
});

describe('§10 Win-Back Assistant', () => {
  it('plans from factual rules: never visited only as a separate count, exclusions with reasons, and writes nothing', async () => {
    const drafts0 = (await one(`select count(*)::int n from segment_audience_drafts`)).n; const notes0 = (await one(`select count(*)::int n from notifications`)).n;
    const p = await wb.plan(ctx, { goal: 'inactive_risk', channel: 'sms' });
    expect(p.suggestion).toBe(true);
    expect(p.audience.neverVisited).toMatchObject({ count: 2, included: false });
    expect(p.audience.selected).toBe(5);                                   // Tia, Olga, Uma, Nico, Nell — never Nora or Gus
    expect(p.audience.excluded).toMatchObject({ upcoming_booking: 1, no_consent: 1 });
    expect(p.audience.eligible).toBe(3);
    expect(p.message.body).toContain('{salon_name}'); expect(p.message.label).toMatch(/Suggested/);
    const rate = await wb.seg.priceCents();   // the configured per-text rate (cost is shown ONLY when one exists)
    if (rate == null) { expect(p.estimatedCostCents).toBeNull(); expect(p.costNote).toMatch(/not estimated/); }
    else { expect(p.estimatedCostCents).toBe(p.audience.eligible * p.message.smsSegments! * rate); expect(p.costNote).toBeNull(); }
    expect((await one(`select count(*)::int n from segment_audience_drafts`)).n).toBe(drafts0);
    expect((await one(`select count(*)::int n from notifications`)).n).toBe(notes0);
    const e = await wb.plan(ctx, { goal: 'inactive_risk', channel: 'email' });
    expect(e.audience.excluded.opted_out ?? 0).toBeGreaterThanOrEqual(1);   // Olga unsubscribed from marketing email
    expect((await wb.plan(ctx, { goal: 'inactive_90' })).audience.selected).toBe(2);   // Olga 120 d, Nico 100 d
    expect(goalFilters('inactive_90', 60)).toEqual({ segment: 'at_risk', minDays: 90 });
    expect(await code(wb.plan(ctx, { goal: 'promote_service', service: 'ge' }))).toBe('WINBACK_GOAL_INVALID');
    expect(await code(wb.plan(ctx, { goal: 'everyone' }))).toBe('WINBACK_GOAL_INVALID');
  });
  it('saves an UNSENT win_back audience (idempotent, audited) — nothing is sent or queued', async () => {
    const recips0 = (await one(`select count(*)::int n from retention_sms_recipients`)).n; const notes0 = (await one(`select count(*)::int n from notifications`)).n;
    const audits: any[] = [];
    const d = await wb.saveAudience(ctx, { goal: 'inactive_risk', channel: 'sms', message: 'We miss you at {salon_name}!', idempotencyKey: 'wb-test-0001' }, async (_t, m) => { audits.push(m); });
    expect(d).toMatchObject({ duplicate: false });
    const row = await one(`select status, channel, selected_count, eligible_count, filters_json from segment_audience_drafts where tenant_id = $1 and idempotency_key = 'winback:wb-test-0001'`, [T]);
    expect(row).toMatchObject({ status: 'draft', channel: 'sms', selected_count: 5, eligible_count: 3 });
    expect((typeof row.filters_json === 'string' ? JSON.parse(row.filters_json) : row.filters_json).purpose).toBe('win_back');
    const again = await wb.saveAudience(ctx, { goal: 'inactive_risk', channel: 'sms', idempotencyKey: 'wb-test-0001' }, async (_t, m) => { audits.push(m); });
    expect(again).toMatchObject({ duplicate: true }); expect(audits.length).toBe(1);
    expect(audits[0]).toMatchObject({ goal: 'inactive_risk', assistant: true });
    expect((await one(`select count(*)::int n from retention_sms_recipients`)).n).toBe(recips0);
    expect((await one(`select count(*)::int n from notifications`)).n).toBe(notes0);
    expect(await code(wb.saveAudience(ctx2, { goal: 'repeat_visits', idempotencyKey: 'wb-test-0002' }, async () => undefined))).toBe('WINBACK_AUDIENCE_EMPTY');
  });
});

describe('§16 send-time block + R40 tenant isolation', () => {
  it('the worker blocks a queued win-back text to a customer with no completed visit — the provider is never called', async () => {
    const calls: unknown[] = [];
    const messenger: any = { sendSms: async (m: unknown) => { calls.push(m); return { sent: true, status: 'sent', providerId: 'SMx' }; } };
    await runRetentionSmsJob(db, messenger, { tenantId: T, recipientId: id('f11') });
    expect(calls).toEqual([]);
    expect(await one(`select status, error from retention_sms_recipients where id = $1`, [id('f11')])).toEqual({ status: 'blocked', error: 'never_visited' });
  });
  it('the other salon sees only its own customers', async () => {
    expect((await wb.plan(ctx2, { goal: 'inactive_risk' })).audience.selected).toBe(1);
    expect(ids(await repo.customers(ctx2, { segment: 'all', pageSize: 50 }))).toEqual([X]);
  });
});

describe('A19 Nov 6 — search scopes, category / technician / spend filters, "New" = exactly one visit, Add to eligible audience', () => {
  it('search in one field only; category, technician and spend-band filters; New counts only first-time customers with one visit', async () => {
    const all = { segment: 'all', preset: 'year' } as any;
    expect(ids(await repo.customers(ctx, { ...all, q: 'olga@x', scope: 'email' }))).toEqual([OLD]);
    expect(ids(await repo.customers(ctx, { ...all, q: 'olga', scope: 'phone' }))).toEqual([]);              // a name is not a phone
    expect(ids(await repo.customers(ctx, { ...all, q: '0303', scope: 'phone' }))).toEqual([OLD]);
    expect(ids(await repo.customers(ctx, { ...all, q: 'Olga', scope: 'name' }))).toEqual([OLD]);
    // Olga's ticket gets a gel line by Tam in the "Gel" category
    const CAT = id('ca01'), SVC = id('ca02');
    await q(`insert into service_categories (id, tenant_id, branch_id, name, sort_order, status) values ($1,$2,$3,'Gel',1,'active')`, [CAT, T, B]);
    await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, commission_type, commission_value, status) values ($1,$2,$3,$4,'Gel X',45,5000,'percent',0,'active')`, [SVC, T, B, CAT]);
    const olgaT = (await one(`select id from tickets where tenant_id = $1 and customer_id = $2 limit 1`, [T, OLD])).id;
    await q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, status, supply_method_snapshot, supply_value_snapshot)
      values ($1,$2,$3,$4,$5,'Gel X',5000,45,5000,'completed','none',0)`, [T, B, olgaT, SVC, TECH]);
    expect(ids(await repo.customers(ctx, { ...all, category: CAT }))).toEqual([OLD]);
    expect(ids(await repo.customers(ctx, { ...all, technician: TECH }))).toEqual([OLD]);
    expect(ids(await repo.customers(ctx, { ...all, q: 'gel x', scope: 'service' }))).toEqual([OLD]);
    const high = ids(await repo.customers(ctx, { ...all, spend: 'high' })), low = ids(await repo.customers(ctx, { ...all, spend: 'low' }));
    expect(high).toEqual([]);                                                                                   // nobody here spent $500+
    expect(low.length).toBeGreaterThan(0);
    // New = first visit in the period AND exactly one visit: Owen (one visit 10 days ago) yes; Dee (two tickets) no
    // date-proof window: the last 60 salon days (a calendar month / year would miss Owen on the 1st–10th)
    const nyDay = (back: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(Date.now() - back * 86_400_000));
    const win = { preset: 'custom', from: nyDay(60), to: nyDay(0) } as any;
    const nv = ids(await repo.customers(ctx, { segment: 'new_visitors', ...win } as any));
    expect(nv).toContain(ONE); expect(nv).not.toContain(DUP);
    expect((await repo.summary(ctx, win) as any).segments.new_visitors).toBe(nv.length);
  });
  it('Add to eligible audience: picked customers become ONE unsent draft with their verdicts; a repeat is the same draft; none eligible is refused', async () => {
    const audits: any[] = [];
    const d: any = await wb.addToAudience(ctx, { customerIds: [OLD, NC, TWO], channel: 'sms', idempotencyKey: 'wb-pick-0001' }, async (_t, m) => { audits.push(m); });
    expect(d).toMatchObject({ status: 'draft', selected: 3, sends: 0, duplicate: false });
    expect(d.eligible).toBeGreaterThanOrEqual(1); expect(d.excluded).toBeGreaterThanOrEqual(1);              // Nico has no SMS consent
    expect((await wb.addToAudience(ctx, { customerIds: [OLD, NC, TWO], channel: 'sms', idempotencyKey: 'wb-pick-0001' }, async () => undefined) as any).duplicate).toBe(true);
    expect(await code(wb.addToAudience(ctx, { customerIds: [NC], channel: 'sms', idempotencyKey: 'wb-pick-0002' }, async () => undefined))).toBe('WINBACK_AUDIENCE_EMPTY');
    expect(await code(wb.addToAudience(ctx, { customerIds: [], idempotencyKey: 'wb-pick-0003' }, async () => undefined))).toBe('WINBACK_AUDIENCE_EMPTY');
    expect(audits[0]).toMatchObject({ picked: 3 });
  });
});
