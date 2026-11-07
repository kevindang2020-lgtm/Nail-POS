// tech-metrics.pgtest — F5 §73 (Nov 6 2026): clocked / break / service / ready minutes and turn units for Today / Week / Month,
// salon-local, each from its own table; an open shift or break counts up to now; another technician and another salon do not count.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { clearBranchTimeZoneCache } from '@aipowersalon/database';
import { loadTechMetrics } from './tech-metrics';

const T = 'a7a70000-0000-4000-8000-000000000001', B = 'a7a70000-0000-4000-8000-000000000002', TECH = 'a7a70000-0000-4000-8000-000000000003', OTHER = 'a7a70000-0000-4000-8000-000000000004';
const C = 'a7a70000-0000-4000-8000-000000000005', TK = 'a7a70000-0000-4000-8000-000000000006';
// Friday Nov 6 2026, 16:00 in New York (21:00 UTC)
const NOW = Date.parse('2026-11-06T21:00:00Z');
let db: any;
beforeAll(async () => {
  const pg = await migratedPglite(); clearBranchTimeZoneCache(); db = kyselyFor(pg);
  const q = (s: string, p: unknown[] = []) => pg.query(s, p);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'M','M','tm-a','TMA001','active')`, [T]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York')`, [B, T]);
  for (const [id, n] of [[TECH, 'Mia'], [OTHER, 'Oli']]) await q(`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status) values ($1,$2,$3,$4,'X',$4,'active')`, [id, T, B, n]);
  await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values ($1,$2,$3,'G','G','G G')`, [C, T, B]);
  // today: on the clock 09:00 ET and still on (7 h by 16:00); a 30-min break; yesterday 8 h (counts in week + month, not today)
  await q(`insert into technician_shifts (tenant_id, branch_id, technician_id, shift_date, start_time, end_time, status) values
    ($1,$2,$3,'2026-11-06','2026-11-06T14:00:00Z',null,'open'), ($1,$2,$3,'2026-11-05','2026-11-05T14:00:00Z','2026-11-05T22:00:00Z','closed'),
    ($1,$2,$4,'2026-11-06','2026-11-06T14:00:00Z',null,'open')`, [T, B, TECH, OTHER]);
  await q(`insert into technician_breaks (tenant_id, branch_id, technician_id, kind, started_at, ended_at) values ($1,$2,$3,'lunch','2026-11-06T17:00:00Z','2026-11-06T17:30:00Z')`, [T, B, TECH]);
  // one 45-min service done today
  await q(`insert into tickets (id, tenant_id, branch_id, customer_id, status, service_done_at) values ($1,$2,$3,$4,'service_done','2026-11-06T16:00:00Z')`, [TK, T, B, C]);
  await q(`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, technician_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, status)
    values ($1,$2,$3,$4,'00000000-0000-0000-0000-000000000001','Gel',4500,45,4500,'completed')`, [T, B, TK, TECH]);
  // two turns today, one yesterday
  await q(`insert into technician_turn_events (tenant_id, branch_id, business_date, sequence_number, technician_id, event_type, turn_units, turn_units_delta, occurred_at) values
    ($1,$2,'2026-11-06',1,$3,'TURN_CREDIT',1,1,now()), ($1,$2,'2026-11-06',2,$3,'TURN_CREDIT',1,1,now()), ($1,$2,'2026-11-05',3,$3,'TURN_CREDIT',1,1,now())`, [T, B, TECH]);
}, 120_000);

describe('F5 §73 technician metrics', () => {
  it('today: 7 h on the clock (open shift counts to now), 30 min break, 45 min service, 345 min ready, 2 turns', async () => {
    const m = await loadTechMetrics(db, { tenantId: T, branchId: B }, TECH, 'today', NOW);
    expect(m).toMatchObject({ from: '2026-11-06', to: '2026-11-06', timezone: 'America/New_York', clockedMinutes: 420, breakMinutes: 30, serviceMinutes: 45, readyMinutes: 345, turnUnits: 2, services: 1 });
  });
  it('week and month add yesterday’s 8 h and turn', async () => {
    const w = await loadTechMetrics(db, { tenantId: T, branchId: B }, TECH, 'week', NOW);
    expect(w).toMatchObject({ from: '2026-11-02', clockedMinutes: 900, turnUnits: 3, services: 1 });
    const mo = await loadTechMetrics(db, { tenantId: T, branchId: B }, TECH, 'month', NOW);
    expect(mo).toMatchObject({ from: '2026-11-01', clockedMinutes: 900, turnUnits: 3 });
  });
  it('another technician has only their own clock time; another salon sees nothing', async () => {
    expect(await loadTechMetrics(db, { tenantId: T, branchId: B }, OTHER, 'today', NOW)).toMatchObject({ clockedMinutes: 420, breakMinutes: 0, serviceMinutes: 0, turnUnits: 0, services: 0 });
    expect(await loadTechMetrics(db, { tenantId: 'a7a70000-0000-4000-8000-0000000000ff', branchId: null }, TECH, 'today', NOW)).toMatchObject({ clockedMinutes: 0, turnUnits: 0 });
  });
});
