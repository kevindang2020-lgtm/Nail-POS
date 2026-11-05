// integration-webhook-dedupe.pgtest — BUILD_PLAN Phase 14 (Constitution 12 "webhook dedupe verified per provider") on the
// real migrated schema: the integrations inbound webhook (POST /integrations/inbound/:connectionId). The same signed
// provider event — in sequence and racing — is ONE integration_webhook_events row, and two drains racing over the queue
// run its handler ONCE. A bad signature is refused and only leaves a rejected security-feed row (never a dedup key).
import { describe, it, expect, beforeAll } from 'vitest';
import { createHmac } from 'node:crypto';
import { migratedPglite, kyselyFor, testProviderSecrets } from '@aipowersalon/testing';
import { WebhookIngestService, type WebhookHandler } from './webhook-ingest.service';
import { IntegrationWebhookRepo } from './integration-webhook.kysely.repository';
import { IntegrationConnectionsRepo } from './integration-connections.kysely.repository';

const T = 'e3400000-0000-4000-8000-00000000000a';
const SECRET = 'p14-integration-fixture';   // test fixture, not a credential
let pg: any; let db: any; let conn: string;
const handled: string[] = [];
const handler: WebhookHandler = async (ev) => { handled.push(ev.meta.eventId); await new Promise((r) => setTimeout(r, 5)); };
const sign = (raw: string, secret = SECRET) => { const t = Math.floor(Date.now() / 1000); return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`; };
const count = async (q: string, p: unknown[] = []) => Number((await pg.query(q, p)).rows[0].c);
let svc: WebhookIngestService;

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ('${T}', 'IN', 'IN', 'in-p14', 'INP14', 'active')`);
  conn = (await pg.query(`INSERT INTO integration_connections (tenant_id, provider_key, category, connection_status) VALUES ($1, 'clover', 'Payments', 'active') RETURNING id::text id`, [T])).rows[0].id;
  await pg.query(`INSERT INTO integration_credential_references (connection_id, kind, secret_enc) VALUES ($1, 'webhook_secret', $2)`, [conn, testProviderSecrets.encrypt(SECRET)]);
  svc = new WebhookIngestService(new IntegrationWebhookRepo(db), new IntegrationConnectionsRepo(db, testProviderSecrets), db, undefined, { clover: handler });
}, 120_000);

describe('integrations inbound webhook: one signed event is one event, processed once', () => {
  it('delivered twice in sequence and twice concurrently → one row; the repeats answer "duplicate"', async () => {
    const raw = JSON.stringify({ id: 'evt_p14_int_1', type: 'payment.updated' });
    expect(await svc.processInbound({ connectionId: conn, rawBody: raw, signatureHeader: sign(raw) })).toMatchObject({ ok: true, code: 'accepted', status: 202 });
    expect(await svc.processInbound({ connectionId: conn, rawBody: raw, signatureHeader: sign(raw) })).toMatchObject({ ok: true, code: 'duplicate', deduped: true });
    const race = await Promise.all([svc.processInbound({ connectionId: conn, rawBody: raw, signatureHeader: sign(raw) }), svc.processInbound({ connectionId: conn, rawBody: raw, signatureHeader: sign(raw) })]);
    expect(race.map((r) => r.code)).toEqual(['duplicate', 'duplicate']);
    expect(await count(`SELECT count(*)::int c FROM integration_webhook_events WHERE connection_id = $1 AND provider_event_id = 'evt_p14_int_1'`, [conn])).toBe(1);
  });

  it('two drains racing over the queue run the handler ONCE per event', async () => {
    const raw = JSON.stringify({ id: 'evt_p14_int_2', type: 'payment.updated' });
    await svc.processInbound({ connectionId: conn, rawBody: raw, signatureHeader: sign(raw) });
    handled.length = 0;
    await Promise.all([svc.drainWebhookQueue({}), svc.drainWebhookQueue({}), svc.drainWebhookQueue({})]);
    expect(handled.sort()).toEqual(['evt_p14_int_1', 'evt_p14_int_2']);
    expect(await count(`SELECT count(*)::int c FROM integration_webhook_events WHERE connection_id = $1 AND status = 'processed' AND attempt_count = 1`, [conn])).toBe(2);
    await svc.drainWebhookQueue({});   // nothing left to do
    expect(handled.length).toBe(2);
  });

  it('a bad signature is refused (401): no dedup row for the event, one rejected row for the security feed', async () => {
    const raw = JSON.stringify({ id: 'evt_p14_int_forged', type: 'payment.updated' });
    expect(await svc.processInbound({ connectionId: conn, rawBody: raw, signatureHeader: sign(raw, 'not-the-secret') })).toMatchObject({ ok: false, code: 'signature_invalid', status: 401 });
    expect(await count(`SELECT count(*)::int c FROM integration_webhook_events WHERE provider_event_id = 'evt_p14_int_forged'`)).toBe(0);
    expect(await count(`SELECT count(*)::int c FROM integration_webhook_events WHERE connection_id = $1 AND signature_result = 'invalid'`, [conn])).toBe(1);
  });
});
