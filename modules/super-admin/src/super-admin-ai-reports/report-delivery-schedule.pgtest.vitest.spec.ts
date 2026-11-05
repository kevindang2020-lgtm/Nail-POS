// report-delivery-schedule.pgtest — executes the report SCHEDULE and DELIVERY reads against the real schema.
//
// Two quiet failure modes, both of which look like nothing is wrong:
//   • a schedule list that silently empties reads as "no reports are scheduled" — nobody receives their
//     report, and nobody is told that anything broke;
//   • delivery counts that silently zero read as "0 failed, 0 bounced", which is the number an operator
//     wants to see. `countsByRun` is six `count(*) filter (where …)` predicates over a CHECK-constrained
//     status column, so each one is an independent chance to match nothing.
import { describe, it, expect, beforeAll } from 'vitest';
import { KyselyReportScheduleRepository } from './report-schedule.kysely.repository';
import { KyselyReportDeliveryRepository } from './report-delivery.kysely.repository';
// Shared, cached migrated schema — see @aipowersalon/testing (packages/testing/src/pgtest-schema.mjs) (built once, reused by every pgtest).
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

const RUN = '11112222-0000-4000-8000-000000000001';
const R1 = '11112222-0000-4000-8000-00000000000a';
const R2 = '11112222-0000-4000-8000-00000000000b';
const R3 = '11112222-0000-4000-8000-00000000000c';
let schedules: KyselyReportScheduleRepository;
let deliveries: KyselyReportDeliveryRepository;

beforeAll(async () => {
  const pg = await migratedPglite();
  const db = kyselyFor(pg) as never;
  schedules = new KyselyReportScheduleRepository(db);
  deliveries = new KyselyReportDeliveryRepository(db);

  await pg.exec(`
    INSERT INTO ai_report_schedules (name, report_key, frequency, scope_type, status, next_run_at)
    VALUES ('Weekly platform digest', 'platform.weekly', 'weekly', 'platform', 'active', now() + interval '1 day');
  `);
  await pg.exec(`
    INSERT INTO ai_report_runs (id, report_reference, report_key, scope_type, date_range_start, date_range_end, idempotency_key)
    VALUES ('${RUN}', 'RPT-2026-001', 'platform.weekly', 'platform', current_date - 7, current_date, 'idem-2026-001');
  `);
  // One row per status the counts query filters on. A single row would leave five of six counts at zero and
  // prove nothing — the same mistake as asserting shape instead of data.
  await pg.exec(`
    INSERT INTO ai_report_deliveries (run_id, recipient_id, channel, status) VALUES
      ('${RUN}', '${R1}', 'email', 'delivered'),
      ('${RUN}', '${R2}', 'email', 'failed'),
      ('${RUN}', '${R3}', 'email', 'excluded');
  `);
});

describe('schedules — an empty list reads as "nothing is scheduled"', () => {
  it('an active schedule is LISTED', async () => {
    const r = await schedules.list(25);
    expect(r.length).toBeGreaterThan(0);
    expect(r.map((s) => s.name)).toContain('Weekly platform digest');
  });

  it('the frequency survives the read — it drives when the report actually runs', async () => {
    const s = (await schedules.list(25)).find((x) => x.name === 'Weekly platform digest')!;
    expect(s.frequency).toBe('weekly');
  });

  it('get() by id returns the schedule, not null', async () => {
    const id = (await schedules.list(25))[0].id;
    expect(await schedules.get(id)).not.toBeNull();
  });

  it('setNextRun writes and the new value comes back — a schedule that never advances re-fires forever', async () => {
    const id = (await schedules.list(25))[0].id;
    await schedules.setNextRun(id, new Date('2027-01-01T06:00:00Z').toISOString());
    const after = await schedules.get(id);
    expect(String((after as never as { nextRunAt?: string }).nextRunAt ?? '')).toContain('2027');
  });
});

describe('delivery counts — "0 failed" is the number an operator wants to see', () => {
  it('a delivered message is counted', async () => {
    expect((await deliveries.countsByRun(RUN)).delivered).toBe(1);
  });

  it('a FAILED delivery is counted — this is the one that must never silently read zero', async () => {
    expect((await deliveries.countsByRun(RUN)).failed).toBe(1);
  });

  it('an excluded recipient is counted separately', async () => {
    expect((await deliveries.countsByRun(RUN)).excluded).toBe(1);
  });

  it('total EXCLUDES the excluded recipients — otherwise the success rate is understated', async () => {
    const c = await deliveries.countsByRun(RUN);
    expect(c.total).toBe(2);
  });

  it('a run with no deliveries reports zeros rather than throwing', async () => {
    const c = await deliveries.countsByRun('11112222-0000-4000-8000-0000000000ff');
    expect(c.total).toBe(0);
  });

  it('listByRun returns the rows themselves', async () => {
    expect((await deliveries.listByRun(RUN)).length).toBe(3);
  });
});
