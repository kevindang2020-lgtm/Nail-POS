// upsell-schedule-conflict.vitest.spec.ts — Functional Decision 27: "Do not recommend an add-on that creates a scheduling
// conflict." An add-on that adds more time than is left before the ticket technician's next appointment is not
// suggested — and adding it anyway (a screen left open) is refused. Real-Postgres part opt-in (PG_RACE_URL).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { addOnMinutesAvailable, addOnConflictsWithSchedule, recommendAddOns } from './ai-checkout-upsell-core';
import { AiCheckoutUpsellService, type MutationDeps } from './ai-checkout-upsell.service';
import { KyselyTechnicianSchedule } from './ai-checkout-upsell.kysely';
import { clearBranchTimeZoneCache } from '@aipowersalon/database';

const addOn = (addOnId: string, durationDeltaMinutes: number): any => ({ addOnId, name: addOnId, priceCents: 500, durationDeltaMinutes, isTaxable: false, isActive: true, sourceServiceId: 's', sourceServiceName: 'Gel' });

describe('the schedule rule', () => {
  it('the tightest gap across the ticket technicians; nothing booked → no limit', () => {
    expect(addOnMinutesAvailable([{ startsInMinutes: 40 }, { startsInMinutes: 12 }, null])).toBe(12);
    expect(addOnMinutesAvailable([null, null])).toBeNull();
    expect(addOnMinutesAvailable([{ startsInMinutes: -5 }])).toBe(0);   // already late for the next one
  });
  it('an add-on fits only if its extra time is within the gap (equal fits)', () => {
    expect(addOnConflictsWithSchedule(15, 15)).toBe(false);
    expect(addOnConflictsWithSchedule(16, 15)).toBe(true);
    expect(addOnConflictsWithSchedule(30, null)).toBe(false);
  });
  it('recommendAddOns leaves out the add-ons that would run into the next appointment', () => {
    const p = { candidates: [addOn('quick', 10), addOn('long', 30)], cartAddOnIds: [], sameVisitFeasible: true, maxAddOns: 2, ticketSubtotalCents: 10000, maxPriceCents: 3000 };
    expect(recommendAddOns({ ...p, availableMinutes: 20 }).map((c) => c.targetId)).toEqual(['quick']);
    expect(recommendAddOns({ ...p, availableMinutes: null }).map((c) => c.targetId)).toEqual(['quick', 'long']);
  });
});

describe('AiCheckoutUpsellService with the technician schedule', () => {
  const TICKET = { checkoutId: 'c1', branchId: 'b1', customerId: 'cust1', status: 'open', serviceLines: [{ serviceId: 'svc_mani', serviceName: 'Manicure' }], cartAddOnIds: [], subtotalCents: 10000, technicianIds: ['tech_mia'] };
  const addOns: any = { getAddOns: async () => [addOn('art', 10), addOn('spa', 30)] };
  const stub: any = { candidates: async () => [], options: async () => ({ enabled: false, allowedAmountsCents: [] }), context: async () => null, state: async () => null };
  let lines = 0;
  const mut: MutationDeps = { idem: undefined as any,
    addOn: { addServiceLine: async () => { lines++; return { lineId: 'L' + lines }; } }, membership: { enroll: async () => ({ membershipId: 'M' }) },
    loyalty: { enroll: async () => ({ enrolled: true as const }), redeem: async () => ({ redemptionId: 'R' }) }, promotion: { apply: async () => ({ applied: true as const }) },
    booking: { openBooking: async () => ({ bookingDraftId: 'B' }) }, recalc: { recalculate: async () => ({ totalCents: 0, subtotalCents: 0, taxCents: 0 }) } } as any;
  const ctx: any = { tenantId: 'A', branchId: 'b1', userId: 'u', role: 'MANAGER', permissions: ['pos.checkout.view', 'pos.checkout.reopen_service'] };
  const make = (startsInMinutes: number | null) => new AiCheckoutUpsellService({ getTicket: async () => TICKET } as any, addOns, stub, stub, stub, stub, stub, undefined,
    { dismissed: async () => [], record: async () => {}, recordFeedback: async () => {} } as any, null, undefined, mut, undefined,
    { nextAppointment: async () => (startsInMinutes === null ? null : { startsInMinutes, startTime: '15:00' }) });

  it("Mia's next customer is in 20 minutes: the 10-minute add-on is suggested, the 30-minute one is not", async () => {
    const r = await make(20).recommendations(ctx, 'c1');
    expect(r.cards.filter((c) => c.type === 'service_addon').map((c) => c.targetId)).toEqual(['art']);
  });
  it('adding the 30-minute add-on anyway is refused (ADDON_SCHEDULE_CONFLICT) and nothing is added', async () => {
    lines = 0;
    await expect(make(20).addServiceAddon(ctx, 'c1', 'spa', { confirm: true, idempotencyKey: 'k1' })).rejects.toThrow('ADDON_SCHEDULE_CONFLICT');
    expect(lines).toBe(0);
  });
  it('with no next appointment both are suggested and either can be added', async () => {
    const r = await make(null).recommendations(ctx, 'c1');
    expect(r.cards.filter((c) => c.type === 'service_addon').map((c) => c.targetId).sort()).toEqual(['art', 'spa']);
  });
});

