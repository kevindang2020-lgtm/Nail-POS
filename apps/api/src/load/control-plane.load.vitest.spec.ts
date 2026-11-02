// control-plane.load — Constitution 7 §289 load tests, §290 performance rules, on the REAL migrated schema.
//
// Opt-in (LOAD_TESTS=1 npm run test:load:control-plane); skipped in the normal suite. It builds the scale §289 names —
// 10,000 tenants, a large audit history, a quarter of hourly health snapshots' worth of rows, many concurrent support
// sessions — then times the Super Admin's own read paths (the real repository / service code, not look-alike SQL) and
// checks the §290 rules: server-side aggregation, bounded pages, nothing enormous shipped to the browser.
//
// Budgets are ceilings, set at several times the measured PGlite time (Sep 28 2026), so a lost index or an unbounded
// query fails the run. PGlite is single-connection: it SERIALISES concurrent transactions, so the concurrency section
// checks invariants under many parallel callers but cannot prove behaviour under true contention — run the same file
// against a real Postgres for that (the repositories are the same code).
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { platformPermissionsFor } from '@aipowersalon/permissions';
import { KyselySuperAdminPlatformRepo, PlatformSearchService, KillSwitchService } from '@aipowersalon/super-admin';
import { TenantHealthService, TenantHealthSnapshots } from '../observability/tenant-health';

const run = process.env.LOAD_TESTS === '1';
const TENANTS = Number(process.env.LOAD_TENANTS ?? 10_000);
const AUDIT_ROWS = Number(process.env.LOAD_AUDIT_ROWS ?? 200_000);
const SNAP_HOURS = Number(process.env.LOAD_SNAPSHOT_HOURS ?? 24);
const SESSIONS = Number(process.env.LOAD_SUPPORT_SESSIONS ?? 500);
const ME = '76767676-7676-4767-8767-767676767676';
const results: Array<{ path: string; ms: number; budgetMs: number; rows: number }> = [];
let db: any;

async function timed<T>(path: string, budgetMs: number, fn: () => Promise<T>, rowsOf: (r: T) => number): Promise<T> {
  const t0 = performance.now(); const r = await fn(); const ms = Math.round(performance.now() - t0);
  results.push({ path, ms, budgetMs, rows: rowsOf(r) });
  expect(ms, `${path} took ${ms} ms (budget ${budgetMs} ms)`).toBeLessThanOrEqual(budgetMs);
  return r;
}

