// tech-utilization.pgtest — Nov 3 audit: when the day's bookings cannot be read, utilization is unknown (null), never "0 %".
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { loadTechUtilization } from './tech-utilization';

const T = 'f1a00000-0000-4000-8000-000000000001', B = 'f1a00000-0000-4000-8000-000000000002', TE = 'f1a00000-0000-4000-8000-000000000003';
let pg: any; let db: any;
beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.query(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'U','U','util-t','UTL001','active')`, [T]);
  await pg.query(`insert into branches (id, tenant_id, name, timezone) values ($1,$2,'Main','America/New_York')`, [B, T]);
  await pg.query(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'Ana','Le','Ana Le')`, [TE, T, B]);
  await pg.query(`insert into technician_shifts (tenant_id, branch_id, technician_id, shift_date, start_time, end_time) values ($1,$2,$3,'2026-11-03','2026-11-03T14:00:00Z','2026-11-03T22:00:00Z')`, [T, B, TE]);
}, 240_000);

describe('loadTechUtilization', () => {
  it('a shift and no bookings is 0 %; a failed bookings read is unknown (null), not 0 %', async () => {
    expect((await loadTechUtilization(db, { tenantId: T, branchId: B }, '2026-11-03')).get(TE)).toBe(0);
    await pg.query(`alter table pos_tech_appointments rename to pos_tech_appointments_off`);
    try { expect((await loadTechUtilization(db, { tenantId: T, branchId: B }, '2026-11-03')).get(TE)).toBeNull(); }
    finally { await pg.query(`alter table pos_tech_appointments_off rename to pos_tech_appointments`); }
  });
});
