// device-proof.ts — Secure Tap to Pay mandate §4 / §71 (Oct 23 2026): a payment phone proves possession of ITS private key on
// every sensitive request. The key pair is made on the phone with the OS's own cryptography (WebCrypto ECDSA P-256 with a
// non-extractable private key, or the Secure Enclave through the native bridge); only the public key (SPKI, base64) is
// registered. No custom cryptography: node:crypto verifies an ECDSA P-256 / SHA-256 signature.
//
// The signed string (version-tagged, newline-joined):
//   AIPS-DEVICE-V1 \n METHOD \n PATH?QUERY \n DEVICE-ID \n TIMESTAMP-MS \n NONCE \n SHA256-HEX(raw body bytes)
// Headers: x-aps-device-id, x-aps-device-ts, x-aps-device-nonce, x-aps-device-sig (base64url, IEEE-P1363 r||s — what
// WebCrypto produces). A request is accepted once: the timestamp must be within ±5 minutes and (device, nonce) is recorded
// in mobile_pay_device_nonces (a replay is DEVICE_REQUEST_REPLAYED).
import { createHash, createPublicKey, verify as cryptoVerify, type KeyObject } from 'node:crypto';

export const DEVICE_PROOF_VERSION = 'AIPS-DEVICE-V1';
export const DEVICE_PROOF_WINDOW_MS = 5 * 60_000;
export const DEVICE_PROOF_HEADERS = { id: 'x-aps-device-id', ts: 'x-aps-device-ts', nonce: 'x-aps-device-nonce', sig: 'x-aps-device-sig' } as const;

export class DeviceProofError extends Error {
  constructor(readonly code: 'DEVICE_KEY_MISMATCH' | 'DEVICE_REQUEST_REPLAYED' | 'DEVICE_KEY_REQUIRED' | 'DEVICE_NOT_REGISTERED' | 'DEVICE_REVOKED', message: string) { super(message); this.name = 'DeviceProofError'; }
}

export function bodyHash(raw: Buffer | string | null | undefined): string {
  return createHash('sha256').update(raw == null ? '' : raw).digest('hex');
}
export function canonicalDeviceRequest(p: { method: string; path: string; deviceId: string; ts: string | number; nonce: string; bodySha256: string }): string {
  return [DEVICE_PROOF_VERSION, String(p.method).toUpperCase(), p.path, p.deviceId, String(p.ts), p.nonce, p.bodySha256].join('\n');
}

/** Parse a registered public key: SPKI DER in base64 / base64url, P-256 only. Throws on anything else. */
export function parseDevicePublicKey(spkiB64: string): KeyObject {
  const der = Buffer.from(String(spkiB64 ?? '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (der.length < 60 || der.length > 200) throw new Error('not an EC public key');
  const key = createPublicKey({ key: der, format: 'der', type: 'spki' });
  const d = key.asymmetricKeyDetails as { namedCurve?: string } | undefined;
  if (key.asymmetricKeyType !== 'ec' || d?.namedCurve !== 'prime256v1') throw new Error('the payment device key must be ECDSA P-256');
  return key;
}
/** The platform-wide identity of a key (UNIQUE): sha256 of its SPKI DER. */
export function keyFingerprint(spkiB64: string): string {
  const k = parseDevicePublicKey(spkiB64);
  return createHash('sha256').update(k.export({ format: 'der', type: 'spki' })).digest('hex');
}

export function verifyDeviceSignature(spkiB64: string, signed: string, sigB64url: string): boolean {
  try {
    const sig = Buffer.from(String(sigB64url ?? '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (sig.length !== 64) return false;   // P-256 r||s
    return cryptoVerify('sha256', Buffer.from(signed, 'utf8'), { key: parseDevicePublicKey(spkiB64), dsaEncoding: 'ieee-p1363' }, sig);
  } catch (e) { void e; return false; }   // a malformed key or signature is simply not a valid signature (fail closed)
}

/** Mandate §71 policy: 'required' — a payment phone without a registered key cannot take money; 'optional' — legacy phones
 *  without a key still work, but a phone that HAS a key must always sign. Production defaults to required. */
export function deviceKeyPolicy(env: NodeJS.ProcessEnv = process.env): 'required' | 'optional' {
  const v = String(env.MOBILE_PAY_DEVICE_KEYS ?? '').trim().toLowerCase();
  if (v === 'required' || v === 'optional') return v;
  return env.NODE_ENV === 'production' ? 'required' : 'optional';
}

export interface DeviceProofInput {
  method: string; path: string; headers: Record<string, string | string[] | undefined>; rawBody?: Buffer | string | null; now?: number;
}
export interface ParsedProof { deviceId: string; ts: string; nonce: string; sig: string }

/** The proof headers of a request, or null when it carries none (the request is then an unsigned one). */
export function readProof(headers: DeviceProofInput['headers']): ParsedProof | null {
  const h = (k: string) => { const v = headers?.[k]; return Array.isArray(v) ? v[0] : v; };
  const deviceId = h(DEVICE_PROOF_HEADERS.id); const ts = h(DEVICE_PROOF_HEADERS.ts); const nonce = h(DEVICE_PROOF_HEADERS.nonce); const sig = h(DEVICE_PROOF_HEADERS.sig);
  if (!deviceId && !sig) return null;
  return { deviceId: String(deviceId ?? ''), ts: String(ts ?? ''), nonce: String(nonce ?? ''), sig: String(sig ?? '') };
}

/** Check a proof against a known public key (timestamp window + signature). Replay is the caller's (it needs storage). */
export function checkProof(input: DeviceProofInput, proof: ParsedProof, publicKey: string): { ok: true } | { ok: false; reason: string } {
  const now = input.now ?? Date.now();
  const ts = Number(proof.ts);
  if (!proof.deviceId || !proof.nonce || proof.nonce.length < 16 || proof.nonce.length > 128 || !/^[A-Za-z0-9_-]+$/.test(proof.nonce)) return { ok: false, reason: 'malformed proof' };
  if (!Number.isFinite(ts) || Math.abs(now - ts) > DEVICE_PROOF_WINDOW_MS) return { ok: false, reason: 'timestamp outside the window' };
  const signed = canonicalDeviceRequest({ method: input.method, path: input.path, deviceId: proof.deviceId, ts: proof.ts, nonce: proof.nonce, bodySha256: bodyHash(input.rawBody) });
  return verifyDeviceSignature(publicKey, signed, proof.sig) ? { ok: true } : { ok: false, reason: 'bad signature' };
}
