// native-auth.test.ts — the native app's session handling.
//
// The property to protect: on the WEB, the token never enters JavaScript (it lives in an httpOnly cookie), so an
// XSS bug cannot steal it. Adding a native path must not weaken that — so the web must never receive, store, or
// send a token at all.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  setSecureStore, saveNativeToken, loadNativeToken, clearNativeToken, authHeader, tokenFromResponse,
  InMemorySecureStore, type SecureStore,
} from './native-auth';

/** Stands in for the Keychain / Keystore-backed plugin a native shell provides. */
class FakeKeychain implements SecureStore {
  store = new Map<string, string>();
  async get(k: string) { return this.store.get(k) ?? null; }
  async set(k: string, v: string) { this.store.set(k, v); }
  async remove(k: string) { this.store.delete(k); }
}

let keychain: FakeKeychain;
beforeEach(async () => {
  keychain = new FakeKeychain();
  setSecureStore(keychain);
  await clearNativeToken();
});

describe('the WEB never handles a token', () => {
  it('a web login response carries NO token — so there is nothing to store', () => {
    const webBody = { ok: true, outcome: 'SUCCESS', principal: { role: 'CUSTOMER' } };
    expect(tokenFromResponse(webBody)).toBeNull();
  });

  it('storing "no token" stores nothing', async () => {
    await saveNativeToken(tokenFromResponse({ ok: true, principal: {} }));
    expect(await loadNativeToken()).toBeNull();
    expect(keychain.store.size).toBe(0);
  });

  it('with no token, the request carries NO Authorization header — the cookie does the work', async () => {
    expect(await authHeader()).toEqual({});
  });
});

describe('the NATIVE app', () => {
  it('stores the token the server issued, in the SECURE store', async () => {
    await saveNativeToken(tokenFromResponse({ ok: true, accessToken: 'tok-123', expiresIn: 3600 }));
    expect(await loadNativeToken()).toBe('tok-123');
    // it went to the Keychain-backed store, not localStorage
    expect([...keychain.store.values()]).toContain('tok-123');
  });

  it('never touches localStorage', async () => {
    await saveNativeToken('tok-123');
    expect(JSON.stringify(localStorage)).not.toContain('tok-123');
  });

  it('sends it as `Authorization: Bearer` — how a native app authenticates without cookies', async () => {
    await saveNativeToken('tok-123');
    expect(await authHeader()).toEqual({ Authorization: 'Bearer tok-123' });
  });

  it('SIGN OUT removes it — a token left in the Keychain outlives the sign-out', async () => {
    await saveNativeToken('tok-123');
    expect(await loadNativeToken()).toBe('tok-123');

    await clearNativeToken();

    expect(await loadNativeToken()).toBeNull();
    expect(keychain.store.size).toBe(0);                 // genuinely gone from the device
    expect(await authHeader()).toEqual({});              // and no longer sent
  });

  it('a secure-store failure does not break the session for this run', async () => {
    const broken: SecureStore = {
      async get() { throw new Error('keychain locked'); },
      async set() { throw new Error('keychain locked'); },
      async remove() { throw new Error('keychain locked'); },
    };
    setSecureStore(broken);
    await saveNativeToken('tok-abc');                    // write fails…
    expect(await loadNativeToken()).toBe('tok-abc');     // …but the in-memory copy keeps this session working
  });

  it('the default store keeps nothing on disk', async () => {
    setSecureStore(new InMemorySecureStore());
    await saveNativeToken('tok-x');
    expect(JSON.stringify(localStorage)).not.toContain('tok-x');
    expect(JSON.stringify(sessionStorage)).not.toContain('tok-x');
  });
});
