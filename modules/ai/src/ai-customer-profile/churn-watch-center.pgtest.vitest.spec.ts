// churn-watch-center.pgtest — Churn Watch guide (Nov 1 2026; migrations 763/764) on the REAL schema.
// Kevin decision 2 (Nov 12 2026): THE verdict is Customer Retention's segment + days away; the assistant's signals are
// supporting reasons only. CW = verdict & reconciliation · RV = review workflow · LS = list · SC = security / no side effects · HL = health.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { CustomerIntelligenceCenter } from './customer-intelligence-center';
import { ChurnWatchCenter, ChurnWatchError, churnState } from './churn-watch-center';
import { DEFAULT_TUNABLES } from './ai-customer-profile-core';
import { RetentionRepository } from '@aipowersalon/customers';

const P = 'c7640000-0000-4000-8000-';
const id = (n: number) => P + String(n).padStart(12, '0');
const T = id(1), B = id(2), X = id(4), BX = id(5), OWNER = id(10), LAN = id(20);
const C = { possible: id(101), elevated: id(102), high: id(103), booked: id(104), never: id(105), approach: id(106), other: id(130) };
const ctx = (o: any = {}) => ({ tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: ['pos.ai_customer_profile.view', 'pos.ai_customer_profile.churn'], ...o }) as any;
let db: any; let enabled = true; let clock = Date.now();
let ci: CustomerIntelligenceCenter; let cw: ChurnWatchCenter;
const q = async (s: any) => (await s.execute(db)).rows as any[];
const audits: any[] = [];
const audit = async (_t: any, m: any) => { audits.push(m); };
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e) { return e instanceof ChurnWatchError ? e.code : (e as Error).message; } }
let tk = 0;
const visit = (cust: string, daysAgo: number) => q(sql`insert into tickets (tenant_id, branch_id, customer_id, primary_technician_id, status, total_cents, ticket_number, created_at, paid_at)
  values (${T}, ${B}, ${cust}, ${LAN}, 'paid', 4500, ${++tk}, now() - (${daysAgo} || ' days')::interval, now() - (${daysAgo} || ' days')::interval)`);
const appt = (cust: string, dayOffset: number, status: string) => q(sql`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_id, customer_name, appt_date, start_time, end_time, status, services)
  values (${T}, ${B}, ${LAN}, ${cust}, 'x', (now() at time zone 'America/New_York')::date + ${dayOffset}::int, '10:00', '11:00', ${status}, '[]')`);
const rescan = async () => { clock += 120_000; return ci.scan(ctx()); };
const allItems = async () => { const out: any[] = []; for (const tab of ['all_signals', 'insufficient', 'no_signal']) out.push(...(await cw.list(ctx(), { tab, pageSize: 100 }, { fullContact: false })).items); return out; };
const listIds = async (f: any) => (await cw.list(ctx(), f, { fullContact: false })).items.map((i: any) => i.id).sort();

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  ci = new CustomerIntelligenceCenter(db, async () => ({ enabled, tunables: DEFAULT_TUNABLES }), () => clock);
  cw = new ChurnWatchCenter(db, async () => enabled, () => clock);
  await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'S', 'Pilot', 'cw-764', 'CW764', 'active'), (${X}, 'X', 'Other', 'cw-764x', 'CW764X', 'active')`);
  await q(sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Main', 'America/New_York'), (${BX}, ${X}, 'Other', 'America/New_York')`);
  await q(sql`insert into users (id, tenant_id, full_name, email, status, role) values (${OWNER}, ${T}, 'Owner', 'o@cw.test', 'active', 'OWNER')`);
  await q(sql`set session_replication_role = replica`);
  await q(sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values (${LAN}, ${T}, ${B}, 'Lan', 'Nguyễn', 'Lan Nguyễn')`);
  for (const [cid, tenant, branch, name] of [[C.possible, T, B, 'Pat Possible'], [C.elevated, T, B, 'Eve Elevated'], [C.high, T, B, 'Hal High'], [C.booked, T, B, 'Bo Booked'], [C.never, T, B, 'Nev Never'], [C.approach, T, B, 'Ana Approach'], [C.other, X, BX, 'Oth Other']] as const)
    await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, status, created_at) values (${cid}, ${tenant}, ${branch}, ${name.split(' ')[0]}, ${name.split(' ')[1]}, ${name}, 'active', now() - interval '400 days')`);
  for (const d of [100, 70, 40]) await visit(C.possible, d);          // 30-day rhythm, 40 days ago: 1.3x → possible
  for (const d of [130, 100, 70]) await visit(C.elevated, d);         // 70 days ago: 2.3x → elevated
  for (const d of [160, 130, 100]) await visit(C.high, d);            // 100 days: 3.3x + 3 cancellations → high
  for (const d of [-20, -50, -80]) await appt(C.high, d, 'cancelled');
  for (const d of [70, 40, 10]) await visit(C.booked, d);
  await appt(C.booked, 6, 'booked');                                  // booked → low ("no current signal")
  for (const d of [110, 80, 50]) await visit(C.approach, d);          // 50 days away: Retention 'approaching' (45 ≤ 50 < 60)
  await q(sql`set session_replication_role = origin`);
});

