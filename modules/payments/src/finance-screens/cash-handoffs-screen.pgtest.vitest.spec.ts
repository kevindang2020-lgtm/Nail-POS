// cash-handoffs-screen.pgtest — End-of-Day Cash mandate (Oct 29 2026), against the REAL schema (salon in America/New_York):
//   Anna: $300 expected from two tickets on Oct 28 — one a $100 split paid $40 cash to her + $60 card (only the $40 is
//         custody) — and an accepted $300 after two partial hand-offs ($200 + $100): balanced;
//   Ben:  $250 expected, counted $245 (−$5 short, under review); Cara: $250 expected, counted $255 (+$5 over), then
//         resolved with a reason (the figures stay); Dee: $80 expected, not counted yet (awaiting);
//   Eve:  cash confirmed at 11:30 PM Oct 28 salon time (03:30 UTC Oct 29) — the business date is Oct 28, not the UTC date;
//   Finn: an active technician who never owed cash — never listed; another salon's technician — invisible.
// Search (technician, phone, customer name / phone, ticket #, amount, hand-off id), filters, paging, the detail's events.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { CashHandoffsScreenRepository } from './cash-handoffs-screen.repository';
import { FinanceError } from './finance-scope';

const P = 'c8d2e3f4-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), B2 = id('b9'), U = id('e1');
const ctx = { tenantId: T, branchId: B, userId: U, role: 'OWNER', permissions: ['pos.checkout.view', 'pos.customers.view', 'pos.checkout.take_payment', 'checkout.manage_overrides'] } as any;
const other = { ...ctx, tenantId: T2, branchId: B2 };
let pg: any; let r: CashHandoffsScreenRepository;
const q = (s: string, p: unknown[] = []) => pg.query(s, p);
const range = async (from: string, to: string, extra: Record<string, unknown> = {}) => r.filters(await r.period(ctx, { preset: 'custom', from, to }), extra);
const all = async (extra: Record<string, unknown> = {}) => r.filters(await r.period(ctx, { preset: 'all' }), extra);
const pr = { page: 1, pageSize: 12 };
const TECH: Record<string, string> = { anna: id('f1'), ben: id('f2'), cara: id('f3'), dee: id('f4'), eve: id('f5'), finn: id('f6'), zed: id('f9') };
let n = 0;
async function cashTicket(tech: string, cents: number, at: string, o: { number: string; customer?: string; tenant?: string; branch?: string; total?: number } ) {
  const tid = id('c' + String(++n).padStart(3, '0'));
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, subtotal_cents, discount_cents, tax_cents, total_cents, tip_cents, ticket_number, paid_at, created_at) values ($1,$2,$3,$4,'paid',$5,0,0,$5,0,$6,$7,$7)`,
    [tid, o.tenant ?? T, o.branch ?? B, o.customer ?? (o.tenant ? id('99') : id('92')), o.total ?? cents, o.number, at]);
  await q(`insert into cash_payment_confirmations (tenant_id, branch_id, ticket_id, customer_id, technician_id, amount_cents, confirmed_by_user_id, confirmed_at, status) values ($1,$2,$3,$4,$5,$6,$7,$8,'confirmed')`,
    [o.tenant ?? T, o.branch ?? B, tid, o.customer ?? null, tech, cents, o.tenant ? null : U, at]);
  return tid;
}
async function handoff(tech: string, date: string, o: { expected: number; counted: number | null; status: string; resolved?: string | null; createdAt: string; version?: number }) {
  const hid = id('e' + String(++n).padStart(3, '0'));
  await q(`insert into tech_cash_handoffs (id, tenant_id, branch_id, technician_id, business_date, expected_cents, counted_cents, variance_cents, payment_count, status, reconciled_by_user_id, reconciled_at, resolution_reason, resolved_by_user_id, resolved_at, version, created_at, updated_at)
    values ($1,$2,$3,$4,$5,$6,$7,$8,1,$9,$10,$11,$12,$13,$14,$15,$16,$16)`,
    [hid, T, B, tech, date, o.expected, o.counted, o.counted == null ? null : o.counted - o.expected, o.status, o.counted == null ? null : U, o.counted == null ? null : o.createdAt, o.resolved ?? null, o.resolved ? U : null, o.resolved ? o.createdAt : null, o.version ?? 1, o.createdAt]);
  return hid;
}
let annaHandoff = '', splitTicket = '';

beforeAll(async () => {
  pg = await migratedPglite();
  r = new CashHandoffsScreenRepository(kyselyFor(pg));
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Pilot LLC','Pilot','ch-pilot','CHP001','active'), ($2,'Other LLC','Other','ch-other','CHP002','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York'), ($3,$4,'Elsewhere','active','America/New_York')`, [B, T, B2, T2]);
  await q(`insert into users (id, tenant_id, email, full_name, role, status) values ($1,$2,'o@x.test','Pat Owner','OWNER','active')`, [U, T]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone) values ($1,$2,$3,'John','Smith','John Smith','+18565551234'), ($4,$2,$3,'Walk','In','Walk-in','+18565550000'), ($5,$6,$7,'John','Smith','John Smith','+18565551234')`, [id('91'), T, B, id('92'), id('99'), T2, B2]);
  const techs: [string, string, string, string, boolean][] = [['anna', 'Anna Lee', T, '+16095550101', true], ['ben', 'Ben Tran', T, '+16095550102', true], ['cara', 'Cara Nguyen', T, '+16095550103', true], ['dee', 'Dee Park', T, '+16095550104', true], ['eve', 'Eve Ho', T, '+16095550105', true], ['finn', 'Finn Vo', T, '+16095550106', true], ['zed', 'Anna Lee', T2, '+16095550101', true]];
  for (const [k, name, tn, phone, active] of techs) await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, is_active, status) values ($1,$2,$3,$7,$8,$4,$5,$6,'active')`, [TECH[k], tn, tn === T ? B : B2, name, phone, active, name.split(' ')[0], name.split(' ')[1]]);
  // Anna, Oct 28: $260 cash ticket + the $40 cash part of a $100 split ($60 was card at the desk) = $300 custody
  await cashTicket(TECH.anna, 26000, '2026-10-28T15:00:00Z', { number: '2001', customer: id('91') });
  splitTicket = await cashTicket(TECH.anna, 4000, '2026-10-28T16:00:00Z', { number: '2002', total: 10000, customer: id('91') });
  await q(`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, tip_cents, status, created_at) values ($1,$2,$3,'card',6000,0,'approved','2026-10-28T16:01:00Z')`, [T, B, splitTicket]);
  annaHandoff = await handoff(TECH.anna, '2026-10-28', { expected: 30000, counted: 30000, status: 'reconciled', createdAt: '2026-10-28T22:00:00Z', version: 3 });
  await q(`insert into tech_cash_handoff_events (tenant_id, branch_id, technician_id, business_date, handoff_id, event_type, amount_cents, expected_cents, counted_total_cents, variance_cents, actor_user_id, idempotency_key, created_at) values
    ($1,$2,$3,'2026-10-28',$4,'partial',20000,30000,20000,-10000,$5,'k-anna-1','2026-10-28T21:00:00Z'), ($1,$2,$3,'2026-10-28',$4,'partial',10000,30000,30000,0,$5,'k-anna-2','2026-10-28T22:00:00Z')`, [T, B, TECH.anna, annaHandoff, U]);
  await cashTicket(TECH.ben, 25000, '2026-10-28T17:00:00Z', { number: '2003' });
  await handoff(TECH.ben, '2026-10-28', { expected: 25000, counted: 24500, status: 'discrepancy', createdAt: '2026-10-28T22:10:00Z' });
  await cashTicket(TECH.cara, 25000, '2026-10-28T18:00:00Z', { number: '2004' });
  await handoff(TECH.cara, '2026-10-28', { expected: 25000, counted: 25500, status: 'reconciled', resolved: 'Customer left $5 extra; kept as overage', createdAt: '2026-10-28T22:20:00Z' });
  await cashTicket(TECH.dee, 8000, '2026-10-28T19:00:00Z', { number: '2005' });                         // awaiting (no hand-off row)
  await cashTicket(TECH.eve, 6000, '2026-10-29T03:30:00Z', { number: '2006', customer: id('92') });       // 11:30 PM Oct 28 in New York
  await cashTicket(TECH.zed, 9900, '2026-10-28T15:00:00Z', { number: '2001', tenant: T2, branch: B2 });   // another salon
});

