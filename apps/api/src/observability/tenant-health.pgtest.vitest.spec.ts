// tenant-health.pgtest — Constitution 11 §156–159, §299–300, §339: one salon's health from facts it already has.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { Reflector } from '@nestjs/core';
import { TenantHealthService, TenantHealthController, evaluateTenantHealth, tenantOverall, type TenantFacts } from './tenant-health';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';

let pg: any; let db: any;
const T = 'd1d1d1d1-0000-4000-8000-00000000000a', OTHER = 'd1d1d1d1-0000-4000-8000-00000000000b';
const NOW = new Date('2026-09-21T15:00:00Z');
beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  for (const [t, code] of [[T, 'THA1'], [OTHER, 'THB1']]) await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${t}', '${code}', 'Salon ${code}', '${code.toLowerCase()}', '${code}', 'active') ON CONFLICT DO NOTHING`);
});
beforeEach(async () => {
  for (const tbl of ['tenant_payment_config', 'tenant_messaging_credentials', 'tenant_a2p_registrations', 'booking_verification_usage_daily', 'go_checkin_devices', 'ai_jobs'])
    await pg.exec(`DELETE FROM ${tbl} WHERE tenant_id IN ('${T}', '${OTHER}')`);
});
const base = (): TenantFacts => ({ payment: { status: 'active', onboarding: 'approved' }, paymentAttempts24h: { total: 0, failed: 0 }, messaging: { status: 'configured', validationError: null },
  a2pCampaign: 'APPROVED', sms24h: { total: 100, failed: 1 }, verification2d: { sent: 50, verified: 48, failed: 2 }, devices: { active: 3, notSeen24h: 0 }, jobs24h: { aiFailed: 0, importsFailed7d: 0 }, failed: [] });

describe('SILENT-SQL-RISK: every fact query runs against the real schema', () => {
  it('a real salon\'s facts read with NO failed queries — a wrong column would otherwise read as "not configured"', async () => {
    const f = await new TenantHealthService(db).facts(T, NOW);
    expect(f.failed).toEqual([]);
  });
  it('a query that REALLY fails inside facts() is recorded — not swallowed into "no row"', async () => {
    // The pure test below hands in the failure list, so it could not see whether facts() records one: a mutation that
    // swallowed errors into "no row" passed every test. This makes ONE real query fail at the database layer.
    const real = kyselyFor(pg);
    const failing = new Proxy(real, { get(t: any, p) {
      if (p !== 'getExecutor') return t[p];
      return () => { const ex = t.getExecutor(); return new Proxy(ex, { get(e: any, q) {
        if (q !== 'executeQuery') return typeof e[q] === 'function' ? e[q].bind(e) : e[q];
        return async (c: any, ...rest: any[]) => { if (String(c.sql).includes('tenant_messaging_credentials')) throw new Error('column does not exist'); return e.executeQuery(c, ...rest); };
      } }); };
    } });
    const h = await new TenantHealthService(failing).health(T, NOW);
    expect(h.failedQueries).toEqual(['messaging_credentials']);
    expect(h.components.messaging).toMatchObject({ state: 'UNKNOWN', reason: 'query_failed:messaging_credentials' });
    expect(h.components.messaging.reason).not.toBe('not_used');
  });
  it('a failed query makes its component UNKNOWN and NAMED — never "not configured", never "zero failures"', () => {
    const c = evaluateTenantHealth({ ...base(), messaging: null, failed: ['messaging_credentials'] });
    expect(c.messaging).toMatchObject({ state: 'UNKNOWN', reason: 'query_failed:messaging_credentials' });
    expect(c.payments.state).toBe('HEALTHY');                         // other components unaffected
  });
});

describe('§299 the salon\'s own configuration vs a provider outage', () => {
  it('invalid Twilio credentials are MISCONFIGURED (the salon\'s problem), not an outage', () => {
    expect(evaluateTenantHealth({ ...base(), messaging: { status: 'configured', validationError: 'Authenticate' } }).messaging).toMatchObject({ state: 'MISCONFIGURED', reason: 'twilio_credentials_invalid' });
  });
  it('a rejected A2P campaign is MISCONFIGURED; one still in progress is DEGRADED (texts may be filtered)', () => {
    expect(evaluateTenantHealth({ ...base(), a2pCampaign: 'FAILED' }).messaging.state).toBe('MISCONFIGURED');
    expect(evaluateTenantHealth({ ...base(), a2pCampaign: 'IN_PROGRESS' }).messaging.reason).toBe('a2p_campaign_not_approved');
  });
  it('payment config in error or onboarding declined is MISCONFIGURED', () => {
    expect(evaluateTenantHealth({ ...base(), payment: { status: 'error', onboarding: 'approved' } }).payments.state).toBe('MISCONFIGURED');
    expect(evaluateTenantHealth({ ...base(), payment: { status: 'active', onboarding: 'declined' } }).payments.reason).toBe('merchant_onboarding_declined');
  });
});

