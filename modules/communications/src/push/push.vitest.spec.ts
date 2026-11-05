import { describe, it, expect, afterEach, vi } from 'vitest';
import { PushService, PushError } from './push.service';
import { InMemoryPushRepository } from './push.repository';
import {
  MockPushProvider, NotConfiguredPushProvider, FcmV1PushProvider, ApnsPushProvider, CompositePushProvider,
  selectPushProvider, apnsConfigFromEnv, fcmServiceAccountFromEnv,
} from './push-providers';
import type { PushProvider, PushSendResult, PushTarget } from './push.types';
import { generateKeyPairSync, createVerify, verify as cryptoVerify } from 'node:crypto';

const ctx = (over: Partial<{ tenantId: string | null; userId: string }> = {}) => ({ tenantId: 't1', userId: 'u1', ...over });
const TOKEN = 'device-token-abcdef123456';
const tgt = (over: Partial<PushTarget> = {}): PushTarget => ({ token: TOKEN, platform: 'ios', app: null, ...over });

const EC_KEY = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const EC_PEM = EC_KEY.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const RSA_KEY = generateKeyPairSync('rsa', { modulusLength: 2048 });
const RSA_PEM = RSA_KEY.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

const b64urlToBuf = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

describe('provider selection (env → provider, honest by default)', () => {
  const ENV_KEYS = ['FCM_SERVER_KEY', 'FCM_SERVICE_ACCOUNT_JSON', 'FCM_SERVICE_ACCOUNT_B64', 'APNS_KEY_P8', 'APNS_KEY_P8_B64', 'APNS_KEY_ID', 'APNS_TEAM_ID', 'APNS_TOPIC', 'APNS_TOPIC_TECH', 'APNS_ENV'];
  afterEach(() => { for (const k of ENV_KEYS) delete process.env[k]; });

  it('with no credentials outside production, defaults to the mock (dev/test convenience)', () => {
    expect(selectPushProvider({ NODE_ENV: 'test' } as any).name).toBe('mock');
  });
  it('with no credentials IN PRODUCTION, selects the honest not-configured provider — never fabricated deliveries', async () => {
    const p = selectPushProvider({ NODE_ENV: 'production' } as any);
    expect(p.name).toBe('not_configured');
    const r = await p.send(tgt(), { title: 'Hi' });
    expect(r.ok).toBe(false); expect(r.error).toBe('push_not_configured');
  });
  it('a legacy FCM_SERVER_KEY selects NOTHING — Google retired that API (June 2024); the result says so', async () => {
    const p = selectPushProvider({ NODE_ENV: 'production', FCM_SERVER_KEY: 'legacy' } as any);
    expect(p.name).toBe('not_configured');
    const r = await p.send(tgt({ platform: 'android' }), { title: 'Hi' });
    expect(r.ok).toBe(false); expect(r.error).toBe('push_legacy_fcm_retired');
  });
  it('APNS_* alone configures the iOS leg; android honestly reports its leg unconfigured', async () => {
    const p = selectPushProvider({ APNS_KEY_P8: EC_PEM, APNS_KEY_ID: 'K1', APNS_TEAM_ID: 'T1', APNS_TOPIC: 'com.aipowersalon.tech' } as any);
    expect(p.name).toBe('apns');
    const r = await p.send(tgt({ platform: 'android' }), { title: 'Hi' });
    expect(r.ok).toBe(false); expect(r.error).toBe('push_not_configured_for_android');
  });
  it('an FCM service account alone configures android+web; ios honestly reports its leg unconfigured', async () => {
    const sa = JSON.stringify({ project_id: 'p1', client_email: 'svc@p1.iam.gserviceaccount.com', private_key: RSA_PEM });
    const p = selectPushProvider({ FCM_SERVICE_ACCOUNT_JSON: sa } as any);
    expect(p.name).toBe('fcm');
    const r = await p.send(tgt({ platform: 'ios' }), { title: 'Hi' });
    expect(r.ok).toBe(false); expect(r.error).toBe('push_not_configured_for_ios');
  });
  it('both credential sets compose to apns+fcm', () => {
    const sa = JSON.stringify({ project_id: 'p1', client_email: 'svc@p1.iam.gserviceaccount.com', private_key: RSA_PEM });
    const p = selectPushProvider({ APNS_KEY_P8: EC_PEM, APNS_KEY_ID: 'K1', APNS_TEAM_ID: 'T1', APNS_TOPIC: 'x', FCM_SERVICE_ACCOUNT_JSON: sa } as any);
    expect(p.name).toBe('apns+fcm');
  });
  it('apnsConfigFromEnv maps per-app topics and the sandbox host', () => {
    const cfg = apnsConfigFromEnv({ APNS_KEY_P8: EC_PEM, APNS_KEY_ID: 'K1', APNS_TEAM_ID: 'T1', APNS_TOPIC: 'com.d', APNS_TOPIC_TECH: 'com.t', APNS_ENV: 'sandbox' } as any)!;
    expect(cfg.topics.tech).toBe('com.t'); expect(cfg.defaultTopic).toBe('com.d');
    expect(cfg.host).toBe('https://api.sandbox.push.apple.com');
  });
  it('fcmServiceAccountFromEnv accepts base64 and un-escapes the private key', () => {
    const sa = { project_id: 'p1', client_email: 'e@x', private_key: 'line1\\nline2' };
    const got = fcmServiceAccountFromEnv({ FCM_SERVICE_ACCOUNT_B64: Buffer.from(JSON.stringify(sa)).toString('base64') } as any)!;
    expect(got.project_id).toBe('p1'); expect(got.private_key).toBe('line1\nline2');
  });
  it('the mock provider accepts and returns a synthetic id (dev/test only)', async () => {
    const r = await new MockPushProvider().send(tgt(), { title: 'Hi' });
    expect(r.ok).toBe(true); expect(r.providerId).toContain('mock-');
  });
});

