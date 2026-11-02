// mobile-pay-device-revocation.pgtest — Owner & Manager Payment App mandate §140 (termination hook) on the real schema,
// through the real outbox → consumer runner: when a user's employment ends (users.status inactive / suspended / …) and
// identity records the AUTHORIZATION_CHANGED, every payment phone BOUND to that user is revoked (reason recorded); a
// still-active user, another user's phone and another tenant's phone are untouched; a redelivery is a no-op.
import { OutboxWriter, DOMAIN_EVENTS, createDomainEvent } from '@aipowersalon/events';
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { ConsumerRegistry, InProcessTransport } from '../event-transport';
import { OutboxPublisher } from '../outbox-publisher';
import { ConsumerRunner } from '../consumer-runner';
import { MobilePayDeviceRevocationConsumer } from './mobile-pay-device-revocation.consumer';

const T = 'ea660000-0000-4000-8000-000000000001', T2 = 'ea660000-0000-4000-8000-000000000002', B = 'ea660000-0000-4000-8000-0000000000b1';
const MGR = 'ea660000-0000-4000-8000-0000000000e1', MGR2 = 'ea660000-0000-4000-8000-0000000000e2';
let db: any; let publisher: OutboxPublisher;
const outbox = new OutboxWriter();
const emit = async (userId: string, tenantId = T, change = 'access.revoke') => {
  await outbox.write(db, createDomainEvent({ eventType: DOMAIN_EVENTS.AUTHORIZATION_CHANGED, tenantId, aggregateType: 'user', aggregateId: userId, actorType: 'user', payload: { userId, change, version: 2 } }));
  await publisher.tick();
};
const dev = async (deviceId: string, tenantId = T) => (await sql`select status, revoke_reason, revoked_at from mobile_pay_devices where tenant_id = ${tenantId} and device_id = ${deviceId}`.execute(db)).rows[0] as any;

beforeAll(async () => {
  const pg = await migratedPglite();
  db = kyselyFor(pg);
  await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'N', 'N', 'ttpn', 'TTPN1', 'active'), (${T2}, 'O', 'O', 'ttpo', 'TTPO2', 'active')`.execute(db);
  await sql`insert into branches (id, tenant_id, name) values (${B}, ${T}, 'Main')`.execute(db);
  await sql`insert into users (id, tenant_id, first_name, last_name, full_name, email, status, role) values
    (${MGR}, ${T}, 'Mia', 'Manager', 'Mia Manager', 'mia@ttp.test', 'active', 'MANAGER'),
    (${MGR2}, ${T}, 'Max', 'Other', 'Max Other', 'max@ttp.test', 'active', 'MANAGER')`.execute(db);
  await sql`insert into mobile_pay_devices (tenant_id, branch_id, device_id, platform, status, bound_user_id) values
    (${T}, ${B}, 'phone-mia-1', 'ios', 'active', ${MGR}),
    (${T}, ${B}, 'phone-mia-2', 'ios', 'pending', ${MGR}),
    (${T}, ${B}, 'phone-max', 'ios', 'active', ${MGR2}),
    (${T2}, null, 'phone-mia-1', 'ios', 'active', ${MGR})`.execute(db);
  const registry = new ConsumerRegistry(); registry.register(new MobilePayDeviceRevocationConsumer());
  publisher = new OutboxPublisher(db, new InProcessTransport(db, registry, new ConsumerRunner(db, { rand: () => 0 })));
}, 120_000);

describe('mobile_payment.revoke_devices_on_deactivation (§140)', () => {
  it('an authorization change for a STILL-ACTIVE user revokes nothing', async () => {
    await emit(MGR, T, 'role.change');
    expect((await dev('phone-mia-1')).status).toBe('active');
    expect((await dev('phone-mia-2')).status).toBe('pending');
  });

  it('employment ended → every phone bound to that user in THIS tenant is revoked with the reason; others untouched', async () => {
    await sql`update users set status = 'inactive' where id = ${MGR}`.execute(db);
    await emit(MGR);
    const a = await dev('phone-mia-1'); const b = await dev('phone-mia-2');
    expect(a.status).toBe('revoked'); expect(a.revoke_reason).toBe('employment_ended:access.revoke'); expect(a.revoked_at).toBeTruthy();
    expect(b.status).toBe('revoked');
    expect((await dev('phone-max')).status).toBe('active');            // another user's phone
    expect((await dev('phone-mia-1', T2)).status).toBe('active');      // same device id in another tenant
  });

  it('a redelivery is a no-op (REPLAY_SAFE) and keeps the first revocation time', async () => {
    const before = (await dev('phone-mia-1')).revoked_at;
    await emit(MGR);
    expect(String((await dev('phone-mia-1')).revoked_at)).toBe(String(before));
  });
});
