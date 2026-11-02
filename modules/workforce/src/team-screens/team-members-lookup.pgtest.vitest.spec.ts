// team-members-lookup.pgtest — Team Management round 2A against the REAL migrated schema (30 Oct 2026):
//   TM-01 customer-linked staff search: a customer's phone (3 formats) or name → every technician on the shared ticket
//         (service lines + primary + helper) and the booked technician, each with WHY and the record references; a voided
//         ticket and a cancelled appointment link nobody; the customer phone is masked; customers.view is required;
//         another salon's identical customer never resolves (tenant B).
//   TM-04 preferred technician: an overlapping appointment → invalid with the appointment reference + qualified alternatives
//         (exact start first, a one-date override's later start next, the unmapped technician never); lunch break, duration
//         past the shift end, approved time off, missing mapping each named; a valid preferred technician comes first;
//         nothing is booked; another salon's technician is a 404.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { TeamMembersLookupRepository } from './team-members-lookup.repository';

const P = 'fb920000-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B = id('b1'), BX = id('b9');
const MGR = id('e1'), T2_U = id('e2');
const ANNA = id('c1'), LAN = id('c2'), KEVIN = id('c3'), SUE = id('c4'), T2_TECH = id('c9');
const MAI = id('d1'), MAI_T2 = id('d2'), GEL = id('d5'), CAT = id('d6'), CAT2 = id('d7'), GEL2 = id('d8');
const TK1 = id('f1'), TK_VOID = id('f2'), APPT_K = id('f5'), APPT_X = id('f6'), APPT_T2 = id('f7');
const perms = ['pos.technicians.view', 'customers.view', 'technicians.edit'];
const mgr = { tenantId: T, branchId: B, userId: MGR, role: 'MANAGER', permissions: perms };
const noCustomers = { ...mgr, permissions: ['pos.technicians.view'] };
const other = { tenantId: T2, branchId: BX, userId: T2_U, role: 'MANAGER', permissions: perms };
let pg: any; let repo: TeamMembersLookupRepository; let tomorrow = '';
const q = (s: string, p: unknown[] = []) => pg.query(s, p);
const names = (r: any) => r.items.map((x: any) => x.name).sort();

