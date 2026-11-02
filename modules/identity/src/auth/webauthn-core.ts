// webauthn-core.ts — pure, tested core for Face ID / Touch ID (WebAuthn platform passkeys).
// The cryptographic attestation/assertion signature check is delegated to a verifier (e.g. @simplewebauthn/server)
// in your repo; everything that can be verified WITHOUT that library lives here and is unit-tested.

export function b64urlEncode(bytes: number[]): string {
  const b = Buffer.from(bytes).toString("base64");
  return b.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function b64urlDecode(s: string): number[] {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b = Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
  return Array.from(b.values());
}
// fresh base64url challenge from CSPRNG bytes (crypto.randomBytes in the service).
export function newChallenge(randomBytes: number[]): string { return b64urlEncode(randomBytes); }

// platform attachment = the on-device authenticator that surfaces as Face ID / Touch ID.
export interface RegOptions { rpId: string; rpName: string; userIdB64: string; userName: string; displayName: string; challenge: string; excludeCredentialIds: string[]; }
export function buildRegistrationOptions(o: RegOptions) {
  return {
    rp: { id: o.rpId, name: o.rpName },
    user: { id: o.userIdB64, name: o.userName, displayName: o.displayName },
    challenge: o.challenge,
    pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }], // ES256, RS256
    timeout: 60000,
    attestation: "none",
    excludeCredentials: o.excludeCredentialIds.map((id) => ({ type: "public-key", id })),
    authenticatorSelection: { authenticatorAttachment: "platform", residentKey: "preferred", userVerification: "required" },
  };
}
export interface AuthOptions { rpId: string; challenge: string; allowCredentialIds: string[]; }
export function buildAuthenticationOptions(o: AuthOptions) {
  return {
    rpId: o.rpId, challenge: o.challenge, timeout: 60000, userVerification: "required",
    allowCredentials: o.allowCredentialIds.map((id) => ({ type: "public-key", id, transports: ["internal"] })),
  };
}

// clientDataJSON checks (RFC: type, challenge, origin). These are required regardless of the crypto verify.
export interface ClientData { type: string; challenge: string; origin: string; }
export function parseClientDataJSON(json: string): ClientData { const j = JSON.parse(json); return { type: j.type, challenge: j.challenge, origin: j.origin }; }
export function verifyClientData(cd: ClientData, expect: { type: "webauthn.create" | "webauthn.get"; challenge: string; origin: string }): { ok: boolean; error?: string } {
  if (cd.type !== expect.type) return { ok: false, error: "type_mismatch" };
  if (cd.challenge !== expect.challenge) return { ok: false, error: "challenge_mismatch" };
  if (cd.origin !== expect.origin) return { ok: false, error: "origin_mismatch" };
  return { ok: true };
}

// rpId must be the site's registrable domain or a suffix of the origin host (prevents cross-origin replay).
export function originMatchesRpId(origin: string, rpId: string): boolean {
  try { const host = new URL(origin).hostname; return host === rpId || host.endsWith("." + rpId); } catch { return false; }
}

// signature counter regression = cloned authenticator. 0/0 is allowed (some platform authenticators don't count).
export function verifySignCount(stored: number, incoming: number): { ok: boolean; error?: string } {
  if (stored === 0 && incoming === 0) return { ok: true };
  if (incoming > stored) return { ok: true };
  return { ok: false, error: "sign_count_regression" };
}

export function isAllowedCredential(allowList: string[], credentialId: string): boolean {
  return allowList.length === 0 || allowList.indexOf(credentialId) >= 0;
}
