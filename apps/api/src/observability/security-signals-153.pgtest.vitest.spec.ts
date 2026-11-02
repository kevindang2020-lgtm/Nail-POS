// security-signals-153.pgtest — Security Deep Scan §153: the events that were recorded but never RAISED now open a
// security incident + ONE platform alert carrying the incident reference (correlation ref): platform admin creation /
// promotion, merchant / payment-gateway configuration changes, repeated unknown-state card payments on one ticket, and
// MALWARE / SCAN_UNAVAILABLE upload refusals. Fixed clocks.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { acceptUpload, UPLOAD_POLICIES } from '@aipowersalon/media';
import { SecuritySignals, incidentRef, routeSignalFor, RULES, PAYMENT_RETRY_THRESHOLD } from './security-signals';

let pg: any; let db: any;
beforeAll(async () => { pg = await migratedPglite(); db = kyselyFor(pg); });
beforeEach(async () => { await pg.exec(`DELETE FROM security_incidents WHERE detection_source = 'observability'; DELETE FROM alerts WHERE related_module = 'security_signal';`); });

const T0 = Date.parse('2026-10-26T10:15:00Z');
function signals(now = T0) { const s = new SecuritySignals(db); s.now = () => now; s.env = { NODE_ENV: 'test' }; return s; }
const settle = (s: SecuritySignals) => Promise.allSettled([...s.pending]);
const incidents = async () => (await pg.query(`SELECT incident_ref, category, severity, description FROM security_incidents WHERE detection_source = 'observability' ORDER BY incident_ref`)).rows;
const alerts = async () => (await pg.query(`SELECT severity, status, related_record_id, dedupe_key FROM alerts WHERE related_module = 'security_signal' ORDER BY dedupe_key`)).rows;
async function oneAlertFor(kind: Parameters<typeof incidentRef>[0], severity = 'high') {
  const ref = incidentRef(kind, new Date(T0));
  const inc = await incidents();
  expect(inc.map((i: any) => i.incident_ref)).toEqual([ref]);
  expect(await alerts()).toEqual([{ severity, status: 'unread', related_record_id: ref, dedupe_key: ref }]);
  return inc[0];
}

describe('route classification', () => {
  it('platform admin + merchant config routes, mutating only, any id, /api/v1 too', () => {
    expect(routeSignalFor('POST', '/super-admin/platform/invitations')).toBe('platform_admin_change');
    expect(routeSignalFor('PUT', '/super-admin/platform-staff/u1/role')).toBe('platform_admin_change');
    expect(routeSignalFor('PATCH', '/api/v1/super-admin/platform/users/u1/role')).toBe('platform_admin_change');
    expect(routeSignalFor('POST', '/super-admin/merchant-accounts/m1/funding-update')).toBe('merchant_config_change');
    expect(routeSignalFor('PATCH', '/super-admin/tenants/t1/payment-gateway')).toBe('merchant_config_change');
    expect(routeSignalFor('POST', '/super-admin/tenants/t1/payment-gateway/webhooks/rotate-secret?x=1')).toBe('merchant_config_change');
    expect(routeSignalFor('PUT', '/pos/settings/payments-checkout')).toBe('merchant_config_change');
    expect(routeSignalFor('GET', '/super-admin/platform/invitations')).toBeNull();
    expect(routeSignalFor('POST', '/super-admin/platform/invitations/i1/resend')).toBeNull();
    expect(routeSignalFor('POST', '/pos/checkout/tickets/t1/pay')).toBeNull();
  });
});

describe('§153 platform admin creation / promotion', () => {
  it('a successful invite → one HIGH privilege incident + one open alert with the incident ref; a refused one → nothing', async () => {
    const s = signals();
    s.observeResponse({ status: 403, method: 'POST', path: '/super-admin/platform/invitations', ip: '203.0.113.1', userId: 'sa1' });
    await settle(s); expect(await incidents()).toEqual([]);
    s.observeResponse({ status: 201, method: 'POST', path: '/super-admin/platform/invitations', ip: '203.0.113.1', userId: 'sa1' });
    await settle(s);
    const inc = await oneAlertFor('platform_admin_change');
    expect(inc).toMatchObject({ category: 'privilege', severity: 'high' });
    expect(inc.description).toContain('POST /super-admin/platform/invitations by user sa1');
  });
  it('a second promotion in the same hour extends the incident — still one alert', async () => {
    const s = signals();
    s.observeResponse({ status: 200, method: 'PUT', path: '/super-admin/platform-staff/u7/role', ip: '203.0.113.1', userId: 'sa1' });
    s.observeResponse({ status: 200, method: 'PUT', path: '/super-admin/platform-staff/u8/role', ip: '203.0.113.1', userId: 'sa1' });
    await settle(s);
    const inc = await oneAlertFor('platform_admin_change');
    expect(inc.description).toContain('/u7/role'); expect(inc.description).toContain('/u8/role');
  });
});

