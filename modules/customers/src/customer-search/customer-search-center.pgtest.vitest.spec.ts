// customer-search-center.pgtest — Customer Search Complete Build Guide (Nov 1 2026, migration 760) on the REAL schema.
// IDs in the test names are the guide's §19 matrix (SR = search, DT = dates, PG = pages, PR = profile, SC = security,
// HL = health). Every customer below is a FIXTURE; product code never hardcodes a name, count or id.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { CustomerSearchCenter, CustomerSearchError, classifyTerm } from './customer-search-center';

const P = 'c7600000-0000-4000-8000-';
const id = (n: number) => P + String(n).padStart(12, '0');
const T = id(1), B = id(2), B2 = id(3), X = id(4), BX = id(5), OWNER = id(10), FD = id(11);
const LAN = id(20), MAI = id(21), XT = id(22);                   // technicians (Lan, Mai at B; Xavier at the other salon)
const SVC = id(30), SVC2 = id(31), CAT = id(32);
const C = {
  hang: id(101), hang2: id(102), mom: id(103), son: id(104), ana: id(105), bo: id(106), old: id(107), arch: id(108), b2only: id(109), xena: id(110),
};
const owner = (perms: string[] = ['pos.customers.view', 'pos.customers.export']) => ({ tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: perms }) as any;
const frontDesk = () => ({ tenantId: T, branchId: B, userId: FD, role: 'FRONT_DESK', permissions: ['pos.customers.view'] }) as any;
const confinedB2 = () => ({ tenantId: T, branchId: B2, userId: FD, role: 'FRONT_DESK', permissions: ['pos.customers.view'], authz: { scope: 'BRANCH', branchIds: [B2] } }) as any;
let db: any; let cs: CustomerSearchCenter;
const q = async (s: any) => (await s.execute(db)).rows as any[];
const audits: any[] = [];
const audit = async (_trx: any, meta: any) => { audits.push(meta); };
const full = { fullContact: true }, masked = { fullContact: false };
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e) { return e instanceof CustomerSearchError ? e.code : `${(e as any)?.code ?? ''}:${(e as Error).message}`; } }
let tk = 0;
async function visit(customer: string, at: string, o: { tech?: string; service?: string; branch?: string; tenant?: string } = {}) {
  const tid = id(5000 + ++tk);
  await q(sql`insert into tickets (id, tenant_id, branch_id, customer_id, status, total_cents, ticket_number, created_at, paid_at)
    values (${tid}, ${o.tenant ?? T}, ${o.branch ?? B}, ${customer}, 'paid', 4500, ${tk}, ${at}::timestamptz, ${at}::timestamptz)`);
  await q(sql`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, technician_id, created_at)
    values (${o.tenant ?? T}, ${o.branch ?? B}, ${tid}, ${o.service ?? SVC}, 'Gel Manicure', 4500, 45, 4500, ${o.tech ?? LAN}, ${at}::timestamptz)`);
  return tid;
}
async function appt(customer: string, dayOffset: number, status = 'booked', o: { tech?: string; branch?: string } = {}) {
  const r = await q(sql`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_id, customer_name, appt_date, start_time, end_time, status, services)
    values (${T}, ${o.branch ?? B}, ${o.tech ?? LAN}, ${customer}, 'x', (now() at time zone 'America/New_York')::date + ${dayOffset}::int, '10:00', '11:00', ${status}, '[{"name":"Gel Manicure"}]') returning id`);
  return String(r[0].id);
}
const names = (r: any) => r.items.map((i: any) => i.name);