describe('ApnsPushProvider', () => {
  const cfg = { keyPem: EC_PEM, keyId: 'KEY123', teamId: 'TEAM456', topics: { tech: 'com.aipowersalon.technician' }, defaultTopic: 'com.aipowersalon.customer' };
  it('mints a valid ES256 JWT (header kid, iss claim, ieee-p1363 signature verifies against the key)', () => {
    const p = new ApnsPushProvider(cfg);
    const [h, c, s] = p.jwt(1_700_000_000_000).split('.');
    const header = JSON.parse(b64urlToBuf(h).toString());
    const claims = JSON.parse(b64urlToBuf(c).toString());
    expect(header).toEqual({ alg: 'ES256', kid: 'KEY123' });
    expect(claims.iss).toBe('TEAM456'); expect(claims.iat).toBe(1_700_000_000);
    const ok = cryptoVerify('sha256', Buffer.from(`${h}.${c}`), { key: EC_KEY.publicKey, dsaEncoding: 'ieee-p1363' }, b64urlToBuf(s));
    expect(ok).toBe(true);
  });
  it('caches the JWT within the 45-minute window and re-mints after it', () => {
    const p = new ApnsPushProvider(cfg);
    const t0 = 1_700_000_000_000;
    expect(p.jwt(t0)).toBe(p.jwt(t0 + 44 * 60_000));
    expect(p.jwt(t0)).not.toBe(p.jwt(t0 + 46 * 60_000));
  });
  it('routes the topic per registering app, falling back to the default topic', () => {
    const p = new ApnsPushProvider(cfg);
    expect(p.topicFor('tech')).toBe('com.aipowersalon.technician');
    expect(p.topicFor('customer')).toBe('com.aipowersalon.customer'); // no per-app override → default
    expect(p.topicFor(null)).toBe('com.aipowersalon.customer');
  });
  it('refuses honestly (no network) when no topic is configured for the token', async () => {
    const p = new ApnsPushProvider({ ...cfg, topics: {}, defaultTopic: undefined });
    const r = await p.send(tgt({ app: 'tech' }), { title: 'Hi' });
    expect(r.ok).toBe(false); expect(r.error).toBe('apns_topic_not_configured');
  });
});

