// @vitest-environment node
// device-proof.test — Secure Tap to Pay M6-4: the phone's signature is checked by the SERVER's own verifier
// (modules/checkout/src/mobile-checkout/device-proof.ts — checkProof / verifyDeviceSignature / parseDevicePublicKey), so
// the client and the guard can never drift apart unseen. Node's WebCrypto stands in for the phone's (same API).
import { describe, it, expect } from 'vitest';
import {
  createDeviceIdentity, signDeviceRequest, signedPathFor, sha256Hex, newDeviceNonce, canonicalDeviceRequest, indexedDbDeviceKeyStore,
  InMemoryDeviceKeyStore, DeviceKeyUnavailableError, DEVICE_PROOF_HEADERS,
} from './device-proof';
import { createTransport } from './network/transport';
import { checkProof, readProof, verifyDeviceSignature, keyFingerprint, bodyHash, canonicalDeviceRequest as serverCanonical, DEVICE_PROOF_WINDOW_MS } from '../../../modules/checkout/src/mobile-checkout/device-proof';

const ID = '3f0b7c1e-9a2d-4e5f-8a6b-1c2d3e4f5a6b';

/** What the guard does with a request: originalUrl after the /api/v1 rewrite, req.rawBody (or the JSON fallback). */
function serverCheck(publicKey: string, h: Record<string, string>, method: string, serverPath: string, rawBody: string | null, now?: number) {
  const proof = readProof(h)!;
  return checkProof({ method, path: serverPath, headers: h, rawBody: rawBody == null ? null : Buffer.from(rawBody, 'utf8'), now }, proof, publicKey);
}

describe('device proof — client signer vs the server verifier', () => {
  it('a signed POST verifies with the server checkProof (path without /api/v1, exact body bytes)', async () => {
    const k = await createDeviceIdentity(ID);
    const body = JSON.stringify({ sessionId: 's1', idempotencyKey: 'idem_1', amountCents: 3233, deviceId: ID, note: 'café ✓' });
    const h = await signDeviceRequest(k.keyPair.privateKey, { method: 'post', url: 'https://api.aipowersalon.com/api/v1/mobile-checkout/tickets/t%201/payment-attempts', deviceId: ID, body });
    expect(Object.keys(h).sort()).toEqual(Object.values(DEVICE_PROOF_HEADERS).sort());
    expect(serverCheck(k.publicKey, h, 'POST', '/mobile-checkout/tickets/t%201/payment-attempts', body)).toEqual({ ok: true });
    // the guard's fallback (no rawBody): JSON.stringify of the parsed body — the client sends exactly that string
    expect(serverCheck(k.publicKey, h, 'POST', '/mobile-checkout/tickets/t%201/payment-attempts', JSON.stringify(JSON.parse(body)))).toEqual({ ok: true });
  });

  it('a GET with a query verifies (no body → the hash of nothing); the query is part of what is signed', async () => {
    const k = await createDeviceIdentity(ID);
    const url = '/api/v1/mobile-checkout/readiness?deviceId=' + ID;
    const h = await signDeviceRequest(k.keyPair.privateKey, { method: 'GET', url, deviceId: ID });
    expect(serverCheck(k.publicKey, h, 'GET', `/mobile-checkout/readiness?deviceId=${ID}`, null)).toEqual({ ok: true });
    expect(serverCheck(k.publicKey, h, 'GET', '/mobile-checkout/readiness?deviceId=other', null)).toEqual({ ok: false, reason: 'bad signature' });
    expect(await sha256Hex(undefined)).toBe(bodyHash(null));
    expect(await sha256Hex('{"a":"é"}')).toBe(bodyHash(Buffer.from('{"a":"é"}', 'utf8')));
  });

  it('a changed body, method, path, device id or timestamp is refused; an old timestamp is outside the window', async () => {
    const k = await createDeviceIdentity(ID);
    const body = JSON.stringify({ amountCents: 1000 });
    const now = Date.now();
    const h = await signDeviceRequest(k.keyPair.privateKey, { method: 'POST', url: '/api/v1/mobile-checkout/tickets/t1/proceed-to-payment', deviceId: ID, body, now });
    const p = '/mobile-checkout/tickets/t1/proceed-to-payment';
    expect(serverCheck(k.publicKey, h, 'POST', p, body, now).ok).toBe(true);
    expect(serverCheck(k.publicKey, h, 'POST', p, JSON.stringify({ amountCents: 1 }), now).ok).toBe(false);
    expect(serverCheck(k.publicKey, h, 'PATCH', p, body, now).ok).toBe(false);
    expect(serverCheck(k.publicKey, h, 'POST', '/mobile-checkout/tickets/t2/proceed-to-payment', body, now).ok).toBe(false);
    expect(serverCheck(k.publicKey, { ...h, [DEVICE_PROOF_HEADERS.id]: 'another-device-id-123' }, 'POST', p, body, now).ok).toBe(false);
    expect(serverCheck(k.publicKey, { ...h, [DEVICE_PROOF_HEADERS.ts]: String(now + 1) }, 'POST', p, body, now).ok).toBe(false);
    expect(serverCheck(k.publicKey, h, 'POST', p, body, now + DEVICE_PROOF_WINDOW_MS + 1)).toEqual({ ok: false, reason: 'timestamp outside the window' });
  });

  it('another phone’s key cannot pass for this one', async () => {
    const a = await createDeviceIdentity(ID); const b = await createDeviceIdentity(ID);
    const h = await signDeviceRequest(b.keyPair.privateKey, { method: 'GET', url: '/api/v1/mobile-checkout/queue', deviceId: ID });
    expect(serverCheck(a.publicKey, h, 'GET', '/mobile-checkout/queue', null).ok).toBe(false);
  });

  it('the canonical string is the server’s, byte for byte', () => {
    const p = { method: 'post', path: '/mobile-checkout/x?y=1', deviceId: ID, ts: 1761264000000, nonce: 'n'.repeat(16), bodySha256: 'ab' };
    expect(canonicalDeviceRequest(p)).toBe(serverCanonical(p));
  });

  it('the public key is SPKI P-256 the server registers; the private key is non-extractable', async () => {
    const k = await createDeviceIdentity(ID);
    expect(keyFingerprint(k.publicKey)).toMatch(/^[0-9a-f]{64}$/);
    expect(k.keyPair.privateKey.extractable).toBe(false);
    await expect(globalThis.crypto.subtle.exportKey('pkcs8', k.keyPair.privateKey)).rejects.toBeTruthy();
  });

  it('a structured clone of the key pair (what IndexedDB stores) still signs for the same public key', async () => {
    const k = await createDeviceIdentity(ID);
    const store = new InMemoryDeviceKeyStore();
    await store.save(structuredClone(k));
    const back = (await store.load())!;
    const signed = 'AIPS-DEVICE-V1\nGET\n/x\n' + ID;
    const sig = new Uint8Array(await globalThis.crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, back.keyPair.privateKey, new TextEncoder().encode(signed)));
    expect(sig.length).toBe(64);   // IEEE-P1363 r||s, what the server expects
    expect(verifyDeviceSignature(k.publicKey, signed, Buffer.from(sig).toString('base64url'))).toBe(true);
  });

  it('nonces are fresh, 43 chars of [A-Za-z0-9_-] (the server accepts 16–128)', () => {
    const a = newDeviceNonce(); const b = newDeviceNonce();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(a).not.toBe(b);
  });

  it('signedPathFor mirrors the API’s /api/v1 rewrite (and leaves the platform alias alone)', () => {
    expect(signedPathFor('/api/v1/mobile-checkout/queue?filter=ready&sort=oldest')).toBe('/mobile-checkout/queue?filter=ready&sort=oldest');
    expect(signedPathFor('https://api.aipowersalon.com/api/v1/mobile-checkout/device/register')).toBe('/mobile-checkout/device/register');
    expect(signedPathFor('/mobile-checkout/queue')).toBe('/mobile-checkout/queue');
    expect(signedPathFor('/api/v1/platform/x')).toBe('/api/v1/platform/x');
  });

  it('no IndexedDB → a clear DeviceKeyUnavailableError, never a fake key', async () => {
    await expect(indexedDbDeviceKeyStore().load()).rejects.toBeInstanceOf(DeviceKeyUnavailableError);
  });
});