beforeAll(async () => {
  db = kyselyFor(await migratedPglite()); cs = new CustomerSearchCenter(db);
  await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'S', 'Pilot Nail Salon', 'cs-760', 'CS760', 'active'), (${X}, 'X', 'Other Salon', 'cs-760x', 'CS760X', 'active')`);
  await q(sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Main', 'America/New_York'), (${B2}, ${T}, 'Second', 'America/New_York'), (${BX}, ${X}, 'Other', 'America/New_York')`);
  await q(sql`insert into users (id, tenant_id, full_name, email, status, role) values (${OWNER}, ${T}, 'Owner', 'o@cs.test', 'active', 'OWNER'), (${FD}, ${T}, 'Desk', 'fd@cs.test', 'active', 'FRONT_DESK')`);
  await q(sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values (${LAN}, ${T}, ${B}, 'Lan', 'Tran', 'Lan Tran'), (${MAI}, ${T}, ${B}, 'Mai', 'Ho', 'Mai Ho'), (${XT}, ${X}, ${BX}, 'Xavier', 'X', 'Xavier X')`);
  await q(sql`insert into service_categories (id, tenant_id, branch_id, name) values (${CAT}, ${T}, ${B}, 'Nails')`);
  await q(sql`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values (${SVC}, ${T}, ${B}, ${CAT}, 'Gel Manicure', 45, 4500), (${SVC2}, ${T}, ${B}, ${CAT}, 'Pedicure', 60, 5500)`);
  const cust: Array<[string, string, string | null, string | null, string, string, string]> = [
    //  id          full name           phone            email                 tenant  branch  created_at
    [C.hang, 'Nguyễn Thị Hằng', '+16095550101', 'hang@example.com', T, B, '2026-01-10T15:00:00Z'],
    [C.hang2, 'Hang Nguyen', '+16095550111', null, T, B, '2026-02-10T15:00:00Z'],              // similar name — a different person
    [C.mom, 'Linh Pham', '+16095550120', 'linh@example.com', T, B, '2026-03-10T15:00:00Z'],
    [C.son, 'Minh Pham', '+16095550120', null, T, B, '2026-04-10T15:00:00Z'],                 // shares the family phone
    [C.ana, 'Ana_Kim', '+16095550130', 'ana@example.com', T, B, '2026-05-10T15:00:00Z'],
    [C.bo, 'Bo Tran', null, 'bo@example.com', T, B, '2026-06-10T15:00:00Z'],
    [C.old, 'Olga Old', '+16095550140', null, T, B, '2025-01-10T15:00:00Z'],
    [C.arch, 'Archie Gone', '+16095550150', null, T, B, '2026-07-10T15:00:00Z'],
    [C.b2only, 'Bea Second', '+16095550160', null, T, B2, '2026-08-10T15:00:00Z'],
    [C.xena, 'Xena Hằng', '+16095550101', 'hang@example.com', X, BX, '2026-09-10T15:00:00Z'],    // ANOTHER salon, same phone + email as Hằng
  ];
  for (const [cid, name, phone, email, tenant, branch, at] of cust)
    await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, phone_display, email, status, created_at, updated_at)
      values (${cid}, ${tenant}, ${branch}, ${name.split(' ')[0]}, ${name.split(' ').slice(1).join(' ')}, ${name}, ${phone}, ${phone ? '(609) 555-' + phone.slice(-4) : null}, ${email}, 'active', ${at}::timestamptz, ${at}::timestamptz)`);
  await q(sql`update customers set archived_at = now() where id = ${C.arch}`);
  await q(sql`update customers set preferred_technician_id = ${MAI} where id = ${C.bo}`);
  const recent = new Date(Date.now() - 5 * 86400000).toISOString();
  await visit(C.hang, recent); await visit(C.hang, new Date(Date.now() - 40 * 86400000).toISOString(), { tech: MAI, service: SVC2 });
  await visit(C.mom, recent);
  await visit(C.old, '2025-02-01T15:00:00Z');                     // last visit long ago → inactive
  await visit(C.b2only, recent, { branch: B2 });
  await visit(C.xena, recent, { tenant: X, branch: BX, tech: XT });
  await appt(C.hang, 3); await appt(C.son, -10, 'no_show'); await appt(C.ana, -2, 'cancelled');
  await q(sql`insert into loyalty_ledger (tenant_id, branch_id, customer_id, type, amount, source, running_balance, delta, balance_after, entry_type, created_at) values (${T}, ${B}, ${C.hang}, 'earn', 120, 'checkout', 120, 120, 120, 'earn', now())`);
}, 240_000);

describe('the term is classified on the server', () => {
  it('uuid / email / phone (with punctuation) / text', () => {
    expect(classifyTerm(C.hang).kind).toBe('uuid');
    expect(classifyTerm('Hang@Example.com').kind).toBe('email');
    expect(classifyTerm('(609) 555-0101')).toMatchObject({ kind: 'phone', digits: '6095550101', stored: '+16095550101' });
    expect(classifyTerm('+1 609 555 0101').stored).toBe('+16095550101');
    expect(classifyTerm('Hằng').kind).toBe('text');
  });
});

