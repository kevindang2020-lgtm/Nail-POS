// time-off.pgtest.vitest.spec.ts — the time-off request workflow (528 + 582) and the eligibility AvailabilityPort on the REAL
// schema (PGlite, every migration). Merge Oct 12 2026 (the other chat's time-off.pgtest, adapted to our vocabulary):
//   • a technician requests for HERSELF (resolved from the session), status pending, audited, one outbox event;
//   • a manager decides exactly once (compare-and-set through TECHNICIAN_TIME_OFF → 409 already_decided);
//   • only approved rows make the technician unavailable (KyselyAvailabilityPort → TIME_OFF), rejected / pending never;
//   • a technician withdraws only her own PENDING request (→ cancelled, the row is kept);
//   • tenants are isolated. Fixed instants (2031) — nothing depends on today's date.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { clearBranchTimeZoneCache } from '@aipowersalon/database';
import { TechnicianTimeOffService, TimeOffError } from './technician-time-off.service';
import { KyselyAvailabilityPort } from '../availability/availability-port.adapter';
import { OutboxWriter, DOMAIN_EVENTS } from '@aipowersalon/events';

const TA = 'f0c00000-0000-4000-8000-000000000001', BA = 'f0c00000-0000-4000-8000-000000000002';
const TB = 'f0c00000-0000-4000-8000-000000000011', BB = 'f0c00000-0000-4000-8000-000000000012';
const ANA = 'f0c00000-0000-4000-8000-0000000000a1', ANA_USER = 'f0c00000-0000-4000-8000-0000000000b1', OLI = 'f0c00000-0000-4000-8000-0000000000a2';
const MGR = 'f0c00000-0000-4000-8000-0000000000c1', MGR_B = 'f0c00000-0000-4000-8000-0000000000c2';
let pg: any; let db: any; let svc: TechnicianTimeOffService; const audits: any[] = [];
/** the domain events written for one time-off row (outbox, same transaction as the row) */
const events = async (id: string) => (await q(`select event_type, payload_json as payload from outbox_events where aggregate_type = 'technician_time_off' and aggregate_id = $1 order by occurred_at, id`, [id])).map((r: any) => ({ type: r.event_type, ...(typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload) }));
const q = async (s: string, p: unknown[] = []) => (await pg.query(s, p)).rows as any[];
const techCtx = { tenantId: TA, branchId: BA, userId: ANA_USER, role: 'TECHNICIAN' };
const mgrCtx = { tenantId: TA, branchId: BA, userId: MGR, role: 'OWNER' };
const mgrB = { tenantId: TB, branchId: BB, userId: MGR_B, role: 'OWNER' };

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg); clearBranchTimeZoneCache();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'TO A LLC','TO A','to-a','TOA001','active'), ($2,'TO B LLC','TO B','to-b','TOB001','active')`, [TA, TB]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York'), ($3,$4,'Main','active','America/New_York')`, [BA, TA, BB, TB]);
  await q(`insert into users (id, tenant_id, branch_id, full_name, email, status, role, mfa_enabled, must_change_password) values ($1,$2,$3,'Ana Tech','ana@to.test','active','TECHNICIAN',false,false)`, [ANA_USER, TA, BA]);
  await q(`insert into technicians (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, is_active, status) values ($1,$2,$3,$4,'Ana','A','Ana A',true,'active'), ($5,$2,$3,null,'Oli','O','Oli O',true,'active')`, [ANA, TA, BA, ANA_USER, OLI]);
  // Ana works every day 08:00–20:00 (2031-03-03 is a Monday)
  for (let dow = 0; dow < 7; dow++) await q(`insert into technician_schedules (tenant_id, branch_id, technician_id, day_of_week, start_time, end_time, is_working) values ($1,$2,$3,$4,'08:00','20:00',true)`, [TA, BA, ANA, dow]);
  const audit = { record: async (c: any, i: any) => { audits.push({ c, i }); return null; } } as any;
  svc = new TechnicianTimeOffService(db, new OutboxWriter(), audit);
}, 240_000);

const avail = (dateIso: string, startTime = '15:00') => new KyselyAvailabilityPort(db).isTechnicianAvailableAt({ tenantId: TA, branchId: BA, technicianId: ANA, dateIso, startTime, durationMin: 30 });

