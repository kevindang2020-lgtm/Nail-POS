// service-recommendations-center.pgtest — Service Recommendations guide (Nov 1 2026; migration 766) on the REAL schema.
// SR = evaluation & catalog · BK = service-level booking · RV = review workflow · HO = Booking Assistant handoff ·
// LS = list · SC = security / no side effects · HL = health.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { ServiceRecommendationsCenter, ServiceRecommendationsError, suggestForCustomer } from './service-recommendations-center';
import { DEFAULT_TUNABLES } from './ai-customer-profile-core';

const P = 'c7660000-0000-4000-8000-';
const id = (n: number) => P + String(n).padStart(12, '0');
const T = id(1), B = id(2), X = id(4), BX = id(5), OWNER = id(10), LAN = id(20), MAI = id(21), CAT = id(30);
const SV = { gel: id(40), pedi: id(41), old: id(42), other: id(43) };
const C = { ann: id(101), ben: id(102), cat: id(103), dan: id(104), eve: id(105), nev: id(106), other: id(130) };
const ctx = (o: any = {}) => ({ tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: ['pos.ai_customer_profile.view', 'pos.booking.create'], ...o }) as any;
let db: any; let enabled = true; let clock = Date.now();
let sr: ServiceRecommendationsCenter;
const q = async (s: any) => (await s.execute(db)).rows as any[];
const audits: any[] = [];
const audit = async (_t: any, m: any) => { audits.push(m); };
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e) { return e instanceof ServiceRecommendationsError ? e.code : (e as Error).message; } }
let tk = 0;
const visit = async (cust: string, daysAgo: number, service: string, name: string, tech = LAN) => {
  const tid = id(1000 + ++tk);
  await q(sql`insert into tickets (id, tenant_id, branch_id, customer_id, primary_technician_id, status, total_cents, ticket_number, created_at, paid_at)
    values (${tid}, ${T}, ${B}, ${cust}, ${tech}, 'paid', 4500, ${tk}, now() - (${daysAgo} || ' days')::interval, now() - (${daysAgo} || ' days')::interval)`);
  await q(sql`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, technician_id, created_at)
    values (${T}, ${B}, ${tid}, ${service}, ${name}, 4000, 45, 4000, ${tech}, now() - (${daysAgo} || ' days')::interval)`);
};
const appt = (cust: string, dayOffset: number, status: string, serviceId: string, serviceName: string) => q(sql`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_id, customer_name, appt_date, start_time, end_time, status, services)
  values (${T}, ${B}, ${LAN}, ${cust}, 'x', (now() at time zone 'America/New_York')::date + ${dayOffset}::int, '10:00', '11:00', ${status}, ${JSON.stringify([{ serviceId, serviceName }])}::jsonb)`);