describe.skipIf(!run)(`control-plane load (${TENANTS} tenants, ${AUDIT_ROWS} audit rows, ${SNAP_HOURS}h of health snapshots, ${SESSIONS} support sessions)`, () => {
  beforeAll(async () => {
    const pg = await migratedPglite(); db = kyselyFor(pg);
    await pg.query(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status)
                    select gen_random_uuid(), 'L' || g, 'Salon ' || g || (case when g % 97 = 0 then ' Belle' else '' end), 'salon-' || g, 'S' || lpad(g::text, 6, '0'), 'active'
                      from generate_series(1, ${TENANTS}) g`);
    await pg.query(`insert into users (id, email, role, status, platform_role) values ('${ME}', 'load@platform.test', 'SUPER_ADMIN', 'active', 'PLATFORM_SUPER_ADMIN')`);
    await pg.query(`insert into audit_logs (user_id, role, action_type, entity_type, entity_id, metadata_json, created_at)
                    select '${ME}', 'SUPER_ADMIN', 'load_event_' || (g % 40), 'tenant', null, '{}'::jsonb, now() - (g || ' seconds')::interval
                      from generate_series(1, ${AUDIT_ROWS}) g`);
    await pg.query(`insert into tenant_health_snapshots (tenant_id, observed_at, snapshot_hour, overall_status, payments_status, communications_status, booking_status, devices_status, jobs_status)
                    select t.id, h.at, date_trunc('hour', h.at),
                           (array['HEALTHY','DEGRADED','OUTAGE','UNKNOWN'])[1 + (abs(hashtext(t.id::text)) + h.n) % 4], 'HEALTHY','HEALTHY','HEALTHY','UNKNOWN','HEALTHY'
                      from tenants t cross join lateral (select n, now() - (n || ' hours')::interval as at from generate_series(0, ${SNAP_HOURS - 1}) n) h`);
    await pg.query(`insert into support_access_sessions (tenant_id, admin_user_id, reason, scope, expires_at)
                    select id, '${ME}', 'load test session', 'READ_ONLY', now() + interval '30 minutes' from tenants order by tenant_code limit ${SESSIONS}`);
    await pg.query('analyze');
  }, 600_000);

  it('Salon Health list: latest snapshot per salon, server-side (§156, §250)', async () => {
    const svc = new TenantHealthSnapshots(new TenantHealthService(db), db);
    const r = await timed('GET /super-admin/tenant-health (worst first, page 1)', 5_000, () => svc.list('worst', undefined, { limit: 100 }), (x) => x.rows.length);
    expect(r.rows.length).toBe(100);                         // §290: one page, never every salon in one response
    expect(r.total).toBe(TENANTS);                           // …while the totals still count every salon
    const deep = await timed('GET /super-admin/tenant-health (page 50)', 5_000, () => svc.list('worst', undefined, { limit: 100, cursor: Buffer.from(JSON.stringify({ o: 4900 })).toString('base64url') }), (x) => x.rows.length);
    expect(deep.rows.length).toBe(100);
  });
  it('platform search over every salon stays bounded (§140, §290)', async () => {
    const svc = new PlatformSearchService(db);
    const r = await timed("GET /super-admin/platform-search?q=belle", 3_000, () => svc.search('belle', platformPermissionsFor('PLATFORM_SUPER_ADMIN')), (x) => x.groups.reduce((n, g) => n + g.hits.length, 0));
    expect(r.groups.find((g) => g.kind === 'tenant')!.hits.length).toBeLessThanOrEqual(5);   // a page, not every match
  });
  it('audit history: the newest page, not the table (§290)', async () => {
    const r = await timed('audit_logs newest 50', 2_000, async () => (await sql<any>`select id, action_type, created_at from audit_logs order by created_at desc limit 50`.execute(db)).rows, (x) => x.length);
    expect(r.length).toBe(50);
  });
  it('support: my live sessions and the kill-switch list under load', async () => {
    const repo = new KyselySuperAdminPlatformRepo(db);
    const mine = await timed('GET /support-sessions/mine', 3_000, () => repo.mySupportSessions(ME), (x) => x.length);
    expect(mine.length).toBe(SESSIONS);
    await timed('GET /super-admin/kill-switches', 1_000, () => new KillSwitchService(db).list(), (x) => x.length);
  });
  it('invariants under many parallel callers (serialised by PGlite — see the header)', async () => {
    const repo = new KyselySuperAdminPlatformRepo(db);
    const s = (await sql<any>`select id from support_access_sessions order by started_at limit 1`.execute(db)).rows[0].id;
    const ext = await Promise.all(Array.from({ length: 25 }, () => repo.extendSupportSession(s, ME, 15, 'parallel extension attempt')));
    // the cap holds however many try at once: it is enforced by the UPDATE itself (a conditional, single statement),
    // which serialises in PGlite and in Postgres alike — the first version (check, then write) let all 25 through here
    const won = ext.filter((r) => r.ok).length;
    expect(won).toBeGreaterThanOrEqual(1);
    expect(won).toBeLessThanOrEqual(2);                        // never past the cap; racing losers are refused, not silently applied
    expect(Number((await sql<any>`select extension_count from support_access_sessions where id = ${s}`.execute(db)).rows[0].extension_count)).toBe(won);
    // The last-Super-Admin rule across TWO rows relies on the row locks (SELECT … FOR UPDATE) that serialise real
    // Postgres connections. PGlite runs every transaction on ONE session, so those locks cannot serialise anything here;
    // that race is only meaningful against a real Postgres and is not claimed by this PGlite run.
  }, 120_000);

  it('report', () => {
    console.log('\ncontrol-plane load results\n' + results.map((r) => `  ${r.path.padEnd(48)} ${String(r.ms).padStart(6)} ms  (budget ${r.budgetMs} ms, ${r.rows} rows)`).join('\n'));
    expect(results.length).toBeGreaterThanOrEqual(6);
  });
});
