// churn-watch-center.pgtest — Churn Watch guide (Nov 1 2026; migrations 763/764) on the REAL schema.
// CW = signals & reconciliation · RV = review workflow · LS = list · SC = security / no side effects · HL = health.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { CustomerIntelligenceCenter } from './customer-intelligence-center';
import { ChurnWatchCenter, ChurnWatchError, churnState } from './churn-watch-center';
import { DEFAULT_TUNABLES } from './ai-customer-profile-core';

const P = 'c7640000-0000-4000-8000-';
const id = (n: number) => P + String(n).padStart(12, '0');
const T = id(1), B = id(2), X = id(4), BX = id(5), OWNER = id(10), LAN = id(20);
const C = { possible: id(101), elevated: id(102), high: id(103), booked: id(104), never: id(105), other: id(130) };
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
  for (const [cid, tenant, branch, name] of [[C.possible, T, B, 'Pat Possible'], [C.elevated, T, B, 'Eve Elevated'], [C.high, T, B, 'Hal High'], [C.booked, T, B, 'Bo Booked'], [C.never, T, B, 'Nev Never'], [C.other, X, BX, 'Oth Other']] as const)
    await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, status, created_at) values (${cid}, ${tenant}, ${branch}, ${name.split(' ')[0]}, ${name.split(' ')[1]}, ${name}, 'active', now() - interval '400 days')`);
  for (const d of [100, 70, 40]) await visit(C.possible, d);          // 30-day rhythm, 40 days ago: 1.3x → possible
  for (const d of [130, 100, 70]) await visit(C.elevated, d);         // 70 days ago: 2.3x → elevated
  for (const d of [160, 130, 100]) await visit(C.high, d);            // 100 days: 3.3x + 3 cancellations → high
  for (const d of [-20, -50, -80]) await appt(C.high, d, 'cancelled');
  for (const d of [70, 40, 10]) await visit(C.booked, d);
  await appt(C.booked, 6, 'booked');                                  // booked → low ("no current signal")
  await q(sql`set session_replication_role = origin`);
});

describe('Churn Watch — signals from the shared evaluation', () => {
  it('CW-00 with no evaluation the queue says Data Unavailable — never "no risk"', async () => {
    const s: any = await cw.summary(ctx());
    expect(s).toMatchObject({ metrics: null, unavailable: true, freshness: { state: 'never' } });
    expect(churnState(undefined)).toBe('data_unavailable');
  });
  it('CW-01 the shared scan applies the existing churn rule; levels reconcile; the six metrics follow', async () => {
    await ci.scan(ctx());
    const lv = Object.fromEntries((await q(sql`select customer_id, churn_level from customer_intelligence_snapshots where tenant_id = ${T}`)).map((r) => [r.customer_id, r.churn_level]));
    expect(lv).toEqual({ [C.possible]: 'possible', [C.elevated]: 'elevated', [C.high]: 'high', [C.booked]: 'low', [C.never]: 'insufficient' });
    const s: any = await cw.summary(ctx());
    expect(s.metrics).toEqual({ evaluated: 5, needsReview: 1, higherPriority: 2, insufficientHistory: 1, upcomingBooking: 1, reviewed: 0, noSignal: 1 });
    const ev = await cw.customer(ctx(), C.high, audit) as any;
    expect(ev.signal).toMatchObject({ level: 'high', state: 'higher_priority' });
    expect(ev.signal.evidence.join(' ')).toMatch(/3 cancellations/);
    expect(ev.inputs).toMatchObject({ canceledCount: 3, hasUpcoming: false, typicalIntervalDays: 30 });
    expect(ev.signal.note).toMatch(/not a confirmed decision/);
  });
  it('CW-02 "signal generated" is the first scan that saw the signal, kept across rescans', async () => {
    const before = (await q(sql`select churn_since from customer_intelligence_snapshots where customer_id = ${C.elevated}`))[0].churn_since;
    await rescan();
    const after = (await q(sql`select churn_since, computed_at from customer_intelligence_snapshots where customer_id = ${C.elevated}`))[0];
    expect(new Date(after.churn_since).toISOString()).toBe(new Date(before).toISOString());
    expect((await q(sql`select churn_since from customer_intelligence_snapshots where customer_id = ${C.booked}`))[0].churn_since).toBeNull();
  });
});

describe('Churn Watch — the review workflow', () => {
  it('RV-01 Mark reviewed moves a signal to Reviewed and records history (append-only); no customer data changes', async () => {
    const cust = await q(sql`select id, updated_at, archived_at from customers where tenant_id = ${T} order by id`);
    const appts = await q(sql`select count(*)::int n from pos_tech_appointments where tenant_id = ${T}`);
    await cw.review(ctx(), C.possible, { action: 'reviewed', note: 'called last week' }, audit);
    expect(await listIds({ tab: 'reviewed' })).toEqual([C.possible]);
    expect(await listIds({ tab: 'needs_review' })).toEqual([C.elevated, C.high].sort());
    expect((await cw.summary(ctx()) as any).metrics).toMatchObject({ needsReview: 0, reviewed: 1 });
    expect(await q(sql`select id, updated_at, archived_at from customers where tenant_id = ${T} order by id`)).toEqual(cust);
    expect(await q(sql`select count(*)::int n from pos_tech_appointments where tenant_id = ${T}`)).toEqual(appts);
    expect(await code(q(sql`update churn_watch_review_events set note = 'x'`))).toMatch(/append-only/);
  });
  it('RV-02 a signal that RISES above the reviewed level returns to Needs Review; a passed deferral returns too', async () => {
    await q(sql`update customer_intelligence_snapshots set churn_level = 'elevated' where customer_id = ${C.possible}`);
    expect(await listIds({ tab: 'needs_review' })).toContain(C.possible);
    await cw.review(ctx(), C.elevated, { action: 'deferred', dueOn: '2020-01-01' }, audit);
    expect(await listIds({ tab: 'needs_review' })).toContain(C.elevated);              // the deferral date has passed
    await cw.review(ctx(), C.elevated, { action: 'deferred', dueOn: '2099-01-01' }, audit);
    expect(await listIds({ tab: 'reviewed' })).toContain(C.elevated);
  });
  it('RV-03 refusals: nothing to review, stale version, a note without text, a disabled assistant', async () => {
    expect(await code(cw.review(ctx(), C.booked, { action: 'reviewed' }, audit))).toBe('CHURN_NO_SIGNAL');
    expect(await code(cw.review(ctx(), C.high, { action: 'reviewed', expectedVersion: 7 }, audit))).toBe('CHURN_STALE_VERSION');
    expect(await code(cw.review(ctx(), C.high, { action: 'note' }, audit))).toBe('CHURN_NOTE_REQUIRED');
    enabled = false;
    expect(await code(cw.list(ctx(), {}, { fullContact: false }))).toBe('AI_CUSTOMER_PROFILE_DISABLED');
    enabled = true;
  });
  it('RV-04 history is newest first', async () => {
    const h = await cw.history(ctx(), {});
    const at = h.items.map((e: any) => e.at);
    expect([...at].sort().reverse()).toEqual(at);
    expect(h.items[0]).toMatchObject({ type: 'deferred', customerId: C.elevated });
  });
});

describe('Churn Watch — list, security, health', () => {
  it('LS-01 search, priority, signal-date range and stable pages', async () => {
    expect(await listIds({ tab: 'all_signals', q: 'hal' })).toEqual([C.high]);
    expect(await listIds({ tab: 'all_signals', priority: 'higher' })).toEqual([C.elevated, C.high, C.possible].sort());
    expect((await cw.list(ctx(), { tab: 'all_signals', preset: 'custom', from: '2020-01-01', to: '2020-12-31' }, { fullContact: false })).total).toBe(0);
    expect(await listIds({ tab: 'insufficient' })).toEqual([C.never]);
    expect(await code(cw.list(ctx(), { preset: 'custom', from: '2026-02-01', to: '2026-01-01' }, { fullContact: false }))).toBe('CHURN_INVALID_PERIOD');
  });
  it('SC-01 another salon\'s customer is not found (read or review); the evidence open is audited', async () => {
    expect(await code(cw.customer(ctx(), C.other, audit))).toBe('CUSTOMER_NOT_FOUND');
    expect(await code(cw.review(ctx(), C.other, { action: 'note', note: 'x' }, audit))).toBe('CUSTOMER_NOT_FOUND');
    audits.length = 0;
    await cw.customer(ctx(), C.high, audit);
    expect(audits).toEqual([{ customerId: C.high, level: 'high' }]);
  });
  it('HL-01 the check reconciles levels, flags bookings made since the evaluation, and changes nothing', async () => {
    await appt(C.high, 3, 'booked');                                           // booked after the last evaluation
    const before = await q(sql`select count(*)::int n from churn_watch_reviews`);
    const r: any = await cw.check(ctx());
    const by = Object.fromEntries(r.checks.map((c: any) => [c.key, c]));
    expect(by.levels_reconcile.state).toBe('PASSED');
    expect(by.bookings_since_evaluation).toMatchObject({ state: 'WARNING', count: 1 });
    expect(by.tenant_isolation.state).toBe('PASSED');
    expect(by.intelligence_agreement.detail).toMatchObject({ high: 1, elevated: 1, possible: 1 });
    expect(await q(sql`select count(*)::int n from churn_watch_reviews`)).toEqual(before);
    expect((await cw.check(ctx()) as any).reused).toBe(true);
  });
});
