// twilio-tenant-binding.pgtest — security fixes E1 + E2 (Oct 23 2026), on the real migrated schema, with two salons.
//
// E1: a messaging number belongs to ONE salon on EVERY write path. The credentials form used to upsert
//     `ON CONFLICT (phone_number) DO UPDATE SET tenant_id = <caller>` — salon B saving salon A's number as its "from"
//     took over A's inbound texts. Now refused; and migration 684's trigger refuses any UPDATE that moves a number.
// E2: the Twilio inbound/status webhooks resolve the tenant from OUR data (the To number / the stored message row) and
//     verify with a token THAT tenant may sign with. Before, the token was chosen by the request's AccountSid, so salon B
//     could sign with its own self-entered token and opt salon A's customers in or out, or move A's delivery statuses.
// Every "refused" case below succeeded on the old code.
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor, testProviderSecrets } from '@aipowersalon/testing';
import { computeTwilioSignature } from '@aipowersalon/notifications';
import { OutboxWriter } from '@aipowersalon/events';
import { TwilioInboundService } from './twilio-inbound.service';
import { NotificationsService } from '../notifications/notifications.service';
import { KyselyNotificationsRepository } from '../notifications/notifications.kysely.repository';
import { KyselyOptOutRepository } from '../notifications/notifications.optout.kysely.repository';
import { TenantMessagingCredentialsService, CredentialsInputError } from '../tenant-messaging/tenant-messaging-credentials.service';

const A = 'e2a00000-0000-4000-8000-00000000000a', B = 'e2b00000-0000-4000-8000-00000000000b', C = 'e2c00000-0000-4000-8000-00000000000c';
const AC_A = 'AC' + 'a'.repeat(32), AC_B = 'AC' + 'b'.repeat(32), AC_PLATFORM = 'AC' + 'f'.repeat(32);
const TOK_A = 'fixture-token-salon-a', TOK_B = 'fixture-token-salon-b', TOK_PLATFORM = 'fixture-token-platform';   // test fixtures, not credentials
const NUM_A = '+18565550301', NUM_B = '+18565550302', NUM_C = '+18565550303';
const CUSTOMER = '+15551230301';
const IN_URL = 'https://api.example.test/webhooks/twilio/sms/inbound';
const ST_URL = 'https://api.example.test/webhooks/twilio/sms/status';