describe('End-of-Day Cash — the five KPIs and the difference', () => {
  it('Oct 28: expected is custody (never the split ticket total), counted is the accepted counts, technicians are distinct', async () => {
    const s = await r.summary(ctx, await range('2026-10-28', '2026-10-28'));
    expect(s.kpis.expectedCents).toBe(30000 + 25000 + 25000 + 8000 + 6000);   // the split contributes its $40 only; Eve is Oct 28
    expect(s.kpis.countedCents).toBe(30000 + 24500 + 25500);
    expect(s.kpis.technicians).toBe(5);                                       // Finn never owed cash; the other salon is invisible
    expect(s.kpis.reconciled).toBe(2); expect(s.kpis.resolved).toBe(1); expect(s.kpis.awaiting).toBe(2); expect(s.kpis.underReview).toBe(1);
    expect(s.difference).toMatchObject({ totalCents: -500 + 500, shortUnits: 1, shortCents: -500, overUnits: 1, overCents: 500, balancedUnits: 1, uncountedExpectedCents: 8000 + 6000 });
    expect(s.permissions).toMatchObject({ count: true, resolve: true });
  });
  it('the business date is the salon-local date: 11:30 PM Oct 28 New York is Oct 28, and Oct 29 is empty', async () => {
    const eve = (await r.list(ctx, await range('2026-10-28', '2026-10-28', { search: 'Eve' }), pr)).items;
    expect(eve.map((x) => x.businessDate)).toEqual(['2026-10-28']);
    const s29 = await r.summary(ctx, await range('2026-10-29', '2026-10-29'));
    expect(s29.kpis).toMatchObject({ expectedCents: 0, countedCents: 0, technicians: 0, reconciled: 0, awaiting: 0 });   // a verified zero
  });
  it('the old single-date path (?date=) is the same scope as a one-day custom range', async () => {
    const p = await r.period(ctx, { date: '2026-10-28' });
    expect(p).toMatchObject({ preset: 'custom', from: '2026-10-28', to: '2026-10-28', tz: 'America/New_York' });
  });
});