describe('Churn Watch — Customer Retention is the verdict (Kevin decision 2)', () => {
  it('CW-00 with no assistant evaluation the queue still shows Retention\'s live verdict; supporting reasons are absent, not invented', async () => {
    const s: any = await cw.summary(ctx());
    expect(s).toMatchObject({ unavailable: false, freshness: { state: 'never' }, definitions: { verdictSource: 'customer_retention', riskDays: 60, approachingDays: 45 } });
    expect(s.metrics).toMatchObject({ evaluated: 6, needsReview: 1, higherPriority: 2, insufficientHistory: 1, noSignal: 2 });
    const items = await allItems();
    expect(items.every((i) => i.supporting === null)).toBe(true);
    expect(churnState(undefined)).toBe('data_unavailable');
  });
  it('CW-01 every listed customer\'s verdict equals Customer Retention\'s own classification (segment + days away)', async () => {
    await ci.scan(ctx());
    const ret = new RetentionRepository(db);
    const theirs = new Map((await ret.customers(ctx(), { segment: 'all', pageSize: 100 } as any)).items.map((r: any) => [r.customerId, r]));
    const items = await allItems();
    expect(items.map((i) => i.id).sort()).toEqual([C.possible, C.elevated, C.high, C.booked, C.never, C.approach].sort());
    for (const i of items) {
      const r: any = theirs.get(i.id);
      expect(r, i.id).toBeTruthy();
      expect(i.verdict).toMatchObject({ source: 'customer_retention', segment: r.segment, daysAway: r.daysAway });
      expect(i.daysSinceLast).toBe(r.daysAway);
      expect(i.nextAppointmentDate).toBe(r.nextAppointmentDate);
      expect(i.state).toBe(churnState(r.segment));
      expect(i).not.toHaveProperty('level');                                  // no second risk level
      expect(i).not.toHaveProperty('confidence');
    }
    const by = Object.fromEntries(items.map((i) => [i.id, i]));
    expect(by[C.high].verdict.segment).toBe('at_risk');
    expect(by[C.approach].verdict.segment).toBe('approaching');
    // the assistant's own rule calls Pat "possible", but Retention says active → NOT in the queue (no second verdict)
    expect((await q(sql`select churn_level from customer_intelligence_snapshots where customer_id = ${C.possible}`))[0].churn_level).toBe('possible');
    expect(by[C.possible]).toMatchObject({ state: 'no_current_signal', verdict: { segment: 'active' } });
    expect(await listIds({ tab: 'needs_review' })).toEqual([C.approach, C.elevated, C.high].sort());
    // the assistant's reasons ride along as labelled support only
    expect(by[C.high].supporting).toMatchObject({ source: 'assistant_signals' });
    expect(by[C.high].supporting.reasons.join(' ')).toMatch(/3 cancellations/);
    const s: any = await cw.summary(ctx());
    expect(s.metrics).toEqual({ evaluated: 6, needsReview: 1, higherPriority: 2, insufficientHistory: 1, upcomingBooking: 1, reviewed: 0, noSignal: 2 });
    const ev = await cw.customer(ctx(), C.high, audit) as any;
    expect(ev.verdict).toMatchObject({ source: 'customer_retention', segment: 'at_risk', state: 'higher_priority', daysAway: theirs.get(C.high)!.daysAway });
    expect(ev.supporting.reasons.join(' ')).toMatch(/3 cancellations/);
    expect(ev.supporting.note).toMatch(/Supporting reasons only/);
    expect(ev).not.toHaveProperty('signal');
    expect(ev.inputs).toMatchObject({ canceledCount: 3, hasUpcoming: false, typicalIntervalDays: 30 });
    expect(ev.verdict.note).toMatch(/not a confirmed decision/);
  });
  it('CW-02 the supporting reasons keep the date the assistant first saw them, across rescans', async () => {
    const before = (await q(sql`select churn_since from customer_intelligence_snapshots where customer_id = ${C.elevated}`))[0].churn_since;
    await rescan();
    const after = (await q(sql`select churn_since, computed_at from customer_intelligence_snapshots where customer_id = ${C.elevated}`))[0];
    expect(new Date(after.churn_since).toISOString()).toBe(new Date(before).toISOString());
    expect((await q(sql`select churn_since from customer_intelligence_snapshots where customer_id = ${C.booked}`))[0].churn_since).toBeNull();
  });
});