let pg: any; let db: any; let inbound: TwilioInboundService;
const audit = { record: vi.fn(async () => ({})) };
// the validate-before-save path talks to a FAKE Twilio (every account answers; every number is on it) — never the network
const okTwilio = async (url: any) => {
  const u = String(url);
  if (u.includes('PhoneNumber=')) { const n = decodeURIComponent(u.split('PhoneNumber=')[1]); return new Response(JSON.stringify({ incoming_phone_numbers: [{ phone_number: n, capabilities: { sms: true, voice: true, mms: false } }] }), { status: 200 }); }
  const m = u.match(/Accounts\/(AC[0-9a-f]+)\.json$/);
  return new Response(JSON.stringify(m ? { sid: m[1], status: 'active', type: 'Full' } : {}), { status: 200 });
};
const creds = () => { const s = new TenantMessagingCredentialsService(db, audit as any, testProviderSecrets); s.http = okTwilio as any; return s; };
const ownerOf = async (n: string) => ((await sql`select tenant_id::text as t from tenant_messaging_numbers where phone_number = ${n}`.execute(db)).rows[0] as any)?.t ?? null;
const optOuts = async (tenant: string, addr: string) => Number((await pg.query(`SELECT count(*)::int c FROM notification_opt_outs WHERE tenant_id = $1 AND address = $2`, [tenant, addr])).rows[0].c);
const env = { sid: process.env.TWILIO_ACCOUNT_SID, tok: process.env.TWILIO_AUTH_TOKEN };

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.exec(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES
    ('${A}', 'A', 'A', 'e2-a', 'E2A', 'active'), ('${B}', 'B', 'B', 'e2-b', 'E2B', 'active'), ('${C}', 'C', 'C', 'e2-c', 'E2C', 'active');`);
  const notifications = new NotificationsService(new KyselyNotificationsRepository(db, new OutboxWriter()), {} as any, {} as any, undefined, new KyselyOptOutRepository(db));
  inbound = new TwilioInboundService(db, notifications, testProviderSecrets);
}, 180_000);
beforeEach(() => { process.env.TWILIO_ACCOUNT_SID = AC_PLATFORM; process.env.TWILIO_AUTH_TOKEN = TOK_PLATFORM; });
afterAll(() => {
  if (env.sid === undefined) delete process.env.TWILIO_ACCOUNT_SID; else process.env.TWILIO_ACCOUNT_SID = env.sid;
  if (env.tok === undefined) delete process.env.TWILIO_AUTH_TOKEN; else process.env.TWILIO_AUTH_TOKEN = env.tok;
});

describe('E1 — the credentials form cannot take another salon\'s number', () => {
  it('salon A saves its own Twilio with its number: A owns the number', async () => {
    await creds().set('u-a', A, { accountSid: AC_A, authToken: TOK_A, fromNumber: NUM_A });
    expect(await ownerOf(NUM_A)).toBe(A);
  });
  it('salon B saving A\'s number as its fromNumber is REFUSED; A keeps the number; B stores nothing', async () => {
    await expect(creds().set('u-b', B, { accountSid: AC_B, authToken: TOK_B, fromNumber: NUM_A })).rejects.toBeInstanceOf(CredentialsInputError);
    expect(await ownerOf(NUM_A)).toBe(A);
    expect((await sql`select count(*)::int c from tenant_messaging_credentials where tenant_id = ${B}`.execute(db)).rows[0]).toMatchObject({ c: 0 });
  });
  it('salon B with its own number works (and re-saving is idempotent)', async () => {
    await creds().set('u-b', B, { accountSid: AC_B, authToken: TOK_B, fromNumber: NUM_B });
    await creds().set('u-b', B, { accountSid: AC_B, fromNumber: NUM_B });
    expect(await ownerOf(NUM_B)).toBe(B);
  });
  it('migration 684: no write path can move a number to another tenant (DB trigger)', async () => {
    await expect(sql`update tenant_messaging_numbers set tenant_id = ${B}::uuid where phone_number = ${NUM_A}`.execute(db)).rejects.toThrow(/another tenant/);
    await expect(sql`insert into tenant_messaging_numbers (tenant_id, phone_number) values (${B}::uuid, ${NUM_A})
      on conflict (phone_number) do update set tenant_id = excluded.tenant_id`.execute(db)).rejects.toThrow(/another tenant/);
    expect(await ownerOf(NUM_A)).toBe(A);
  });
});

describe('E2 — inbound SMS: the tenant comes from the To number, the token from THAT tenant', () => {
  beforeAll(async () => {
    // salon C has no account of its own: its number lives on the platform account
    await pg.query(`INSERT INTO tenant_messaging_numbers (tenant_id, phone_number, channel, provider) VALUES ($1, $2, 'sms', 'twilio')`, [C, NUM_C]);
  });
  const send = (token: string, p: Record<string, string>) =>
    inbound.handleInbound({ from: p.From, to: p.To, body: p.Body, signature: computeTwilioSignature(token, IN_URL, p), url: IN_URL, params: p });

  it('salon B signing with ITS token, AccountSid=B, To=A\'s number → refused, nothing written for A', async () => {
    const r = await send(TOK_B, { AccountSid: AC_B, MessageSid: 'SMe2in0001', From: CUSTOMER, To: NUM_A, Body: 'STOP' });
    expect(r).toEqual({ status: 'ignored', reason: 'account_mismatch' });
    const r2 = await send(TOK_B, { AccountSid: AC_B, MessageSid: 'SMe2in0002', From: CUSTOMER, To: NUM_C, Body: 'START' });
    expect(r2).toEqual({ status: 'ignored', reason: 'account_mismatch' });
    expect(await optOuts(A, CUSTOMER)).toBe(0);
  });
  it('B\'s token with no / the platform / A\'s AccountSid → bad signature (the token is never B\'s)', async () => {
    for (const AccountSid of [undefined, AC_PLATFORM, AC_A]) {
      const p: Record<string, string> = { MessageSid: 'SMe2in0003', From: CUSTOMER, To: NUM_A, Body: 'STOP', ...(AccountSid ? { AccountSid } : {}) };
      expect(await send(TOK_B, p)).toEqual({ status: 'ignored', reason: 'bad_signature' });
    }
    expect(await optOuts(A, CUSTOMER)).toBe(0);
  });
  it('a salon that typed the PLATFORM account SID into its own credentials gains nothing', async () => {
    await pg.query(`UPDATE tenant_messaging_credentials SET account_sid = $2 WHERE tenant_id = $1`, [B, AC_PLATFORM]);
    const r = await send(TOK_B, { AccountSid: AC_PLATFORM, MessageSid: 'SMe2in0004', From: CUSTOMER, To: NUM_C, Body: 'STOP' });
    expect(r).toEqual({ status: 'ignored', reason: 'bad_signature' });
    expect(await optOuts(C, CUSTOMER)).toBe(0);
    // genuine platform traffic for C still verifies
    expect(await send(TOK_PLATFORM, { AccountSid: AC_PLATFORM, MessageSid: 'SMe2in0005', From: CUSTOMER, To: NUM_C, Body: 'STOP' })).toEqual({ status: 'opted_out', tenantId: C });
    expect(await optOuts(C, CUSTOMER)).toBe(1);
    await pg.query(`UPDATE tenant_messaging_credentials SET account_sid = $2 WHERE tenant_id = $1`, [B, AC_B]);
  });
  it('a genuine STOP to A\'s number, signed by A\'s own account, still works', async () => {
    expect(await send(TOK_A, { AccountSid: AC_A, MessageSid: 'SMe2in0006', From: CUSTOMER, To: NUM_A, Body: 'STOP' })).toEqual({ status: 'opted_out', tenantId: A });
    expect(await optOuts(A, CUSTOMER)).toBe(1);
  });
});

describe('E2 — status callback: the tenant comes from the stored message row', () => {
  const SID_A = 'SMe2status000a';
  beforeAll(async () => {
    await pg.query(`INSERT INTO notifications (tenant_id, channel, to_address, body, status, provider_id) VALUES ($1, 'sms', $2, 'Your visit is confirmed', 'sent', $3)`, [A, CUSTOMER, SID_A]);
  });
  const status = async () => ((await pg.query(`SELECT status FROM notifications WHERE provider_id = $1`, [SID_A])).rows[0].status);
  const cb = (token: string, p: Record<string, string>) =>
    inbound.handleStatus({ sid: p.MessageSid, status: p.MessageStatus, signature: computeTwilioSignature(token, ST_URL, p), url: ST_URL, params: p });

  it('a status for A\'s message signed with B\'s token (AccountSid=B) is refused and moves nothing', async () => {
    expect(await cb(TOK_B, { AccountSid: AC_B, MessageSid: SID_A, MessageStatus: 'failed' })).toEqual({ status: 'ignored', reason: 'account_mismatch' });
    expect(await cb(TOK_B, { MessageSid: SID_A, MessageStatus: 'failed' })).toEqual({ status: 'ignored', reason: 'bad_signature' });
    expect(await status()).toBe('sent');
  });
  it('an unknown MessageSid is ignored (a forged one is still reported as a bad signature)', async () => {
    expect(await cb(TOK_PLATFORM, { MessageSid: 'SMe2nosuch0001', MessageStatus: 'delivered' })).toEqual({ status: 'ignored', reason: 'unknown_message' });
    expect(await cb(TOK_B, { MessageSid: 'SMe2nosuch0001', MessageStatus: 'delivered' })).toEqual({ status: 'ignored', reason: 'bad_signature' });
  });
  it('the genuine callback from A\'s own account records the status', async () => {
    expect(await cb(TOK_A, { AccountSid: AC_A, MessageSid: SID_A, MessageStatus: 'delivered' })).toEqual({ status: 'recorded', updated: 1 });
    expect(await status()).toBe('delivered');
  });
});