describe('technician request → manager decision', () => {
  let reqId: string;
  it('a technician requests time off for HERSELF (from the session): pending, audited, emitted; availability untouched', async () => {
    const row = await svc.requestMine(techCtx, { startsAt: '2031-03-03T05:00:00.000Z', endsAt: '2031-03-05T05:00:00.000Z', kind: 'vacation', reason: 'Family trip' });
    reqId = row.id;
    expect(row).toMatchObject({ technicianId: ANA, status: 'pending', kind: 'VACATION', reason: 'Family trip', requestedBy: ANA_USER });
    expect(audits.some((a) => a.i.action === 'technician_time_off_requested' && a.i.resourceId === reqId)).toBe(true);
    expect(await events(reqId)).toEqual([{ type: DOMAIN_EVENTS.TECHNICIAN_TIME_OFF_CHANGED, technicianId: ANA, timeOffId: reqId, status: 'pending', action: 'requested' }]);
    expect((await svc.listMine(techCtx)).map((r) => r.id)).toEqual([reqId]);
    expect(await avail('2031-03-03')).toEqual({ available: true });   // pending never removes availability
    expect((await svc.listPending(mgrCtx)).map((r) => r.id)).toEqual([reqId]);
  });
  it('invalid ranges / kinds / statuses are refused; a non-technician session cannot request', async () => {
    await expect(svc.requestMine(techCtx, { startsAt: '2031-03-05T00:00:00Z', endsAt: '2031-03-03T00:00:00Z' })).rejects.toMatchObject({ code: 'invalid_range' });
    await expect(svc.requestMine(techCtx, { startsAt: '2031-03-01T00:00:00Z', endsAt: '2031-09-01T00:00:00Z' })).rejects.toMatchObject({ code: 'invalid_range' });   // > 120 days
    await expect(svc.requestMine(techCtx, { startsAt: '2031-03-01T00:00:00Z', endsAt: '2031-03-02T00:00:00Z', kind: 'holiday' })).rejects.toBeInstanceOf(TimeOffError);
    await expect(svc.listMine(techCtx, { status: 'REQUESTED' })).rejects.toBeInstanceOf(TimeOffError);
    await expect(svc.requestMine(mgrCtx, { startsAt: '2031-03-01T00:00:00Z', endsAt: '2031-03-02T00:00:00Z' })).rejects.toMatchObject({ code: 'not_technician' });
  });
  it('a manager approves ONCE: the second decision is 409 already_decided; the approval is audited and emitted', async () => {
    const ok = await svc.decide(mgrCtx, ANA, reqId, 'APPROVED', 'Enjoy');
    expect(ok).toMatchObject({ status: 'approved', approvedBy: MGR, decisionNote: 'Enjoy' });
    await expect(svc.decide(mgrCtx, ANA, reqId, 'rejected')).rejects.toMatchObject({ code: 'already_decided', status: 409 });
    expect(audits.filter((a) => a.i.action === 'technician_time_off_approved' && a.i.resourceId === reqId)).toHaveLength(1);
    expect((await events(reqId)).map((e) => `${e.action}:${e.status}`)).toEqual(['requested:pending', 'approved:approved']);   // the refused second decision wrote NO event
    expect(await svc.listPending(mgrCtx)).toEqual([]);
  });
  it('APPROVED time off makes the technician unavailable (eligibility AvailabilityPort → TIME_OFF) in the window only', async () => {
    expect(await avail('2031-03-04')).toEqual({ available: false, reason: 'TIME_OFF' });
    expect(await avail('2031-03-10')).toEqual({ available: true });
    expect(await avail('2031-03-10', '07:00')).toEqual({ available: false, reason: 'OFF_SCHEDULE' });   // before her shift
  });
  it('a decision for the wrong technician id is 404 (the request is matched to the path technician)', async () => {
    const r = await svc.requestMine(techCtx, { startsAt: '2031-04-01T12:00:00Z', endsAt: '2031-04-02T12:00:00Z' });
    await expect(svc.decide(mgrCtx, OLI, r.id, 'approved')).rejects.toMatchObject({ code: 'not_found' });
    await svc.decide(mgrCtx, ANA, r.id, 'rejected', 'Short-staffed');
    expect(await avail('2031-04-01', '15:00')).toEqual({ available: true });   // rejected never removes availability
  });
  it('a technician withdraws only her OWN pending request (kept as cancelled); a decided one cannot be withdrawn', async () => {
    const pending = await svc.requestMine(techCtx, { startsAt: '2031-05-01T12:00:00Z', endsAt: '2031-05-02T12:00:00Z', kind: 'SICK' });
    await expect(svc.cancelMine(techCtx, reqId)).rejects.toMatchObject({ code: 'not_found' });    // approved → not withdrawable
    expect(await svc.cancelMine(techCtx, pending.id)).toEqual({ ok: true });
    expect((await q(`select status from technician_time_off where id = $1`, [pending.id]))[0].status).toBe('cancelled');
    await expect(svc.decide(mgrCtx, ANA, pending.id, 'approved')).rejects.toMatchObject({ code: 'already_decided' });
  });
});

describe('manager-entered time off + isolation', () => {
  it('a manager enters approved time off directly (approver = manager, this branch)', async () => {
    const row = await svc.createFor(mgrCtx, OLI, { startsAt: '2031-03-03T12:00:00Z', endsAt: '2031-03-04T12:00:00Z', kind: 'UNAVAILABLE', reason: 'Training' });
    expect(row).toMatchObject({ status: 'approved', approvedBy: MGR, technicianId: OLI, branchId: BA });
  });
  it('tenant B cannot list, create or decide for tenant A technicians', async () => {
    await expect(svc.listFor(mgrB, ANA)).rejects.toMatchObject({ code: 'not_found' });
    await expect(svc.createFor(mgrB, ANA, { startsAt: '2031-03-03T12:00:00Z', endsAt: '2031-03-04T12:00:00Z' })).rejects.toMatchObject({ code: 'not_found' });
    const anyA = (await svc.listFor(mgrCtx, ANA))[0];
    await expect(svc.decide(mgrB, ANA, anyA.id, 'approved')).rejects.toMatchObject({ code: 'not_found' });
    expect(await svc.listPending(mgrB)).toEqual([]);
  });
});
