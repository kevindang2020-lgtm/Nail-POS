// alert-reconcile.pgtest — health alerts against the real alerts table: raise, escalate, resolve, re-raise.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { HealthAggregator } from './health-aggregator';
import { COMPONENTS } from './health-core';
const COMPONENT_KEYS = COMPONENTS.map((c) => c.key);
// Shared, cached migrated schema — see @aipowersalon/testing (packages/testing/src/pgtest-schema.mjs) (built once, reused by every pgtest).
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

let pg: any; let db: any;
beforeAll(async () => { pg = await migratedPglite(); db = kyselyFor(pg); });
beforeEach(async () => { await pg.exec(`DELETE FROM alerts WHERE related_module = 'system_health'; DELETE FROM status_components; DELETE FROM system_health_snapshots;`); });

const alertsFor = async (key: string) => (await pg.query(`SELECT severity, status, title, message, resolved_at, dedupe_key FROM alerts WHERE related_module = 'system_health' AND related_record_id = $1 ORDER BY created_at`, [key])).rows;
const reconcile = (agg: HealthAggregator, desired: any[], now: number) => (agg as any).reconcileAlerts(desired, now, COMPONENT_KEYS);
const d = (component: string, severity: string, title = `${component} down`) => ({ component, severity, title, message: `${title}. Runbook: R`, owner: 'ops', runbook: 'R', causes: [] });

describe('one open alert per component — raised once, however many ticks', () => {
  it('ten ticks of the same outage are ONE alert', async () => {
    const agg = new HealthAggregator(db);
    for (let i = 0; i < 10; i++) await reconcile(agg, [d('payments', 'critical')], 1_000_000 + i * 30_000);
    const rows = await alertsFor('payments');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ severity: 'critical', status: 'unread' });
  });

  it('a RESTARTED aggregator does not duplicate the open alert — the decision is stateless', async () => {
    await reconcile(new HealthAggregator(db), [d('payments', 'high')], 1_000_000);
    await reconcile(new HealthAggregator(db), [d('payments', 'high')], 1_030_000);   // a fresh instance, no memory
    expect(await alertsFor('payments')).toHaveLength(1);
  });
});

describe('escalation (§264) — worse re-surfaces, better never quietly softens', () => {
  it('degraded → outage raises the SAME alert to critical and makes it unread again, even if acknowledged', async () => {
    const agg = new HealthAggregator(db);
    await reconcile(agg, [d('checkout', 'high')], 1_000_000);
    await pg.exec(`UPDATE alerts SET status = 'read', read_at = now() WHERE related_record_id = 'checkout'`);   // a human acknowledged
    await reconcile(agg, [d('checkout', 'critical', 'checkout is down')], 1_030_000);
    const rows = await alertsFor('checkout');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ severity: 'critical', status: 'unread', title: 'checkout is down' });
  });
  it('outage → degraded does NOT downgrade the open alert', async () => {
    const agg = new HealthAggregator(db);
    await reconcile(agg, [d('checkout', 'critical')], 1_000_000);
    await reconcile(agg, [d('checkout', 'high')], 1_030_000);
    expect((await alertsFor('checkout'))[0].severity).toBe('critical');
  });
});

describe('resolution and the NEXT outage', () => {
  it('recovery resolves the open alert automatically', async () => {
    const agg = new HealthAggregator(db);
    await reconcile(agg, [d('redis', 'high')], 1_000_000);
    await reconcile(agg, [], 1_030_000);
    const [r] = await alertsFor('redis');
    expect(r.status).toBe('resolved');
    expect(r.resolved_at).not.toBeNull();
  });

  it('a SECOND outage after recovery raises a NEW alert — a per-component dedupe key would have silenced it forever', async () => {
    // The alerts table's dedupe_key is UNIQUE across all time. Keyed by component alone, the first outage ever raised
    // would make every later one hit ON CONFLICT DO NOTHING. Keys name the episode instead.
    const agg = new HealthAggregator(db);
    await reconcile(agg, [d('database', 'critical')], 1_000_000);
    await reconcile(agg, [], 1_030_000);
    await reconcile(agg, [d('database', 'critical')], 2_000_000);
    const rows = await alertsFor('database');
    expect(rows).toHaveLength(2);
    expect(rows.map((r: any) => r.status)).toEqual(['resolved', 'unread']);
    expect(rows[0].dedupe_key).not.toBe(rows[1].dedupe_key);
  });

  it('a human-DISMISSED alert is not reopened for the same episode, and a later episode still raises', async () => {
    const agg = new HealthAggregator(db);
    await reconcile(agg, [d('ai', 'medium')], 1_000_000);
    await pg.exec(`UPDATE alerts SET status = 'dismissed', dismissed_at = now() WHERE related_record_id = 'ai'`);
    await reconcile(agg, [d('ai', 'medium')], 1_030_000);
    // Dismissed is not open, so the rule sees no open alert and raises a fresh one — the condition is still true.
    // That is deliberate: dismissing an alert does not make a live outage stop existing.
    const rows = await alertsFor('ai');
    expect(rows.filter((r: any) => r.status === 'unread')).toHaveLength(1);
  });
});

describe('the alerts land where the Super Admin alerts screen already reads them', () => {
  it('type system, platform-level, with the runbook in the message', async () => {
    await reconcile(new HealthAggregator(db), [d('payments', 'critical')], 1_000_000);
    const r = (await pg.query(`SELECT type, tenant_id, tenant_name, related_module FROM alerts WHERE related_record_id = 'payments'`)).rows[0];
    expect(r).toEqual({ type: 'system', tenant_id: null, tenant_name: 'Platform', related_module: 'system_health' });
    expect((await alertsFor('payments'))[0].message).toMatch(/Runbook:/);
  });
});

describe('health alerts are PLATFORM alerts — a tenant\'s alert is never touched', () => {
  it('a tenant alert sharing the module and record id is neither resolved, escalated, nor counted as "open"', async () => {
    // check:tenant flagged the reconcile UPDATEs: scoped only by related_module, they could in principle reach a
    // tenant's row in the shared alerts table. They are now also scoped to tenant_id IS NULL; this proves it bites.
    const T = 'e7e7e7e7-0000-4000-8000-000000000001';
    await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'Scope LLC', 'Scope', 'scope-t', 'SCOP1', 'active') ON CONFLICT DO NOTHING`);
    await pg.exec(`INSERT INTO alerts (tenant_id, tenant_name, title, message, type, severity, status, related_module, related_record_id, dedupe_key)
                   VALUES ('${T}', 'Scope', 'tenant thing', 'm', 'tenant', 'low', 'unread', 'system_health', 'payments', 'tenant-scope-probe')`);
    const agg = new HealthAggregator(db);
    await reconcile(agg, [d('payments', 'critical')], 1_000_000);       // must still RAISE: the tenant row is not "open" for us
    await reconcile(agg, [], 1_030_000);                                // and resolving must not reach the tenant row
    const tenantRow = (await pg.query(`SELECT status, severity FROM alerts WHERE dedupe_key = 'tenant-scope-probe'`)).rows[0];
    expect(tenantRow).toEqual({ status: 'unread', severity: 'low' });
    expect((await pg.query(`SELECT count(*)::int c FROM alerts WHERE tenant_id IS NULL AND related_record_id = 'payments'`)).rows[0].c).toBe(1);
  });
});
