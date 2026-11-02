import { describe, it, expect } from 'vitest';
import { WebAuthnService } from './webauthn.service';

// The allowCredentials list returned at begin-time is only a client hint, so finishAuthentication MUST enforce on the
// server that the submitted credential belongs to the challenge's tenant AND user. Otherwise an attacker could begin
// authentication as a victim and finish with their own passkey. These tests lock that binding in.
function makePorts(over: { challenge: any; cred: any; verifyOk?: boolean; newSignCount?: number }) {
  const calls = { sessionFor: '', signCountUpdatedTo: -1 };
  const p: any = {
    config: { rpId: 'salon.example', rpName: 'Salon', expectedOrigin: 'https://salon.example' },
    clock: { now: () => 1_000_000 },
    rng: { bytes: () => Array(32).fill(1), token: () => 'handle_x' },
    challenges: { put: async () => {}, consume: async () => over.challenge },
    creds: { findByCredentialId: async () => over.cred, listByUser: async () => [], save: async () => {}, updateSignCount: async (_id: string, sc: number) => { calls.signCountUpdatedTo = sc; } },
    verifier: { verifyRegistration: async () => ({ ok: true, credentialId: 'c', publicKey: 'pk', signCount: 0 }), verifyAuthentication: async () => ({ ok: over.verifyOk ?? true, newSignCount: over.newSignCount ?? 1 }) },
    sessions: { create: async (uid: string) => { calls.sessionFor = uid; return { accessToken: 'at', refreshToken: 'rt' }; } },
    users: { findById: async (uid: string) => ({ userId: uid, role: 'OWNER', tenantId: 'tenantA' }), findForAuthn: async () => null },
    tenants: { resolveId: async () => 'tenantA' },
    audit: { record: async () => {} },
  };
  return { p, calls };
}
const input = (challenge: string) => ({ handle: 'handle_x', credentialId: 'cred-1', clientDataJSON: JSON.stringify({ type: 'webauthn.get', challenge, origin: 'https://salon.example' }), authenticatorData: 'ad', signature: 'sig' });
const chal = (over: any) => ({ challenge: 'CH', userId: 'userA', tenantId: 'tenantA', purpose: 'authenticate', expiresAt: 9_000_000, ...over });

describe('WebAuthn finishAuthentication binding + replay', () => {
  it('rejects a credential registered to a DIFFERENT tenant', async () => {
    const { p } = makePorts({ challenge: chal({}), cred: { credentialId: 'cred-1', userId: 'userA', tenantId: 'tenantB', publicKey: 'pk', signCount: 0 } });
    await expect(new WebAuthnService(p).finishAuthentication(input('CH'))).rejects.toThrow('cross_tenant_credential');
  });

  it('rejects a credential belonging to a DIFFERENT user (no begin-as-victim/finish-as-self bypass)', async () => {
    const { p } = makePorts({ challenge: chal({}), cred: { credentialId: 'cred-1', userId: 'userB', tenantId: 'tenantA', publicKey: 'pk', signCount: 0 } });
    await expect(new WebAuthnService(p).finishAuthentication(input('CH'))).rejects.toThrow('credential_user_mismatch');
  });

  it('rejects an expired/replayed challenge', async () => {
    const { p } = makePorts({ challenge: chal({ expiresAt: 1 }), cred: { credentialId: 'cred-1', userId: 'userA', tenantId: 'tenantA', publicKey: 'pk', signCount: 0 } });
    await expect(new WebAuthnService(p).finishAuthentication(input('CH'))).rejects.toThrow('challenge_invalid');
  });

  it('rejects a clientData challenge that does not match the issued challenge', async () => {
    const { p } = makePorts({ challenge: chal({}), cred: { credentialId: 'cred-1', userId: 'userA', tenantId: 'tenantA', publicKey: 'pk', signCount: 0 } });
    await expect(new WebAuthnService(p).finishAuthentication(input('WRONG-CHALLENGE'))).rejects.toThrow(/clientdata_/);
  });

  it('authenticates as the credential owner and advances the sign counter when tenant+user match', async () => {
    const { p, calls } = makePorts({ challenge: chal({}), cred: { credentialId: 'cred-1', userId: 'userA', tenantId: 'tenantA', publicKey: 'pk', signCount: 0 }, newSignCount: 7 });
    const out: any = await new WebAuthnService(p).finishAuthentication(input('CH'));
    expect(out.ok).toBe(true);
    expect(out.userId).toBe('userA');
    expect(calls.sessionFor).toBe('userA');
    expect(calls.signCountUpdatedTo).toBe(7);
  });

  it('flags a cloned authenticator on sign-count regression', async () => {
    const { p } = makePorts({ challenge: chal({}), cred: { credentialId: 'cred-1', userId: 'userA', tenantId: 'tenantA', publicKey: 'pk', signCount: 10 }, newSignCount: 4 });
    await expect(new WebAuthnService(p).finishAuthentication(input('CH'))).rejects.toThrow('sign_count_regression');
  });
});
