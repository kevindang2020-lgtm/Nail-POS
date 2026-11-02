// webauthn-verifier.ts — the REAL cryptographic verification for Face ID / Touch ID.
//
// ⚠️ Why this file exists. `WebAuthnService` takes a `verifier` port and its tests supply a stub that always
// returns `{ ok: true }`. That stub is fine for testing the ORCHESTRATION (tenant binding, replay, sign counts) —
// but no real implementation of the port existed anywhere in the codebase, and `@simplewebauthn/server` was
// installed as a dependency and never imported.
//
// So if anyone had simply mounted the service, the only available `verifier` would have been the always-true
// stub, and **any forged signature would have been accepted — a complete authentication bypass.** A biometric
// login that never checks the signature is worse than no biometric login at all.
//
// This binds the port to the maintained library rather than hand-rolling CBOR/COSE/ECDSA. Two rules:
//   • It FAILS CLOSED. Any error — malformed attestation, bad signature, wrong origin, wrong challenge — returns
//     ok:false. There is no path here that lets a bad ceremony through.
//   • It never "degrades" to permissive. If the library is unavailable the verifier throws rather than allowing.
import { verifyRegistrationResponse, verifyAuthenticationResponse } from '@simplewebauthn/server';
import type { Ports } from './webauthn.service';

type Verifier = Ports['verifier'];

const b64urlToBuf = (s: string): Buffer => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const bufToB64url = (b: Uint8Array | Buffer): string =>
  Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function makeWebAuthnVerifier(): Verifier {
  return {
    async verifyRegistration(input) {
      try {
        const res = await verifyRegistrationResponse({
          response: {
            id: '',
            rawId: '',
            type: 'public-key',
            clientExtensionResults: {},
            response: {
              clientDataJSON: input.clientDataJSON,
              attestationObject: input.attestationObject,
            },
          },
          expectedChallenge: input.expectedChallenge,
          expectedOrigin: input.expectedOrigin,
          expectedRPID: input.expectedRpId,
          requireUserVerification: true,        // Face ID / Touch ID must actually have verified the user
        });

        const info: any = res.registrationInfo;
        // exactly `true` — the library's answer is a boolean; anything else (undefined, a truthy object from a mis-wired or
        // stubbed dependency) is NOT a verified ceremony. Fail closed.
        if (res?.verified !== true || !info) return { ok: false, credentialId: '', publicKey: '', signCount: 0 };

        // v13 nests these under `credential`; older shapes expose them directly. Handle both, fail closed.
        const cred = info.credential ?? info;
        const rawId = cred.id ?? cred.credentialID;
        const rawKey = cred.publicKey ?? cred.credentialPublicKey;
        if (!rawId || !rawKey) return { ok: false, credentialId: '', publicKey: '', signCount: 0 };

        return {
          ok: true,
          credentialId: typeof rawId === 'string' ? rawId : bufToB64url(rawId),
          publicKey: bufToB64url(rawKey),
          signCount: Number(cred.counter ?? 0),
        };
      } catch {
        // Malformed attestation, wrong origin, wrong challenge, failed user-verification → REJECT.
        return { ok: false, credentialId: '', publicKey: '', signCount: 0 };
      }
    },

    async verifyAuthentication(input) {
      try {
        const res = await verifyAuthenticationResponse({
          response: {
            id: '',
            rawId: '',
            type: 'public-key',
            clientExtensionResults: {},
            response: {
              clientDataJSON: input.clientDataJSON,
              authenticatorData: input.authenticatorData,
              signature: input.signature,
            },
          },
          expectedChallenge: input.expectedChallenge,
          expectedOrigin: input.expectedOrigin,
          expectedRPID: input.expectedRpId,
          requireUserVerification: true,
          credential: {
            id: '',
            publicKey: new Uint8Array(b64urlToBuf(input.publicKey)),
            counter: 0,
          },
        });

        if (res?.verified !== true) return { ok: false, newSignCount: 0 };   // exactly true, as above — fail closed
        return { ok: true, newSignCount: Number(res.authenticationInfo?.newCounter ?? 0) };
      } catch {
        // A bad signature lands here. REJECT — never fall through to allow.
        return { ok: false, newSignCount: 0 };
      }
    },
  };
}
