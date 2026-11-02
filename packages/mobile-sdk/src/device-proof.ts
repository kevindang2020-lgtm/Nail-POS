// device-proof.ts — Secure Tap to Pay mandate §4 / §71 (client side of modules/checkout/src/mobile-checkout/device-proof.ts).
//
// A payment phone proves possession of ITS private key on every sensitive request. The key pair is made here with the
// platform's own cryptography — WebCrypto ECDSA P-256, private key NON-extractable — and the CryptoKeyPair object itself
// is kept in IndexedDB (a structured clone of a CryptoKey: the private key bytes never reach JavaScript). Only the
// public key leaves the phone: SPKI DER, base64. No custom cryptography.
//
// The signed string (must match the server byte for byte):
//   AIPS-DEVICE-V1 \n METHOD \n PATH?QUERY \n DEVICE-ID \n TIMESTAMP-MS \n NONCE \n SHA256-HEX(exact body bytes sent)
// PATH is what the server sees as req.originalUrl. The API serves every route at /api/v1/<path> AND rewrites that prefix
// away (url AND originalUrl, apps/api/src/common/api-version.ts) before the guard runs — so the client signs the path
// WITHOUT /api/v1 (exactly as rewriteApiV1 does), with the query string exactly as sent.
// Headers: x-aps-device-id, x-aps-device-ts, x-aps-device-nonce, x-aps-device-sig (base64url of the 64-byte IEEE-P1363
// r||s that WebCrypto's ECDSA sign produces). A fresh nonce on every request: the server accepts each (device, nonce) once.

export const DEVICE_PROOF_VERSION = 'AIPS-DEVICE-V1';
export const DEVICE_PROOF_HEADERS = { id: 'x-aps-device-id', ts: 'x-aps-device-ts', nonce: 'x-aps-device-nonce', sig: 'x-aps-device-sig' } as const;
const API_V1_PREFIX = '/api/v1';

/** Why a key could not be made / used (no WebCrypto, no IndexedDB, a private window). The app shows it; it never signs around it. */
export class DeviceKeyUnavailableError extends Error {
  readonly code = 'DEVICE_KEY_UNAVAILABLE';
  constructor(message = 'This phone cannot create its secure payment key (secure storage is unavailable).') { super(message); this.name = 'DeviceKeyUnavailableError'; }
}

const g = globalThis as unknown as { crypto?: Crypto; indexedDB?: IDBFactory };
function subtle(): SubtleCrypto {
  const s = g.crypto?.subtle;
  if (!s) throw new DeviceKeyUnavailableError('This phone has no WebCrypto — it cannot create its secure payment key.');
  return s;
}

export function canonicalDeviceRequest(p: { method: string; path: string; deviceId: string; ts: string | number; nonce: string; bodySha256: string }): string {
  return [DEVICE_PROOF_VERSION, String(p.method).toUpperCase(), p.path, p.deviceId, String(p.ts), p.nonce, p.bodySha256].join('\n');
}

/** The path the server's guard sees for a request URL (absolute or relative): pathname + query exactly as the browser
 *  sends them (WHATWG URL serialisation — the same one fetch uses), minus the /api/v1 alias prefix the API strips. */
export function signedPathFor(url: string): string {
  const u = new URL(url, 'http://local.invalid');
  const p = u.pathname + u.search;
  if (p.startsWith(API_V1_PREFIX + '/platform')) return p;   // the Super Admin alias keeps its own mapping (platform-alias.ts)
  if (p.startsWith(API_V1_PREFIX + '/') || p.startsWith(API_V1_PREFIX + '?')) { const rest = p.slice(API_V1_PREFIX.length); return rest.startsWith('?') ? '/' + rest : rest; }
  if (p === API_V1_PREFIX) return '/';
  return p;
}