describe('search (SR-01 … SR-07)', () => {
  it('EX-02 / SR-07: no term = the directory, newest created first; archived records are not in it', async () => {
    const r = await cs.search(owner(), {}, full);
    expect(names(r)).toEqual(['Bea Second', 'Bo Tran', 'Ana_Kim', 'Minh Pham', 'Linh Pham', 'Hang Nguyen', 'Nguyễn Thị Hằng', 'Olga Old']);
    expect(r.total).toBe(8); expect(r.sort).toBe('newest');
  });
  it('SR-01 / SR-02: exact Vietnamese name with or without accents; similar names stay separate rows; exact match ranks first', async () => {
    const accented = await cs.search(owner(), { q: 'Nguyễn Thị Hằng' }, full);
    expect(names(accented)[0]).toBe('Nguyễn Thị Hằng'); expect(accented.items[0].matchedBy).toBe('name');
    const plain = await cs.search(owner(), { q: 'hang' }, full);
    expect(names(plain).sort()).toEqual(['Hang Nguyen', 'Nguyễn Thị Hằng']);
    expect(plain.items.map((i: any) => i.id)).not.toContain(C.xena);           // the other salon's Hằng never appears
  });
  it('SR-03: formatted phone variants resolve to the same stored phone; partial digits need 4+', async () => {
    for (const v of ['(609) 555-0101', '609-555-0101', '+1 609 555 0101', '6095550101']) {
      const r = await cs.search(owner(), { q: v }, full);
      expect([v, names(r)]).toEqual([v, ['Nguyễn Thị Hằng']]); expect(r.items[0].matchedBy).toBe('phone');
    }
    expect(names(await cs.search(owner(), { q: '0130' }, full))).toEqual(['Ana_Kim']);
  });
  it('SR-04: two people on one family phone are two rows, each flagged for Duplicate Review — never merged', async () => {
    const r = await cs.search(owner(), { q: '609 555 0120' }, full);
    expect(names(r).sort()).toEqual(['Linh Pham', 'Minh Pham']);
    expect(r.items.every((i: any) => i.sharedContactProfiles === 1)).toBe(true);
    expect((await q(sql`select count(*)::int as n from customers where tenant_id = ${T} and archived_at is null`))[0].n).toBe(8);
  });
  it('SR-05: email (case-insensitive) and exact customer id; an appointment id finds its customer', async () => {
    expect(names(await cs.search(owner(), { q: 'LINH@example.com' }, full))).toEqual(['Linh Pham']);
    const byId = await cs.search(owner(), { q: C.bo }, full);
    expect(names(byId)).toEqual(['Bo Tran']); expect(byId.items[0].matchedBy).toBe('customer_id');
    const aid = (await q(sql`select id from pos_tech_appointments where customer_id = ${C.hang} limit 1`))[0].id;
    expect(names(await cs.search(owner(), { q: aid }, full))).toEqual(['Nguyễn Thị Hằng']);
  });
  it('SC-01: another salon\'s customer id / phone / email discloses nothing', async () => {
    expect((await cs.search(owner(), { q: C.xena }, full)).total).toBe(0);
    expect(await code(cs.profile(owner(), C.xena, { fullContact: true, audit }))).toBe('CUSTOMER_NOT_FOUND');
    const byEmail = await cs.search(owner(), { q: 'hang@example.com' }, full);
    expect(byEmail.items.map((i: any) => i.id)).toEqual([C.hang]);
  });
  it('a % or _ in the term is literal, never a wildcard; a 1-character term is refused', async () => {
    expect(names(await cs.search(owner(), { q: 'Ana_' }, full))).toEqual(['Ana_Kim']);
    expect((await cs.search(owner(), { q: '%%' }, full)).total).toBe(0);
    expect(await code(cs.search(owner(), { q: 'a' }, full))).toBe('CUSTOMER_SEARCH_TOO_SHORT');
  });
  it('SR-06: technician = served on a completed visit OR the recorded preference; service = a completed line', async () => {
    expect(names(await cs.search(owner(), { technician: MAI }, full)).sort()).toEqual(['Bo Tran', 'Nguyễn Thị Hằng']);
    expect(names(await cs.search(owner(), { service: SVC2 }, full))).toEqual(['Nguyễn Thị Hằng']);
  });
  it('status + booking filters use the canonical definitions', async () => {
    expect(names(await cs.search(owner(), { status: 'inactive' }, full))).toEqual(['Olga Old']);
    expect(names(await cs.search(owner(), { status: 'returning' }, full))).toEqual(['Nguyễn Thị Hằng']);
    expect(names(await cs.search(owner(), { status: 'archived' }, full))).toEqual(['Archie Gone']);
    expect(names(await cs.search(owner(), { status: 'duplicate' }, full)).sort()).toEqual(['Linh Pham', 'Minh Pham']);
    expect(names(await cs.search(owner(), { booking: 'upcoming' }, full))).toEqual(['Nguyễn Thị Hằng']);
    expect(names(await cs.search(owner(), { booking: 'no_show' }, full))).toEqual(['Minh Pham']);
    expect(names(await cs.search(owner(), { booking: 'canceled' }, full))).toEqual(['Ana_Kim']);
    const h = (await cs.search(owner(), { q: 'Nguyễn Thị Hằng' }, full)).items[0];
    expect(h).toMatchObject({ visits: 2, lifecycle: 'active', lastTechnician: { name: 'Lan Tran' } });
    expect(h.nextAppointment?.status).toBe('booked');
  });
});

