// webauthn.service.ts — Face ID / Touch ID registration + authentication. Framework-free (constructor injection).
// The cryptographic verify (attestation/assertion) is a `verifier` port you back with @simplewebauthn/server in repo;
// everything else (challenge issue/consume, clientData checks, origin, sign-count, tenant scoping) runs here.
import {
  newChallenge, buildRegistrationOptions, buildAuthenticationOptions, parseClientDataJSON, verifyClientData,
  originMatchesRpId, verifySignCount, isAllowedCredential, b64urlEncode,
} from "./webauthn-core";

export interface WaUser { userId: string; tenantId: string | null; role: string; fullName: string; userName: string; permissions: string[]; branchId: string | null; salonName?: string; tenantCode?: string; }
export interface WaCredential { credentialId: string; userId: string; tenantId: string | null; publicKey: string; signCount: number; }

export interface Ports {
  config: { rpId: string; rpName: string; expectedOrigin: string };
  users: {
    findById(userId: string): Promise<WaUser | null>;
    findForAuthn(tenantId: string | null, hint?: string): Promise<WaUser | null>;
    /**
     * OPTIONAL. Are these two `users` rows the same global technician — and is the target one usable?
     *
     * Optional on purpose: when it is absent (the in-memory ports, every existing spec) `sameHuman` is false and
     * this file behaves EXACTLY as it did before. A widening of authentication must never happen by default; it
     * happens only where the database can prove the two rows are one person.
     */
    isSameGlobalTechnician?(credentialUserId: string, targetUserId: string): Promise<boolean>;
  };
  creds: {
    listByUser(tenantId: string | null, userId: string): Promise<WaCredential[]>;
    /** OPTIONAL. Her passkeys across every salon she works at. Absent → only this salon's. */
    listForHuman?(userId: string): Promise<WaCredential[]>;
    findByCredentialId(credentialId: string): Promise<WaCredential | null>;
    save(c: WaCredential & { transports?: string; deviceLabel?: string }): Promise<void>;
    updateSignCount(credentialId: string, signCount: number): Promise<void>;
  };
  challenges: { put(handle: string, data: { challenge: string; userId: string | null; tenantId: string | null; purpose: "register" | "authenticate"; expiresAt: number }): Promise<void>; consume(handle: string): Promise<{ challenge: string; userId: string | null; tenantId: string | null; purpose: string; expiresAt: number } | null> };
  tenants: { resolveId(tenantCodeOrSlug: string): Promise<string | null> };
  sessions: { create(userId: string): Promise<{ accessToken: string; refreshToken: string }> };
  verifier: {
    verifyRegistration(input: { clientDataJSON: string; attestationObject: string; expectedChallenge: string; expectedOrigin: string; expectedRpId: string }): Promise<{ ok: boolean; credentialId: string; publicKey: string; signCount: number }>;
    verifyAuthentication(input: { clientDataJSON: string; authenticatorData: string; signature: string; publicKey: string; expectedChallenge: string; expectedOrigin: string; expectedRpId: string }): Promise<{ ok: boolean; newSignCount: number }>;
  };
  audit: { record(a: { actionType: string; userId?: string; tenantId?: string | null; metadata: Record<string, unknown> }): Promise<void> };
  clock: { now(): number };
  rng: { bytes(n: number): number[]; token(): string };
}
const FIVE_MIN = 5 * 60_000;

export class WebAuthnService {
  constructor(private p: Ports) {}

