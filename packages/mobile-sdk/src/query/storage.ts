// storage.ts — where the read cache and the pending-mutation journal live on the device (Constitution 6 §18, §22).
// IndexedDB on the web AND inside the Capacitor WebView (WKWebView / Android WebView both keep it in the app's own
// container). @capacitor/preferences is not installed in any app and adds nothing here: nothing stored through this
// interface is a secret (tokens live in the Keychain / Keystore via native-auth.ts; the sanitizer strips secret-named
// fields before every write). No IndexedDB (tests, a locked-down WebView) → memory only, never localStorage.
export interface KvStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export class MemoryKvStore implements KvStore {
  readonly map = new Map<string, string>();
  async get(k: string) { return this.map.has(k) ? this.map.get(k)! : null; }
  async set(k: string, v: string) { this.map.set(k, v); }
  async remove(k: string) { this.map.delete(k); }
  async keys() { return [...this.map.keys()]; }
}

const DB = 'aps-offline'; const STORE = 'kv';
export class IndexedDbKvStore implements KvStore {
  private db: Promise<IDBDatabase> | null = null;
  constructor(private readonly idb: IDBFactory) {}
  private open(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = new Promise((resolve, reject) => {
        const req = this.idb.open(DB, 1);
        req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      this.db.catch(() => { this.db = null; });
    }
    return this.db;
  }
  private async tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode); const r = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(r.result); t.onerror = () => reject(t.error); t.onabort = () => reject(t.error);
    });
  }
  async get(k: string) { const v = await this.tx('readonly', (s) => s.get(k)); return typeof v === 'string' ? v : null; }
  async set(k: string, v: string) { await this.tx('readwrite', (s) => s.put(v, k)); }
  async remove(k: string) { await this.tx('readwrite', (s) => s.delete(k)); }
  async keys() { return ((await this.tx('readonly', (s) => s.getAllKeys())) as IDBValidKey[]).map(String); }
}

let shared: KvStore | null = null;
/** The device store every app uses (one per JS realm). */
export function deviceKvStore(): KvStore {
  if (!shared) shared = typeof indexedDB !== 'undefined' && indexedDB ? new IndexedDbKvStore(indexedDB) : new MemoryKvStore();
  return shared;
}
/** Tests: swap the device store. */
export function setDeviceKvStore(s: KvStore | null): void { shared = s; }