describe('dates and pages (DT-01, DT-02, PG-01, PG-02)', () => {
  it('DT: the date field decides the column; From > To and a half range are refused', async () => {
    expect(names(await cs.search(owner(), { dateField: 'created', preset: 'custom', from: '2026-03-01', to: '2026-04-30' }, full))).toEqual(['Minh Pham', 'Linh Pham']);
    expect(names(await cs.search(owner(), { dateField: 'last_visit', preset: 'custom', from: '2025-01-01', to: '2025-12-31' }, full))).toEqual(['Olga Old']);
    expect(await code(cs.search(owner(), { preset: 'custom', from: '2026-05-01', to: '2026-04-01' }, full))).toBe('CUSTOMER_SEARCH_INVALID_PERIOD');
    expect(await code(cs.search(owner(), { preset: 'custom', from: '2026-05-01' }, full))).toBe('CUSTOMER_SEARCH_INVALID_PERIOD');
  });
  it('PG-01: pages are stable, never repeat a row, and the total is the real count', async () => {
    // 20 more profiles created at the SAME instant: only the id tie-break keeps the order stable across pages
    const fill = Array.from({ length: 20 }, (_, i) => id(900 + i));
    for (const [i, cid] of fill.entries()) await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, status, created_at)
      values (${cid}, ${T}, ${B}, 'Page', ${'Filler ' + i}, ${'Page Filler ' + i}, 'active', '2026-10-01T15:00:00Z')`);
    try {
      const seen: string[] = [];
      for (let p = 1; p <= 3; p++) { const r = await cs.search(owner(), { pageSize: 10, page: p }, full); expect(r.total).toBe(28); expect(r.pageCount).toBe(3); seen.push(...r.items.map((i: any) => i.id)); }
      expect(seen).toHaveLength(28); expect(new Set(seen).size).toBe(28);
      expect((await cs.search(owner(), { pageSize: 7 }, full)).pageSize).toBe(25);   // only 10 / 25 / 50 / 100
      expect((await cs.search(owner(), { pageSize: 10, page: 9 }, full))).toMatchObject({ items: [], total: 28 });
    } finally { await q(sql`delete from customers where id = any(${fill}::uuid[])`); }
  });
});

describe('security and scope (SC-02, SC-03, branches)', () => {
  it('SC-02: without pos.customers.export the phone and email are masked', async () => {
    const r = (await cs.search(frontDesk(), { q: 'Linh Pham' }, masked)).items[0];
    expect(r.phone).not.toContain('555-0120'); expect(String(r.phone)).toContain('0120');
    expect(r.email).not.toBe('linh@example.com');
  });
  it('a branch-confined role sees customers with a home branch or activity in its branch only', async () => {
    expect(names(await cs.search(confinedB2(), {}, masked))).toEqual(['Bea Second']);
    expect(await code(cs.search(confinedB2(), { branch: B }, masked))).toBe('BRANCH_NOT_AUTHORIZED');
    expect(await code(cs.profile(confinedB2(), C.hang, { fullContact: false, audit }))).toBe('CUSTOMER_NOT_FOUND');
  });
  it('SC-03: searching, opening a profile and checking the system change no customer, booking, ticket or ledger row', async () => {
    const snap = async () => (await q(sql`select (select md5(string_agg(row(c.*)::text, '' order by id)) from customers c where tenant_id = ${T}) as c,
      (select md5(string_agg(row(a.*)::text, '' order by id)) from pos_tech_appointments a where tenant_id = ${T}) as a,
      (select md5(string_agg(row(t.*)::text, '' order by id)) from tickets t where tenant_id = ${T}) as t,
      (select count(*) from loyalty_ledger where tenant_id = ${T}) as l`))[0];
    const before = await snap();
    await cs.search(owner(), { q: 'hang' }, full); await cs.profile(owner(), C.hang, { fullContact: true, audit }); await cs.check(owner());
    expect(await snap()).toEqual(before);
  });
});

describe('Customer 360° (PR-01, PR-02)', () => {
  it('PR-01: identity, visits, bookings, services, recorded preference, loyalty from the ledger — and the open is audited', async () => {
    audits.length = 0;
    const p = await cs.profile(owner(), C.hang, { fullContact: true, audit });
    expect(p.identity).toMatchObject({ name: 'Nguyễn Thị Hằng', phone: '(609) 555-0101', email: 'hang@example.com', lifecycle: 'active' });
    expect(p.visits?.completed).toBe(2);
    expect(p.appointments.upcoming).toHaveLength(1);
    expect(p.services.map((s: any) => s.technician?.name)).toEqual(['Lan Tran', 'Mai Ho']);
    expect(p.loyalty).toMatchObject({ points: 120, enrolled: true, conflict: null });
    expect(p.duplicates).toEqual([]);                                     // the OTHER salon's same phone is not a duplicate here
    expect(audits).toEqual([expect.objectContaining({ customerId: C.hang, fullContact: true })]);
    const bo = await cs.profile(owner(), C.bo, { fullContact: true, audit });
    expect(bo.preferences.technician).toMatchObject({ name: 'Mai Ho', recorded: true });
    expect(bo.visits?.completed).toBe(0); expect(bo.identity.lifecycle).toBe('never');
  });
  it('PR-02: a source that cannot be read is "unavailable", never an empty history', async () => {
    await q(sql`alter table loyalty_ledger rename to loyalty_ledger_hidden`);
    try {
      const p = await cs.profile(owner(), C.hang, { fullContact: true, audit });
      expect(p.sources.loyalty).toBe('unavailable'); expect(p.loyalty).toBeNull();
      expect(p.sources.visits).toBe('ok');
    } finally { await q(sql`alter table loyalty_ledger_hidden rename to loyalty_ledger`); }
  });
  it('a failing audit write means no profile leaves (fail-closed)', async () => {
    expect(await code(cs.profile(owner(), C.hang, { fullContact: true, audit: async () => { throw new Error('audit down'); } }))).toContain('audit down');
  });
});

describe('summary + Check Customer Search System (HL-01, HL-02)', () => {
  it('the KPI row states its numbers from the rows', async () => {
    const s = await cs.summary(owner(), { preset: 'year' });
    expect(s.kpis).toMatchObject({ customers: 8, active: 3, neverVisited: 4, withUpcomingAppointment: 1, sharedContactProfiles: 2, archived: 1 });
  });
  it('HL: the check reports evidence per area, finds a real cross-salon link as FAILED, records the run and rate-limits', async () => {
    await q(sql`delete from customer_search_health_runs where tenant_id = ${T}`);   // SC-03 above ran one
    const r1 = await cs.check(owner());
    expect(r1.rateLimited).toBe(false);
    expect(Object.fromEntries(r1.checks.map((c) => [c.key, c.state]))).toMatchObject({ directory: 'READY', exact_lookup: 'READY', tenant_isolation: 'READY', duplicate_signals: 'WARNING', indexes: 'READY' });
    expect((await cs.check(owner())).rateLimited).toBe(true);
    expect((await q(sql`select count(*)::int as n from customer_search_health_runs where tenant_id = ${T}`))[0].n).toBe(1);
    // a corrupt link (legacy data from before the cross-tenant trigger): one of this salon's appointments points at the OTHER
    // salon's customer. The database refuses that today, so the fixture bypasses triggers for this one insert.
    await q(sql`set session_replication_role = replica`);
    const bad = await q(sql`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_id, customer_name, appt_date, start_time, end_time, status, services)
      values (${T}, ${B}, ${LAN}, ${C.xena}, 'x', current_date, '12:00', '13:00', 'booked', '[]') returning id`);
    await q(sql`set session_replication_role = origin`);
    await q(sql`update customer_search_health_runs set created_at = now() - interval '1 minute' where tenant_id = ${T}`);
    const r2 = await cs.check(owner());
    expect(r2.overall).toBe('FAILED'); expect(r2.checks.find((c) => c.key === 'tenant_isolation')?.state).toBe('FAILED');
    expect(names(await cs.search(owner(), { q: C.xena }, full))).toEqual([]);   // search still never shows the other salon's customer
    await q(sql`delete from pos_tech_appointments where id = ${bad[0].id}`);
  });
});