describe('End-of-Day Cash — the table', () => {
  it('one row per technician and day, newest first; states say balanced / short / over / resolved / awaiting', async () => {
    const l = await r.list(ctx, await range('2026-10-28', '2026-10-28'), pr);
    expect(l.total).toBe(5);
    const by = Object.fromEntries(l.items.map((x) => [x.technician, x]));
    expect(by['Anna Lee']).toMatchObject({ expectedCents: 30000, countedCents: 30000, differenceCents: 0, state: 'balanced', paymentCount: 2, version: 3 });
    expect(by['Ben Tran']).toMatchObject({ differenceCents: -500, state: 'short', status: 'discrepancy' });
    expect(by['Cara Nguyen']).toMatchObject({ differenceCents: 500, state: 'resolved', resolutionReason: 'Customer left $5 extra; kept as overage' });
    expect(by['Dee Park']).toMatchObject({ countedCents: null, differenceCents: null, state: 'open', id: null });
    expect(l.items.map((x) => x.technician)[0]).toBe('Eve Ho');                  // newest activity first (03:30 UTC Oct 29)
    expect(l.items.some((x) => x.technician === 'Finn Vo')).toBe(false);
  });
  it('status filters and sorting go to the server', async () => {
    expect((await r.list(ctx, await all({ status: 'awaiting' }), pr)).items.map((x) => x.technician).sort()).toEqual(['Dee Park', 'Eve Ho']);
    expect((await r.list(ctx, await all({ status: 'short' }), pr)).items.map((x) => x.technician)).toEqual(['Ben Tran']);
    expect((await r.list(ctx, await all({ status: 'reconciled' }), pr)).items.map((x) => x.technician).sort()).toEqual(['Anna Lee', 'Cara Nguyen']);
    expect((await r.list(ctx, await all({ sort: 'variance_asc' }), pr)).items[0].technician).toBe('Ben Tran');
    expect((await r.list(ctx, await all({ technician: TECH.cara }), pr)).total).toBe(1);
  });
  it('search: technician name / phone, linked customer name / phone, ticket #, amount, hand-off id — real links only', async () => {
    const names = async (s: string) => (await r.list(ctx, await all({ search: s }), pr)).items.map((x) => x.technician).sort();
    expect(await names('ben')).toEqual(['Ben Tran']);
    expect(await names('(609) 555-0103')).toEqual(['Cara Nguyen']);
    expect(await names('John Smith')).toEqual(['Anna Lee']);                     // customer → ticket → cash confirmation → unit
    expect(await names('856-555-1234')).toEqual(['Anna Lee']);
    expect(await names('#2005')).toEqual(['Dee Park']);
    expect(await names('$40.00')).toEqual(['Anna Lee']);                          // the cash part of the split
    expect(await names(annaHandoff)).toEqual(['Anna Lee']);
    expect(await names('Zed Nobody')).toEqual([]);
  });
  it('another salon sees only its own unit — never the pilot salon\'s', async () => {
    const l = await r.list(other, r.filters(await r.period(other, { preset: 'all' }), {}), pr);
    expect(l.items.map((x) => [x.technician, x.expectedCents])).toEqual([['Anna Lee', 9900]]);
    expect((await r.list(ctx, await all({ search: '9900' }), pr)).total).toBe(0);
  });
  it('pages are stable: no row twice, none missed', async () => {
    const f = await all();
    const a = await r.list(ctx, f, { page: 1, pageSize: 2 }), b = await r.list(ctx, f, { page: 2, pageSize: 2 }), c = await r.list(ctx, f, { page: 3, pageSize: 2 });
    const ids = [...a.items, ...b.items, ...c.items].map((x) => x.technicianId + x.businessDate);
    expect(new Set(ids).size).toBe(5); expect(a.pageCount).toBe(3);
  });
});