describe('judgement calls', () => {
  it('§58 card attempt failures are SHOWN but never judged — many are customer declines', () => {
    const c = evaluateTenantHealth({ ...base(), paymentAttempts24h: { total: 100, failed: 90 } });
    expect(c.payments.state).toBe('HEALTHY');
    expect(c.payments.details).toMatchObject({ failedAttempts24h: 90 });
  });
  it('a feature the salon does not use is UNKNOWN "not_used" and does not affect the overall', () => {
    const c = evaluateTenantHealth({ ...base(), messaging: { status: 'not_configured', validationError: null } });
    expect(c.messaging).toMatchObject({ state: 'UNKNOWN', reason: 'not_used' });
    expect(tenantOverall(c)).toBe('HEALTHY');
  });
  it('below 20 messages a failure rate is noise, not a finding', () => {
    expect(evaluateTenantHealth({ ...base(), sms24h: { total: 5, failed: 4 } }).messaging.state).toBe('HEALTHY');
    expect(evaluateTenantHealth({ ...base(), sms24h: { total: 40, failed: 25 } }).messaging.state).toBe('OUTAGE');
    expect(evaluateTenantHealth({ ...base(), sms24h: { total: 40, failed: 10 } }).messaging.state).toBe('DEGRADED');
  });
  it('devices are judged over 24 h — some offline is DEGRADED, all offline is OUTAGE', () => {
    expect(evaluateTenantHealth({ ...base(), devices: { active: 3, notSeen24h: 1 } }).devices.state).toBe('DEGRADED');
    expect(evaluateTenantHealth({ ...base(), devices: { active: 3, notSeen24h: 3 } }).devices.state).toBe('OUTAGE');
  });
  it('§157 no opaque score: the overall is the worst IN-USE component, and a salon using nothing is UNKNOWN', () => {
    expect(tenantOverall(evaluateTenantHealth({ ...base(), payment: { status: 'error', onboarding: 'approved' } }))).toBe('MISCONFIGURED');
    const none = evaluateTenantHealth({ ...base(), payment: null, messaging: null, verification2d: { sent: 0, verified: 0, failed: 0 }, devices: { active: 0, notSeen24h: 0 }, jobs24h: { aiFailed: 0, importsFailed7d: 0 } });
    expect(tenantOverall({ ...none, jobs: { state: 'UNKNOWN', reason: 'x', details: {} } })).toBe('UNKNOWN');
  });
});

describe('end to end on real rows', () => {
  it('reads the salon\'s real facts: config error, bad credentials, a stale device, a failed AI job', async () => {
    await pg.exec(`INSERT INTO tenant_payment_config (tenant_id, status, onboarding_status) VALUES ('${T}', 'error', 'approved');
      INSERT INTO tenant_messaging_credentials (tenant_id, status, last_validation_error) VALUES ('${T}', 'configured', 'Authenticate');
      INSERT INTO booking_verification_usage_daily (tenant_id, usage_date, sent_count, verified_count, failed_count) VALUES ('${T}', '2026-09-21', 40, 20, 20);
      INSERT INTO go_checkin_devices (tenant_id, device_name, checkin_slug, status, last_seen_at) VALUES ('${T}', 'Front', 'th-front', 'active', '2026-09-19T10:00:00Z'), ('${T}', 'Back', 'th-back', 'active', '2026-09-21T14:55:00Z');
      INSERT INTO ai_jobs (tenant_id, module, task_key, input_reference, status, created_at) VALUES ('${T}', 'm', 't', 'r', 'FAILED', '2026-09-21T09:00:00Z')`);
    const h = await new TenantHealthService(db).health(T, NOW);
    expect(h.failedQueries).toEqual([]);
    expect(h.tenantName).toBe('Salon THA1');
    expect(h.components.payments.state).toBe('MISCONFIGURED');
    expect(h.components.messaging.reason).toBe('twilio_credentials_invalid');
    expect(h.components.booking).toMatchObject({ state: 'DEGRADED', reason: 'verification_failures_high' });
    expect(h.components.devices).toMatchObject({ state: 'DEGRADED', details: { activeDevices: 2, notSeen24h: 1 } });
    expect(h.components.jobs.state).toBe('DEGRADED');
    expect(h.overall).toBe('MISCONFIGURED');
  });
  it('another salon\'s facts never leak in — every query is tenant-scoped', async () => {
    await pg.exec(`INSERT INTO tenant_payment_config (tenant_id, status, onboarding_status) VALUES ('${OTHER}', 'error', 'declined');
      INSERT INTO ai_jobs (tenant_id, module, task_key, input_reference, status, created_at) VALUES ('${OTHER}', 'm', 't', 'r', 'FAILED', '2026-09-21T09:00:00Z')`);
    const h = await new TenantHealthService(db).health(T, NOW);
    expect(h.components.payments).toMatchObject({ state: 'UNKNOWN', reason: 'not_configured' });
    expect(h.components.jobs.state).toBe('HEALTHY');
  });
  it('an unknown salon is a 404', async () => {
    await expect(new TenantHealthService(db).health('e0e0e0e0-0000-4000-8000-000000000000', NOW)).rejects.toThrow(/Tenant not found/);
  });
  it('the response carries statuses and counts only — no customer or message content (§159)', async () => {
    const h = await new TenantHealthService(db).health(T, NOW);
    expect(JSON.stringify(h)).not.toMatch(/phone|email|@|\+1\d{10}/i);
  });
});

describe('§180 permission', () => {
  it('the route requires super_admin.system_operations.view', () => {
    expect(new Reflector().get('perm', TenantHealthController.prototype.health)).toBe('super_admin.system_operations.view');
  });
});