  // ---- registration (enroll Face ID on this device) ----
  async beginRegistration(user: WaUser) {
    const challenge = newChallenge(this.p.rng.bytes(32));
    const handle = this.p.rng.token();
    await this.p.challenges.put(handle, { challenge, userId: user.userId, tenantId: user.tenantId, purpose: "register", expiresAt: this.p.clock.now() + FIVE_MIN });
    const existing = await this.p.creds.listByUser(user.tenantId, user.userId);
    const options = buildRegistrationOptions({
      rpId: this.p.config.rpId, rpName: this.p.config.rpName,
      userIdB64: b64urlEncode(Array.from(Buffer.from(user.userId))), userName: user.userName, displayName: user.fullName,
      challenge, excludeCredentialIds: existing.map((c) => c.credentialId),
    });
    await this.p.audit.record({ actionType: "passkey_registration_started", userId: user.userId, tenantId: user.tenantId, metadata: {} });
    return { handle, options };
  }
  async finishRegistration(input: { handle: string; credentialId: string; publicKey: string; clientDataJSON: string; attestationObject: string; transports?: string; deviceLabel?: string }) {
    const ch = await this.p.challenges.consume(input.handle);
    if (!ch || ch.purpose !== "register" || this.p.clock.now() >= ch.expiresAt) throw new Error("challenge_invalid");
    let cd; try { cd = parseClientDataJSON(input.clientDataJSON); } catch { throw new Error("clientdata_malformed"); }   // attacker-controlled JSON must fail in-vocabulary, never as a raw SyntaxError
    const vcd = verifyClientData(cd, { type: "webauthn.create", challenge: ch.challenge, origin: this.p.config.expectedOrigin });
    if (!vcd.ok) throw new Error("clientdata_" + vcd.error);
    if (!originMatchesRpId(cd.origin, this.p.config.rpId)) throw new Error("origin_rpid_mismatch");
    const v = await this.p.verifier.verifyRegistration({ clientDataJSON: input.clientDataJSON, attestationObject: input.attestationObject, expectedChallenge: ch.challenge, expectedOrigin: this.p.config.expectedOrigin, expectedRpId: this.p.config.rpId });
    if (!v.ok) throw new Error("attestation_failed");
    await this.p.creds.save({ credentialId: v.credentialId, userId: ch.userId!, tenantId: ch.tenantId, publicKey: v.publicKey, signCount: v.signCount, transports: input.transports, deviceLabel: input.deviceLabel });
    await this.p.audit.record({ actionType: "passkey_registered", userId: ch.userId || undefined, tenantId: ch.tenantId, metadata: { deviceLabel: input.deviceLabel } });
    return { ok: true as const };
  }

