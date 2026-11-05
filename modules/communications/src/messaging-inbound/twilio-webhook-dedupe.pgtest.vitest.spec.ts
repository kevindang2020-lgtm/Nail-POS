// twilio-webhook-dedupe.pgtest — BUILD_PLAN Phase 14 (Constitution 12 "webhook dedupe verified per provider") on the
// real migrated schema: Twilio inbound SMS (POST /webhooks/twilio/sms/inbound) and the message-status callback
// (POST /webhooks/twilio/sms/status). Twilio retries; a retried delivery — in sequence or racing the original — changes
// the database once. A forged signature changes nothing.
//   inbound STOP twice  → one notification_opt_outs row
//   status "failed" ×2  → the message moves once, ONE communication.sms_delivery_failed outbox event
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { migratedPglite, kyselyFor, testProviderSecrets } from '@aipowersalon/testing';
import { computeTwilioSignature } from '@aipowersalon/notifications';
import { OutboxWriter } from '@aipowersalon/events';
import { TwilioInboundService } from './twilio-inbound.service';
import { NotificationsService } from '../notifications/notifications.service';
import { KyselyNotificationsRepository } from '../notifications/notifications.kysely.repository';
import { KyselyOptOutRepository } from '../notifications/notifications.optout.kysely.repository';

const T = 'e1400000-0000-4000-8000-00000000000a';
const NUM = '+18565550140', FROM = '+15551230140';
const TOKEN = 'p14-twilio-fixture-token';   // test fixture, not a credential
const IN_URL = 'https://api.example.test/webhooks/twilio/sms/inbound';
const ST_URL = 'https://api.example.test/webhooks/twilio/sms/status';
let pg: any; let db: any; let svc: TwilioInboundService;
const count = async (q: string, p: unknown[] = []) => Number((await pg.query(q, p)).rows[0].c);
const prevToken = process.env.TWILIO_AUTH_TOKEN;

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'TW', 'TW', 'tw-p14', 'TWP14', 'active');
    INSERT INTO tenant_messaging_numbers (tenant_id, phone_number, channel, provider) VALUES ('${T}', '${NUM}', 'sms', 'twilio');`);
  const notifications = new NotificationsService(new KyselyNotificationsRepository(db, new OutboxWriter()), {} as any, {} as any, undefined, new KyselyOptOutRepository(db));
  svc = new TwilioInboundService(db, notifications, testProviderSecrets);
}, 120_000);
beforeEach(() => { process.env.TWILIO_AUTH_TOKEN = TOKEN; });
afterAll(() => { if (prevToken === undefined) delete process.env.TWILIO_AUTH_TOKEN; else process.env.TWILIO_AUTH_TOKEN = prevToken; });

describe('Twilio inbound SMS: a retried STOP is one opt-out', () => {
  const params = { MessageSid: 'SMp14inbound0001', From: FROM, To: NUM, Body: 'STOP' };
  const deliver = (signature = computeTwilioSignature(TOKEN, IN_URL, params)) =>
    svc.handleInbound({ from: params.From, to: params.To, body: params.Body, signature, url: IN_URL, params });

  it('delivered twice in sequence and twice concurrently → one notification_opt_outs row', async () => {
    expect(await deliver()).toEqual({ status: 'opted_out', tenantId: T });
    expect(await deliver()).toEqual({ status: 'opted_out', tenantId: T });
    await Promise.all([deliver(), deliver()]);
    expect(await count(`SELECT count(*)::int c FROM notification_opt_outs WHERE tenant_id = $1 AND address = $2`, [T, FROM])).toBe(1);
  });
  it('a forged signature is refused and writes nothing', async () => {
    const p = { ...params, From: '+15551239999' };
    const r = await svc.handleInbound({ from: p.From, to: p.To, body: 'STOP', signature: computeTwilioSignature('not-the-token', IN_URL, p), url: IN_URL, params: p });
    expect(r).toEqual({ status: 'ignored', reason: 'bad_signature' });
    expect(await count(`SELECT count(*)::int c FROM notification_opt_outs WHERE address = '+15551239999'`)).toBe(0);
  });
});

describe('Twilio status callback: a retried "failed" moves the message once and emits ONE failure event', () => {
  const SID = 'SMp14status00001';
  beforeAll(async () => {
    await pg.query(`INSERT INTO notifications (tenant_id, channel, to_address, body, status, provider_id) VALUES ($1, 'sms', $2, 'Your visit is confirmed', 'sent', $3)`, [T, FROM, SID]);
  });
  const params = { MessageSid: SID, MessageStatus: 'failed', ErrorCode: '30003' };
  const deliver = (signature = computeTwilioSignature(TOKEN, ST_URL, params)) =>
    svc.handleStatus({ sid: SID, status: 'failed', signature, url: ST_URL, params });

  it('in sequence and concurrently → status failed, exactly one sms_delivery_failed event', async () => {
    expect(await deliver()).toEqual({ status: 'recorded', updated: 1 });
    await deliver();
    await Promise.all([deliver(), deliver()]);
    expect((await pg.query(`SELECT status FROM notifications WHERE provider_id = $1`, [SID])).rows[0].status).toBe('failed');
    expect(await count(`SELECT count(*)::int c FROM outbox_events WHERE event_type = 'communication.sms_delivery_failed' AND tenant_id = $1`, [T])).toBe(1);
  });
  it('a forged status callback is refused and moves nothing', async () => {
    const sid = 'SMp14status00002';
    await pg.query(`INSERT INTO notifications (tenant_id, channel, to_address, body, status, provider_id) VALUES ($1, 'sms', $2, 'x', 'sent', $3)`, [T, FROM, sid]);
    const p = { MessageSid: sid, MessageStatus: 'failed' };
    expect(await svc.handleStatus({ sid, status: 'failed', signature: computeTwilioSignature('not-the-token', ST_URL, p), url: ST_URL, params: p })).toEqual({ status: 'ignored', reason: 'bad_signature' });
    expect((await pg.query(`SELECT status FROM notifications WHERE provider_id = $1`, [sid])).rows[0].status).toBe('sent');
  });
});
