// device-attestation.ts — Secure Tap to Pay §5 (Oct 26 2026): the SERVER half of device attestation / integrity.
//
// The phone (native half, external: Apple App Attest — DCAppAttestService — needs a real device and the App ID's
// entitlement) produces an attestation object for its payment key and sends it to POST /mobile-checkout/device/attest,
// signed by that key. The server hands the evidence to an AttestationVerifierPort and stores the VERDICT on the device row
// (mobile_pay_devices.attestation_status: none / passed / failed). It is ONE trust signal (§5: "do not claim attestation is
// infallible"), never the only control — the device key, its signature on every request, approval and revocation stay.
//
//   • No verifier configured (today: the default) → 'unverifiable': nothing is stored, the answer says so honestly
//     (ATTESTATION_VERIFIER_NOT_CONFIGURED). The server NEVER marks a phone 'passed' without a verifier that checked it.
//   • Policy TTP_ATTESTATION_POLICY = 'off' (default) | 'enforce':
//       off     — the verdict is stored and audited; a 'failed' verdict raises a security event; nothing else changes;
//       enforce — additionally a 'failed' verdict marks the phone COMPROMISED (the §13 lifecycle: it must be revoked and
//                 re-registered, never re-activated in place) and ends its sessions, like a revoke (§16).
export type AttestationVerdict = 'passed' | 'failed' | 'unverifiable';
export interface AttestationEvidence { format: string; evidence: string; keyId?: string | null }
export interface AttestationVerifierPort {
  readonly provider: string;
  /** Verify the evidence for this device's registered key. Throwing = could not verify (treated as 'unverifiable'). */
  verify(input: AttestationEvidence & { tenantId: string; deviceId: string; keyFingerprint: string | null }): Promise<{ verdict: AttestationVerdict; reason?: string | null }>;
}
/** The default: no verifier wired — never a pass. */
export class NoAttestationVerifier implements AttestationVerifierPort {
  readonly provider = 'none';
  async verify(): Promise<{ verdict: AttestationVerdict; reason: string }> { return { verdict: 'unverifiable', reason: 'ATTESTATION_VERIFIER_NOT_CONFIGURED' }; }
}
export type AttestationPolicy = 'off' | 'enforce';
export function attestationPolicy(env: Record<string, string | undefined> = process.env): AttestationPolicy {
  return String(env.TTP_ATTESTATION_POLICY ?? '').trim().toLowerCase() === 'enforce' ? 'enforce' : 'off';
}
export const ATTESTATION_FORMATS = ['apple-appattest', 'android-play-integrity'] as const;
export const ATTESTATION_EVIDENCE_MAX = 16_384;
