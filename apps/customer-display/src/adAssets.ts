// adAssets.ts — 23-inch spec §72–§73: the display keeps the pictures of its active ads ON THE DEVICE, so a network drop
// (or a restart while the network is down) does not blank the advertising panel, and a new ad starts only once its
// picture is actually here ("Media Ready → … → Download New Asset → Use in Rotation" — never a half-loaded frame).
//
// Where the browser allows it (a secure context: the Android/Capacitor shell, https, localhost) the pictures live in Cache
// Storage, which survives a restart; they are shown from in-memory object URLs. Elsewhere (a plain-http LAN page) the
// display falls back to fetching into memory, and finally to letting the browser's own HTTP cache hold the picture
// (/media/* is served with Cache-Control: public, max-age=86400). Only ad pictures are ever stored — no customer data.
// Pictures no longer in the playlist are dropped from memory and from the cache.
import { mediaUrl } from './api';

export const AD_ASSET_CACHE = 'aps-display-ad-assets-v1';

export interface AdAssetDeps {
  fetch: (url: string) => Promise<Response>;
  caches: Pick<CacheStorage, 'open'> | null;
  createObjectURL: ((b: Blob) => string) | null;
  revokeObjectURL: ((u: string) => void) | null;
  /** Last resort: can the browser load this address as an image (from its HTTP cache or the network)? */
  probe: (url: string) => Promise<boolean>;
}

function browserDeps(): AdAssetDeps {
  const g: any = typeof globalThis !== 'undefined' ? globalThis : {};
  return {
    fetch: (u) => fetch(u, { mode: 'cors', credentials: 'omit' }),
    caches: g.isSecureContext && g.caches ? (g.caches as CacheStorage) : null,
    createObjectURL: g.URL?.createObjectURL ? (b) => URL.createObjectURL(b) : null,
    revokeObjectURL: g.URL?.revokeObjectURL ? (u) => URL.revokeObjectURL(u) : null,
    probe: (u) => new Promise<boolean>((resolve) => {
      if (typeof Image === 'undefined') { resolve(false); return; }
      const img = new Image();
      const done = (ok: boolean) => { img.onload = null; img.onerror = null; resolve(ok); };
      img.onload = () => done(true); img.onerror = () => done(false);
      img.src = u;
    }),
  };
}

export class AdAssetCache {
  /** source address (as in the playlist) → what an <img> loads now (an object URL, or the address itself) */
  private readonly ready = new Map<string, string>();
  private generation = 0;
  constructor(private readonly deps: AdAssetDeps = browserDeps()) {}

  /** A loadable address for a picture that is ready on this device, else null. */
  resolve(url: string): string | null { return this.ready.get(url) ?? null; }
  readyCount(): number { return this.ready.size; }

  /**
   * Make every picture in `urls` ready (cache → network → browser), then forget the ones no longer listed. A newer call
   * supersedes an older one still running. Resolves when this call has done what it can; it never rejects.
   */
  async prepare(urls: readonly string[]): Promise<void> {
    const gen = ++this.generation;
    const want = [...new Set(urls)];
    const cache = await this.openCache();
    for (const url of want) {
      if (gen !== this.generation) return;          // a newer playlist took over
      if (this.ready.has(url)) continue;
      const loadable = await this.load(url, cache);
      if (gen !== this.generation) { this.release(loadable); return; }
      if (loadable) this.ready.set(url, loadable);
    }
    if (gen !== this.generation) return;
    // drop what the playlist no longer has (memory and the on-device cache)
    for (const [url, loadable] of [...this.ready]) {
      if (want.includes(url)) continue;
      this.ready.delete(url); this.release(loadable);
      if (cache) await cache.delete(mediaUrl(url)).catch(() => false);
    }
    if (cache) {
      const keep = new Set(want.map(mediaUrl));
      const keys = await cache.keys().catch(() => [] as readonly Request[]);
      for (const k of keys) if (!keep.has(k.url) && !keep.has(new URL(k.url).pathname)) await cache.delete(k).catch(() => false);
    }
  }

  /** Forget everything (unmount). */
  clear(): void { this.generation++; for (const v of this.ready.values()) this.release(v); this.ready.clear(); }

  private async openCache(): Promise<Cache | null> {
    try { return this.deps.caches ? await this.deps.caches.open(AD_ASSET_CACHE) : null; } catch { return null; }
  }

  private release(loadable: string | null): void {
    if (loadable && loadable.startsWith('blob:')) { try { this.deps.revokeObjectURL?.(loadable); } catch { /* already gone */ } }
  }

  private async load(url: string, cache: Cache | null): Promise<string | null> {
    const abs = mediaUrl(url);
    // 1) on-device copy (works offline, survives a restart)
    if (cache && this.deps.createObjectURL) {
      try {
        const hit = await cache.match(abs);
        if (hit && hit.ok) return this.deps.createObjectURL(await hit.blob());
      } catch { /* fall through to the network */ }
    }
    // 2) the network — and keep a copy on the device
    if (this.deps.createObjectURL) {
      try {
        const res = await this.deps.fetch(abs);
        if (res.ok && /^image\//i.test(res.headers.get('content-type') || 'image/')) {
          if (cache) await cache.put(abs, res.clone()).catch(() => undefined);
          return this.deps.createObjectURL(await res.blob());
        }
      } catch { /* cross-origin without CORS, or offline: try the browser's own loader */ }
    }
    // 3) the browser's own image loader (its HTTP cache keeps /media/* for a day)
    try { return (await this.deps.probe(abs)) ? abs : null; } catch { return null; }
  }
}