export function bytesToBase64(b: Uint8Array): string { let s = ''; for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); }
export function bytesToBase64Url(b: Uint8Array): string { return bytesToBase64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

/** sha256 hex of the exact UTF-8 bytes of the body ('' → the hash of nothing, as the server computes for no body). */
export async function sha256Hex(body: string | null | undefined): Promise<string> {
  const d = new Uint8Array(await subtle().digest('SHA-256', new TextEncoder().encode(body ?? '')));
  return Array.from(d, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** 32 random bytes, base64url: 43 characters of [A-Za-z0-9_-] (the server accepts 16–128). New for EVERY request. */
export function newDeviceNonce(): string {
  const c = g.crypto;
  if (!c?.getRandomValues) throw new DeviceKeyUnavailableError('This phone has no secure random source.');
  return bytesToBase64Url(c.getRandomValues(new Uint8Array(32)));
}

/** ECDSA P-256; the PRIVATE key is non-extractable (WebCrypto always leaves the public half exportable). */
export async function generateDeviceKeyPair(): Promise<CryptoKeyPair> {
  return subtle().generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']) as Promise<CryptoKeyPair>;
}
/** The public key as the server registers it: SPKI DER, standard base64. */
export async function exportPublicKeySpki(publicKey: CryptoKey): Promise<string> {
  return bytesToBase64(new Uint8Array(await subtle().exportKey('spki', publicKey)));
}

export interface SignInput { method: string; url: string; deviceId: string; body?: string | null; now?: number; nonce?: string }
/** The four proof headers for one request. `body` must be the exact string that goes on the wire (or absent). */
export async function signDeviceRequest(privateKey: CryptoKey, i: SignInput): Promise<Record<string, string>> {
  const ts = String(i.now ?? Date.now());
  const nonce = i.nonce ?? newDeviceNonce();
  const signed = canonicalDeviceRequest({ method: i.method, path: signedPathFor(i.url), deviceId: i.deviceId, ts, nonce, bodySha256: await sha256Hex(i.body) });
  const sig = new Uint8Array(await subtle().sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, new TextEncoder().encode(signed)));
  return { [DEVICE_PROOF_HEADERS.id]: i.deviceId, [DEVICE_PROOF_HEADERS.ts]: ts, [DEVICE_PROOF_HEADERS.nonce]: nonce, [DEVICE_PROOF_HEADERS.sig]: bytesToBase64Url(sig) };
}

// ── Where the key pair lives ──────────────────────────────────────────────────────────────────────────────────────
/** One device identity: the id the server knows this phone by and the key pair bound to it (they live and die together). */
export interface StoredDeviceKey { deviceId: string; keyPair: CryptoKeyPair; publicKey: string; createdAt: number; enrolled?: boolean }
export interface DeviceKeyStore { load(): Promise<StoredDeviceKey | null>; save(r: StoredDeviceKey): Promise<void>; clear(): Promise<void> }

export class InMemoryDeviceKeyStore implements DeviceKeyStore {
  private r: StoredDeviceKey | null = null;
  async load() { return this.r; }
  async save(r: StoredDeviceKey) { this.r = r; }
  async clear() { this.r = null; }
}

/** IndexedDB-backed store (structured clone keeps the CryptoKey usable and its private bytes hidden). Throws
 *  DeviceKeyUnavailableError when IndexedDB is missing or refuses (private mode, blocked storage). */
export function indexedDbDeviceKeyStore(dbName = 'aps-device-identity', storeName = 'keys', key = 'current'): DeviceKeyStore {
  const open = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
    const idb = g.indexedDB;
    if (!idb) { reject(new DeviceKeyUnavailableError('This phone has no secure key storage (IndexedDB is unavailable).')); return; }
    let req: IDBOpenDBRequest;
    try { req = idb.open(dbName, 1); } catch { reject(new DeviceKeyUnavailableError()); return; }
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(storeName)) req.result.createObjectStore(storeName); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new DeviceKeyUnavailableError());
    req.onblocked = () => reject(new DeviceKeyUnavailableError());
  });
  const tx = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | null): Promise<T> => {
    const db = await open();
    try {
      return await new Promise<T>((resolve, reject) => {
        const t = db.transaction(storeName, mode); const s = t.objectStore(storeName);
        const r = fn(s);
        t.oncomplete = () => resolve((r?.result ?? null) as T);
        t.onerror = () => reject(new DeviceKeyUnavailableError());
        t.onabort = () => reject(new DeviceKeyUnavailableError());
      });
    } finally { db.close(); }
  };
  return {
    load: async () => { const r = await tx<StoredDeviceKey | undefined>('readonly', (s) => s.get(key)); return r && r.keyPair?.privateKey && r.deviceId ? r : null; },
    save: async (r) => { await tx('readwrite', (s) => s.put(r, key)); },
    clear: async () => { await tx('readwrite', (s) => s.delete(key)); },
  };
}

/** A fresh identity: a new random id and a new key pair (never derived from anything on the phone). */
export async function createDeviceIdentity(deviceId: string): Promise<StoredDeviceKey> {
  const keyPair = await generateDeviceKeyPair();
  return { deviceId, keyPair, publicKey: await exportPublicKeySpki(keyPair.publicKey), createdAt: Date.now(), enrolled: false };
}