describe('FcmV1PushProvider', () => {
  const sa = { project_id: 'proj-1', client_email: 'svc@proj-1.iam.gserviceaccount.com', private_key: RSA_PEM };
  const okJson = (j: any) => ({ ok: true, status: 200, json: async () => j }) as any;
  const errJson = (status: number, j: any) => ({ ok: false, status, json: async () => j }) as any;

  it('exchanges a signed RS256 assertion for an access token, then posts to the v1 messages:send endpoint', async () => {
    const calls: { url: string; init: any }[] = [];
    const fetchMock = vi.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), init });
      if (String(url).includes('oauth2.googleapis.com')) return okJson({ access_token: 'AT', expires_in: 3600 });
      return okJson({ name: 'projects/proj-1/messages/m1' });
    });
    const p = new FcmV1PushProvider(sa, fetchMock as any);
    const r = await p.send(tgt({ platform: 'android', token: 'fcm-tok-123456' }), { title: 'Hello', body: 'World', data: { k: 'v' } });
    expect(r).toEqual({ ok: true, providerId: 'projects/proj-1/messages/m1' });
    expect(calls[0].url).toContain('oauth2.googleapis.com/token');
    const assertion = decodeURIComponent(String(calls[0].init.body).split('assertion=')[1]);
    const [h, c, s] = assertion.split('.');
    expect(JSON.parse(b64urlToBuf(h).toString()).alg).toBe('RS256');
    const claims = JSON.parse(b64urlToBuf(c).toString());
    expect(claims.iss).toBe(sa.client_email); expect(claims.scope).toContain('firebase.messaging');
    const v = createVerify('RSA-SHA256'); v.update(`${h}.${c}`);
    expect(v.verify(RSA_KEY.publicKey, b64urlToBuf(s))).toBe(true);
    expect(calls[1].url).toBe('https://fcm.googleapis.com/v1/projects/proj-1/messages:send');
    expect(calls[1].init.headers.Authorization).toBe('Bearer AT');
    const body = JSON.parse(calls[1].init.body);
    expect(body.message.token).toBe('fcm-tok-123456');
    expect(body.message.notification).toEqual({ title: 'Hello', body: 'World' });
    expect(body.message.data).toEqual({ k: 'v' });
  });
  it('caches the access token across sends', async () => {
    const fetchMock = vi.fn(async (url: any) => String(url).includes('oauth2') ? okJson({ access_token: 'AT', expires_in: 3600 }) : okJson({ name: 'n' }));
    const p = new FcmV1PushProvider(sa, fetchMock as any);
    await p.send(tgt({ platform: 'android' }), { title: 'a' });
    await p.send(tgt({ platform: 'android' }), { title: 'b' });
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes('oauth2')).length).toBe(1);
  });
  it("maps UNREGISTERED / NOT_FOUND to the canonical 'unregistered' error", async () => {
    const fetchMock = vi.fn(async (url: any) => String(url).includes('oauth2')
      ? okJson({ access_token: 'AT', expires_in: 3600 })
      : errJson(404, { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }));
    const p = new FcmV1PushProvider(sa, fetchMock as any);
    const r = await p.send(tgt({ platform: 'android' }), { title: 'Hi' });
    expect(r.ok).toBe(false); expect(r.error).toBe('unregistered');
  });
  it('reports an OAuth failure without throwing', async () => {
    const fetchMock = vi.fn(async () => errJson(401, { error: 'invalid_grant' }));
    const p = new FcmV1PushProvider(sa, fetchMock as any);
    const r = await p.send(tgt({ platform: 'android' }), { title: 'Hi' });
    expect(r.ok).toBe(false); expect(r.error).toContain('fcm_oauth_invalid_grant');
  });
});

describe('CompositePushProvider', () => {
  const leg = (name: string): PushProvider => ({ name, async send() { return { ok: true, providerId: name }; } });
  it('routes ios→apns leg and android/web→fcm leg', async () => {
    const p = new CompositePushProvider({ ios: leg('A'), android: leg('F'), web: leg('F') });
    expect((await p.send(tgt({ platform: 'ios' }), { title: 'x' })).providerId).toBe('A');
    expect((await p.send(tgt({ platform: 'android' }), { title: 'x' })).providerId).toBe('F');
    expect((await p.send(tgt({ platform: 'web' }), { title: 'x' })).providerId).toBe('F');
  });
});

