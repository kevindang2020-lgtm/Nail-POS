// ai-calendar.postgres-race — AI Calendar guide T28 + Check Calendar System, on REAL Postgres with real concurrency
// (PG_RACE_URL = a migrated database; four separate sessions).
//   1. Four staff confirm four different moves into the SAME technician time at once (the Scheduling Assistant's proposals
//      run through the Copilot → canonical Booking reschedule, whose write is this conditional, versioned UPDATE). The
//      canonical store's exclusion constraint (pos_tech_appointments_no_overlap) lets exactly ONE land; the others are
//      refused with 23P01 and their appointments stay where they were — no double-booking, whatever the app layer did.
//   2. Six Check Calendar System clicks at once record ONE run; the rest return it as rate-limited (advisory lock).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { AiCalendarCenter, type AicCtx } from './ai-calendar-center';

const url = process.env.PG_RACE_URL;
const TAG = `aicr${process.pid}${Date.now().toString(36)}`.slice(0, 16);
const T = randomUUID(), B = randomUUID(), TECH = randomUUID();
const D = '2027-03-12';

describe.skipIf(!url)('AI Calendar on real Postgres: moves into one slot, one health run', () => {
  const mk = () => new Kysely<any>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 4 }) }) });
  const dbs = url ? [mk(), mk(), mk(), mk()] : [];
  const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  beforeAll(async () => {
    const db = dbs[0];
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, ${TAG}, ${TAG}, ${TAG}, ${TAG.toUpperCase().slice(0, 12)}, 'active')`.execute(db);
    await sql`insert into branches (id, tenant_id, name, timezone) values (${B}, ${T}, 'Main', 'America/New_York')`.execute(db);
    await sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, is_active) values (${TECH}, ${T}, ${B}, 'Race', 'Tech', 'Race Tech', true)`.execute(db);
    for (let i = 0; i < 4; i++) {
      await sql`insert into pos_tech_appointments (id, tenant_id, branch_id, technician_id, customer_name, source, appt_date, start_time, end_time, duration_minutes, status)
        values (${ids[i]}, ${T}, ${B}, ${TECH}, ${'Race ' + i}, 'ai', ${D}::date, ${`${9 + i}:00`.padStart(5, '0')}, ${`${9 + i}:45`.padStart(5, '0')}, 45, 'booked')`.execute(db);
    }
  }, 60_000);
  afterAll(async () => {
    if (dbs[0]) {
      await sql`delete from pos_tech_appointments where tenant_id = ${T}`.execute(dbs[0]).catch(() => undefined);
      await sql`delete from ai_calendar_health_runs where tenant_id = ${T}`.execute(dbs[0]).catch(() => undefined);
      await sql`delete from technicians where tenant_id = ${T}`.execute(dbs[0]).catch(() => undefined);
    }
    await Promise.all(dbs.map((d) => d.destroy()));
  });

  it('T28 four simultaneous moves into 15:00–15:45 for one technician → exactly one lands, three are refused, nothing double-booked', async () => {
    const move = (db: Kysely<any>, id: string) => db.transaction().execute(async (trx) => {
      const r = await sql<{ id: string }>`update pos_tech_appointments set start_time = '15:00', end_time = '15:45', version = version + 1, updated_at = now()
        where tenant_id = ${T} and id = ${id} and version = 1 returning id`.execute(trx);
      return r.rows.length;
    });
    const out = await Promise.allSettled(ids.map((id, i) => move(dbs[i], id)));
    const ok = out.filter((o) => o.status === 'fulfilled' && (o as PromiseFulfilledResult<number>).value === 1);
    const refused = out.filter((o) => o.status === 'rejected') as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(refused).toHaveLength(3);
    for (const r of refused) expect(String(r.reason?.code ?? r.reason?.message)).toMatch(/23P01|exclusion constraint/);
    const at15 = (await sql<{ c: string }>`select count(*)::int c from pos_tech_appointments where tenant_id = ${T} and appt_date = ${D}::date and start_time = '15:00'`.execute(dbs[0])).rows[0];
    expect(Number(at15.c)).toBe(1);
    const unmoved = (await sql<{ c: string }>`select count(*)::int c from pos_tech_appointments where tenant_id = ${T} and version = 1`.execute(dbs[0])).rows[0];
    expect(Number(unmoved.c)).toBe(3);
  });

  it('six simultaneous Check Calendar System clicks → one recorded run; the others see it as rate-limited', async () => {
    const ctx: AicCtx = { tenantId: T, branchId: B, userId: randomUUID(), role: 'OWNER', permissions: ['pos.booking.view'] };
    const centers = dbs.map((d) => new AiCalendarCenter(d, null));
    const out = await Promise.all(Array.from({ length: 6 }, (_, i) => centers[i % 4].health(ctx, D)));
    expect(new Set(out.map((o) => o.runId)).size).toBe(1);
    expect(out.filter((o) => !o.rateLimited)).toHaveLength(1);
    const runs = (await sql<{ c: string }>`select count(*)::int c from ai_calendar_health_runs where tenant_id = ${T}`.execute(dbs[0])).rows[0];
    expect(Number(runs.c)).toBe(1);
  });
});
