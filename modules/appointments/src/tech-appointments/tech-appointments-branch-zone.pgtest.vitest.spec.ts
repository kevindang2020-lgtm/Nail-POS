// tech-appointments-branch-zone.pgtest.vitest.spec.ts — BUILD_PLAN Phase 6, audit bug 2: the AI's appointment
// protection never fired. The tech-appointments board read "today" as the server's UTC date and handed out only a time
// of day ('HH:MM'), which the AI parsed as an instant (NaN). Now the day is the BRANCH's and every item carries `date`
// + `startAt` (appt_date + 'HH:MM' on the branch's wall clock).
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyTechApptRepository } from './tech-appointments.kysely.repository';
import { TechAppointmentsService } from './tech-appointments.service';

const T = 'a6200000-0000-4000-8000-000000000001';
const B = 'a6200000-0000-4000-8000-000000000002';
const TECH = 'a6200000-0000-4000-8000-000000000003';
const ctx = { tenantId: T, branchId: B, userId: 'a6200000-0000-4000-8000-000000000009', role: 'OWNER', permissions: ['pos.tech_appointments.view'] } as any;
let repo: KyselyTechApptRepository;

beforeAll(async () => {
  const pg = await migratedPglite();
  await pg.exec(`
    INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'Zone Salon', 'Zone Salon', 'zone-salon-p6', 'ZONEP6', 'active');
    INSERT INTO branches (id, tenant_id, name, status) VALUES ('${B}', '${T}', 'LA', 'active');
    UPDATE branches SET timezone = 'America/Los_Angeles' WHERE id = '${B}';
    INSERT INTO technicians (id, tenant_id, branch_id, first_name, last_name, full_name, status) VALUES ('${TECH}', '${T}', '${B}', 'Ava', 'A', 'Ava A', 'active');
    INSERT INTO pos_tech_appointments (tenant_id, branch_id, technician_id, customer_name, appt_date, start_time, end_time, status) VALUES
      ('${T}', '${B}', '${TECH}', 'Evening guest', '2026-10-07', '18:30', '19:15', 'confirmed'),
      ('${T}', '${B}', '${TECH}', 'Tomorrow guest', '2026-10-08', '09:00', '09:45', 'confirmed');
  `);
  repo = new KyselyTechApptRepository(kyselyFor(pg) as never);
  repo.now = () => Date.parse('2026-10-08T02:00:00Z');   // 7 pm on Oct 7 in Los Angeles — already Oct 8 in UTC
}, 120000);

describe('tech appointments in the branch zone (bug 2)', () => {
  it("today is the BRANCH's day, not the server's UTC date", async () => {
    expect(repo.today()).toBe('2026-10-08');            // the legacy UTC answer — what broke the engine
    expect(await repo.todayFor(ctx)).toBe('2026-10-07');
  });
  it("the default board day is the branch's, and each item carries date + startAt resolved in the branch's zone", async () => {
    const items = await new TechAppointmentsService(repo).appointments(ctx, {});
    expect(items.map((a) => a.customerName)).toEqual(['Evening guest']);
    expect(items[0]).toMatchObject({ date: '2026-10-07', startTime: '18:30', startAt: '2026-10-08T01:30:00.000Z' });
    expect(Date.parse(items[0].startAt!) - repo.now()).toBe(-30 * 60000);   // started 30 minutes ago — never NaN
  });
  it('an explicit date still works and resolves the same way', async () => {
    const st = await repo.query(ctx, { date: '2026-10-08' });
    expect(st.appointments[0]).toMatchObject({ customerName: 'Tomorrow guest', startAt: '2026-10-08T16:00:00.000Z' });
  });
});