const url = process.env.PG_RACE_URL;
const T = 'a2700000-0000-4000-8000-0000000000a1', B = 'b2700000-0000-4000-8000-0000000000b1', TECH = 'c2700000-0000-4000-8000-0000000000c1';
describe.skipIf(!url)('KyselyTechnicianSchedule on real Postgres', () => {
  let db: Kysely<any>; let pool: pg.Pool;
  const at = new Date('2026-10-02T18:40:00Z');   // 2:40 pm in New Jersey
  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 2 }); db = new Kysely<any>({ dialect: new PostgresDialect({ pool }) });
    await sql`delete from pos_tech_appointments where tenant_id = ${T}`.execute(db);
    await sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values (${TECH}, ${T}, ${B}, 'Mia', 'Tran', 'Mia Tran') on conflict (id) do nothing`.execute(db);
    const ins = (start: string, end: string, status: string, date = '2026-10-02') => sql`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_name, source, services, appt_date, start_time, end_time, duration_minutes, status, deposit_status)
      values (${T}, ${B}, ${TECH}, 'X', 'manual', '[]'::jsonb, ${date}, ${start}, ${end}, 30, ${status}, 'not_required')`.execute(db);
    await ins('14:00', '14:30', 'in_service');   // the one being checked out — started earlier
    await ins('15:00', '15:30', 'cancelled');    // cancelled — frees the chair
    await ins('15:20', '15:50', 'confirmed');    // the next real one
    await ins('16:00', '16:30', 'booked');
    await ins('09:00', '09:30', 'booked', '2026-10-03');
  });
  afterAll(async () => { await sql`delete from pos_tech_appointments where tenant_id = ${T}`.execute(db).catch(() => undefined); await sql`delete from technicians where id = ${TECH}`.execute(db).catch(() => undefined); await db?.destroy(); });
  it('finds the next chair-holding appointment after now in salon time: 3:20 pm, 40 minutes away', async () => {
    const s = new KyselyTechnicianSchedule(db as any, 'America/New_York', () => at);
    expect(await s.nextAppointment({ tenantId: T, branchId: B } as any, TECH)).toEqual({ startsInMinutes: 40, startTime: '15:20' });
    expect(await new KyselyTechnicianSchedule(db as any, 'America/New_York', () => new Date('2026-10-02T21:00:00Z')).nextAppointment({ tenantId: T, branchId: B } as any, TECH)).toBeNull();   // 5 pm: nothing left today
  });
  it("with no fixed zone it uses the BRANCH's zone: a Los Angeles branch at 18:40 UTC is 11:40 am — its 2:00 pm visit is 140 minutes away", async () => {
    clearBranchTimeZoneCache();
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, lifecycle_state) values (${T}, 'UP', 'UP', 'up-salon-tz', 'UPTZ', 'active') on conflict (id) do nothing`.execute(db);
    await sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Santa Monica', 'America/Los_Angeles') on conflict (id) do update set timezone = excluded.timezone`.execute(db);
    const s = new KyselyTechnicianSchedule(db as any, undefined, () => at);
    expect(await s.nextAppointment({ tenantId: T, branchId: B } as any, TECH)).toEqual({ startsInMinutes: 14 * 60 - (11 * 60 + 40), startTime: '14:00' });   // New Jersey time would have said 15:20
    clearBranchTimeZoneCache();
  });
});
