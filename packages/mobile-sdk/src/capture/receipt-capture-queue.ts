// receipt-capture-queue.ts — Receipt / Expense mandate §155–§157 (Oct 27 2026): offline receipt capture for the Owner App and
// the POS web app.
//
//   §155  Offline, a receipt photo / PDF is QUEUED on the device (IndexedDB) and uploaded when the connection returns — on
//         `online`, on the next screen load, or when the user taps Sync. The expense is NOT saved until the backend confirms
//         the upload: a queued capture is shown as "waiting to upload", never as a receipt that exists.
//   §156  Nothing unencrypted sits in the cache: the bytes are AES-GCM encrypted with a NON-EXTRACTABLE WebCrypto key that
//         lives only in this origin's IndexedDB (the same pattern as the Tap-to-Pay device key). Without WebCrypto the queue
//         REFUSES to hold the photo (the user is told to try again online) — it never falls back to plain storage.
//   §157  A capture is deleted the moment the server confirms it (documentId answered), and anything older than 48 hours
//         is dropped unsent and reported (the user retakes it) — the device never becomes a receipt archive.
//
// The store is a small interface so the logic is tested against an in-memory one; `indexedDbCaptureStore()` is the device one.
export const CAPTURE_TTL_MS = 48 * 60 * 60_000;
export const CAPTURE_MAX_QUEUED = 50;

export interface QueuedCapture { id: string; filename: string; mimeType: string; sizeBytes: number; createdAt: number; iv: Uint8Array; cipher: ArrayBuffer; source: string; attempts: number; lastError: string | null }
export interface CaptureStore {
  list(): Promise<QueuedCapture[]>;
  put(c: QueuedCapture): Promise<void>;
  remove(id: string): Promise<void>;
  loadKey(): Promise<CryptoKey | null>;
  saveKey(k: CryptoKey): Promise<void>;
}
export interface CaptureSummary { id: string; filename: string; mimeType: string; sizeBytes: number; createdAt: number; attempts: number; lastError: string | null; source: string }
export type CaptureUploader = (file: { filename: string; mimeType: string; sizeBytes: number; bytes: Uint8Array; source: string }) => Promise<{ documentId: string }>;
export interface SyncResult { uploaded: Array<{ id: string; documentId: string; filename: string }>; failed: Array<{ id: string; filename: string; error: string }>; expired: Array<{ id: string; filename: string }>; skipped: number }

export class CaptureUnavailableError extends Error { constructor(msg = 'This device cannot hold receipts safely while offline. Try again when you are back online.') { super(msg); this.name = 'CaptureUnavailableError'; } }

const g = globalThis as unknown as { crypto?: Crypto; indexedDB?: IDBFactory; navigator?: Navigator; document?: Document; addEventListener?: Window['addEventListener']; removeEventListener?: Window['removeEventListener'] };
const subtle = (): SubtleCrypto | null => (g.crypto?.subtle ?? null);
const randomId = () => (g.crypto?.randomUUID ? g.crypto.randomUUID() : `cap-${Date.now()}-${Math.random().toString(16).slice(2)}`);

/** In-memory store (tests, and a session that cannot open IndexedDB — it still never stores plain bytes). */
export class InMemoryCaptureStore implements CaptureStore {
  private items = new Map<string, QueuedCapture>(); private key: CryptoKey | null = null;
  async list() { return [...this.items.values()].sort((a, b) => a.createdAt - b.createdAt); }
  async put(c: QueuedCapture) { this.items.set(c.id, c); }
  async remove(id: string) { this.items.delete(id); }
  async loadKey() { return this.key; }
  async saveKey(k: CryptoKey) { this.key = k; }
}

/** The device store: IndexedDB, one object store for captures and one for the non-extractable key. */
export function indexedDbCaptureStore(dbName = 'aps-receipt-capture', version = 1): CaptureStore {
  const open = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
    const idb = g.indexedDB;
    if (!idb) { reject(new CaptureUnavailableError()); return; }
    let req: IDBOpenDBRequest;
    try { req = idb.open(dbName, version); } catch { reject(new CaptureUnavailableError()); return; }
    req.onupgradeneeded = () => { const d = req.result; if (!d.objectStoreNames.contains('captures')) d.createObjectStore('captures', { keyPath: 'id' }); if (!d.objectStoreNames.contains('keys')) d.createObjectStore('keys'); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new CaptureUnavailableError());
    req.onblocked = () => reject(new CaptureUnavailableError());
  });
  const tx = async <T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest | null): Promise<T> => {
    const db = await open();
    try {
      return await new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode); const s = t.objectStore(store); const r = fn(s);
        t.oncomplete = () => resolve((r?.result ?? null) as T);
        t.onerror = () => reject(new CaptureUnavailableError());
        t.onabort = () => reject(new CaptureUnavailableError());
      });
    } finally { db.close(); }
  };
  return {
    list: async () => ((await tx<QueuedCapture[] | null>('captures', 'readonly', (s) => s.getAll())) ?? []).sort((a, b) => a.createdAt - b.createdAt),
    put: async (c) => { await tx('captures', 'readwrite', (s) => s.put(c)); },
    remove: async (id) => { await tx('captures', 'readwrite', (s) => s.delete(id)); },
    loadKey: async () => (await tx<CryptoKey | undefined>('keys', 'readonly', (s) => s.get('capture'))) ?? null,
    saveKey: async (k) => { await tx('keys', 'readwrite', (s) => s.put(k, 'capture')); },
  };
}