describe('transport requestHeaders hook — signed per attempt', () => {
  it('a retried GET carries a NEW nonce and signature on each attempt (never a replay); the hook sees the exact body string', async () => {
    const k = await createDeviceIdentity(ID);
    const seen: Record<string, string>[] = [];
    let calls = 0;
    const fetchImpl = (async (_u: string, init: RequestInit) => { seen.push(init.headers as Record<string, string>); calls++; return new Response(JSON.stringify({ ok: true }), { status: calls === 1 ? 503 : 200 }); }) as unknown as typeof fetch;
    const bodies: (string | undefined)[] = [];
    const t = createTransport({ app: 'manager-pay', apiBase: () => 'https://api.example.com', fetchImpl, sleep: async () => {}, random: () => 0,
      requestHeaders: async (r) => { bodies.push(r.body); return signDeviceRequest(k.keyPair.privateKey, { method: r.method, url: r.url, deviceId: ID, body: r.body }); } });
    await t.get('/mobile-checkout/queue', { query: { filter: 'ready' } });
    expect(seen.length).toBe(2);
    expect(seen[0][DEVICE_PROOF_HEADERS.nonce]).not.toBe(seen[1][DEVICE_PROOF_HEADERS.nonce]);
    for (const h of seen) expect(serverCheck(k.publicKey, h, 'GET', '/mobile-checkout/queue?filter=ready', null)).toEqual({ ok: true });
    await t.post('/mobile-checkout/tickets/t1/lock', { sessionId: 's', deviceId: ID });
    expect(bodies[bodies.length - 1]).toBe(JSON.stringify({ sessionId: 's', deviceId: ID }));
    expect(serverCheck(k.publicKey, seen[seen.length - 1], 'POST', '/mobile-checkout/tickets/t1/lock', bodies[bodies.length - 1]!)).toEqual({ ok: true });
  });

  it('a hook that throws stops the request — nothing is sent unsigned by accident', async () => {
    let sent = 0;
    const t = createTransport({ app: 'manager-pay', apiBase: () => '', fetchImpl: (async () => { sent++; return new Response('{}'); }) as unknown as typeof fetch,
      requestHeaders: async () => { throw new DeviceKeyUnavailableError(); } });
    await expect(t.post('/mobile-checkout/x', {})).rejects.toBeInstanceOf(DeviceKeyUnavailableError);
    expect(sent).toBe(0);
  });
});
