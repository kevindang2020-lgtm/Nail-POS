// payment-device-oversight.pgtest — Secure Tap to Pay §51 (Oct 27 2026) on the REAL migrated schema: the owner panel counts ONE
// salon only (registrations, revocations, suspensions, claim conflicts, device security events by kind, app versions), the
// platform panel counts every salon and names the salons with the most new phones in 24 h, and registrationCounts (the
// unusual-registration rule's input) counts NEW phones per salon and per employee.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyMobilePayDeviceStore } from './mobile-pay-device.kysely';
import { tenantDeviceSecuritySummary, platformDeviceSecuritySummary } from './payment-device-oversight';

let pg: any; let db: any; let store: KyselyMobilePayDeviceStore;
const TA = 'd5100000-0000-4000-8000-00000000000a', TB = 'd5100000-0000-4000-8000-00000000000b';
const UA = 'd5102000-0000-4000-8000-00000000000a', UA2 = 'd5102000-0000-4000-8000-0000000000a2', UB = 'd5102000-0000-4000-8000-00000000000b';

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg); store = new KyselyMobilePayDeviceStore(db);
  for (const [t, code, name] of [[TA, 'D51A', 'Glow Nails'], [TB, 'D51B', 'Luxe Nails']]) await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${t}', '${name}', '${name}', '${code.toLowerCase()}', '${code}', 'active')`);
  await pg.exec(`INSERT INTO users (id, tenant_id, email, full_name, role, status) VALUES ('${UA}', '${TA}', 'a@d51.test', 'Ann', 'MANAGER', 'active'), ('${UA2}', '${TA}', 'a2@d51.test', 'Al', 'MANAGER', 'active'), ('${UB}', '${TB}', 'b@d51.test', 'Bo', 'MANAGER', 'active')`);
  // salon A: 3 new phones today (2 by Ann, 1 by Al), one 40 days old; salon B: 1 phone today
  for (const [t, d, u, v] of [[TA, 'a-1', UA, '1.4.0'], [TA, 'a-2', UA, '1.4.1'], [TA, 'a-3', UA2, '1.3.9'], [TA, 'a-old', UA2, '1.2.0'], [TB, 'b-1', UB, '2.0.0']] as const) await store.upsertOnRegister(t, { deviceId: d, registeredBy: u, appVersion: v, platform: 'ios' } as any);
  await pg.exec(`UPDATE mobile_pay_devices SET created_at = now() - interval '40 days' WHERE device_id = 'a-old'`);
  await store.setStatus(TA, 'a-1', 'active', UA); await store.setStatus(TA, 'a-2', 'revoked', UA, 'lost');
  const audit = (t: string, action: string, ago = '1 hour') => pg.exec(`INSERT INTO audit_events (tenant_id, module, action, resource_type, resource_id, occurred_at) VALUES ('${t}', 'mobile_checkout', '${action}', 'mobile_checkout', 'x', now() - interval '${ago}')`);
  await audit(TA, 'mobile_pay_device_revoked'); await audit(TA, 'mobile_pay_device_suspended'); await audit(TA, 'checkout_payment_claim_conflict'); await audit(TA, 'checkout_payment_claim_conflict');
  await audit(TA, 'mobile_pay_device_revoked', '60 days');   // outside the 30-day window
  await audit(TB, 'mobile_pay_device_revoked');
  const sev = (t: string, kind: string) => pg.exec(`INSERT INTO security_events (event_type, severity, tenant_id, actor_type, resource_type, resource_id, reason) VALUES ('FRAUD_PATTERN_DETECTED', 'HIGH', '${t}', 'device', 'payment_device', 'a-2', '${kind}: test')`);
  await sev(TA, 'key_mismatch'); await sev(TA, 'key_mismatch'); await sev(TA, 'revoked_device_attempt'); await sev(TA, 'unusual_registration'); await sev(TB, 'request_replayed');
  await pg.exec(`INSERT INTO security_events (event_type, severity, tenant_id, actor_type, resource_type, reason) VALUES ('FRAUD_PATTERN_DETECTED', 'HIGH', '${TA}', 'user', 'checkout', 'key_mismatch: not a phone')`);   // another resource — not counted
}, 240_000);

describe('§51 payment-device security panels (Postgres)', () => {
  it('registrationCounts: NEW phones in 24 h per salon and per employee (the unusual-registration input)', async () => {
    expect(await store.registrationCounts(TA, UA)).toEqual({ tenantLast24h: 3, userLast24h: 2 });
    expect(await store.registrationCounts(TA, UA2)).toEqual({ tenantLast24h: 3, userLast24h: 1 });
    expect(await store.registrationCounts(TB, null)).toEqual({ tenantLast24h: 1, userLast24h: 0 });
  });
  it('owner panel: this salon only, inside the window', async () => {
    const s = await tenantDeviceSecuritySummary(db, TA);
    expect(s).toMatchObject({ scope: 'tenant', windowDays: 30, devices: { active: 1, revoked: 1, pending: 2 }, registrations: { last24h: 3, window: 3 }, revocations: 1, suspensions: 1, claimConflicts: 2 });
    expect(s.signals).toMatchObject({ key_mismatch: 2, revoked_device_attempt: 1, unusual_registration: 1, request_replayed: 0 });
    expect(s.appVersions.map((v) => v.version).sort()).toEqual(['1.2.0', '1.3.9', '1.4.0']);   // the revoked a-2 (1.4.1) cannot pay — not listed
    expect(JSON.stringify(s)).not.toContain('Luxe');
    expect(s.topRegistrations).toBeUndefined(); expect(s.process).toBeUndefined();
  });
  it('platform panel: every salon, the salons with the most new phones today, and the process counters', async () => {
    const s = await platformDeviceSecuritySummary(db);
    expect(s).toMatchObject({ scope: 'platform', registrations: { last24h: 4, window: 4 }, revocations: 2, claimConflicts: 2 });
    expect(s.signals).toMatchObject({ key_mismatch: 2, request_replayed: 1, unusual_registration: 1 });
    expect(s.topRegistrations).toEqual([{ tenantId: TA, tenantName: 'Glow Nails', last24h: 3 }, { tenantId: TB, tenantName: 'Luxe Nails', last24h: 1 }]);
    expect(s.process).toEqual(expect.objectContaining({ events: expect.any(Object), appVersions: expect.any(Object) }));
  });
  it('without a database (in-memory mode) both panels answer zeros, never throw', async () => {
    expect((await tenantDeviceSecuritySummary(null, TA)).registrations).toEqual({ last24h: 0, window: 0 });
    expect((await platformDeviceSecuritySummary(null)).topRegistrations).toEqual([]);
  });
});
