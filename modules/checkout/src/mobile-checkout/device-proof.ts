// device-proof.ts — Secure Tap to Pay mandate §4 / §71: the SERVER side of packages/mobile-sdk/src/device-proof.ts.
//
// A payment phone signs every sensitive request with its own ECDSA P-256 key (private key non-extractable, made by the
// phone's WebCrypto). This module checks that signature with Node's crypto — no custom cryptography. It is pure: the
// caller (a guard) supplies the phone's REGISTERED public key and the request as the server received it, and is
// responsible for refusing a (device, nonce) it has already accepted (replay) — see DeviceNonceStore below.
//
// The signed string, byte for byte the client's:
//   AIPS-DEVICE-V1 \n METHOD \n PATH?QUERY \n DEVICE-ID \n TIMESTAMP-MS \n NONCE \n SHA256-HEX(exact body bytes)
// PATH is req.originalUrl after the /api/v1 rewrite (apps/api/src/common/api-version.ts) — the client signs it the same.
// Signature: base64url of the 64-byte IEEE-P1363 r||s WebCrypto produces. Public key: SPKI DER, standard base64.
//
// Status (Nov 5 2026): the verifier is complete and tested against the real client signer
// (packages/mobile-sdk/src/device-proof.test.ts). NOT yet wired: storing each phone's public key at registration, the
// per-route guard and the nonce store. The Manager Pay app does not sign requests yet either, so a guard would refuse
// every Tap to Pay call; it lands together with the native Tap to Pay build (Apple entitlement + Fiserv PSP).
import { createHash, createPublicKey, verify as cryptoVerify, type KeyObject } from 'node:crypto';

export const DEVICE_PROOF_VERSION = 'AIPS-DEVICE-V1';
export const DEVICE_PROOF_HEADERS = { id: 'x-aps-device-id', ts: 'x-aps-device-ts', nonce: 'x-aps-device-nonce', sig: 'x-aps-device-sig' } as const;
/** A signed request is accepted within ±5 minutes of the server clock (phones drift; replays are stopped by the nonce). */
export const DEVICE_PROOF_WINDOW_MS = 5 * 60 * 1000;

export interface DeviceProof { deviceId: string; ts: number; nonce: string; sig: string }
export type ProofCheck = { ok: true } | { ok: false; reason: string };

export function canonicalDeviceRequest(p: { method: string; path: string; deviceId: string; ts: string | number; nonce: string; bodySha256: string }): string {
  return [DEVICE_PROOF_VERSION, String(p.method).toUpperCase(), p.path, p.deviceId, String(p.ts), p.nonce, p.bodySha256].join('\n');
}

/** sha256 hex of the exact body bytes received; no body → the hash of nothing (what the client signs for a GET). */
export function bodyHash(raw: Buffer | Uint8Array | null | undefined): string {
  return createHash('sha256').update(raw ?? Buffer.alloc(0)).digest('hex');
}

/** sha256 hex of the SPKI DER — a stable, non-secret id for a registered key (audit logs, never the key itself). */
export function keyFingerprint(spkiBase64: string): string {
  return createHash('sha256').update(Buffer.from(spkiBase64, 'base64')).digest('hex');
}

/** The registered public key as a Node KeyObject. Only EC P-256 is accepted; anything else throws. */
export function parseDevicePublicKey(spkiBase64: string): KeyObject {
  const k = createPublicKey({ key: Buffer.from(spkiBase64, 'base64'), format: 'der', type: 'spki' });
  const d = k.asymmetricKeyDetails as { namedCurve?: string } | undefined;
  if (k.asymmetricKeyType !== 'ec' || (d?.namedCurve !== 'prime256v1' && d?.namedCurve !== 'P-256')) throw new Error('device key must be EC P-256');
  return k;
}

/** True only for a valid ECDSA-SHA256 signature (IEEE-P1363 r||s, base64url) over `signed` by that public key. */
export function verifyDeviceSignature(spkiBase64: string, signed: string, sigBase64Url: string): boolean {
  try {
    const sig = Buffer.from(sigBase64Url, 'base64url');
    if (sig.length !== 64) return false;
    return cryptoVerify('sha256', Buffer.from(signed, 'utf8'), { key: parseDevicePublicKey(spkiBase64), dsaEncoding: 'ieee-p1363' }, sig);
  } catch { return false; }
}

const header = (h: Record<string, unknown>, name: string): string | undefined => {
  const v = h[name] ?? h[name.toLowerCase()] ?? Object.entries(h).find(([k]) => k.toLowerCase() === name)?.[1];
  return Array.isArray(v) ? String(v[0]) : v == null ? undefined : String(v);
};

/** The four proof headers, shape-checked; null when any is missing or malformed (the guard refuses the request). */
export function readProof(h: Record<string, unknown>): DeviceProof | null {
  const deviceId = header(h, DEVICE_PROOF_HEADERS.id), ts = header(h, DEVICE_PROOF_HEADERS.ts);
  const nonce = header(h, DEVICE_PROOF_HEADERS.nonce), sig = header(h, DEVICE_PROOF_HEADERS.sig);
  if (!deviceId || !/^[A-Za-z0-9._:-]{8,128}$/.test(deviceId)) return null;
  if (!ts || !/^\d{10,16}$/.test(ts)) return null;
  if (!nonce || !/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) return null;
  if (!sig || !/^[A-Za-z0-9_-]{60,100}$/.test(sig)) return null;
  return { deviceId, ts: Number(ts), nonce, sig };
}

/** Check one request: inside the time window, and signed by THIS public key over exactly this method/path/device/body. */
export function checkProof(req: { method: string; path: string; headers: Record<string, unknown>; rawBody: Buffer | Uint8Array | null; now?: number }, proof: DeviceProof, publicKeySpki: string): ProofCheck {
  const now = req.now ?? Date.now();
  if (!Number.isFinite(proof.ts) || Math.abs(now - proof.ts) > DEVICE_PROOF_WINDOW_MS) return { ok: false, reason: 'timestamp outside the window' };
  const signed = canonicalDeviceRequest({ method: req.method, path: req.path, deviceId: proof.deviceId, ts: proof.ts, nonce: proof.nonce, bodySha256: bodyHash(req.rawBody) });
  return verifyDeviceSignature(publicKeySpki, signed, proof.sig) ? { ok: true } : { ok: false, reason: 'bad signature' };
}

/** Replay protection for the guard: each (device, nonce) is accepted once within the window. */
export interface DeviceNonceStore { firstUse(deviceId: string, nonce: string, ttlMs: number): Promise<boolean> }
export class InMemoryDeviceNonceStore implements DeviceNonceStore {
  private seen = new Map<string, number>();
  constructor(private readonly now: () => number = Date.now) {}
  async firstUse(deviceId: string, nonce: string, ttlMs: number): Promise<boolean> {
    const t = this.now();
    for (const [k, exp] of this.seen) if (exp <= t) this.seen.delete(k);
    const k = deviceId + '\u0000' + nonce;
    if (this.seen.has(k)) return false;
    this.seen.set(k, t + ttlMs); return true;
  }
}
