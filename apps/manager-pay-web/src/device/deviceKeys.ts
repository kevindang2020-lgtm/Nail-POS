// deviceKeys.ts — Secure Tap to Pay M6-4: this phone's payment identity = DEVICE_ID + its ECDSA P-256 key pair, kept
// TOGETHER in IndexedDB (the CryptoKeyPair itself — the private key is non-extractable and never seen by JavaScript).
//
// • currentKey(): the identity, loaded once, created on first use. If the stored record names another id than
//   localStorage (storage partly cleared), the record wins — the key is what the server trusts.
// • signingHeaders(): the transport's per-attempt hook. Every /mobile-checkout request is signed once this phone has
//   ENROLLED its key (POST device/register with publicKey succeeded); the registration itself is always signed (proof
//   of possession). Before enrolment, a signed header on another route would be refused as DEVICE_NOT_REGISTERED, so
//   those wait for an enrolment in flight and otherwise go unsigned — the SERVER then decides (under the 'required'
//   policy it refuses money with DEVICE_KEY_REQUIRED, which the app shows plainly). Nothing ever fakes a signature.
// • When secure storage is missing (no WebCrypto / IndexedDB, private mode) keyUnavailableReason() says why; requests go
//   unsigned and the server's DEVICE_KEY_REQUIRED is explained with that reason — never a silent success.
// • wipeDeviceIdentity(): the phone was removed (DEVICE_REVOKED) or its key no longer matches — the key record is deleted
//   and a NEW id minted; the old id is final on the server.
import { createDeviceIdentity, indexedDbDeviceKeyStore, signDeviceRequest, DeviceKeyUnavailableError, type DeviceKeyStore, type StoredDeviceKey } from '@aipowersalon/mobile-sdk';
import { DEVICE_ID, setDeviceId, mintNewDeviceId } from '../util/session';

let store: DeviceKeyStore = indexedDbDeviceKeyStore('aps-pay-device', 'keys', 'identity');
let cached: StoredDeviceKey | null = null;
let loading: Promise<StoredDeviceKey | null> | null = null;
let unavailable: string | null = null;
let enrollment: Promise<unknown> | null = null;

/** Tests / a native Secure Enclave bridge can supply another store. Resets the cached identity. */
export function setDeviceKeyStore(s: DeviceKeyStore): void { store = s; cached = null; loading = null; unavailable = null; enrollment = null; }

/** Why this phone cannot hold a payment key, or null when it can (or has not tried yet). */
export function keyUnavailableReason(): string | null { return unavailable; }

/** This phone's identity: loaded from secure storage, or created (and saved) on first use. null when unavailable. */
export function currentKey(): Promise<StoredDeviceKey | null> {
  if (cached) return Promise.resolve(cached);
  if (!loading) {
    loading = (async () => {
      try {
        let rec = await store.load();
        if (rec && rec.deviceId !== DEVICE_ID) setDeviceId(rec.deviceId);   // the key decides which id this phone is
        if (!rec) { rec = await createDeviceIdentity(DEVICE_ID); await store.save(rec); }
        unavailable = null; cached = rec; return rec;
      } catch (e) {
        unavailable = e instanceof DeviceKeyUnavailableError ? e.message : 'This phone cannot create its secure payment key (secure storage is unavailable).';
        return null;
      } finally { loading = null; }
    })();
  }
  return loading;
}

/** The registration with this key succeeded: from now on every payment request is signed. */
export async function markEnrolled(): Promise<void> {
  const k = await currentKey();
  if (!k || k.enrolled) return;
  const next = { ...k, enrolled: true };
  try { await store.save(next); } catch { /* signed for this run; the next launch re-enrols (idempotent) */ }
  cached = next;
}
export function isEnrolled(): boolean { return !!cached?.enrolled; }

/** An enrolment in flight: other signed routes wait for it instead of racing it (and being refused as unregistered). */
export function trackEnrollment<T>(p: Promise<T>): Promise<T> {
  enrollment = p;
  void p.finally(() => { if (enrollment === p) enrollment = null; }).catch(() => undefined);
  return p;
}

/** Wipe this identity (key record + id) and mint a new id. The next registration is a NEW device (owner approval). */
export async function wipeDeviceIdentity(): Promise<void> {
  cached = null; loading = null; enrollment = null;
  try { await store.clear(); } catch { /* nothing more we can do; the new id below still detaches the old key */ }
  mintNewDeviceId();
}

const SIGNED_PATH = /\/mobile-checkout(\/|\?|$)/;
const REGISTER_PATH = /\/mobile-checkout\/device\/register(\?|$)/;
/** The transport hook (src/api/client.ts): proof headers for /mobile-checkout requests, computed per attempt. */
export async function signingHeaders(r: { method: string; url: string; body: string | undefined; isForm: boolean }): Promise<Record<string, string> | null> {
  const path = new URL(r.url, 'http://local.invalid').pathname;
  if (!SIGNED_PATH.test(path)) return null;
  const isRegister = REGISTER_PATH.test(path);
  if (!isRegister && !cached?.enrolled && enrollment) { try { await enrollment; } catch { /* decided below */ } }
  const k = await currentKey();
  if (!k) return null;                                  // no key possible here — the server decides (DEVICE_KEY_REQUIRED is shown plainly)
  if (!isRegister && !k.enrolled) return null;          // not registered yet: a signature would be refused as DEVICE_NOT_REGISTERED
  if (r.isForm) throw new DeviceKeyUnavailableError('A payment request with a file upload cannot be signed.');
  return signDeviceRequest(k.keyPair.privateKey, { method: r.method, url: r.url, deviceId: k.deviceId, body: r.body });
}