beforeAll(async () => {
  pg = await migratedPglite();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Pilot LLC','Pilot','tl-a','TLA001','active'), ($2,'Other LLC','Other','tl-b','TLB001','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York'), ($3,$4,'Elsewhere','active','America/New_York')`, [B, T, BX, T2]);
  await q(`insert into users (id, tenant_id, branch_id, full_name, email, role, status) values ($1,$2,$3,'Mai Manager','mai@pilot.test','MANAGER','active'), ($4,$5,$6,'Other Boss','boss@other.test','MANAGER','active')`, [MGR, T, B, T2_U, T2, BX]);
  const tech = (tid: string, tenant: string, br: string, name: string) => q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active, role_label) values ($1,$2,$3,$4,'x',$4,'active',true,'Technician')`, [tid, tenant, br, name]);
  await tech(ANNA, T, B, 'Anna Lee'); await tech(LAN, T, B, 'Lan Vo'); await tech(KEVIN, T, B, 'Kevin Dang'); await tech(SUE, T, B, 'Sue Park'); await tech(T2_TECH, T2, BX, 'Other Salon Tech');
  // the SAME customer name and phone in both salons
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, phone_display) values ($1,$2,$3,'Mai','Le','Mai Le','+18565551201','(856) 555-1201'), ($4,$5,$6,'Mai','Le','Mai Le','+18565551201','(856) 555-1201')`, [MAI, T, B, MAI_T2, T2, BX]);
  await q(`insert into service_categories (id, tenant_id, branch_id, name) values ($1,$2,$3,'Nails'), ($4,$5,$6,'Nails')`, [CAT, T, B, CAT2, T2, BX]);
  await q(`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents, status) values ($1,$2,$3,$4,'Gel Manicure',45,4000,'active'), ($5,$6,$7,$8,'Gel Manicure',45,4000,'active')`, [GEL, T, B, CAT, GEL2, T2, BX, CAT2]);
  for (const t of [ANNA, LAN, KEVIN]) await q(`insert into technician_services (tenant_id, branch_id, technician_id, service_id) values ($1,$2,$3,$4)`, [T, B, t, GEL]);
  await q(`insert into technician_services (tenant_id, branch_id, technician_id, service_id) values ($1,$2,$3,$4)`, [T2, BX, T2_TECH, GEL2]);
  // TK1: a paid multi-technician ticket — Anna (primary) + Lan on service lines, Kevin the helper. TK_VOID: Sue on a voided ticket.
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, ticket_number, paid_at, payment_status, primary_technician_id, helper_technician_id) values ($1,$2,$3,$4,'paid','T-501', now() - interval '2 days','paid',$5,$6)`, [TK1, T, B, MAI, ANNA, KEVIN]);
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, ticket_number, paid_at, payment_status) values ($1,$2,$3,$4,'paid','T-502', now() - interval '1 day','voided')`, [TK_VOID, T, B, MAI]);
  const line = (n: string, tk: string, tech: string) => q(`insert into ticket_service_lines (id, tenant_id, branch_id, ticket_id, service_id, technician_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, line_kind)
    values ($1,$2,$3,$4,$5,$6,'Gel Manicure',4000,45,4000,'service')`, [id('9' + n), T, B, tk, GEL, tech]);
  await line('1', TK1, ANNA); await line('2', TK1, LAN); await line('3', TK_VOID, SUE);
  tomorrow = (await q(`select to_char(((now() at time zone 'America/New_York')::date + 1), 'YYYY-MM-DD') as d`)).rows[0].d;
  const dow = (await q(`select extract(dow from $1::date)::int as w`, [tomorrow])).rows[0].w;
  const appt = (aid: string, tenant: string, br: string, tech: string, cust: string, s0: string, e: string, status: string) => q(`insert into pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_id, customer_name, customer_phone, services, appt_date, start_time, end_time, duration_minutes, status)
    values ($1,$2,$3,$4,$5,'Mai Le','+18565551201','[{"name":"Gel Manicure"}]'::jsonb,$6::date,$7,$8,45,$9)`, [aid, tenant, br, tech, cust, tomorrow, s0, e, status]);
  await appt(APPT_K, T, B, KEVIN, MAI, '11:00', '11:45', 'booked'); await appt(APPT_X, T, B, SUE, MAI, '15:00', '15:45', 'cancelled'); await appt(APPT_T2, T2, BX, T2_TECH, MAI_T2, '10:00', '10:45', 'booked');
  // tomorrow's plan: weekly 09–17 for all (Anna lunch 12:00–12:30); Lan's one-date override 13:00–18:00; Anna approved time off 14:00–15:00
  for (const t of [ANNA, LAN, KEVIN, SUE]) await q(`insert into technician_schedules (tenant_id, branch_id, technician_id, day_of_week, start_time, end_time, lunch_start_time, lunch_end_time, is_working) values ($1,$2,$3,$4,'09:00','17:00',$5,$6,true)`,
    [T, B, t, dow, t === ANNA ? '12:00' : null, t === ANNA ? '12:30' : null]);
  await q(`insert into technician_shift_overrides (tenant_id, branch_id, technician_id, local_shift_date, timezone, override_type, start_local_time, end_local_time) values ($1,$2,$3,$4::date,'America/New_York','CUSTOM_SHIFT','13:00','18:00')`, [T, B, LAN, tomorrow]);
  await q(`insert into technician_time_off (tenant_id, branch_id, technician_id, starts_at, ends_at, status) values ($1,$2,$3, ($4 || ' 14:00')::timestamp at time zone 'America/New_York', ($4 || ' 15:00')::timestamp at time zone 'America/New_York', 'approved')`, [T, B, ANNA, tomorrow]);
  repo = new TeamMembersLookupRepository(kyselyFor(pg) as never);
}, 180_000);

describe('TM-01 customer-linked staff search', () => {
  it('phone in any format → every technician on the shared ticket + the booked one, each with why; voided / cancelled link nobody', async () => {
    for (const ph of ['8565551201', '(856) 555-1201', '+1 856 555 1201']) {
      const r: any = await repo.customerLinks(mgr, { q: ph });
      expect(names(r), ph).toEqual(['Anna Lee', 'Kevin Dang', 'Lan Vo']);   // never Sue (voided ticket, cancelled appointment)
      expect(r.query.kind).toBe('phone'); expect(r.matchedCustomers).toBe(1);
    }
    const r: any = await repo.customerLinks(mgr, { q: '8565551201' });
    const anna = r.items.find((x: any) => x.name === 'Anna Lee'); const kevin = r.items.find((x: any) => x.name === 'Kevin Dang'); const lan = r.items.find((x: any) => x.name === 'Lan Vo');
    // Anna: ONE reason for T-501 carrying both roles (service line + primary)
    expect(anna.reasons).toHaveLength(1); expect(anna.reasons[0].ticketNumber).toBe('T-501'); expect(anna.reasons[0].kinds.sort()).toEqual(['service_line', 'ticket_primary']);
    expect(lan.reasons[0].kinds).toEqual(['service_line']); expect(lan.reasons[0].services).toEqual(['Gel Manicure']);
    // Kevin: the helper on T-501 AND the booked appointment tomorrow (upcoming, with its id and date)
    const kinds = kevin.reasons.map((x: any) => x.kinds[0]).sort(); expect(kinds).toEqual(['appointment', 'ticket_helper']);
    const ap = kevin.reasons.find((x: any) => x.kind === 'appointment'); expect(ap.refId).toBe(APPT_K); expect(ap.date).toBe(tomorrow); expect(ap.time).toBe('11:00'); expect(ap.upcoming).toBe(true);
    // the customer's phone is masked everywhere; the full number never leaves the server
    expect(JSON.stringify(r)).not.toContain('555-1201'); expect(JSON.stringify(r)).not.toContain('8565551201'); expect(r.customers[0].phone).toBe('••• 1201');
  });
  it('by name; tenant B\'s identical customer never resolves (and vice versa)', async () => {
    const r: any = await repo.customerLinks(mgr, { q: 'mai le' }); expect(names(r)).toEqual(['Anna Lee', 'Kevin Dang', 'Lan Vo']); expect(r.query.kind).toBe('name');
    expect(JSON.stringify(r)).not.toContain(T2_TECH); expect(JSON.stringify(r)).not.toContain(MAI_T2);
    const o: any = await repo.customerLinks(other, { q: '8565551201' }); expect(names(o)).toEqual(['Other Salon Tech']);
    expect(JSON.stringify(o)).not.toContain(ANNA); expect(JSON.stringify(o)).not.toContain(TK1);
  });
  it('needs customers.view; a too-short query is refused; paging is on the server', async () => {
    await expect(repo.customerLinks(noCustomers, { q: 'mai' })).rejects.toMatchObject({ status: 403 });
    await expect(repo.customerLinks(mgr, { q: 'm' })).rejects.toMatchObject({ status: 422 });
    await expect(repo.customerLinks(mgr, { q: '1201' })).rejects.toMatchObject({ status: 422 });   // 4 digits: too broad for a customer phone
    const p1: any = await repo.customerLinks(mgr, { q: 'mai', pageSize: 2 }); const p2: any = await repo.customerLinks(mgr, { q: 'mai', pageSize: 2, page: 2 });
    expect(p1.totalItems).toBe(3); expect(p1.items).toHaveLength(2); expect(p2.items).toHaveLength(1);
    expect(new Set([...names(p1), ...names(p2)]).size).toBe(3);
    const p9: any = await repo.customerLinks(mgr, { q: 'mai', pageSize: 2, page: 9 }); expect(p9.page).toBe(2);   // clamps
  });
});

