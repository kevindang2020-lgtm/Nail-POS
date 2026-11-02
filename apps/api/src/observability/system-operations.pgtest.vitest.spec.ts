// system-operations.pgtest — the System Operations API against the real schema.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { Reflector } from '@nestjs/core';
import { SystemOperationsService, SystemOperationsController, fromStatusPage } from './system-operations';
import { COMPONENTS } from './health-core';
import { SLOS } from './slo-core';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

let pg: any; let db: any;
beforeAll(async () => { pg = await migratedPglite(); db = kyselyFor(pg); });
beforeEach(async () => { await pg.exec(`DELETE FROM status_components; DELETE FROM system_health_snapshots; DELETE FROM alerts WHERE related_module = 'system_health'; DELETE FROM platform_request_metrics_minute;`); });
const NOW = new Date('2026-09-21T12:00:00Z');
const iso = (msFromNow: number) => new Date(NOW.getTime() + msFromNow).toISOString();
async function comp(key: string, status: string, expiresIn: number | null, source = 'computed') {
  await pg.exec(`INSERT INTO status_components (key, name, status, status_source, reason_code, criticality, expires_at, computed_at)
                 VALUES ('${key}', '${key}', '${status}', '${source}', 'r', 'critical', ${expiresIn === null ? 'NULL' : `'${iso(expiresIn)}'`}, '${iso(-10_000)}')`);
}

describe('§332–333 no fake green on the page', () => {
  it('a computed component past its expiry shows UNKNOWN, whatever it stored, and the page is marked stale', async () => {
    await comp('database', 'operational', -1_000);                     // expired a second ago
    const o = await new SystemOperationsService(db).overview(NOW);
    const db1 = o.components.find((c) => c.key === 'database')!;
    expect(db1.storedStatus).toBe('operational');
    expect(db1.status).toBe('UNKNOWN');
    expect(db1.reason).toBe('stale');
    expect(o.stale).toBe(true);
  });
  it('a component the aggregator never wrote is UNKNOWN ("never_computed"), not silently absent', async () => {
    const o = await new SystemOperationsService(db).overview(NOW);
    expect(o.components).toHaveLength(COMPONENTS.length);
    expect(o.components.every((c) => c.status === 'UNKNOWN' && c.reason === 'never_computed')).toBe(true);
    expect(o.overall).toBe('UNKNOWN');
  });
  it('a human\'s MAINTENANCE has no expiry and stays MAINTENANCE', async () => {
    await comp('payments', 'maintenance', null, 'manual');
    expect((await new SystemOperationsService(db).overview(NOW)).components.find((c) => c.key === 'payments')!.status).toBe('MAINTENANCE');
  });
});

describe('the overall status uses the SAME rollup as the aggregator', () => {
  it('fresh critical components healthy + an optional outage → the platform is HEALTHY (§91)', async () => {
    for (const c of COMPONENTS) await comp(c.key, c.key === 'ai' ? 'major_outage' : 'operational', 60_000);
    const o = await new SystemOperationsService(db).overview(NOW);
    expect(o.overall).toBe('HEALTHY');
    expect(o.stale).toBe(false);
    expect(o.components.find((c) => c.key === 'ai')!.status).toBe('OUTAGE');
  });
  it('a fresh critical outage → OUTAGE', async () => {
    for (const c of COMPONENTS) await comp(c.key, c.key === 'database' ? 'major_outage' : 'operational', 60_000);
    expect((await new SystemOperationsService(db).overview(NOW)).overall).toBe('OUTAGE');
  });
});