describe('Churn Watch — the review workflow', () => {
  it('RV-01 Mark reviewed moves a customer to Reviewed at Retention\'s segment and records history (append-only); no customer data changes', async () => {
    const cust = await q(sql`select id, updated_at, archived_at from customers where tenant_id = ${T} order by id`);
    const appts = await q(sql`select count(*)::int n from pos_tech_appointments where tenant_id = ${T}`);
    await cw.review(ctx(), C.approach, { action: 'reviewed', note: 'called last week' }, audit);
    expect(await listIds({ tab: 'reviewed' })).toEqual([C.approach]);
    expect(await listIds({ tab: 'needs_review' })).toEqual([C.elevated, C.high].sort());
    expect((await q(sql`select level_at_review from churn_watch_reviews where customer_id = ${C.approach}`))[0].level_at_review).toBe('approaching');
    expect((await cw.summary(ctx()) as any).metrics).toMatchObject({ needsReview: 0, reviewed: 1 });
    expect(await q(sql`select id, updated_at, archived_at from customers where tenant_id = ${T} order by id`)).toEqual(cust);
    expect(await q(sql`select count(*)::int n from pos_tech_appointments where tenant_id = ${T}`)).toEqual(appts);
    expect(await code(q(sql`update churn_watch_review_events set note = 'x'`))).toMatch(/append-only/);
  });
  it('RV-02 Retention\'s segment RISING above the reviewed one returns the customer to Needs Review (the salon\'s thresholds decide); a passed deferral returns too; an old rule-level review never stands', async () => {
    await q(sql`insert into tenant_retention_settings (tenant_id, risk_days, approaching_days, observation_window_days, version) values (${T}, 48, 30, 30, 1)`);
    expect((await allItems()).find((i) => i.id === C.approach).verdict.segment).toBe('at_risk');
    expect(await listIds({ tab: 'needs_review' })).toContain(C.approach);
    expect(await listIds({ tab: 'needs_review' })).toContain(C.possible);              // 40 days ≥ 30: Retention now says approaching
    await q(sql`delete from tenant_retention_settings where tenant_id = ${T}`);
    expect(await listIds({ tab: 'reviewed' })).toEqual([C.approach]);                  // back to the defaults: the review stands again
    await cw.review(ctx(), C.elevated, { action: 'deferred', dueOn: '2020-01-01' }, audit);
    expect(await listIds({ tab: 'needs_review' })).toContain(C.elevated);              // the deferral date has passed
    await cw.review(ctx(), C.elevated, { action: 'deferred', dueOn: '2099-01-01' }, audit);
    expect(await listIds({ tab: 'reviewed' })).toContain(C.elevated);
    await q(sql`insert into churn_watch_reviews (tenant_id, customer_id, status, level_at_review) values (${T}, ${C.high}, 'reviewed', 'high')`);
    expect(await listIds({ tab: 'needs_review' })).toContain(C.high);                  // a pre-Nov-12 level is not a Retention segment
    await q(sql`delete from churn_watch_reviews where customer_id = ${C.high}`);
  });
  it('RV-03 refusals: nothing to review (Retention says active — even when the assistant\'s own rule flags it), stale version, empty note, disabled assistant', async () => {
    expect(await code(cw.review(ctx(), C.booked, { action: 'reviewed' }, audit))).toBe('CHURN_NO_SIGNAL');
    expect(await code(cw.review(ctx(), C.possible, { action: 'reviewed' }, audit))).toBe('CHURN_NO_SIGNAL');
    expect(await code(cw.review(ctx(), C.high, { action: 'reviewed', expectedVersion: 7 }, audit))).toBe('CHURN_STALE_VERSION');
    expect(await code(cw.review(ctx(), C.high, { action: 'note' }, audit))).toBe('CHURN_NOTE_REQUIRED');
    enabled = false;
    expect(await code(cw.list(ctx(), {}, { fullContact: false }))).toBe('AI_CUSTOMER_PROFILE_DISABLED');
    enabled = true;
  });
  it('RV-04 history is newest first and records Retention\'s segment', async () => {
    const h = await cw.history(ctx(), {});
    const at = h.items.map((e: any) => e.at);
    expect([...at].sort().reverse()).toEqual(at);
    expect(h.items[0]).toMatchObject({ type: 'deferred', customerId: C.elevated, level: 'at_risk' });
  });
});

