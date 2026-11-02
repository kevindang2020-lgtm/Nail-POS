import { describe, it, expect, beforeAll } from 'vitest';
import { MIGRATIONS_DIR } from '@aipowersalon/database';
import { readFileSync } from 'fs';

import { PGlite } from '@electric-sql/pglite';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
// The repo uses sql`` template execution, which pglite supports via a minimal Kysely dialect shim below.

// Minimal pglite→Kysely adapter: we only need sql``.execute(db), so wrap PGlite.query.
class PgliteDriver {
  constructor(private pg: PGlite) {}
  async init() {}
  async acquireConnection() {
    const pg = this.pg;
    return {
      async executeQuery(compiled: any) { const r = await pg.query(compiled.sql, compiled.parameters as any[]); return { rows: r.rows as any[] }; },
      async *streamQuery() { /* not used */ },
    };
  }
  async beginTransaction() {} async commitTransaction() {} async rollbackTransaction() {}
  async releaseConnection() {} async destroy() {}
}

async function makeDb(): Promise<Kysely<any>> {
  const pg = new PGlite();
  try { await pg.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;'); } catch { /* gen_random_uuid available natively in pglite */ }
  await pg.exec(readFileSync(`${MIGRATIONS_DIR}/147_status_and_updates.sql`, 'utf8'));
  await pg.exec(readFileSync(`${MIGRATIONS_DIR}/247_system_status.sql`, 'utf8'));
  await pg.exec(readFileSync(`${MIGRATIONS_DIR}/248_status_post_incident_reports.sql`, 'utf8'));
  await pg.exec(readFileSync(`${MIGRATIONS_DIR}/249_status_health_snapshots.sql`, 'utf8'));
  await pg.exec(readFileSync(`${MIGRATIONS_DIR}/250_status_communications.sql`, 'utf8'));
  await pg.exec(readFileSync(`${MIGRATIONS_DIR}/251_status_recovery_and_impact.sql`, 'utf8'));
  await pg.exec(`INSERT INTO status_incident_impact (incident_reference, tenant_name, branch_name, service, impact_level, comm_status) VALUES ('INC-2026-0506-001','VIP Nail Club','Downtown','Booking System','high','in_progress')`);
  await pg.exec(`INSERT INTO status_health_snapshots (snapshot_date, health_score, uptime_pct) VALUES (now()::date, 99.2, 99.96), (now()::date - 1, 98.8, 99.9)`);
  try { await pg.exec("CREATE TABLE IF NOT EXISTS audit_logs (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), action_type TEXT, entity_type TEXT, entity_id UUID, user_id UUID, created_at TIMESTAMPTZ DEFAULT now())"); } catch { /* ignore */ }
  await pg.exec(`INSERT INTO status_components (key, name, category, status, uptime_pct, response_time_ms, owner_team, affected_tenants, sort_order)
    VALUES ('main_app','Main Application','application','operational',99.99,120,'Platform Team',0,1),
           ('booking','Booking System','application','degraded',99.45,820,'Platform Team',28,2)`);
  return new Kysely<any>({ dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => new PgliteDriver(pg), createIntrospector: (d: any) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() } });
}

describe('KyselySystemStatusRepo (pglite)', () => {
  let repo: any;
  beforeAll(async () => {
    const { KyselySystemStatusRepo } = await import('./system-status.kysely.repository');
    repo = new KyselySystemStatusRepo(await makeDb());
  });

  it('reads seeded components', async () => {
    const comps = await repo.components();
    expect(comps.length).toBe(2);
    expect(comps.find((c: any) => c.key === 'booking').status).toBe('degraded');
  });

  it('creates an incident, lists it, and advances it to resolved', async () => {
    const created = await repo.createIncident({ title: 'Booking latency', componentKey: 'booking', severity: 'high', impact: 'major', affectedTenants: 28 });
    expect(created.reference).toMatch(/^INC-/);
    expect(created.status).toBe('investigating');
    const listed = await repo.incidents();
    expect(listed.some((i: any) => i.reference === created.reference)).toBe(true);
    const resolved = await repo.updateIncidentStatus(created.reference, 'resolved');
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolvedAt).toBeTruthy();
    const history = await repo.incidentHistory();
    expect(history.some((h: any) => h.incidentId === created.reference)).toBe(true);
  });

  it('publishes an update and schedules maintenance', async () => {
    const u = await repo.publishUpdate({ title: 'Recovery update', body: 'All good', audience: 'all_tenants', incidentId: null });
    expect(u.status).toBe('published');
    expect((await repo.publicUpdates()).some((x: any) => x.title === 'Recovery update')).toBe(true);
    const m = await repo.scheduleMaintenance({ service: 'Backups', scope: 'Global', windowStart: '2026-05-09T23:00:00Z', windowEnd: '2026-05-10T01:00:00Z', tenantImpact: 0, owner: 'Infra Team' });
    expect(m.noticeStatus).toBe('published');
    expect((await repo.scheduledMaintenance()).some((x: any) => x.service === 'Backups')).toBe(true);
  });

  it('counts incident reports this month', async () => {
    expect(await repo.incidentReportsThisMonth()).toBeGreaterThanOrEqual(1);
  });

  it('creates and lists a post-incident report', async () => {
    const created = await repo.createPostIncidentReport({ title: 'Booking RCA', incidentReference: 'INC-2026-0506-001', summary: 'Summary', rootCause: 'DB contention', owner: 'John D.' });
    expect(created.reportReference).toMatch(/^PIR-/);
    expect((await repo.postIncidentReports()).some((r: any) => r.reportReference === created.reportReference)).toBe(true);
  });

  it('reads the daily health trend from snapshots', async () => {
    const trend = await repo.healthTrend();
    expect(trend.length).toBeGreaterThanOrEqual(2);
    expect(trend[0]).toHaveProperty('score');
    expect(trend[trend.length - 1].date >= trend[0].date).toBe(true);
  });

  it('notifies tenants and lists the communication log', async () => {
    const sent = await repo.notifyTenants({ message: 'Booking latency resolved', channel: 'email', audience: '28 Tenants', incidentReference: 'INC-2026-0506-001', sentBy: 'Super Admin' });
    expect(sent.message).toBe('Booking latency resolved');
    expect((await repo.communications()).some((c: any) => c.message === 'Booking latency resolved')).toBe(true);
  });

  it('reads affected-tenant impact rows', async () => {
    const rows = await repo.affectedTenants();
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].tenant).toBe('VIP Nail Club');
    expect(rows[0].impactLevel).toBe('High');
  });
});
