// messenger-events.pgtest — BUILD_PLAN Phase 2 (Constitution 8): the tenant messenger's facts reach the outbox.
// communication.sms_sent / communication.sms_delivery_failed / communication.push_sent were declared in the event
// contract and produced by nothing. Each is now written in the SAME transaction as its ledger row, through the real
// NotificationsService and repositories on a migrated database (mock providers only).
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { OutboxWriter } from '@aipowersalon/events';
import { MockSmsSender, MockEmailSender } from '@aipowersalon/notifications';
import { NotificationsService } from './notifications.service';
import { KyselyNotificationsRepository } from './notifications.kysely.repository';
import { KyselyPushRepository } from '../push/push.kysely.repository';

const T = '11111111-1111-4111-8111-111111111111';
let db: any;
const events = async (type: string) => (await sql`SELECT tenant_id, aggregate_id, payload_json FROM outbox_events WHERE event_type = ${type} ORDER BY occurred_at`.execute(db)).rows as any[];

beforeAll(async () => {
  const pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.query(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, lifecycle_state) VALUES ($1, 'Messenger Salon LLC', 'Messenger Salon', 'messenger-salon', 'MSG001', 'active') ON CONFLICT DO NOTHING`, [T]);
});
beforeEach(async () => { await sql`DELETE FROM outbox_events`.execute(db); await sql`DELETE FROM notifications`.execute(db); });

describe('tenant messenger events (Constitution 8)', () => {
  it('a salon text writes its ledger row and communication.sms_sent together — never the body or the number', async () => {
    const svc = new NotificationsService(new KyselyNotificationsRepository(db, new OutboxWriter()), new MockSmsSender(), new MockEmailSender());
    const r = await svc.sendSms({ tenantId: T, to: '+18565550100', body: 'Your receipt R-1', purpose: 'receipt' });
    expect(r).toMatchObject({ sent: true, simulated: true });
    const rows = (await sql`SELECT id, status FROM notifications WHERE tenant_id = ${T}`.execute(db)).rows as any[];
    expect(rows).toHaveLength(1);
    const [e] = await events('communication.sms_sent');
    expect(e).toMatchObject({ tenant_id: T, aggregate_id: String(rows[0].id) });
    expect(e.payload_json).toMatchObject({ channel: 'sms', purpose: 'receipt', simulated: true });
    expect(JSON.stringify(e.payload_json)).not.toMatch(/8565550100|receipt R-1/);
  });

  it('a provider failure is communication.sms_delivery_failed (stage send); a later carrier failure emits once', async () => {
    const failing = new NotificationsService(new KyselyNotificationsRepository(db, new OutboxWriter()), { async send() { throw new Error('provider down'); } } as any, new MockEmailSender());
    const r = await failing.sendSms({ tenantId: T, to: '+18565550101', body: 'x', purpose: 'reminder' });
    expect(r.sent).toBe(false);
    expect((await events('communication.sms_delivery_failed')).map((e) => e.payload_json.stage)).toEqual(['send']);

    // a real provider stand-in (not the mock: a simulated row is terminal — no carrier ever calls back, P-11)
    const ok = new NotificationsService(new KyselyNotificationsRepository(db, new OutboxWriter()), { async send() { return { sid: 'SM-PROVIDER-1' }; } } as any, new MockEmailSender());
    const sent = await ok.sendSms({ tenantId: T, to: '+18565550102', body: 'y', purpose: 'reminder' });
    const repo = new KyselyNotificationsRepository(db, new OutboxWriter());
    await repo.updateDeliveryByProvider(sent.providerId!, 'failed', '30007 carrier filtered', null);
    await repo.updateDeliveryByProvider(sent.providerId!, 'failed', '30007 carrier filtered', null);   // repeated callback
    expect((await events('communication.sms_delivery_failed')).map((e) => e.payload_json.stage)).toEqual(['send', 'carrier']);
  });

  it('a platform text (no salon yet) is sent without a salon ledger row or event', async () => {
    const provider = new MockSmsSender();
    const svc = new NotificationsService(new KyselyNotificationsRepository(db, new OutboxWriter()), provider, new MockEmailSender());
    expect((await svc.sendSms({ tenantId: null, to: '+18565550103', body: 'code 123456', purpose: 'account' })).sent).toBe(true);
    expect(provider.sent).toHaveLength(1);
    expect(await events('communication.sms_sent')).toHaveLength(0);
  });

  it('a push handed to the provider for a salon is communication.push_sent; a failed push is not', async () => {
    const repo = new KyselyPushRepository(db, new OutboxWriter());
    const U = '33333333-3333-4333-8333-333333333333';
    await repo.logDelivery({ tenantId: T, userId: U, token: 'tok-abcdef123456', template: 'appointment_reminder', result: { ok: true, providerId: 'fcm-1' } as any });
    await repo.logDelivery({ tenantId: T, userId: U, token: 'tok-abcdef123456', template: 'appointment_reminder', result: { ok: false, error: 'unregistered' } as any });
    const pushes = await events('communication.push_sent');
    expect(pushes).toHaveLength(1);
    expect(pushes[0].payload_json).toMatchObject({ userId: U, template: 'appointment_reminder', providerId: 'fcm-1' });
    expect(JSON.stringify(pushes[0].payload_json)).not.toContain('tok-abcdef');
    expect((await sql`SELECT count(*)::int AS n FROM notification_delivery_logs WHERE tenant_id = ${T} AND channel = 'push'`.execute(db)).rows[0]).toMatchObject({ n: 2 });
  });
});
