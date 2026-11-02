// branch-transfer-schedule.pgtest.vitest.spec.ts — found by the 200-technician M5 pilot (Oct 24 2026), real schema
// (PGlite). A technician moved to another location of the SAME salon (Super Admin transfer: request → approve):
//   • her weekly schedule follows her (it was left at the old location: the new board showed no hours for her), and
//   • saving her week at the new location works — it died on uq_technician_schedules_tenant_tech_dow (a 500), because the
//     writer deleted only the new location's rows and the old location's rows still held every weekday;
//   • what happened at the old location stays there (her appointment keeps its branch).
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyTechniciansRepository } from '@aipowersalon/workforce';
import { SuperAdminStaffKyselyRepository } from './super-admin-staff.kysely.repository';

const T = 'b7a00000-0000-4000-8000-0000000000a1', MAIN = 'b7a00000-0000-4000-8000-0000000000b1', ANNEX = 'b7a00000-0000-4000-8000-0000000000b2';
const USER = 'b7a00000-0000-4000-8000-0000000000c1', TECH = 'b7a00000-0000-4000-8000-0000000000d1', SA = 'b7a00000-0000-4000-8000-0000000000c9';
let pg: any; let db: any;
const q = (s: string, p: unknown[] = []) => pg.query(s, p).then((r: any) => r.rows as any[]);
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const week = (end: string) => Object.fromEntries(DAYS.map((d) => [d, { isWorking: true, startTime: '09:00', endTime: end }]));

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Two LLC','Two','two-m5','TWOM5','active')`, [T]);
  await q(`insert into branches (id, tenant_id, name, status) values ($1,$3,'Main','active'), ($2,$3,'Annex','active')`, [MAIN, ANNEX, T]);
  await q(`insert into users (id, tenant_id, branch_id, role, status, full_name) values ($1,$2,$3,'TECHNICIAN','active','Ivy Move')`, [USER, T, MAIN]);
  await q(`insert into technicians (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, is_active) values ($1,$2,$3,$4,'Ivy','Move','Ivy Move',true)`, [TECH, T, MAIN, USER]);
  await q(`insert into user_branch_access (tenant_id, branch_id, user_id, role, access_level) values ($1,$2,$3,'TECHNICIAN','staff')`, [T, MAIN, USER]);
  // her week at Main (saved through the real writer) and one appointment there
  const repo = new KyselyTechniciansRepository(db);
  await repo.setSchedule({ tenantId: T, branchId: MAIN, userId: SA, role: 'OWNER', permissions: [] } as any, TECH, { weekly: week('19:00') } as any);
  await q(`insert into pos_tech_appointments (tenant_id, branch_id, technician_id, customer_name, source, services, appt_date, start_time, end_time, duration_minutes, status)
           values ($1,$2,$3,'Old Guest','manual','[]','2026-11-02','10:00','10:45',45,'booked')`, [T, MAIN, TECH]);
}, 120_000);

describe('a technician transferred within the salon', () => {
  it('approve: the roster row, login grant AND weekly schedule move to the annex; her old appointment stays at Main', async () => {
    const repo = new SuperAdminStaffKyselyRepository(db);
    const { id } = await repo.createWorkerTransferRequest({ tenantId: T, userId: USER, fromBranchId: MAIN, toBranchId: ANNEX, reason: 'annex opening', requestedBy: SA });
    const out = await repo.decideWorkerTransfer(id, 'approve', 'ok', SA);
    expect(out.status).toBe('approved');
    expect((await q(`select branch_id from technicians where id = $1`, [TECH]))[0].branch_id).toBe(ANNEX);
    const sched = await q(`select distinct branch_id from technician_schedules where technician_id = $1`, [TECH]);
    expect(sched.map((r) => r.branch_id)).toEqual([ANNEX]);
    expect((await q(`select count(*)::int n from technician_schedules where technician_id = $1`, [TECH]))[0].n).toBe(7);
    expect((await q(`select branch_id from pos_tech_appointments where technician_id = $1`, [TECH]))[0].branch_id).toBe(MAIN);
  });
  it('the annex saves her week (no unique-key 500), and the annex reads it back', async () => {
    const repo = new KyselyTechniciansRepository(db);
    const ctx = { tenantId: T, branchId: ANNEX, userId: SA, role: 'OWNER', permissions: [] } as any;
    const saved = await repo.setSchedule(ctx, TECH, { weekly: week('17:00') } as any);
    expect(saved?.weekly.monday).toMatchObject({ isWorking: true });
    expect(String(saved?.weekly.monday.endTime).slice(0, 5)).toBe('17:00');
    expect((await q(`select count(*)::int n, min(end_time)::text e from technician_schedules where technician_id = $1`, [TECH]))[0]).toMatchObject({ n: 7 });
  });
  it('a week whose rows were left at another location (written before this fix) is still replaced, not duplicated', async () => {
    await q(`update technician_schedules set branch_id = $2 where technician_id = $1`, [TECH, MAIN]);   // the old, stranded state
    const repo = new KyselyTechniciansRepository(db);
    const ctx = { tenantId: T, branchId: ANNEX, userId: SA, role: 'OWNER', permissions: [] } as any;
    await repo.setSchedule(ctx, TECH, { weekly: week('18:00') } as any);
    const rows = await q(`select branch_id, end_time::text e from technician_schedules where technician_id = $1`, [TECH]);
    expect(rows).toHaveLength(7);
    expect(new Set(rows.map((r) => r.branch_id))).toEqual(new Set([ANNEX]));
  });
});