const rescan = async () => { clock += 120_000; return sr.scan(ctx()); };
const list = (f: any) => sr.list(ctx(), f, { fullContact: false });
const recId = async (cust: string, service: string) => (await q(sql`select id from service_recommendations where customer_id = ${cust} and service_id = ${service}`))[0]?.id as string;

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  sr = new ServiceRecommendationsCenter(db, async () => ({ enabled, tunables: DEFAULT_TUNABLES }), () => clock);
  await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'S', 'Pilot', 'sr-766', 'SR766', 'active'), (${X}, 'X', 'Other', 'sr-766x', 'SR766X', 'active')`);
  await q(sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Main', 'America/New_York'), (${BX}, ${X}, 'Other', 'America/New_York')`);
  await q(sql`insert into users (id, tenant_id, full_name, email, status, role) values (${OWNER}, ${T}, 'Owner', 'o@sr.test', 'active', 'OWNER')`);
  await q(sql`set session_replication_role = replica`);
  await q(sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values (${LAN}, ${T}, ${B}, 'Lan', 'Nguyễn', 'Lan Nguyễn'), (${MAI}, ${T}, ${B}, 'Mai', 'Trần', 'Mai Trần')`);
  await q(sql`insert into service_categories (id, tenant_id, branch_id, name) values (${CAT}, ${T}, ${B}, 'Manicure')`);
  await q(sql`insert into services (id, tenant_id, branch_id, category_id, name, description, duration_minutes, price_cents, status, archived_at) values
    (${SV.gel}, ${T}, ${B}, ${CAT}, 'Gel Manicure', 'Long-wear gel polish', 45, 4500, 'active', null), (${SV.pedi}, ${T}, ${B}, ${CAT}, 'Spa Pedicure', null, 50, 5500, 'active', null),
    (${SV.old}, ${T}, ${B}, ${CAT}, 'Retired Art', null, 30, 2000, 'inactive', now()), (${SV.other}, ${X}, ${BX}, ${CAT}, 'Other Salon Gel', null, 45, 4500, 'active', null)`);
  await q(sql`insert into service_add_ons (tenant_id, service_id, add_on_key, name, price_cents, duration_delta_minutes, is_active) values
    (${T}, ${SV.gel}, 'chrome', 'Chrome finish', 1000, 10, true), (${T}, ${SV.gel}, 'old', 'Old add-on', 500, 5, false)`);
  await q(sql`insert into technician_services (tenant_id, branch_id, technician_id, service_id, is_primary) values (${T}, ${B}, ${LAN}, ${SV.gel}, true), (${T}, ${B}, ${LAN}, ${SV.pedi}, false)`);
  for (const [cid, tenant, branch, name] of [[C.ann, T, B, 'Ann An'], [C.ben, T, B, 'Ben Bảo'], [C.cat, T, B, 'Cat Cao'], [C.dan, T, B, 'Dan Do'], [C.eve, T, B, 'Eve Em'], [C.nev, T, B, 'Nev Never'], [C.other, X, BX, 'Oth Other']] as const)
    await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, status, created_at)
      values (${cid}, ${tenant}, ${branch}, ${name.split(' ')[0]}, ${name.split(' ')[1]}, ${name}, ${cid === C.ann ? '+14155550111' : null}, 'active', now() - interval '400 days')`);
  for (const d of [60, 30, 5]) await visit(C.ann, d, SV.gel, 'Gel Manicure');            // usual: gel ×3, all with Lan
  for (const d of [100, 80]) await visit(C.ann, d, SV.pedi, 'Spa Pedicure');             // twice, 11+ weeks ago → previously preferred
  for (const d of [40, 10]) await visit(C.ben, d, SV.gel, 'Gel Manicure');
  await appt(C.ben, 5, 'booked', SV.gel, 'Gel Manicure');                                // the same service is booked
  await visit(C.cat, 15, SV.gel, 'Gel Manicure');                                        // one completion → insufficient
  for (const d of [90, 60, 30]) await visit(C.dan, d, SV.old, 'Retired Art');           // only an inactive service → insufficient
  for (const d of [40, 10]) await visit(C.eve, d, SV.pedi, 'Spa Pedicure');
  await appt(C.eve, 3, 'confirmed', SV.gel, 'Gel Manicure');                             // a DIFFERENT service is booked
  await q(sql`set session_replication_role = origin`);
});

