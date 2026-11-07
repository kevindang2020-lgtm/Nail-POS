// device-proof.vitest.spec — the server verifier's own edges (the client↔server round trip is in
// packages/mobile-sdk/src/device-proof.test.ts): wrong key types, malformed headers, and one-time nonces.
import { describe, it, expect } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { parseDevicePublicKey, readProof, verifyDeviceSignature, checkProof, canonicalDeviceRequest, bodyHash, InMemoryDeviceNonceStore, DEVICE_PROOF_HEADERS } from './device-proof';

const spki = (k: any) => k.export({ type: 'spki', format: 'der' }).toString('base64');

describe('device proof — server verifier', () => {
  it('accepts only EC P-256 keys', () => {
    expect(() => parseDevicePublicKey(spki(generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey))).not.toThrow();
    expect(() => parseDevicePublicKey(spki(generateKeyPairSync('ec', { namedCurve: 'P-384' }).publicKey))).toThrow(/P-256/);
    expect(() => parseDevicePublicKey(spki(generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey))).toThrow(/P-256/);
    expect(verifyDeviceSignature('not-a-key', 'x', 'A'.repeat(86))).toBe(false);
  });

  it('a P-256 signature made with Node verifies; a DER-encoded one (wrong format) does not', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const nowTs = Date.now(); const nonce = 'n'.repeat(43);
    const signed = canonicalDeviceRequest({ method: 'POST', path: '/mobile-checkout/x', deviceId: 'device-0001', ts: nowTs, nonce, bodySha256: bodyHash(Buffer.from('{}')) });
    const p1363 = sign('sha256', Buffer.from(signed), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    const der = sign('sha256', Buffer.from(signed), privateKey).toString('base64url');
    const h = { [DEVICE_PROOF_HEADERS.id]: 'device-0001', [DEVICE_PROOF_HEADERS.ts]: String(nowTs), [DEVICE_PROOF_HEADERS.nonce]: nonce, [DEVICE_PROOF_HEADERS.sig]: p1363 };
    expect(checkProof({ method: 'POST', path: '/mobile-checkout/x', headers: h, rawBody: Buffer.from('{}'), now: nowTs }, readProof(h)!, spki(publicKey))).toEqual({ ok: true });
    expect(verifyDeviceSignature(spki(publicKey), signed, der)).toBe(false);
  });

  // merged Nov 7 2026: readProof returns null ONLY when a request carries no proof at all (an unsigned request — the
  // guard's key policy decides). A present-but-malformed proof is read and then REFUSED by checkProof, so it can never
  // be mistaken for an unsigned request.
  it('no proof → null; a malformed proof is refused by checkProof (never treated as unsigned)', () => {
    const ok = { [DEVICE_PROOF_HEADERS.id]: 'device-0001', [DEVICE_PROOF_HEADERS.ts]: String(Date.now()), [DEVICE_PROOF_HEADERS.nonce]: 'n'.repeat(43), [DEVICE_PROOF_HEADERS.sig]: 'A'.repeat(86) };
    const key = spki(generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey);
    const refused = (h: Record<string, string>) => { const p = readProof(h); return p === null ? 'unsigned' : checkProof({ method: 'POST', path: '/x', headers: h, rawBody: null }, p, key); };
    expect(readProof({})).toBeNull();
    expect(readProof(ok)).not.toBeNull();
    for (const bad of [{ [DEVICE_PROOF_HEADERS.nonce]: 'short' }, { [DEVICE_PROOF_HEADERS.ts]: 'yesterday' }, { [DEVICE_PROOF_HEADERS.sig]: '' }, { [DEVICE_PROOF_HEADERS.id]: 'bad id with spaces' }]) {
      expect(refused({ ...ok, ...bad })).toEqual({ ok: false, reason: 'malformed proof' });
    }
    expect(readProof({ 'X-APS-DEVICE-ID': 'device-0001', 'X-APS-DEVICE-TS': ok[DEVICE_PROOF_HEADERS.ts], 'X-APS-DEVICE-NONCE': 'n'.repeat(43), 'X-APS-DEVICE-SIG': 'A'.repeat(86) })).not.toBeNull();
  });

  it('a nonce is accepted once per device, again only after it expires', async () => {
    let t = 1_000_000; const s = new InMemoryDeviceNonceStore(() => t);
    expect(await s.firstUse('d1', 'nonce-aaaaaaaaaaaaaa', 1000)).toBe(true);
    expect(await s.firstUse('d1', 'nonce-aaaaaaaaaaaaaa', 1000)).toBe(false);   // replay
    expect(await s.firstUse('d2', 'nonce-aaaaaaaaaaaaaa', 1000)).toBe(true);    // another phone, same nonce: fine
    t += 1001;
    expect(await s.firstUse('d1', 'nonce-aaaaaaaaaaaaaa', 1000)).toBe(true);
  });
});