  // ---- authentication (Sign in with Face ID) ----
  async beginAuthentication(input: { tenantCodeOrSlug?: string; emailOrPhone?: string }) {
    const tenantId = input.tenantCodeOrSlug ? await this.p.tenants.resolveId(input.tenantCodeOrSlug) : null;
    const user = await this.p.users.findForAuthn(tenantId, input.emailOrPhone);
    const challenge = newChallenge(this.p.rng.bytes(32));
    const handle = this.p.rng.token();
    // Offer her the passkey she ACTUALLY HAS.
    //
    // Under the per-salon login model a technician has one `users` row per salon, so the passkey she registered
    // at Luxe belongs to a different row than the one she is signing in to at Belle. `listByUser` returned
    // nothing there, the allowCredentials list came back empty, and Face ID simply did not appear — at every
    // salon but the first one she ever used. The spec asks for the opposite in as many words: "Face ID still
    // works after salon switch."
    //
    // `listForHuman` returns her own credentials always, and her OTHER salons' credentials only when the
    // database can prove they are the same person: same global_tech_profile_id, both rows TECHNICIAN, the target
    // row active (she has onboarded there), and the global account itself active.
    const allow = user
      ? (this.p.creds.listForHuman
        ? await this.p.creds.listForHuman(user.userId)
        : await this.p.creds.listByUser(user.tenantId, user.userId)
      ).map((c) => c.credentialId)
      : [];
    // store challenge even when no user matched (avoid revealing existence); allowCredentials may be empty.
    await this.p.challenges.put(handle, { challenge, userId: user ? user.userId : null, tenantId, purpose: "authenticate", expiresAt: this.p.clock.now() + FIVE_MIN });
    return { handle, options: buildAuthenticationOptions({ rpId: this.p.config.rpId, challenge, allowCredentialIds: allow }) };
  }
  async finishAuthentication(input: { handle: string; credentialId: string; clientDataJSON: string; authenticatorData: string; signature: string }) {
    const ch = await this.p.challenges.consume(input.handle);
    if (!ch || ch.purpose !== "authenticate" || this.p.clock.now() >= ch.expiresAt) throw new Error("challenge_invalid");
    const cred = await this.p.creds.findByCredentialId(input.credentialId);
    if (!cred) throw new Error("unknown_credential");

    // ══ THE PASSKEY PROVES *WHO*. THE CHALLENGE DECIDES *WHERE*. ═══════════════════════════════════════════
    //
    // A technician's passkey is registered against her `users` row at ONE salon. It is still HER passkey — her
    // device, her biometric — and under the per-salon login model her other salons are other rows belonging to
    // the same person. `isSameGlobalTechnician` is the only thing that may say so, and it asks the database, not
    // the request: same global_tech_profile_id, both TECHNICIAN, target row active, global account active.
    //
    // That link is never established by a stranger. It exists because SHE accepted the membership, because she
    // logged in and created the profile herself, or because a Super Admin merged two accounts under audit.
    //
    // Everything below is unchanged when it is false — which includes every non-technician, every unlinked user,
    // and every deployment where the port is not wired. A widening of authentication does not happen by default.
    const sameHuman = ch.userId !== null && cred.userId !== ch.userId && this.p.users.isSameGlobalTechnician
      ? await this.p.users.isSameGlobalTechnician(cred.userId, ch.userId)
      : false;

    if (ch.tenantId !== null && cred.tenantId !== ch.tenantId && !sameHuman) throw new Error("cross_tenant_credential"); // isolation
    if (ch.userId !== null && cred.userId !== ch.userId && !sameHuman) throw new Error("credential_user_mismatch");
    let cd; try { cd = parseClientDataJSON(input.clientDataJSON); } catch { throw new Error("clientdata_malformed"); }   // attacker-controlled JSON must fail in-vocabulary, never as a raw SyntaxError
    const vcd = verifyClientData(cd, { type: "webauthn.get", challenge: ch.challenge, origin: this.p.config.expectedOrigin });
    if (!vcd.ok) throw new Error("clientdata_" + vcd.error);
    const v = await this.p.verifier.verifyAuthentication({ clientDataJSON: input.clientDataJSON, authenticatorData: input.authenticatorData, signature: input.signature, publicKey: cred.publicKey, expectedChallenge: ch.challenge, expectedOrigin: this.p.config.expectedOrigin, expectedRpId: this.p.config.rpId });
    if (!v.ok) throw new Error("assertion_failed");
    const sc = verifySignCount(cred.signCount, v.newSignCount);
    if (!sc.ok) { await this.p.audit.record({ actionType: "passkey_clone_detected", userId: cred.userId, tenantId: cred.tenantId, metadata: {} }); throw new Error("sign_count_regression"); }
    await this.p.creds.updateSignCount(cred.credentialId, v.newSignCount);

    // The session is minted for the users row of the salon she asked to sign in to — NEVER for whichever salon
    // happens to own the credential. Minting `cred.userId` here would have taken a technician who asked for
    // Belle and signed her into Luxe, using a passkey, silently, with the tenant of a salon she did not choose.
    //
    // `sessions.create` refuses any row that is not `status = 'active'`, so an invited-but-never-onboarded row
    // cannot be reached this way either. Two independent gates, and the outer one does not lean on the inner.
    const principalUserId = ch.userId ?? cred.userId;
    const user = await this.p.users.findById(principalUserId);
    const session = await this.p.sessions.create(principalUserId);
    await this.p.audit.record({
      actionType: "passkey_login_success", userId: principalUserId, tenantId: ch.tenantId ?? cred.tenantId,
      metadata: sameHuman ? { crossSalonPasskey: true, registeredAtTenantId: cred.tenantId } : {},
    });
    return { ok: true as const, accessToken: session.accessToken, refreshToken: session.refreshToken, role: user?.role, userId: principalUserId };
  }
}