describe('Service Recommendations — evaluation and catalog', () => {
  it('SR-00 with no evaluation the page says Data Unavailable — never "no recommendations"', async () => {
    expect(await sr.summary(ctx())).toMatchObject({ metrics: null, unavailable: true, freshness: { state: 'never' } });
    expect(await list({})).toMatchObject({ unavailable: true, total: 0 });
  });
  it('SR-01 the assistant\'s rule by catalog service id: usual + previously preferred, active services only, a single completion is not a suggestion', async () => {
    const s: any = await sr.scan(ctx());
    expect(s.scan).toMatchObject({ customersEvaluated: 6, generated: 4, counts: { repeat_service: 3, previously_preferred: 1, insufficient_history: 2, never_served: 1 } });
    const recs = await q(sql`select customer_id, service_id, rec_type, confidence, times_completed, preferred_technician_id from service_recommendations where tenant_id = ${T} order by customer_id, rec_type`);
    expect(recs).toEqual([
      { customer_id: C.ann, service_id: SV.pedi, rec_type: 'previously_preferred', confidence: 'medium', times_completed: 2, preferred_technician_id: null },
      { customer_id: C.ann, service_id: SV.gel, rec_type: 'repeat_service', confidence: 'high', times_completed: 3, preferred_technician_id: LAN },
      { customer_id: C.ben, service_id: SV.gel, rec_type: 'repeat_service', confidence: 'medium', times_completed: 2, preferred_technician_id: null },
      { customer_id: C.eve, service_id: SV.pedi, rec_type: 'repeat_service', confidence: 'medium', times_completed: 2, preferred_technician_id: null },
    ]);
    const m: any = (await sr.summary(ctx())).metrics;
    expect(m).toEqual({ recommendations: 4, customersWithRecommendations: 3, customersEvaluated: 6, needsReview: 3, recentlyReviewed: 0, associatedBookings: 0, insufficientHistory: 2, neverServed: 1 });
    expect((await sr.scan(ctx()) as any).reused).toBe(true);                       // inside 60 s
  });
  it('SR-02 a suggestion keeps its date across rescans; a deactivated service shows at once, is superseded on the next evaluation, and returns as NEW', async () => {
    const g0 = (await q(sql`select generated_at from service_recommendations where customer_id = ${C.ann} and service_id = ${SV.gel}`))[0].generated_at;
    await rescan();
    expect(new Date((await q(sql`select generated_at from service_recommendations where customer_id = ${C.ann} and service_id = ${SV.gel}`))[0].generated_at).toISOString()).toBe(new Date(g0).toISOString());
    await q(sql`update services set status = 'inactive' where id = ${SV.pedi}`);
    expect((await list({ tab: 'all', q: 'eve' })).items[0]).toMatchObject({ state: 'service_inactive', service: { active: false, priceCents: null } });
    expect((await list({ tab: 'needs_review' })).items.map((i: any) => i.customerId)).toEqual([C.ann]);   // only Ann's gel
    await rescan();
    expect((await list({ tab: 'superseded' })).total).toBe(2);
    await q(sql`update services set status = 'active' where id = ${SV.pedi}`);
    await rescan();
    const back = (await q(sql`select status, generated_at from service_recommendations where customer_id = ${C.eve}`))[0];
    expect(back.status).toBe('open');
    expect(new Date(back.generated_at).getTime()).toBeGreaterThan(new Date(g0).getTime());
  });
  it('SR-03 the overlay reads the catalog live: price, duration, category, description, active add-ons, qualified technicians, history', async () => {
    const d: any = await sr.detail(ctx(), await recId(C.ann, SV.gel), { fullContact: false }, audit);
    expect(d.service).toMatchObject({ name: 'Gel Manicure', category: 'Manicure', description: 'Long-wear gel polish', active: true, priceCents: 4500, durationMinutes: 45, branch: 'Main' });
    expect(d.service.addOns).toEqual([{ name: 'Chrome finish', priceCents: 1000, durationDeltaMinutes: 10 }]);
    expect(d.technicians).toMatchObject({ qualifiedTotal: 1, qualified: [{ id: LAN, primary: true }], preferred: { id: LAN, active: true, qualified: true } });
    expect(d.evidence).toMatchObject({ timesCompleted: 3 });
    expect(d.history.frequency[0]).toMatchObject({ serviceId: SV.gel, count: 3 });
    expect(d.history.visits[0].lines[0]).toMatchObject({ service: 'Gel Manicure', technician: 'Lan Nguyễn', matches: true });
    expect(d.identity.phone).toBe('(•••) •••-0111');
    expect(d.caveats).toContain('availability_not_checked');
    expect(d.note).toMatch(/not a booking/);
    await q(sql`update services set price_cents = 4900 where id = ${SV.gel}`);
    expect(((await sr.detail(ctx(), await recId(C.ann, SV.gel), { fullContact: false }, audit)) as any).service.priceCents).toBe(4900);   // today's price, never a snapshot
  });
  it('SR-04 the shared rule helper matches the assistant\'s rule', () => {
    const now = new Date().toISOString();
    const at = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
    expect(suggestForCustomer('c', [{ serviceId: 's', at: at(3), technicianId: null }], new Set(['s']), now, DEFAULT_TUNABLES)).toEqual([]);
    expect(suggestForCustomer('c', [{ serviceId: 's', at: at(3), technicianId: 't' }, { serviceId: 's', at: at(30), technicianId: 't' }], new Set(), now, DEFAULT_TUNABLES)).toEqual([]);
  });
});

