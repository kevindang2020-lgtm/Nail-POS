// workforce-status.pgtest.vitest.spec.ts — the ONE authoritative technician operational state against the REAL schema
// (every migration, via the shared migratedPglite harness): first-touch backfill from legacy rows (the same rule the
// 579 backfill applies), compare-and-set transitions, VERSION_CONFLICT, CLOCK_STATE_CONFLICT, "break → AVAILABLE
// disappears immediately", the technician_statuses compat row and tenant isolation.
// Merged from the Oct 2026 Technician Profile package (their 462 spec), adapted to our harness.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import type { Kysely } from 'kysely';
import { KyselyWorkforceStateStore } from './workforce-status.kysely.repository';
import { WorkforceStatusService } from './workforce-status.service';

const uuid = (p: string, n: string | number) => `${p}${'0'.repeat(8 - p.length)}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TA = uuid('fa', 1), TB = uuid('fa', 2), BA = uuid('fb', 1), BB = uuid('fb', 2);
const T1 = uuid('fc', 1), T2 = uuid('fc', 2), T3 = uuid('fc', 3), TBX = uuid('fd', 1);
const SHIFT_OPEN = uuid('fe', 1);

let pg: any; let db: Kysely<any>; let svc: WorkforceStatusService; const emitted: any[] = [];
const q = (s: string, p: any[] = []) => pg.query(s, p).then((r: any) => r.rows as any[]);

beforeAll(async () => {
  pg = await migratedPglite();
  db = kyselyFor(pg) as any;
  // LEGACY WORLD: two tenants, three technicians, an open punch, DUPLICATED technician_statuses rows (the table has
  // no unique key — 579 only de-duplicates what existed at migration time; a technician touched later still gets the
  // LATEST row picked).
  await pg.query(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code) values ($1,'A','A','wfa','WFA'),($2,'B','B','wfb','WFB')`, [TA, TB]);
  await pg.query(`insert into branches (id, tenant_id, name, status) values ($1,$2,'A-Main','active'),($3,$4,'B-Main','active')`, [BA, TA, BB, TB]);
  await pg.query(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, is_active, status) values
    ($1,$4,$5,'Ana','A','Ana A',true,'active'), ($2,$4,$5,'Ben','B','Ben B',true,'off_shift'), ($3,$4,$5,'Cal','C','Cal C',false,'suspended'), ($6,$7,$8,'Bex','X','Bex X',true,'active')`, [T1, T2, T3, TA, BA, TBX, TB, BB]);
  await pg.query(`insert into technician_shifts (id, tenant_id, branch_id, technician_id, shift_date, start_time, end_time, status) values ($1,$2,$3,$4,'2026-10-09', now() - interval '3 hours', null, 'active')`, [SHIFT_OPEN, TA, BA, T1]);
  await pg.query(`insert into technician_statuses (tenant_id, branch_id, technician_id, status, changed_at) values
    ($1,$2,$3,'available', now() - interval '3 hours'), ($1,$2,$3,'in_service', now() - interval '2 hours'), ($1,$2,$3,'on_break', now() - interval '1 hour'),
    ($1,$2,$4,'available', now() - interval '1 day')`, [TA, BA, T1, T2]);
  const rt = { toTenant: (c: any, e: string, p: any) => emitted.push({ room: c, e, p }), toTechnician: () => {}, toTicket: () => {}, toCustomerDisplay: () => {}, toOwner: () => {} } as any;
  svc = new WorkforceStatusService(new KyselyWorkforceStateStore(db), rt);
}, 240_000);

describe('first-touch backfill from the legacy rows', () => {
  it('builds one workforce row per technician from the open punch + the LATEST legacy status', async () => {
    const ana = await svc.getTechnicianState(TA, T1);
    expect(ana).toMatchObject({ employment: 'active', clock: 'ON_BREAK', shift: 'ON_SHIFT', queue: 'BREAK', service: 'IDLE', openShiftId: SHIFT_OPEN, version: 1 });
    const ben = await svc.getTechnicianState(TA, T2);   // legacy 'available' but NO open punch → clocked out
    expect(ben).toMatchObject({ clock: 'CLOCKED_OUT', shift: 'OFF_SHIFT', queue: 'OFF_SHIFT' });
    const cal = await svc.getTechnicianState(TA, T3);   // suspended → UNAVAILABLE
    expect(cal).toMatchObject({ employment: 'suspended', queue: 'UNAVAILABLE' });
    expect(await q(`select count(*)::int as n from technician_workforce_state`)).toEqual([{ n: 3 }]);
  });
  it('the 579 table has exactly one row per technician (UNIQUE technician_id)', async () => {
    await expect(pg.query(`insert into technician_workforce_state (tenant_id, branch_id, technician_id) values ($1,$2,$3)`, [TA, BA, T1])).rejects.toThrow(/duplicate key|unique/i);
  });
});

describe('transitions are compare-and-set on version', () => {
  it('breakEnd → AVAILABLE; breakStart → AVAILABLE disappears IMMEDIATELY (same call, same row, compat row too)', async () => {
    const back = await svc.breakEnd(TA, T1);
    expect(back).toMatchObject({ clock: 'CLOCKED_IN', queue: 'AVAILABLE', version: 2 });
    expect(await svc.isAssignable(TA, T1)).toBe(true);
    const onBreak = await svc.breakStart(TA, T1);
    expect(onBreak).toMatchObject({ clock: 'ON_BREAK', queue: 'BREAK', version: 3 });
    expect(await svc.isAssignable(TA, T1)).toBe(false);
    expect((await svc.listBranchStates(TA, BA)).filter((s) => s.queue === 'AVAILABLE').map((s) => s.technicianId)).not.toContain(T1);
    // the compat rows (three legacy duplicates) all carry the new value — update-then-insert, tenant-scoped
    expect(await q(`select distinct status from technician_statuses where technician_id = $1`, [T1])).toEqual([{ status: 'on_break' }]);
    expect(await q(`select queue_status, version from technician_workforce_state where technician_id = $1`, [T1])).toEqual([{ queue_status: 'BREAK', version: 3 }]);
  });
  it('an illegal move is CLOCK_STATE_CONFLICT and changes nothing', async () => {
    await expect(svc.breakStart(TA, T1)).rejects.toMatchObject({ code: 'CLOCK_STATE_CONFLICT' });      // already on break
    await expect(svc.clockIn(TA, T1)).rejects.toMatchObject({ code: 'CLOCK_STATE_CONFLICT' });         // already clocked in
    await expect(svc.breakStart(TA, T2)).rejects.toMatchObject({ code: 'CLOCK_STATE_CONFLICT' });      // clocked out
    await expect(svc.clockOut(TA, T2)).rejects.toMatchObject({ code: 'CLOCK_STATE_CONFLICT' });        // clocked out
    expect((await svc.getTechnicianState(TA, T1))!.version).toBe(3);
  });
  it('a pinned stale version is VERSION_CONFLICT; the row is untouched', async () => {
    await expect(svc.breakEnd(TA, T1, { expectedVersion: 1 })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    expect(await svc.getTechnicianState(TA, T1)).toMatchObject({ clock: 'ON_BREAK', version: 3 });
    const ok = await svc.breakEnd(TA, T1, { expectedVersion: 3 });
    expect(ok.version).toBe(4);
  });
  it('two writers on the same version: exactly one CAS wins (the loser re-reads and the rules decide)', async () => {
    // Ben: clocked out. Two clock-ins → the second finds CLOCKED_IN on re-read → CLOCK_STATE_CONFLICT.
    // (PGlite is single-connection, so the two calls are serialised; the CAS itself is proven on real Postgres by
    // the race suites. What this proves is the re-read-and-decide rule.)
    const results = await Promise.allSettled([svc.clockIn(TA, T2, { openShiftId: uuid('fe', 2) }), svc.clockIn(TA, T2, { openShiftId: uuid('fe', 3) })]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect((await svc.getTechnicianState(TA, T2))!).toMatchObject({ clock: 'CLOCKED_IN', queue: 'AVAILABLE', version: 2 });
  });
  it('service lifecycle moves queue ASSIGNED → SERVING → AVAILABLE and clockOut is refused mid-service', async () => {
    const tk = uuid('ff', 1);
    expect((await svc.assigned(TA, T2, tk)).queue).toBe('ASSIGNED');
    expect((await svc.serviceStarted(TA, T2, tk)).queue).toBe('SERVING');
    await expect(svc.clockOut(TA, T2)).rejects.toMatchObject({ code: 'CLOCK_STATE_CONFLICT' });
    expect((await svc.servicePaused(TA, T2)).queue).toBe('ASSIGNED');
    expect((await svc.serviceResumed(TA, T2)).queue).toBe('SERVING');
    expect((await svc.serviceCompleted(TA, T2)).queue).toBe('AVAILABLE');
    expect((await svc.clockOut(TA, T2)).queue).toBe('OFF_SHIFT');
    expect(await q(`select status from technician_statuses where technician_id = $1`, [T2])).toEqual([{ status: 'off_shift' }]);
  });
  it('setEmployment(suspended) flips queue to UNAVAILABLE even while clocked in; reactivation restores', async () => {
    expect((await svc.setEmployment(TA, T1, 'suspended'))!.queue).toBe('UNAVAILABLE');
    expect(await svc.isAssignable(TA, T1)).toBe(false);
    expect((await svc.setEmployment(TA, T1, 'active'))!.queue).toBe('AVAILABLE');
  });
  it('legacyStatusMap answers the old vocabulary for a set of technicians from the one state', async () => {
    expect(await svc.legacyStatusMap(TA, BA, [T1, T2, T3])).toEqual({ [T1]: 'available', [T2]: 'off_shift', [T3]: 'inactive' });
  });
  it('emits technician_status_updated to the branch with the six statuses and NO personal data', async () => {
    const last = emitted.filter((e) => e.e === 'technician_status_updated').pop();
    expect(last.room).toEqual({ tenantId: TA, branchId: BA });
    expect(Object.keys(last.p).sort()).toEqual(['branchId', 'clock', 'employment', 'presence', 'queue', 'service', 'shift', 'technicianId', 'version']);
  });
});

describe('tenant isolation', () => {
  it('tenant B cannot read or move tenant A technicians; branch listing is scoped', async () => {
    expect(await svc.getTechnicianState(TB, T1)).toBeNull();
    await expect(svc.clockOut(TB, T1)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(await svc.getTechnicianState(TB, TBX)).toMatchObject({ queue: 'OFF_SHIFT', clock: 'CLOCKED_OUT' });
    const b = await svc.listBranchStates(TB, BB);
    expect(b.map((s) => s.technicianId)).toEqual([TBX]);
  });
});
