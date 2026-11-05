// booking-checkin-queries.pgtest — executes the Super Admin Booking & Check-In Monitor queries against the
// real migrated schema.
//
// #2 by size in the silent-SQL report: 80 queries, ALL of them raw `sql` templates routed through two
// swallowing helpers at the top of the repository —
//   rows() → returns []   on any error
//   one()  → returns the DEFAULT ('0', '0', null…) on any error
// So a wrong column name does not raise: the monitor reports **no bookings, no check-ins, an empty funnel**.
// That is the same answer a genuinely quiet period gives, which is what makes it dangerous.
//
// Every assertion below is "NOT the empty/zero default", because that default is the failure mode.
import { describe, it, expect, beforeAll } from 'vitest';
import { SuperAdminBookingCheckinKyselyRepository } from './super-admin-booking-checkin.kysely.repository';
// Shared, cached migrated schema — see @aipowersalon/testing (packages/testing/src/pgtest-schema.mjs) (built once, reused by every pgtest).
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

const T = '66666666-6666-6666-6666-666666666666';
const B = '77777777-7777-7777-7777-777777777777';
const TECH = '88888888-8888-8888-8888-888888888888';
const DEV = '99999999-9999-9999-9999-999999999999';
const range = { start: new Date(Date.now() - 86_400_000), end: new Date(Date.now() + 86_400_000) };
const scope = { tenantId: T };
let repo: SuperAdminBookingCheckinKyselyRepository;

beforeAll(async () => {
  const pg = await migratedPglite();
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status)
    VALUES ('${T}', 'Monitor Salon LLC', 'Monitor Salon', 'monitor', 'MONITOR', 'active') ON CONFLICT DO NOTHING;
  `);
  await pg.exec(`
    INSERT INTO branches (id, tenant_id, name, status)
    VALUES ('${B}', '${T}', 'Main', 'active') ON CONFLICT DO NOTHING;
  `).catch(() => undefined);
  repo = new SuperAdminBookingCheckinKyselyRepository(kyselyFor(pg) as never);
  // Seed the facts the monitor measures. Column names and CHECK values come from db/migrations — that is the
  // point of the test. A first draft asserted only Array.isArray(), which PASSES when the query is broken,
  // because a broken query returns []. Every assertion below needs real rows to come back.
  await pg.exec(`
    INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name)
    VALUES ('${TECH}', '${T}', '${B}', 'Mia', 'Chen', 'Mia Chen') ON CONFLICT DO NOTHING;
  `);
  await pg.exec(`
    INSERT INTO pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_name, source, appt_date, start_time, end_time, status, created_at)
    VALUES (gen_random_uuid(), '${T}', '${B}', '${TECH}', 'Ada Rowe', 'online', current_date, '10:00', '11:00', 'booked', now());
  `);
  await pg.exec(`
    INSERT INTO go_checkin_devices (id, tenant_id, branch_id, device_name, device_type, checkin_slug, status)
    VALUES ('${DEV}', '${T}', '${B}', 'Front Kiosk', 'kiosk', 'front-kiosk', 'active') ON CONFLICT DO NOTHING;
  `);
  await pg.exec(`
    INSERT INTO go_checkin_sessions (id, tenant_id, branch_id, device_id, session_token_hash, status, started_at, completed_at)
    VALUES (gen_random_uuid(), '${T}', '${B}', '${DEV}', 'abc123', 'completed', now() - interval '5 minutes', now());
  `);
  await pg.exec(`
    INSERT INTO pos_queue_items (id, tenant_id, branch_id, customer_name, status, checked_in_at)
    VALUES (gen_random_uuid(), '${T}', '${B}', 'Walk-in', 'waiting', now());
  `);
});

describe('booking queries run against the real schema', () => {
  it('a seeded booking comes BACK, grouped by its source', async () => {
    const r = await repo.bookingsBySource(range, scope, null);
    expect(r.length).toBeGreaterThan(0);
    expect(r.map((x) => x.source)).toContain('online');
  });

  it('the status funnel counts that booking', async () => {
    const r = await repo.statusCounts(range, scope, null);
    expect(r.length).toBeGreaterThan(0);
    expect(Number(r[0].count)).toBeGreaterThan(0);
  });

  it('another tenant sees none of it — the tenant scope is real', async () => {
    const r = await repo.bookingsBySource(range, { tenantId: '00000000-0000-0000-0000-000000000000' }, null);
    expect(r).toHaveLength(0);
  });
});

describe('check-in and queue aggregates run against the real schema', () => {
  it('a completed kiosk session is COUNTED — 0 here is what a broken query returns', async () => {
    const s = await repo.checkinStats(range, scope, null);
    expect(Number(s.started)).toBeGreaterThan(0);
    expect(Number(s.completed)).toBeGreaterThan(0);
  });

  it('the average completion time is computed, not null — the epoch math actually ran', async () => {
    const s = await repo.checkinStats(range, scope, null);
    expect(s.avg_seconds).not.toBeNull();
    expect(Number(s.avg_seconds)).toBeGreaterThan(0);
  });

  it('a waiting guest shows in the queue snapshot', async () => {
    const q = await repo.queueSnapshot(range, scope, null);
    expect(Number(q.waiting)).toBeGreaterThan(0);
    expect(Number(q.entered)).toBeGreaterThan(0);
  });
});