describe('Service Recommendations — service-level booking', () => {
  it('BK-01 the SAME service booked → Already Booked; a DIFFERENT booked service does not satisfy the suggestion', async () => {
    const all = (await list({ tab: 'all' })).items as any[];
    expect(all.find((i) => i.customerId === C.ben)).toMatchObject({ state: 'booked', booking: { thisService: true } });
    const eve = all.find((i) => i.customerId === C.eve);
    expect(eve).toMatchObject({ state: 'needs_review', booking: { thisService: false } });
    expect(eve.booking.nextAnyDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((await list({ tab: 'booked' })).items.map((i: any) => i.customerId)).toEqual([C.ben]);
  });
});

describe('Service Recommendations — review workflow', () => {
  it('RV-01 reviewed / not applicable move a suggestion out of Needs Review; history is append-only; no customer, booking or catalog change', async () => {
    const before = await q(sql`select (select count(*) from pos_tech_appointments)::int a, (select max(updated_at) from customers where tenant_id = ${T}) c, (select sum(price_cents) from services)::int p`);
    await sr.review(ctx(), await recId(C.ann, SV.gel), { action: 'reviewed', note: 'mentioned at checkout' }, audit);
    await sr.review(ctx(), await recId(C.eve, SV.pedi), { action: 'not_applicable' }, audit);
    expect((await list({ tab: 'needs_review' })).items.map((i: any) => i.customerId)).toEqual([C.ann]);   // Ann's pedi only
    expect((await list({ tab: 'reviewed' })).total).toBe(2);
    expect((await sr.summary(ctx()) as any).metrics).toMatchObject({ recentlyReviewed: 2 });
    expect(await q(sql`select (select count(*) from pos_tech_appointments)::int a, (select max(updated_at) from customers where tenant_id = ${T}) c, (select sum(price_cents) from services)::int p`)).toEqual(before);
    expect(await code(q(sql`update service_recommendation_events set note = 'x'`))).toMatch(/append-only/);
  });
  it('RV-02 a passed deferral returns; reopen returns; refusals', async () => {
    const pedi = await recId(C.ann, SV.pedi);
    await sr.review(ctx(), pedi, { action: 'deferred', dueOn: '2020-01-01' }, audit);
    expect((await list({ tab: 'needs_review' })).items.map((i: any) => i.id)).toContain(pedi);
    await sr.review(ctx(), pedi, { action: 'deferred', dueOn: '2099-01-01' }, audit);
    expect((await list({ tab: 'needs_review' })).items.map((i: any) => i.id)).not.toContain(pedi);
    await sr.review(ctx(), pedi, { action: 'reopened' }, audit);
    expect((await list({ tab: 'needs_review' })).items.map((i: any) => i.id)).toContain(pedi);
    expect(await code(sr.review(ctx(), pedi, { action: 'reviewed', expectedVersion: 5 }, audit))).toBe('SR_STALE_VERSION');
    expect(await code(sr.review(ctx(), pedi, { action: 'note' }, audit))).toBe('SR_NOTE_REQUIRED');
    enabled = false;
    expect(await code(list({}))).toBe('AI_CUSTOMER_PROFILE_DISABLED');
    enabled = true;
  });
});

describe('Service Recommendations — Booking Assistant handoff (prefill only)', () => {
  it('HO-01 returns today\'s price and a qualified technician; writes ONE booking_started event, never an appointment', async () => {
    const before = await q(sql`select count(*)::int n from pos_tech_appointments`);
    const h: any = await sr.handoff(ctx(), await recId(C.ann, SV.gel), { technicianId: LAN }, { fullContact: true }, audit);
    expect(h).toMatchObject({ customerId: C.ann, customerName: 'Ann An', customerPhone: '+14155550111', serviceId: SV.gel, priceCents: 4900, durationMinutes: 45, technicianId: LAN, technicianName: 'Lan Nguyễn' });
    expect(await q(sql`select count(*)::int n from pos_tech_appointments`)).toEqual(before);
    expect((await sr.history(ctx(), { type: 'booking_started' })).total).toBe(1);
  });
  it('HO-02 refusals: not qualified, the same service already booked, an inactive service, a superseded suggestion, another salon', async () => {
    expect(await code(sr.handoff(ctx(), await recId(C.ann, SV.gel), { technicianId: MAI }, { fullContact: false }, audit))).toBe('SR_TECHNICIAN_NOT_QUALIFIED');
    const e: any = await sr.handoff(ctx(), await recId(C.ben, SV.gel), {}, { fullContact: false }, audit).catch((x) => x);
    expect(e.code).toBe('SR_ALREADY_BOOKED');
    expect(e.details.nextAppointmentDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await q(sql`update services set archived_at = now() where id = ${SV.pedi}`);
    expect(await code(sr.handoff(ctx(), await recId(C.eve, SV.pedi), {}, { fullContact: false }, audit))).toBe('SR_SERVICE_INACTIVE');
    await rescan();
    expect(await code(sr.handoff(ctx(), await recId(C.eve, SV.pedi), {}, { fullContact: false }, audit))).toBe('SR_NOT_CURRENT');
    expect(await code(sr.review(ctx(), await recId(C.eve, SV.pedi), { action: 'reviewed' }, audit))).toBe('SR_NOT_CURRENT');
    await q(sql`update services set archived_at = null where id = ${SV.pedi}`);
    await rescan();
  });
});

describe('Service Recommendations — list, security, health', () => {
  it('LS-01 search by name or service, type, technician, dates, newest first with stable pages', async () => {
    // a service word finds the suggested service AND customers who completed it (the shared customer search), so Ann's gel suggestion too
    expect((await list({ tab: 'all', q: 'pedicure' })).items.map((i: any) => `${i.customerId}:${i.service.id}`).sort()).toEqual([`${C.ann}:${SV.gel}`, `${C.ann}:${SV.pedi}`, `${C.eve}:${SV.pedi}`].sort());
    expect((await list({ tab: 'all', q: 'bảo' })).items.map((i: any) => i.customerId)).toEqual([C.ben]);
    expect((await list({ tab: 'all', type: 'previously_preferred' })).total).toBe(1);
    expect((await list({ tab: 'all', technicianId: LAN })).total).toBe(4);
    expect((await list({ tab: 'all', serviceId: SV.gel })).total).toBe(2);
    expect((await list({ tab: 'all', preset: 'custom', from: '2020-01-01', to: '2020-12-31' })).total).toBe(0);
    expect(await code(list({ preset: 'custom', from: '2026-02-01', to: '2026-01-01' }))).toBe('SR_INVALID_PERIOD');
    const p = (await list({ tab: 'all', pageSize: 10 })).items as any[];
    const gen = p.map((i) => i.generatedAt);
    expect([...gen].sort().reverse()).toEqual(gen);
    expect((await list({ tab: 'all', pageSize: 10, page: 2 })).items).toEqual([]);
  });
  it('SC-01 another salon\'s data is never reachable; the overlay is audited', async () => {
    const [other] = await q(sql`insert into service_recommendations (tenant_id, customer_id, service_id, rec_type, confidence, rule_version) values (${X}, ${C.other}, ${SV.other}, 'repeat_service', 'high', 'sr-2026-11-02') returning id`);
    expect(await code(sr.detail(ctx(), other.id, { fullContact: false }, audit))).toBe('SR_NOT_FOUND');
    expect(await code(sr.review(ctx(), other.id, { action: 'note', note: 'x' }, audit))).toBe('SR_NOT_FOUND');
    expect(await code(sr.handoff(ctx(), other.id, {}, { fullContact: false }, audit))).toBe('SR_NOT_FOUND');
    expect((await list({ tab: 'all', q: 'other' })).total).toBe(0);
    audits.length = 0;
    await sr.detail(ctx(), await recId(C.ben, SV.gel), { fullContact: false }, audit);
    expect(audits).toEqual([{ recommendationId: await recId(C.ben, SV.gel), customerId: C.ben, serviceId: SV.gel, state: 'booked' }]);
  });
  it('HL-01 the check reconciles records, flags catalog / qualification gaps, and changes nothing', async () => {
    const before = await q(sql`select (select count(*) from service_recommendations)::int a, (select count(*) from service_recommendation_events)::int b, (select count(*) from pos_tech_appointments)::int c`);
    const r: any = await sr.check(ctx());
    const by = Object.fromEntries(r.checks.map((c: any) => [c.key, c]));
    expect(by.records_reconcile.state).toBe('PASSED');
    expect(by.services_catalog).toMatchObject({ state: 'PASSED', count: 2 });
    expect(by.active_services_only.state).toBe('PASSED');
    expect(by.technician_qualifications.state).toBe('PASSED');
    expect(by.already_booked.count).toBe(1);
    expect(by.tenant_isolation.state).toBe('PASSED');
    expect(await q(sql`select (select count(*) from service_recommendations)::int a, (select count(*) from service_recommendation_events)::int b, (select count(*) from pos_tech_appointments)::int c`)).toEqual(before);
    expect((await sr.check(ctx()) as any).reused).toBe(true);
    expect((await sr.scans(ctx(), {})).items[0]).toMatchObject({ status: 'completed', generated: 4 });
  });
});
