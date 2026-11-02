// webauthn.test.ts — the browser half of Face ID.
//
// The property that matters most: the frontend NEVER decides whether a biometric ceremony succeeded. It produces
// a signature and posts it; only the SERVER's verifier decides if it is valid. A frontend that "checks" a
// biometric is theatre — and this codebase already had a WebAuthn service whose only verifier was an always-true
// stub, so that failure mode is not hypothetical here.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const post = vi.fn();
// The SDK takes the HTTP client by injection — no module mock needed (Constitution 13 §89).
import { configureMobileSdk } from './http';
configureMobileSdk({ http: { get: async () => ({}) as any, post: (p: string, b: any) => post(p, b) }, apiBase: () => '' });

import { enrollFaceId, signInWithFaceId, isFaceIdAvailable } from './webauthn';   // the WEB passkey flow this file tests

const buf = (s: string) => new TextEncoder().encode(s).buffer;

beforeEach(() => {
  post.mockReset();
  (globalThis as any).navigator = { credentials: {}, userAgent: 'TestBrowser/1.0' };
  (globalThis as any).window = { PublicKeyCredential: undefined };
  (globalThis as any).atob = (s: string) => Buffer.from(s, 'base64').toString('binary');
  (globalThis as any).btoa = (s: string) => Buffer.from(s, 'binary').toString('base64');
});

describe('availability', () => {
  it('is false when the browser has no WebAuthn', async () => {
    expect(await isFaceIdAvailable()).toBe(false);
  });

  it('is false when no PLATFORM authenticator exists (e.g. desktop without Touch ID)', async () => {
    (globalThis as any).window = {
      PublicKeyCredential: { isUserVerifyingPlatformAuthenticatorAvailable: async () => false },
    };
    expect(await isFaceIdAvailable()).toBe(false);
  });

  it('is true with a platform authenticator', async () => {
    (globalThis as any).window = {
      PublicKeyCredential: { isUserVerifyingPlatformAuthenticatorAvailable: async () => true },
    };
    expect(await isFaceIdAvailable()).toBe(true);
  });
});

describe('enrollment', () => {
  const options = {
    challenge: 'Y2hhbA',
    user: { id: 'dXNlcg', name: 'x', displayName: 'x' },
    excludeCredentials: [],
    authenticatorSelection: {},
  };

  it('runs the ceremony and posts the attestation back under the SAME handle', async () => {
    post.mockResolvedValueOnce({ handle: 'h-1', options });
    post.mockResolvedValueOnce({ ok: true });
    (navigator as any).credentials.create = vi.fn(async () => ({
      id: 'cred-1',
      response: { clientDataJSON: buf('cdj'), attestationObject: buf('att') },
    }));

    await enrollFaceId('iPhone');

    expect(post.mock.calls[0][0]).toBe('/auth/webauthn/register/begin');
    const [path, body] = post.mock.calls[1];
    expect(path).toBe('/auth/webauthn/register/finish');
    expect(body.handle).toBe('h-1');                    // same handle — the server binds the challenge to it
    expect(body.credentialId).toBe('cred-1');
    expect(body.clientDataJSON).toBeTruthy();
    expect(body.attestationObject).toBeTruthy();
  });

  it('requires user verification (a Face ID prompt that never verifies is pointless)', async () => {
    post.mockResolvedValueOnce({ handle: 'h-1', options });
    post.mockResolvedValueOnce({ ok: true });
    const create = vi.fn(async () => ({ id: 'c', response: { clientDataJSON: buf('a'), attestationObject: buf('b') } }));
    (navigator as any).credentials.create = create;

    await enrollFaceId();
    expect((create.mock.calls[0] as any)[0].publicKey.authenticatorSelection.userVerification).toBe('required');
  });

  it('a cancelled prompt does NOT post anything', async () => {
    post.mockResolvedValueOnce({ handle: 'h-1', options });
    (navigator as any).credentials.create = vi.fn(async () => null);
    await expect(enrollFaceId()).rejects.toThrow(/cancel/i);
    expect(post).toHaveBeenCalledTimes(1);             // only the begin call
  });
});

describe('sign-in', () => {
  const options = { challenge: 'Y2hhbA', allowCredentials: [] };

  it('posts the assertion — and does NOT decide success itself', async () => {
    post.mockResolvedValueOnce({ handle: 'h-2', options });
    post.mockResolvedValueOnce({ ok: true });
    (navigator as any).credentials.get = vi.fn(async () => ({
      id: 'cred-1',
      response: { clientDataJSON: buf('cdj'), authenticatorData: buf('ad'), signature: buf('sig') },
    }));

    await signInWithFaceId('a@b.com');

    const [path, body] = post.mock.calls[1];
    expect(path).toBe('/auth/webauthn/authenticate/finish');
    expect(body.handle).toBe('h-2');
    expect(body.signature).toBeTruthy();
    // the helper returns nothing — there is no client-side "verified" flag to spoof
  });

  it('SERVER REJECTION is a failure — the browser having produced a signature proves nothing', async () => {
    post.mockResolvedValueOnce({ handle: 'h-2', options });
    post.mockRejectedValueOnce(new Error('Unable to sign in with Face ID.'));
    (navigator as any).credentials.get = vi.fn(async () => ({
      id: 'forged',
      response: { clientDataJSON: buf('x'), authenticatorData: buf('y'), signature: buf('forged') },
    }));

    await expect(signInWithFaceId()).rejects.toThrow(/Unable to sign in/i);
  });

  it('requires user verification on sign-in too', async () => {
    post.mockResolvedValueOnce({ handle: 'h-2', options });
    post.mockResolvedValueOnce({ ok: true });
    const get = vi.fn(async () => ({ id: 'c', response: { clientDataJSON: buf('a'), authenticatorData: buf('b'), signature: buf('c') } }));
    (navigator as any).credentials.get = get;

    await signInWithFaceId();
    expect((get.mock.calls[0] as any)[0].publicKey.userVerification).toBe('required');
  });
});