describe('alerts, history, SLOs, API routes', () => {
  it('lists open PLATFORM health alerts only, most severe first — never a tenant\'s alert', async () => {
    const T = 'f8f8f8f8-0000-4000-8000-000000000001';
    await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'Ops LLC', 'Ops', 'ops-t', 'OPST1', 'active') ON CONFLICT DO NOTHING`);
    await pg.exec(`INSERT INTO alerts (tenant_id, tenant_name, title, message, type, severity, status, related_module, related_record_id, dedupe_key) VALUES
      (NULL, 'Platform', 'ai degraded', 'm', 'system', 'low', 'unread', 'system_health', 'ai', 'so1'),
      (NULL, 'Platform', 'db down', 'm', 'system', 'critical', 'unread', 'system_health', 'database', 'so2'),
      (NULL, 'Platform', 'old', 'm', 'system', 'high', 'resolved', 'system_health', 'api', 'so3'),
      ('${T}', 'Ops', 'tenant one', 'm', 'tenant', 'critical', 'unread', 'system_health', 'x', 'so4')`);
    const o = await new SystemOperationsService(db).overview(NOW);
    expect(o.alerts.open).toBe(2);
    expect(o.alerts.recent.map((a) => a.title)).toEqual(['db down', 'ai degraded']);
    expect(o.alerts.bySeverity).toEqual({ critical: 1, low: 1 });
  });
  it('carries every SLO, each labelled with its status (proposed)', async () => {
    const o = await new SystemOperationsService(db).overview(NOW);
    expect(o.slos.map((s) => s.id).sort()).toEqual(SLOS.map((s) => s.id).sort());
    expect(o.slos.every((s) => s.status === 'proposed')).toBe(true);
  });
  it('§391 history: the timeline of changes, newest first, 30 days', async () => {
    await pg.exec(`INSERT INTO system_health_snapshots (component_key, status, previous, reason_code, observed_at) VALUES
      ('communications', 'DEGRADED', 'HEALTHY', 'outage:twilio', '${iso(-3_600_000)}'),
      ('communications', 'HEALTHY', 'DEGRADED', 'ok', '${iso(-1_500_000)}'),
      ('communications', 'OUTAGE', 'HEALTHY', 'x', '${iso(-40 * 86_400_000)}')`);
    const h = await new SystemOperationsService(db).history('communications', NOW);
    expect(h.changes.map((c) => c.status)).toEqual(['HEALTHY', 'DEGRADED']);   // the 40-day-old change is outside
  });
  it('history refuses an unknown component', async () => {
    await expect(new SystemOperationsService(db).history('nope', NOW)).rejects.toThrow(/Unknown component/);
  });
  it('§143 top failing routes over the last hour, across instances, by route template', async () => {
    await pg.exec(`INSERT INTO platform_request_metrics_minute (bucket_minute, method, route, status_class, count, sum_ms, max_ms) VALUES
      ('${iso(-600_000)}', 'POST', '/pos/checkout/tickets/:ticketId/pay/card', 5, 7, 700, 300),
      ('${iso(-600_000)}', 'POST', '/pos/checkout/tickets/:ticketId/pay/card', 2, 93, 9300, 200),
      ('${iso(-2 * 3_600_000)}', 'GET', '/old', 5, 99, 99, 1)`);
    const a = await new SystemOperationsService(db).api(NOW);
    expect(a.failing).toEqual([{ method: 'POST', route: '/pos/checkout/tickets/:ticketId/pay/card', total: 100, serverErrors: 7 }]);
  });
});

describe('§180 every route requires the System Operations permission', () => {
  it('overview, api and history all carry super_admin.system_operations.view', () => {
    const r = new Reflector();
    for (const m of ['overview', 'api', 'history']) {
      expect(r.get('perm', (SystemOperationsController.prototype as any)[m]), m).toBe('super_admin.system_operations.view');
    }
  });
});

describe('fromStatusPage', () => {
  it('maps the public vocabulary back; anything unexpected is UNKNOWN, never HEALTHY', () => {
    expect(fromStatusPage('operational')).toBe('HEALTHY');
    expect(fromStatusPage('major_outage')).toBe('OUTAGE');
    expect(fromStatusPage('unknown')).toBe('UNKNOWN');
    expect(fromStatusPage('green')).toBe('UNKNOWN');
  });
});
