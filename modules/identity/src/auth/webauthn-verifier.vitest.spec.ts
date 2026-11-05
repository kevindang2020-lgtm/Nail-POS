// webauthn-verifier.vitest.spec.ts — the verifier must FAIL CLOSED.
//
// Context: `WebAuthnService` was tested with a STUB verifier that always returned `{ ok: true }`. No real
// implementation of the port existed, and `@simplewebauthn/server` was installed but never imported. Mounting the
// service in that state would have meant **any forged signature was accepted — a complete authentication
// bypass**. A biometric login that never checks the signature is worse than none.
//
// These tests assert the direction that actually matters for security: garbage, forged and mismatched ceremonies
// are REJECTED. (A full positive ceremony needs a real authenticator, which cannot be produced here — see the
// report's limitations. The crypto itself is delegated to the maintained library rather than hand-rolled.)
import { describe, it, expect } from 'vitest';
import { makeWebAuthnVerifier } from './webauthn-verifier';

const v = makeWebAuthnVerifier();
const b64 = (s: string) => Buffer.from(s).toString('base64url');

describe('registration verification fails closed', () => {
  it('rejects a garbage attestation', async () => {
    const r = await v.verifyRegistration({
      clientDataJSON: b64('not-json-at-all'),
      attestationObject: b64('garbage'),
      expectedChallenge: 'chal',
      expectedOrigin: 'https://aipowersalon.com',
      expectedRpId: 'aipowersalon.com',
    });
    expect(r.ok).toBe(false);
    expect(r.credentialId).toBe('');
    expect(r.publicKey).toBe('');
  });

  it('rejects EMPTY input rather than throwing or passing', async () => {
    const r = await v.verifyRegistration({
      clientDataJSON: '', attestationObject: '', expectedChallenge: '', expectedOrigin: '', expectedRpId: '',
    });
    expect(r.ok).toBe(false);
  });

  it('rejects a clientData whose challenge does not match the issued one', async () => {
    const clientData = b64(JSON.stringify({ type: 'webauthn.create', challenge: 'ATTACKER', origin: 'https://aipowersalon.com' }));
    const r = await v.verifyRegistration({
      clientDataJSON: clientData,
      attestationObject: b64('anything'),
      expectedChallenge: 'THE-REAL-CHALLENGE',
      expectedOrigin: 'https://aipowersalon.com',
      expectedRpId: 'aipowersalon.com',
    });
    expect(r.ok).toBe(false);
  });

  it('rejects a ceremony from a DIFFERENT origin (phishing site)', async () => {
    const clientData = b64(JSON.stringify({ type: 'webauthn.create', challenge: 'chal', origin: 'https://evil.example' }));
    const r = await v.verifyRegistration({
      clientDataJSON: clientData,
      attestationObject: b64('anything'),
      expectedChallenge: 'chal',
      expectedOrigin: 'https://aipowersalon.com',
      expectedRpId: 'aipowersalon.com',
    });
    expect(r.ok).toBe(false);
  });
});

describe('authentication verification fails closed', () => {
  it('rejects a FORGED signature', async () => {
    const r = await v.verifyAuthentication({
      clientDataJSON: b64(JSON.stringify({ type: 'webauthn.get', challenge: 'chal', origin: 'https://aipowersalon.com' })),
      authenticatorData: b64('fake-authenticator-data'),
      signature: b64('forged-signature'),
      publicKey: b64('not-a-real-key'),
      expectedChallenge: 'chal',
      expectedOrigin: 'https://aipowersalon.com',
      expectedRpId: 'aipowersalon.com',
    });
    expect(r.ok).toBe(false);          // ← the whole point. A stub would have returned true here.
    expect(r.newSignCount).toBe(0);
  });

  it('rejects garbage without throwing (a throw could be caught and treated as success upstream)', async () => {
    const r = await v.verifyAuthentication({
      clientDataJSON: 'x', authenticatorData: 'x', signature: 'x', publicKey: 'x',
      expectedChallenge: 'c', expectedOrigin: 'o', expectedRpId: 'r',
    });
    expect(r.ok).toBe(false);
  });

  it('rejects a replayed clientData whose challenge does not match', async () => {
    const r = await v.verifyAuthentication({
      clientDataJSON: b64(JSON.stringify({ type: 'webauthn.get', challenge: 'OLD', origin: 'https://aipowersalon.com' })),
      authenticatorData: b64('d'), signature: b64('s'), publicKey: b64('k'),
      expectedChallenge: 'NEW', expectedOrigin: 'https://aipowersalon.com', expectedRpId: 'aipowersalon.com',
    });
    expect(r.ok).toBe(false);
  });

  it('NEVER returns ok for any input we can construct without a real authenticator', async () => {
    for (const sig of ['', b64('a'), b64('b'.repeat(64)), 'AAAA']) {
      const r = await v.verifyAuthentication({
        clientDataJSON: b64(JSON.stringify({ type: 'webauthn.get', challenge: 'c', origin: 'https://aipowersalon.com' })),
        authenticatorData: b64('d'), signature: sig, publicKey: b64('k'),
        expectedChallenge: 'c', expectedOrigin: 'https://aipowersalon.com', expectedRpId: 'aipowersalon.com',
      });
      expect(r.ok).toBe(false);
    }
  });
});
