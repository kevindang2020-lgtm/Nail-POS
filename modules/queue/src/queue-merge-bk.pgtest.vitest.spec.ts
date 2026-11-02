// queue-merge-bk.pgtest — merge Oct 12 2026 (other-chat booking concurrency / Technician Profile phase 1) on the REAL schema
// (PGlite, all migrations). Pins, for the queue module's surfaces:
//   • tech-queue-offer.ts — the ONE accept / decline write: status-guarded (only a pending offer flips), version-guarded
//     (a stale expectedVersion is a no-op), the decline reason lands on the ticket notes, every flip bumps `version` (155);
//   • the live schedule's "book this open slot" goes through the shared appointment-slot-guard: a taken slot is a typed
//     AppointmentSlotConflict (never a swallowed insert), and the EXCLUDE guard (426/482) backs it;
//   • the queue's ASSIGNABLE roster excludes suspended / inactive / archived technicians (employment is a hard gate).
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { clearBranchTimeZoneCache } from '@aipowersalon/database';
import { AppointmentSlotConflict } from '@aipowersalon/appointments';
import { acceptOffer, declineOffer } from './tech-queue/tech-queue-offer';
import { KyselyTechQueueRepository } from './tech-queue/tech-queue.kysely.repository';
import { KyselyLiveScheduleRepository } from './live-technician-schedule/live-technician-schedule.kysely.repository';
import { KyselyQueueRepository } from './queue/queue.kysely.repository';
import { LiveTechnicianScheduleService, ConflictError as LsConflict } from './live-technician-schedule/live-technician-schedule.service';
import { TechnicianEligibilityService, KyselyEligibilityReader, KyselyAvailabilityPort } from '@aipowersalon/workforce';

const T = 'b1c00000-0000-4000-8000-000000000001';
const B = 'b1c00000-0000-4000-8000-000000000002';
const MIA = 'b1c00000-0000-4000-8000-0000000000a1';
const LEO = 'b1c00000-0000-4000-8000-0000000000a2';   // suspended
const ZOE = 'b1c00000-0000-4000-8000-0000000000a3';   // is_active = false
const KIM = 'b1c00000-0000-4000-8000-0000000000a4';   // archived_at set
const T1 = 'b1c00000-0000-4000-8000-0000000000e1', T2 = 'b1c00000-0000-4000-8000-0000000000e2', T3 = 'b1c00000-0000-4000-8000-0000000000e3';
const ctx: any = { tenantId: T, branchId: B, userId: 'u-desk', role: 'MANAGER', permissions: ['pos.tech_queue.view', 'pos.queue.view'] };
let db: any; let pg: any;
const q = (s: string, p: unknown[] = []) => pg.query(s, p);
const ticket = async (id: string) => (await q(`select status, version, notes from pos_tech_queue_tickets where id = $1`, [id])).rows[0] as any;

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  clearBranchTimeZoneCache();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Merge BK LLC','Merge BK','merge-bk','MBK001','active')`, [T]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York')`, [B, T]);
  await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active) values
    ($1,$5,$6,'Mia','Chen','Mia Chen','active',true), ($2,$5,$6,'Leo','Park','Leo Park','suspended',true), ($3,$5,$6,'Zoe','Tran','Zoe Tran','active',false), ($4,$5,$6,'Kim','Ng','Kim Ng','active',true)`, [MIA, LEO, ZOE, KIM, T, B]);
  await q(`update technicians set archived_at = now() where id = $1`, [KIM]);
  await q(`insert into pos_tech_queue_tickets (id, tenant_id, branch_id, customer_name, requested_services, status, assigned_technician_id, assigned_at) values
    ($1,$4,$5,'Offer One','[]'::jsonb,'assigned',$6, now()), ($2,$4,$5,'Offer Two','[]'::jsonb,'waiting_for_acceptance',$6, now()), ($3,$4,$5,'Started','[]'::jsonb,'in_service',$6, now())`, [T1, T2, T3, T, B, MIA]);
});

describe('tech-queue offer writer (accept / decline) on the real schema', () => {
  it('accept flips only a pending offer and bumps the version; a stale expectedVersion is a no-op; a started ticket is never re-accepted', async () => {
    const v0 = Number((await ticket(T1)).version);
    expect((await acceptOffer(db, { tenantId: T, ticketId: T1, expectedVersion: v0 + 7 })).accepted).toBe(false);   // stale
    expect((await ticket(T1)).status).toBe('assigned');
    expect((await acceptOffer(db, { tenantId: T, ticketId: T1, expectedVersion: v0 })).accepted).toBe(true);
    const a = await ticket(T1); expect(a.status).toBe('accepted'); expect(Number(a.version)).toBe(v0 + 1);
    expect((await acceptOffer(db, { tenantId: T, ticketId: T1 })).accepted).toBe(false);                           // no longer pending
    expect((await acceptOffer(db, { tenantId: T, ticketId: T3 })).accepted).toBe(false);                           // in_service is not an offer
    expect((await acceptOffer(db, { tenantId: 'b1c00000-0000-4000-8000-0000000000ff', ticketId: T2 })).accepted).toBe(false);   // other tenant
  });
  it('decline is status-guarded, keeps the reason on the notes, bumps the version; the POS repository routes through it', async () => {
    const repo = new KyselyTechQueueRepository(db);
    const v0 = Number((await ticket(T2)).version);
    expect(await repo.decline(ctx, T2, 'Double-booked with a walk-in', v0 + 1)).toBe(false);   // stale → no write
    expect((await ticket(T2)).status).toBe('waiting_for_acceptance');
    expect(await repo.decline(ctx, T2, 'Double-booked with a walk-in', v0)).toBe(true);
    const d = await ticket(T2);
    expect(d.status).toBe('declined'); expect(Number(d.version)).toBe(v0 + 1); expect(String(d.notes)).toContain('(declined) Double-booked with a walk-in');
    expect((await declineOffer(db, { tenantId: T, ticketId: T2, reason: 'again' })).declined).toBe(false);   // not pending any more
    expect((await declineOffer(db, { tenantId: T, ticketId: T3, reason: 'x' })).declined).toBe(false);       // never a started ticket
    expect((await ticket(T3)).status).toBe('in_service');
  });
});

