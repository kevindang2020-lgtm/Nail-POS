// tech-queue-lane-states.pgtest — 200-technician mandate §33 (Oct 26 2026): the POS Tech Queue reports the two lane states
// the mandate names that the queue model did not: HOLD (from the Fair Turn ledger — technician_turn_state 'HOLD' today,
// with its reason) and APPOINTMENT SOON (ready, next appointment today within APPOINTMENT_SOON_MINUTES — the Fair Turn
// board's window — while the salon's appointment protection is on). Busy / break / off keep their own state.
import { describe, it, expect, beforeAll } from 'vitest';
import { KyselyTechQueueRepository } from './tech-queue.kysely.repository';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { APPOINTMENT_SOON_MINUTES } from '@aipowersalon/workforce';

const T = 'cccccccc-0000-4000-8000-0000000003a1';
const B = 'cccccccc-0000-4000-8000-0000000003a2';
const id = (n: number) => `cccccccc-0000-4000-8000-00000000${String(300 + n).padStart(4, '0')}`;
const TECHS = { hold: id(1), soon: id(2), later: id(3), breakHold: id(4), ready: id(5), past: id(6) };
const ctx = { tenantId: T, branchId: B } as never;
// a whole-hour zone where it is ~10:00 now, so "in 30 minutes" and "in 3 hours" are both today (as the pilot does)
const TZ = (() => { const h = new Date().getUTCHours(); let off = (10 - h + 24) % 24; if (off > 14) off -= 24; return off === 0 ? 'Etc/GMT' : `Etc/GMT${off > 0 ? '-' : '+'}${Math.abs(off)}`; })();
const local = (plusMin: number) => { const p = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(Date.now() + plusMin * 60_000)); const g = (t: string) => p.find((x) => x.type === t)!.value; return { date: `${g('year')}-${g('month')}-${g('day')}`, time: `${g('hour')}:${g('minute')}` }; };
let repo: KyselyTechQueueRepository; let pgh: any;

beforeAll(async () => {
  const pg = await migratedPglite(); pgh = pg;
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'Lane Salon LLC', 'Lane Salon', 'lane-salon', 'LANES3', 'active') ON CONFLICT DO NOTHING;`);
  await pg.exec(`INSERT INTO branches (id, tenant_id, name, status, timezone) VALUES ('${B}', '${T}', 'Main', 'active', '${TZ}') ON CONFLICT DO NOTHING;`);
  const today = local(0).date;
  for (const [k, tid] of Object.entries(TECHS)) {
    await pg.exec(`INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status) VALUES ('${tid}', '${T}', '${B}', '${k}', 'X', '${k} X', 'active');`);
    await pg.exec(`INSERT INTO technician_statuses (tenant_id, branch_id, technician_id, status) VALUES ('${T}', '${B}', '${tid}', '${k === 'breakHold' ? 'on_break' : 'available'}');`);
  }
  for (const [tid, st, reason] of [[TECHS.hold, 'HOLD', 'AWAITING_MANAGER_POSITION'], [TECHS.breakHold, 'HOLD', 'manager'], [TECHS.soon, 'READY', null], [TECHS.ready, 'READY', null]] as const)
    await pg.exec(`INSERT INTO technician_turn_state (tenant_id, branch_id, business_date, technician_id, status, in_rotation, hold_reason) VALUES ('${T}', '${B}', '${today}', '${tid}', '${st}', true, ${reason ? `'${reason}'` : 'NULL'});`);
  const appt = async (tid: string, plusMin: number) => { const s = local(plusMin); await pg.exec(`INSERT INTO pos_tech_appointments (tenant_id, branch_id, technician_id, customer_name, appt_date, start_time, end_time, status) VALUES ('${T}', '${B}', '${tid}', 'Guest', '${s.date}', '${s.time}', '${local(plusMin + 45).time}', 'confirmed');`); };
  await appt(TECHS.soon, 30);                                  // inside the window
  await appt(TECHS.later, 180);                                // outside it
  await appt(TECHS.past, -90);                                 // already started — not "soon"
  await appt(TECHS.hold, 20);                                  // held AND an appointment soon: Hold wins
  repo = new KyselyTechQueueRepository(kyselyFor(pg) as never);
});

describe('§33 Tech Queue lane states from the domain', () => {
  it(`Hold (Fair Turn HOLD, with its reason) and Appointment Soon (≤ ${APPOINTMENT_SOON_MINUTES} min); busy / break / off keep their own`, async () => {
    const st: any = await repo.query(ctx, {} as never);
    const row = (tid: string) => st.technicianRows.find((r: any) => r.technicianId === tid);
    expect(row(TECHS.hold)).toMatchObject({ status: 'hold', holdReason: 'AWAITING_MANAGER_POSITION' });
    expect(row(TECHS.soon).status).toBe('appointment_soon');
    expect(row(TECHS.soon).nextAppointmentInMinutes).toBeGreaterThanOrEqual(28);
    expect(row(TECHS.soon).nextAppointmentInMinutes).toBeLessThanOrEqual(31);
    expect(row(TECHS.later)).toMatchObject({ status: 'available', holdReason: null });
    expect(row(TECHS.later).nextAppointmentInMinutes).toBeGreaterThan(APPOINTMENT_SOON_MINUTES);
    expect(row(TECHS.past)).toMatchObject({ status: 'available', nextAppointmentInMinutes: null });
    expect(row(TECHS.breakHold).status).toBe('on_break');      // a break is a break, whatever the turn ledger says
    expect(row(TECHS.ready).status).toBe('available');
  });
  it('appointment protection off → no Appointment Soon (the Fair Turn board shows none either); Hold stays', async () => {
    // the salon's Fair Turn policy (queue_assignment_tenant_settings.turn_policy, 600) — the setting the board reads
    await pgh.exec(`INSERT INTO queue_assignment_tenant_settings (tenant_id, turn_policy) VALUES ('${T}', '{"appointmentProtectionEnabled": false}'::jsonb) ON CONFLICT (tenant_id) DO UPDATE SET turn_policy = EXCLUDED.turn_policy;`);
    const st: any = await repo.query(ctx, {} as never);
    const row = (tid: string) => st.technicianRows.find((r: any) => r.technicianId === tid);
    expect(row(TECHS.hold).status).toBe('hold');
    expect(row(TECHS.soon).status).toBe('available');
    expect(row(TECHS.soon).nextAppointmentInMinutes).toBeGreaterThanOrEqual(28);   // still reported, just not a state
  });
});