describe('TM-04 preferred technician', () => {
  it('an overlapping appointment → not valid, the appointment named, qualified alternatives (exact start first), never the unmapped one', async () => {
    const r: any = await repo.preferredCheck(mgr, { technicianId: KEVIN, date: tomorrow, time: '11:15', serviceIds: GEL });
    expect(r.preferred.valid).toBe(false); expect(r.preferredFirst).toBe(false); expect(r.preferred.reasons).toEqual(['appointments']);
    expect(r.preferred.checks.find((c: any) => c.key === 'appointments').detail.appointments[0]).toMatchObject({ id: APPT_K, start: '11:00', end: '11:45' });
    expect(r.durationMinutes).toBe(45);
    expect(r.alternatives.map((a: any) => [a.name, a.start])).toEqual([['Anna Lee', '11:15'], ['Lan Vo', '13:00']]);   // Lan's date override starts at 13:00
    expect(r.alternatives.some((a: any) => a.technicianId === SUE || a.technicianId === KEVIN)).toBe(false);
    const n = (await q(`select count(*)::int as n from pos_tech_appointments where tenant_id = $1`, [T])).rows[0].n; expect(n).toBe(2);   // nothing booked
  });
  it('break, duration past the shift end, approved time off, missing mapping, one-date override — each named', async () => {
    const at = async (tid: string, time: string) => (await repo.preferredCheck(mgr, { technicianId: tid, date: tomorrow, time, serviceIds: GEL }) as any).preferred;
    expect((await at(ANNA, '12:00')).reasons).toEqual(['breaks']);
    expect((await at(ANNA, '16:30')).reasons).toEqual(['duration']);
    expect((await at(ANNA, '14:15')).reasons).toEqual(['time_off']);
    expect((await at(SUE, '10:00')).reasons).toEqual(['qualified']);
    const lan = await at(LAN, '10:00'); expect(lan.reasons).toEqual(['shift']); expect(lan.checks.find((c: any) => c.key === 'shift').detail.source).toBe('override');
  });
  it('a valid preferred technician comes first; no time → her earliest valid start; another salon\'s technician is a 404', async () => {
    const r: any = await repo.preferredCheck(mgr, { technicianId: KEVIN, date: tomorrow, time: '10:00', serviceIds: GEL });
    expect(r.preferred.valid).toBe(true); expect(r.preferredFirst).toBe(true); expect(r.preferred.start).toBe('10:00'); expect(r.preferred.end).toBe('10:45');
    const e: any = await repo.preferredCheck(mgr, { technicianId: LAN, date: tomorrow, serviceIds: GEL }); expect(e.preferred.valid).toBe(true); expect(e.preferred.start).toBe('13:00');
    await expect(repo.preferredCheck(mgr, { technicianId: T2_TECH, date: tomorrow, time: '10:00', serviceIds: GEL })).rejects.toMatchObject({ status: 404 });
    await expect(repo.preferredCheck(other, { technicianId: KEVIN, date: tomorrow, time: '10:00', serviceIds: GEL2 })).rejects.toMatchObject({ status: 404 });
    await expect(repo.preferredCheck(mgr, { technicianId: KEVIN, date: tomorrow, time: '10:00', serviceIds: GEL2 })).rejects.toMatchObject({ status: 422 });   // the other salon's service
  });
});
