// Security Deep Scan D2 / A8 (Oct 23 2026) — a Super Admin-typed processor URL decides where a salon's DECRYPTED merchant
// credentials are sent. Before: any string was stored (http://, internal hosts, attacker hosts) and the resolver sent the
// Basic / Bearer / Bolt credentials there; Test Connection echoed the far end's response body. Each case below fails on
// the old code: the write is accepted, the processor is built, the terminal key is handed out, the body is echoed.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { PaymentGatewayResolver, checkProcessorUrl } from './payment-gateway.resolver';
import { CardPointeClient } from './cardpointe.client';

const T = '86868686-8686-4868-8868-868686868686', BR = '87878787-8787-4878-8878-878787878787';
let pg: any; let db: any;
const plain = { encrypt: (s: string) => 'enc:' + s, decrypt: (s: string) => String(s).replace(/^enc:/, '') } as any;
const resolver = () => new PaymentGatewayResolver(db, plain);

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  await pg.query(`INSERT INTO tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) VALUES ($1,'urlsalon','urlsalon','urlsalon','URLSALON','active')`, [T]);
  await pg.query(`INSERT INTO branches (id, tenant_id, name) VALUES ($1,$2,'Main')`, [BR, T]);
});

describe('processor URL policy (pure)', () => {
  it('accepts the processors\' own https hosts and documented ports', () => {
    for (const u of ['https://fts.cardconnect.com/cardconnect/rest', 'https://isv-uat.cardconnect.com', 'https://fts-uat.cardconnect.com:6443', 'https://fts.cardconnect.com:8443', 'https://cert.api.fiserv.com'])
      expect(checkProcessorUrl('gateway', u).ok, u).toBe(true);
    for (const u of ['https://bolt.cardpointe.com/api', 'https://bolt-uat.cardpointe.com', 'https://boltgw.cardconnect.com']) expect(checkProcessorUrl('bolt', u).ok, u).toBe(true);
    for (const u of ['https://scl.clover.com', 'https://scl-sandbox.dev.clover.com']) expect(checkProcessorUrl('clover', u).ok, u).toBe(true);
  });
  it('refuses http, other hosts, look-alikes, internal hosts, credentials in the URL and undocumented ports', () => {
    for (const u of ['http://fts.cardconnect.com', 'https://evil.example', 'https://cardconnect.com.evil.io', 'https://evilcardconnect.com',
      'https://127.0.0.1', 'https://metadata.internal', 'https://user:pw@fts.cardconnect.com', 'https://fts.cardconnect.com:9999', 'https://scl.clover.com'])
      expect(checkProcessorUrl('gateway', u).ok, u).toBe(false);
    expect(checkProcessorUrl('clover', 'https://fts.cardconnect.com').ok).toBe(false);
    expect(checkProcessorUrl('bolt', 'https://fts.cardconnect.com:6443').ok).toBe(false);
  });
});

describe('PaymentGatewayResolver — D2 write + build checks', () => {
  it('refuses to STORE an attacker / http base URL or Bolt URL (400 PROCESSOR_URL_NOT_ALLOWED), and writes nothing', async () => {
    const r = resolver();
    await expect(r.upsertConfig(T, { processorType: 'cardpointe', baseUrl: 'https://attacker.example/cardconnect/rest', merchantId: 'MID-X', apiUsername: 'u', apiPassword: 'p' }))
      .rejects.toMatchObject({ status: 400, code: 'PROCESSOR_URL_NOT_ALLOWED', expose: true });
    await expect(r.upsertConfig(T, { processorType: 'cardpointe', baseUrl: 'http://fts.cardconnect.com' })).rejects.toMatchObject({ code: 'PROCESSOR_URL_NOT_ALLOWED' });
    await expect(r.upsertConfig(T, { boltBaseUrl: 'https://10.0.0.5/api', boltApiKey: 'k' })).rejects.toMatchObject({ code: 'PROCESSOR_URL_NOT_ALLOWED' });
    await expect(r.upsertConfig(T, { processorType: 'clover', baseUrl: 'https://fts.cardconnect.com', apiPassword: 'tok' })).rejects.toMatchObject({ code: 'PROCESSOR_URL_NOT_ALLOWED' });
    await expect(r.upsertBranchMerchant(T, BR, { processorType: 'cardpointe', baseUrl: 'https://attacker.example' })).rejects.toMatchObject({ code: 'PROCESSOR_URL_NOT_ALLOWED' });
    expect((await pg.query(`SELECT count(*)::int AS n FROM tenant_payment_config WHERE tenant_id = $1`, [T])).rows[0].n).toBe(0);
    expect((await pg.query(`SELECT count(*)::int AS n FROM payment_merchant_accounts WHERE tenant_id = $1`, [T])).rows[0].n).toBe(0);
    // a real processor host is accepted
    const v = await r.upsertConfig(T, { processorType: 'cardpointe', environment: 'sandbox', baseUrl: 'https://isv-uat.cardconnect.com/cardconnect/rest', merchantId: 'MID-OK', apiUsername: 'u', apiPassword: 'p', boltBaseUrl: 'https://bolt-uat.cardpointe.com/api', boltApiKey: 'k' });
    expect(v.terminalConfigured).toBe(true);
  });

  it('never builds a processor (or hands out a Bolt key) for a stored row whose host is not allowed', async () => {
    await pg.query(`UPDATE tenant_payment_config SET base_url = 'https://attacker.example', bolt_base_url = 'https://attacker.example/api', status = 'active' WHERE tenant_id = $1`, [T]);
    const g = await resolver().resolve(T);
    expect(g.configured).toBe(false);
    expect(g.processor).toBeUndefined();
    expect(g.status).toBe('error');
    const t = await resolver().resolveTerminalConfig(T, null);
    expect(t.config).toBeNull();
    expect(t.reason).toBe('TERMINAL_NOT_CONFIGURED');
    const tc = await resolver().testConnection(T);
    expect(tc.tested).toBe(false);
    // and a stored Clover row with an attacker host is refused the same way
    await pg.query(`UPDATE tenant_payment_config SET processor = 'clover', base_url = 'https://attacker.example', api_password_enc = 'enc:tok' WHERE tenant_id = $1`, [T]);
    expect((await resolver().resolve(T)).configured).toBe(false);
  });
});

describe('Test Connection never echoes the far end', () => {
  it('a refused inquiry reports only the HTTP status — not the response body', async () => {
    const fetchImpl = async () => ({ status: 401, ok: false, json: async () => ({}), text: async () => 'SECRET-INTERNAL-PAGE <html>admin</html>' });
    const r = await new CardPointeClient({ baseUrl: 'https://isv-uat.cardconnect.com', merchid: 'M', username: 'u', password: 'p' }, fetchImpl as any).testConnection();
    expect(r.ok).toBe(false);
    expect(r.message).toContain('401');
    expect(r.message).not.toContain('SECRET-INTERNAL-PAGE');
  });
  it('a network failure does not echo the transport error text', async () => {
    const fetchImpl = async () => { throw new Error('connect ECONNREFUSED 10.1.2.3:443 internal-db.railway.internal'); };
    const r = await new CardPointeClient({ baseUrl: 'https://isv-uat.cardconnect.com', merchid: 'M', username: 'u', password: 'p' }, fetchImpl as any).testConnection();
    expect(r.ok).toBe(false);
    expect(r.message).not.toMatch(/10\.1\.2\.3|railway|ECONNREFUSED/);
  });
});