export interface ReceiptCaptureQueue {
  /** §155: hold a capture until the connection returns. Refuses (CaptureUnavailableError) rather than store plain bytes. */
  enqueue(file: { filename: string; mimeType: string; bytes: Uint8Array; source: string }): Promise<CaptureSummary>;
  /** what is waiting (metadata only — never the bytes) */
  pending(): Promise<CaptureSummary[]>;
  /** §155/§157: upload everything that is waiting; a confirmed upload is deleted at once; anything past the TTL is dropped unsent */
  sync(upload: CaptureUploader, now?: number): Promise<SyncResult>;
  /** drop one (the user retakes it) */
  discard(id: string): Promise<void>;
  /** wire the `online` event (and a visibility return) to sync; returns the unsubscribe */
  bindReconnect(upload: CaptureUploader, onResult?: (r: SyncResult) => void): () => void;
}

const summary = (c: QueuedCapture): CaptureSummary => ({ id: c.id, filename: c.filename, mimeType: c.mimeType, sizeBytes: c.sizeBytes, createdAt: c.createdAt, attempts: c.attempts, lastError: c.lastError, source: c.source });

/** The device store when IndexedDB exists; otherwise an in-memory one for the session (still encrypted, still synced on
 *  reconnect — a private window without IndexedDB holds the photo only until the tab closes, and says so through pending()). */
export function defaultCaptureStore(): CaptureStore { return g.indexedDB ? indexedDbCaptureStore() : new InMemoryCaptureStore(); }

export function createReceiptCaptureQueue(store: CaptureStore = defaultCaptureStore()): ReceiptCaptureQueue {
  let syncing: Promise<SyncResult> | null = null;
  const key = async (): Promise<CryptoKey> => {
    const s = subtle();
    if (!s) throw new CaptureUnavailableError();
    const existing = await store.loadKey();
    if (existing) return existing;
    const k = await s.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);   // non-extractable: never leaves this origin's key store
    await store.saveKey(k);
    return k;
  };
  const decrypt = async (c: QueuedCapture): Promise<Uint8Array> => {
    const s = subtle(); if (!s) throw new CaptureUnavailableError();
    const k = await key();
    return new Uint8Array(await s.decrypt({ name: 'AES-GCM', iv: c.iv }, k, c.cipher));
  };
  const q: ReceiptCaptureQueue = {
    async enqueue(file) {
      const s = subtle(); if (!s) throw new CaptureUnavailableError();
      if ((await store.list()).length >= CAPTURE_MAX_QUEUED) throw new CaptureUnavailableError(`Up to ${CAPTURE_MAX_QUEUED} receipts can wait offline. Sync when you are back online.`);
      const k = await key();
      const iv = (g.crypto as Crypto).getRandomValues(new Uint8Array(12));
      const cipher = await s.encrypt({ name: 'AES-GCM', iv }, k, file.bytes);
      const c: QueuedCapture = { id: randomId(), filename: file.filename, mimeType: file.mimeType, sizeBytes: file.bytes.length, createdAt: Date.now(), iv, cipher, source: file.source, attempts: 0, lastError: null };
      await store.put(c);
      return summary(c);
    },
    async pending() { return (await store.list()).map(summary); },
    async sync(upload, now = Date.now()) {
      if (syncing) return syncing;   // non-overlapping: a second reconnect while one sync runs joins it
      syncing = (async () => {
        const r: SyncResult = { uploaded: [], failed: [], expired: [], skipped: 0 };
        for (const c of await store.list()) {
          if (now - c.createdAt > CAPTURE_TTL_MS) { await store.remove(c.id); r.expired.push({ id: c.id, filename: c.filename }); continue; }   // §157: never kept for good
          try {
            const bytes = await decrypt(c);
            const { documentId } = await upload({ filename: c.filename, mimeType: c.mimeType, sizeBytes: c.sizeBytes, bytes, source: c.source });
            if (!documentId) throw new Error('The server did not confirm the upload.');
            await store.remove(c.id);                                                                 // §157: gone the moment the server confirmed it
            r.uploaded.push({ id: c.id, documentId, filename: c.filename });
          } catch (e) {
            const msg = (e as Error)?.message || 'upload failed';
            await store.put({ ...c, attempts: c.attempts + 1, lastError: msg });
            r.failed.push({ id: c.id, filename: c.filename, error: msg });
          }
        }
        return r;
      })().finally(() => { syncing = null; });
      return syncing;
    },
    async discard(id) { await store.remove(id); },
    bindReconnect(upload, onResult) {
      const run = () => { void q.sync(upload).then((r) => { if (onResult && (r.uploaded.length || r.failed.length || r.expired.length)) onResult(r); }).catch(() => undefined); };
      const onOnline = () => run();
      const onVisible = () => { if (g.document?.visibilityState === 'visible' && g.navigator?.onLine !== false) run(); };
      g.addEventListener?.('online', onOnline);
      g.document?.addEventListener?.('visibilitychange', onVisible);
      return () => { g.removeEventListener?.('online', onOnline); g.document?.removeEventListener?.('visibilitychange', onVisible); };
    },
  };
  return q;
}

/** Is the app offline right now? (`navigator.onLine` false, or the caller's transport said so) */
export const isOffline = (): boolean => g.navigator?.onLine === false;