describe('§153 merchant / payment gateway configuration', () => {
  it('a gateway change → one HIGH fraud incident + alert', async () => {
    const s = signals();
    s.observeResponse({ status: 200, method: 'PATCH', path: '/super-admin/tenants/t1/payment-gateway', ip: '203.0.113.2', userId: 'sa2' });
    await settle(s);
    expect(await oneAlertFor('merchant_config_change')).toMatchObject({ category: 'fraud' });
  });
});

describe('§153 repeated unknown-state payment retries on one ticket', () => {
  const T = 'd1530000-0000-4000-8000-00000000000a', BR = 'd1530000-0000-4000-8000-0000000000b1';
  it(`${PAYMENT_RETRY_THRESHOLD} unresolved card payments on one ticket within 30 min → one alert; raised once per ticket per window`, async () => {
    await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'S153', 'S153', 's153', 'S153', 'active') ON CONFLICT DO NOTHING`);
    await pg.exec(`INSERT INTO branches (id, tenant_id, name) VALUES ('${BR}', '${T}', 'A') ON CONFLICT DO NOTHING`);
    const cust = (await pg.query(`INSERT INTO customers (tenant_id, branch_id, first_name, last_name, full_name) VALUES ($1, $2, 'P', 'R', 'P R') RETURNING id`, [T, BR])).rows[0].id;
    const ticket = (await pg.query(`INSERT INTO tickets (tenant_id, branch_id, customer_id) VALUES ($1, $2, $3) RETURNING id`, [T, BR, cust])).rows[0].id;
    const calm = (await pg.query(`INSERT INTO tickets (tenant_id, branch_id, customer_id) VALUES ($1, $2, $3) RETURNING id`, [T, BR, cust])).rows[0].id;
    const at = new Date(T0 - 5 * 60_000).toISOString();
    for (let i = 0; i < PAYMENT_RETRY_THRESHOLD; i++) await pg.query(`INSERT INTO payments (tenant_id, branch_id, ticket_id, method, amount_cents, status, created_at) VALUES ($1, $2, $3, 'card', 5000, 'processing', $4)`, [T, BR, ticket, at]);
    await pg.query(`INSERT INTO payments (tenant_id, branch_id, ticket_id, method, amount_cents, status, created_at) VALUES ($1, $2, $3, 'card', 5000, 'processing', $4)`, [T, BR, calm, at]);
    const s = signals();
    expect(await s.checkPaymentRetries()).toBe(1);
    expect(await s.checkPaymentRetries()).toBe(0);                                   // same window: not raised again
    await settle(s);
    const inc = await oneAlertFor('payment_retry_unknown');
    expect(inc.description).toContain(`ticket ${ticket}`);
    expect(inc.description).not.toContain(calm);
  });
});

describe('§153 upload refusals', () => {
  it('MALWARE (through the real upload policy) → one HIGH data incident + alert', async () => {
    const s = signals(); s.onModuleInit();
    try {
      const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4520000000049454e44ae426082', 'hex');
      await expect(acceptUpload(UPLOAD_POLICIES.avatar, { bytes: png, filename: 'a.png', declaredType: 'image/png', tenantId: null },
        { scanner: { scan: async () => ({ status: 'infected', detail: 'Eicar-Test-Signature' }) } as any })).rejects.toMatchObject({ reason: 'MALWARE' });
    } finally { s.onModuleDestroy(); }
    await settle(s);
    expect(await oneAlertFor('upload_malware')).toMatchObject({ category: 'data' });
  });
  it(`SCAN_UNAVAILABLE: below ${RULES.upload_scan_unavailable.threshold} in 15 min nothing; at it one MEDIUM incident + alert`, async () => {
    const s = signals();
    for (let i = 0; i < RULES.upload_scan_unavailable.threshold - 1; i++) s.observeUploadRefusal({ reason: 'SCAN_UNAVAILABLE', kind: 'support/pdf' });
    await settle(s); expect(await incidents()).toEqual([]);
    s.observeUploadRefusal({ reason: 'SCAN_UNAVAILABLE', kind: 'support/pdf' });
    await settle(s);
    expect(await oneAlertFor('upload_scan_unavailable', 'medium')).toMatchObject({ category: 'data' });
  });
});