describe('token registration', () => {
  it('registers a valid token, then revokes it', async () => {
    const repo = new InMemoryPushRepository(); const svc = new PushService(repo, new MockPushProvider());
    await svc.register(ctx(), 'ios', TOKEN, 'customer');
    expect((await repo.activeTokensForUser('u1')).length).toBe(1);
    await svc.unregister(ctx(), TOKEN);
    expect((await repo.activeTokensForUser('u1')).length).toBe(0);
  });
  it('re-registering the same token does not duplicate it', async () => {
    const repo = new InMemoryPushRepository(); const svc = new PushService(repo, new MockPushProvider());
    await svc.register(ctx(), 'ios', TOKEN); await svc.register(ctx(), 'android', TOKEN);
    expect((await repo.activeTokensForUser('u1')).length).toBe(1);
  });
  it('rejects an unknown platform and a too-short token', async () => {
    const svc = new PushService(new InMemoryPushRepository(), new MockPushProvider());
    await expect(svc.register(ctx(), 'blackberry', TOKEN)).rejects.toBeInstanceOf(PushError);
    await expect(svc.register(ctx(), 'ios', 'short')).rejects.toBeInstanceOf(PushError);
  });
  it('the registering app travels with the token to the provider (APNs topic routing depends on it)', async () => {
    const seen: PushTarget[] = [];
    const spy: PushProvider = { name: 'spy', async send(t) { seen.push(t); return { ok: true }; } };
    const repo = new InMemoryPushRepository(); const svc = new PushService(repo, spy);
    await svc.register(ctx(), 'ios', TOKEN, 'tech');
    await svc.dispatchToUser('t1', 'u1', { title: 'Hi' });
    expect(seen[0].app).toBe('tech');
  });
});

describe('dispatchToUser', () => {
  it("fans out to all of a user's devices and logs each delivery", async () => {
    const repo = new InMemoryPushRepository(); const svc = new PushService(repo, new MockPushProvider());
    await svc.register(ctx(), 'ios', 'token-aaaaaaaa1111');
    await svc.register(ctx(), 'android', 'token-bbbbbbbb2222');
    const sum = await svc.dispatchToUser('t1', 'u1', { title: 'Top 10!', body: 'You hit the leaderboard', reference: 'leaderboard' });
    expect(sum.tokens).toBe(2); expect(sum.sent).toBe(2); expect(sum.failed).toBe(0); expect(sum.provider).toBe('mock');
    expect(repo.logs.length).toBe(2);
    expect(repo.logs.every((l) => l.channel === 'push' && l.status === 'sent' && l.template === 'leaderboard')).toBe(true);
    expect(repo.logs[0].targetMasked.startsWith('***')).toBe(true); // token is masked in the log
  });
  it('records failures when the provider rejects, without throwing', async () => {
    const failing: PushProvider = { name: 'failing', async send(): Promise<PushSendResult> { return { ok: false, error: 'delivery_refused' }; } };
    const repo = new InMemoryPushRepository(); const svc = new PushService(repo, failing);
    await svc.register(ctx(), 'ios', 'token-cccccccc3333');
    const sum = await svc.dispatchToUser('t1', 'u1', { title: 'Hi' });
    expect(sum.sent).toBe(0); expect(sum.failed).toBe(1);
    expect(repo.logs[0].status).toBe('failed'); expect(repo.logs[0].error).toBe('delivery_refused');
  });
  it("auto-revokes a token the provider reports as 'unregistered' (dead device) — and only that one", async () => {
    const dead: PushProvider = { name: 'x', async send(t) { return t.token.endsWith('dead') ? { ok: false, error: 'unregistered' } : { ok: true }; } };
    const repo = new InMemoryPushRepository(); const svc = new PushService(repo, dead);
    await svc.register(ctx(), 'ios', 'token-aaaaaaaa-dead');
    await svc.register(ctx(), 'android', 'token-bbbbbbbb-live');
    await svc.dispatchToUser('t1', 'u1', { title: 'Hi' });
    const left = await repo.activeTokensForUser('u1');
    expect(left.length).toBe(1); expect(left[0].token).toBe('token-bbbbbbbb-live');
  });
  it('survives a provider that throws (logs the failure, never throws)', async () => {
    const boom: PushProvider = { name: 'boom', async send(): Promise<PushSendResult> { throw new Error('kaboom'); } };
    const repo = new InMemoryPushRepository(); const svc = new PushService(repo, boom);
    await svc.register(ctx(), 'ios', 'token-dddddddd4444');
    const sum = await svc.dispatchToUser('t1', 'u1', { title: 'Hi' });
    expect(sum.failed).toBe(1); expect(repo.logs[0].error).toContain('kaboom');
  });
  it('is a no-op for a user with no registered devices', async () => {
    const svc = new PushService(new InMemoryPushRepository(), new MockPushProvider());
    const sum = await svc.dispatchToUser('t1', 'nobody', { title: 'Hi' });
    expect(sum.tokens).toBe(0); expect(sum.sent).toBe(0);
  });
});
