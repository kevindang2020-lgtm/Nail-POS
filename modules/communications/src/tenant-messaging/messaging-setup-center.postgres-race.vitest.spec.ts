// messaging-setup-center.postgres-race — Text Messaging Setup guide §11 "alert deduplication" on REAL Postgres with REAL
// concurrency (PGlite is one session). Eight workers raise the same failing parts at once over four sessions (a dispatcher
// that ran twice, a retried job): exactly ONE open owner alert per part, none of the eight fails, and every detection is
// counted on that one alert. Another salon is untouched.
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { raiseSetupAlerts, type ReadinessPart } from './messaging-setup-center';

const url = process.env.PG_RACE_URL;
const TAG = `msr${process.pid}${Date.now().toString(36)}`.slice(0, 16);
const T = randomUUID(), T2 = randomUUID();
const parts: ReadinessPart[] = [
  { key: 'registration', state: 'attention_required', summary: '10DLC not started.', evidence: 'x', source: 'provider status', checkedAt: null, nextAction: 'Start registration.', fixLink: '/x' },
  { key: 'inbound', state: 'failed', summary: 'Webhook points elsewhere.', evidence: 'x', source: 'provider check', checkedAt: null, nextAction: 'Fix it.', fixLink: '/x' },
  { key: 'account', state: 'ready', summary: 'ok', evidence: 'x', source: 'provider check', checkedAt: null, nextAction: null, fixLink: '/x' },
];

describe.skipIf(!url)('setup alerts on real Postgres: one open alert per failing part under concurrency', () => {
  const mk = () => new Kysely<any>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 4 }) }) });
  const dbs = url ? [mk(), mk(), mk(), mk()] : [];
  beforeAll(async () => {
    for (const [id, i] of [[T, 1], [T2, 2]] as const) await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${id}, ${TAG + i}, ${TAG + i}, ${TAG + '-' + i}, ${(TAG.slice(-9) + i).toUpperCase()}, 'active')`.execute(dbs[0]);
  });
  afterAll(async () => {
    if (dbs[0]) { await sql`delete from owner_alerts where tenant_id in (${T}, ${T2})`.execute(dbs[0]); await sql`delete from tenants where id in (${T}, ${T2})`.execute(dbs[0]); }
    await Promise.all(dbs.map((d) => d.destroy()));
  });

  it('8 concurrent raises over 4 sessions → exactly one open alert per failing part, nothing for the ready part, no failure', async () => {
    const out = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => raiseSetupAlerts(dbs[i % 4], T, parts)));
    expect(out.filter((o) => o.status === 'rejected').map((o: any) => String(o.reason?.message ?? o.reason))).toEqual([]);
    const opened = out.reduce((n, o: any) => n + o.value.opened, 0);
    expect(opened).toBe(2);
    const rows = (await sql<any>`select metadata->>'dedupeKey' as k, status from owner_alerts where tenant_id = ${T} and category = 'messaging_failure' order by 1`.execute(dbs[0])).rows;
    expect(rows.map((r) => r.k)).toEqual(['sms_setup:inbound', 'sms_setup:registration']);
    expect(rows.every((r) => r.status === 'new')).toBe(true);
    expect(Number((await sql<any>`select count(*)::int n from owner_alerts where tenant_id = ${T2}`.execute(dbs[0])).rows[0].n)).toBe(0);
  });
});