describe('End-of-Day Cash — the detail', () => {
  it('lists the eligible cash tickets, both partial hand-offs as separate events, and the linked customer', async () => {
    const d = await r.detail(ctx, TECH.anna, '2026-10-28');
    expect(d.lines.map((l) => [l.ticketNumber, l.amountCents, l.ticketTotalCents])).toEqual([['2001', 26000, 26000], ['2002', 4000, 10000]]);
    expect(d.lines[1].tenders).toBe(1);                                          // the card part — the cash part is a confirmation, not a payment row
    expect(d.lines[0].customer).toMatchObject({ name: 'John Smith', phone: '(856) 555-1234' });
    expect(d.events.map((e) => [e.type, e.amountCents, e.countedTotalCents])).toEqual([['partial', 10000, 30000], ['partial', 20000, 20000]]);
  });
  it('masks the customer phone without the customer permission; an unknown unit is a coded 404', async () => {
    const d = await r.detail({ ...ctx, permissions: ['pos.checkout.view'] }, TECH.anna, '2026-10-28');
    expect(d.lines[0].customer?.phone).toBe('(•••) •••-1234'); expect(d.permissions).toMatchObject({ count: false, resolve: false });
    await expect(r.detail(ctx, TECH.finn, '2026-10-28')).rejects.toBeInstanceOf(FinanceError);
    await expect(r.detail(other, TECH.anna, '2026-10-28')).rejects.toMatchObject({ code: 'HANDOFF_NOT_FOUND' });
  });
  it('the CSV states the basis and carries every matching unit', async () => {
    const csv = await r.exportCsv(ctx, await range('2026-10-28', '2026-10-28'));
    expect(csv).toContain('confirmed cash-to-technician payments per salon-local business day');
    expect(csv.split('\n').filter((l) => /^2026-10-28,/.test(l)).length).toBe(5);
  });
});
