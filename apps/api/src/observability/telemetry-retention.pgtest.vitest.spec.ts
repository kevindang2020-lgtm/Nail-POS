// telemetry-retention.pgtest — the summary tables are pruned, in batches, against the real schema.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { TelemetryRetention, RETENTION, BATCH } from './telemetry-retention';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

let pg: any; let db: any;
beforeAll(async () => { pg = await migratedPglite(); db = kyselyFor(pg); });
beforeEach(async () => { await pg.exec(`DELETE FROM platform_request_metrics_minute; DELETE FROM system_health_snapshots;`); });
const NOW = new Date('2026-09-21T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

describe('retention', () => {
  it('request metrics older than 35 days go; 34 days stay — the 30-day SLO window must remain readable', async () => {
    await pg.exec(`INSERT INTO platform_request_metrics_minute (bucket_minute, method, route, status_class, count) VALUES
      ('${daysAgo(36)}', 'GET', '/old', 2, 1), ('${daysAgo(34)}', 'GET', '/keep', 2, 1), ('${daysAgo(1)}', 'GET', '/new', 2, 1)`);
    const r = await new TelemetryRetention(db).run(NOW);
    expect(r.platform_request_metrics_minute).toBe(1);
    const left = (await pg.query(`SELECT route FROM platform_request_metrics_minute ORDER BY route`)).rows.map((x: any) => x.route);
    expect(left).toEqual(['/keep', '/new']);
  });

  it('health history is kept 400 days — a year of uptime reporting', async () => {
    await pg.exec(`INSERT INTO system_health_snapshots (component_key, status, reason_code, observed_at) VALUES
      ('api', 'HEALTHY', 'ok', '${daysAgo(401)}'), ('api', 'OUTAGE', 'x', '${daysAgo(399)}')`);
    await new TelemetryRetention(db).run(NOW);
    expect((await pg.query(`SELECT status FROM system_health_snapshots`)).rows.map((x: any) => x.status)).toEqual(['OUTAGE']);
  });

  it('a backlog larger than one batch is fully cleared, across batches', async () => {
    const n = BATCH + 7;
    await pg.exec(`INSERT INTO platform_request_metrics_minute (bucket_minute, method, route, status_class, count)
      SELECT timestamptz '${daysAgo(60)}' + (g || ' seconds')::interval, 'GET', '/r', 2, 1 FROM generate_series(1, ${n}) g`);
    const r = await new TelemetryRetention(db).run(NOW);
    expect(r.platform_request_metrics_minute).toBe(n);
    expect((await pg.query(`SELECT count(*)::int c FROM platform_request_metrics_minute`)).rows[0].c).toBe(0);
  });

  it('one table failing does not stop the other', async () => {
    await pg.exec(`INSERT INTO system_health_snapshots (component_key, status, reason_code, observed_at) VALUES ('api', 'HEALTHY', 'ok', '${daysAgo(500)}')`);
    const svc = new TelemetryRetention(db);
    const orig = (RETENTION as any)[0].table;
    (RETENTION as any)[0].table = 'no_such_table_zz';
    try { const r = await svc.run(NOW); expect(r.system_health_snapshots).toBe(1); }
    finally { (RETENTION as any)[0].table = orig; }
  });
});