describe('live schedule "book this open slot" through the shared slot guard', () => {
  it('the second booking of the same slot is a typed conflict and leaves exactly one row', async () => {
    const repo = new KyselyLiveScheduleRepository(db);
    const today = await repo.today(ctx);
    const slot = `${MIA}:${10 * 60}`;   // 10:00, the default slot length
    const first = await repo.bookOpenSlot(ctx, slot, { customerName: 'First' });
    expect(first?.appointmentId).toBeTruthy();
    await expect(repo.bookOpenSlot(ctx, slot, { customerName: 'Second' })).rejects.toBeInstanceOf(AppointmentSlotConflict);
    const n = (await q(`select count(*)::int as n from pos_tech_appointments where tenant_id = $1 and technician_id = $2 and appt_date = $3 and status not in ('cancelled','no_show','completed')`, [T, MIA, today])).rows[0].n;
    expect(n).toBe(1);
  });
});

describe('queue roster: employment is a hard gate', () => {
  it('suspended / inactive / archived technicians are not in the assignable roster; the active one is', async () => {
    const ids = (await new KyselyQueueRepository(db).technicians(ctx)).map((t) => t.technicianId);
    expect(ids).toContain(MIA);
    expect(ids).not.toContain(LEO); expect(ids).not.toContain(ZOE); expect(ids).not.toContain(KIM);
  });
});

// Resume run (merge Oct 12 2026): the live board on WF's Technician Profile tables + eligibility before "book this open slot".
// A FIXED clock (2031-03-03 is a Monday, 10:00 in New York) — nothing depends on today's date.
describe('live schedule on the workforce tables (579 state, 582 time off) + eligibility on book-open-slot', () => {
  const ROY = 'b1c00000-0000-4000-8000-0000000000a5';
  const DAY = '2031-03-03';
  const fixed = () => { const r = new KyselyLiveScheduleRepository(db); r.now = () => Date.parse('2031-03-03T15:00:00.000Z'); return r; };
  const lctx: any = { ...ctx, permissions: ['pos.technicians.view', 'pos.booking.create'] };
  beforeAll(async () => {
    await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status, is_active) values ($1,$2,$3,'Roy','Lam','Roy Lam','active',true)`, [ROY, T, B]);
    for (const id of [MIA, ROY]) await q(`insert into technician_schedules (tenant_id, branch_id, technician_id, day_of_week, start_time, end_time, is_working) values ($1,$2,$3,1,'09:00','18:00',true)`, [T, B, id]);
    await q(`insert into technician_time_off (tenant_id, branch_id, technician_id, starts_at, ends_at, status, kind) values ($1,null,$2,'2031-03-03T05:00:00Z','2031-03-04T05:00:00Z','approved','VACATION')`, [T, ROY]);
    await q(`insert into technician_workforce_state (tenant_id, branch_id, technician_id, employment_status, clock_status, shift_status, queue_status, service_state) values ($1,$2,$3,'active','CLOCKED_IN','ON_SHIFT','SERVING','SERVING')
             on conflict (tenant_id, technician_id) do update set queue_status = 'SERVING', service_state = 'SERVING', clock_status = 'CLOCKED_IN'`, [T, B, MIA]);
  });
  it('the board reads the ONE workforce state (SERVING → in service) and APPROVED time off removes the day\'s shift', async () => {
    const board = await new LiveTechnicianScheduleService(fixed()).board(lctx, { date: DAY });
    const col = (id: string) => board.technicians.find((t) => t.technicianId === id)!;
    expect(col(MIA).status).toBe('in_service');
    expect(col(MIA).shift?.startTime).toBe('09:00');
    expect(col(ROY).shift).toBeUndefined();
    expect(col(ROY).status).toBe('off_shift');
  });
  it('book-open-slot asks the eligibility engine: time off / outside the shift are 409, a free slot books', async () => {
    const eligibility = new TechnicianEligibilityService({ reader: new KyselyEligibilityReader(db), availability: new KyselyAvailabilityPort(db) });
    const svc = new LiveTechnicianScheduleService(fixed(), null, eligibility);
    await expect(svc.bookOpenSlot(lctx, `${ROY}:${10 * 60}`, { customerName: 'On leave' })).rejects.toBeInstanceOf(LsConflict);   // approved time off
    await expect(svc.bookOpenSlot(lctx, `${MIA}:${7 * 60}`, { customerName: 'Too early' })).rejects.toBeInstanceOf(LsConflict);   // before her shift
    const ok = await svc.bookOpenSlot(lctx, `${MIA}:${15 * 60}`, { customerName: 'Fits' });
    expect(ok.appointmentId).toBeTruthy();
    expect((await q(`select appt_date::text as d, start_time::text as s from pos_tech_appointments where id = $1`, [ok.appointmentId])).rows[0]).toMatchObject({ d: DAY, s: expect.stringMatching(/^15:00/) });
    const refused = await q(`select count(*)::int as n from pos_tech_appointments where tenant_id = $1 and appt_date = $2 and customer_name in ('On leave','Too early')`, [T, DAY]);
    expect(refused.rows[0].n).toBe(0);
  });
});