describe('Churn Watch — list, security, health', () => {
  it('LS-01 search, priority (Retention segments), verdict-date range and tabs', async () => {
    expect(await listIds({ tab: 'all_signals', q: 'hal' })).toEqual([C.high]);
    expect(await listIds({ tab: 'all_signals', priority: 'higher' })).toEqual([C.elevated, C.high].sort());
    expect(await listIds({ tab: 'all_signals', priority: 'normal' })).toEqual([C.approach]);
    expect((await cw.list(ctx(), { tab: 'all_signals', preset: 'custom', from: '2020-01-01', to: '2020-12-31' }, { fullContact: false })).total).toBe(0);
    expect(await listIds({ tab: 'insufficient' })).toEqual([C.never]);
    expect(await listIds({ tab: 'no_signal' })).toEqual([C.possible, C.booked].sort());
    const pr = (await cw.list(ctx(), { tab: 'all_signals', sort: 'priority' }, { fullContact: false })).items.map((i: any) => i.verdict.segment);
    expect(pr).toEqual(['at_risk', 'at_risk', 'approaching']);
    expect(await code(cw.list(ctx(), { preset: 'custom', from: '2026-02-01', to: '2026-01-01' }, { fullContact: false }))).toBe('CHURN_INVALID_PERIOD');
  });
  it('SC-01 another salon\'s customer is not found (read or review); the evidence open is audited with Retention\'s segment', async () => {
    expect(await code(cw.customer(ctx(), C.other, audit))).toBe('CUSTOMER_NOT_FOUND');
    expect(await code(cw.review(ctx(), C.other, { action: 'note', note: 'x' }, audit))).toBe('CUSTOMER_NOT_FOUND');
    audits.length = 0;
    await cw.customer(ctx(), C.high, audit);
    expect(audits).toEqual([{ customerId: C.high, segment: 'at_risk' }]);
  });
  it('HL-01 the check names Retention as the verdict source, reconciles the supporting levels, flags bookings since the evaluation, and changes nothing', async () => {
    await appt(C.high, 3, 'booked');                                           // booked after the last evaluation
    const before = await q(sql`select count(*)::int n from churn_watch_reviews`);
    const r: any = await cw.check(ctx());
    const by = Object.fromEntries(r.checks.map((c: any) => [c.key, c]));
    expect(by.verdict_source).toMatchObject({ state: 'PASSED', detail: { source: 'customer_retention', riskDays: 60, approachingDays: 45 } });
    expect(by.levels_reconcile.state).toBe('PASSED');
    expect(by.bookings_since_evaluation).toMatchObject({ state: 'WARNING', count: 1 });
    expect(by.tenant_isolation.state).toBe('PASSED');
    expect(await q(sql`select count(*)::int n from churn_watch_reviews`)).toEqual(before);
    expect((await cw.check(ctx()) as any).reused).toBe(true);
  });
});
