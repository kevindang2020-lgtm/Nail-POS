import { t } from '@aipowersalon/mobile-sdk/i18n';
// offline-read-cache.ts — Functional Decision 33: a DEGRADED offline mode. When the connection drops, the screens that
// let the salon keep working (today's booking board, the queue, the live technician schedule, the service catalog) show
// the last copy this device received, labelled with its time. Nothing that moves money or makes a booking authoritative
// runs offline: every write is refused at the network layer while offline, whatever screen sent it.
//
// Before Oct 1 offline mode was a red banner only — a dropped connection blanked every screen.
// Installed once at startup (main.tsx). Copies are per signed-in user and tenant, cleared on sign-out or user change;
// customer records, payments and reports are never stored (only the allow-listed reads below).
export const OFFLINE_READS: RegExp[] = [
  /^\/pos\/booking\/state(\?|$)/,
  /^\/pos\/queue\/state(\?|$)/,
  /^\/pos\/technicians\/live-schedule\/state(\?|$)/,
  /^\/pos\/services\/state(\?|$)/,
  /^\/pos\/services(\?|$)/,
  /^\/pos\/services\/categories(\?|$)/,
];
export const offlineWriteMessage = (): string => t('pos.you_are_offline_this_action_needs_kjan');
export const OFFLINE_CACHE_SERVED = 'aps:offline-cache-served';
const PREFIX = 'aps_offline:';
const SCOPE_KEY = 'aps_offline_scope';
const MAX_ENTRY_CHARS = 1_500_000;
const MAX_AGE_MS = 24 * 3_600_000;   // yesterday's board is not "today's schedule"

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;
let scope = '';

/** Path + query when the URL is an allow-listed read, else null. */
export function offlineCacheKey(url: string): string | null {
  let pathAndQuery = url;
  try { const u = new URL(url, 'http://local'); pathAndQuery = u.pathname + u.search; } catch { /* keep as is */ }
  return OFFLINE_READS.some((r) => r.test(pathAndQuery)) ? pathAndQuery : null;
}

export function clearOfflineReadCache(store: Store = localStorage): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < store.length; i++) { const k = store.key(i); if (k && k.startsWith(PREFIX)) keys.push(k); }
    keys.forEach((k) => store.removeItem(k));
    store.removeItem(SCOPE_KEY);
  } catch { /* storage unavailable */ }
  scope = '';
}
/** Called when the signed-in principal is known. A different user or tenant than last time → old copies are dropped. */
export function setOfflineCacheScope(next: string, store: Store = localStorage): void {
  try { if (store.getItem(SCOPE_KEY) !== next) { clearOfflineReadCache(store); store.setItem(SCOPE_KEY, next); } } catch { /* ignore */ }
  scope = next;
}

const entryKey = (k: string) => PREFIX + scope + '|' + k;

export function installOfflineReadCache(win: Window & typeof globalThis = window, store: Store = localStorage, now: () => number = Date.now): () => void {
  const original = win.fetch.bind(win);
  const isOffline = () => win.navigator?.onLine === false;
  const fromCache = (k: string): Response | null => {
    if (!scope) return null;
    try {
      const raw = store.getItem(entryKey(k)); if (!raw) return null;
      const { savedAt, body } = JSON.parse(raw);
      if (!(now() - savedAt <= MAX_AGE_MS)) return null;
      win.dispatchEvent(new CustomEvent(OFFLINE_CACHE_SERVED, { detail: { savedAt, path: k } }));
      return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json', 'X-Offline-Copy': new Date(savedAt).toISOString() } });
    } catch { return null; }
  };
  win.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = String(init?.method ?? (typeof input === 'object' && 'method' in (input as any) ? (input as Request).method : 'GET')).toUpperCase();
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    if (method !== 'GET' && method !== 'HEAD') {
      if (isOffline()) return new Response(JSON.stringify({ message: offlineWriteMessage(), code: 'OFFLINE' }), { status: 503, headers: { 'Content-Type': 'application/json', 'X-Offline': '1' } });
      return original(input as any, init);
    }
    const k = offlineCacheKey(url);
    if (!k) return original(input as any, init);
    if (isOffline()) { const c = fromCache(k); if (c) return c; }
    try {
      const res = await original(input as any, init);
      if (res.ok && scope) {
        res.clone().text().then((body) => {
          if (body.length <= MAX_ENTRY_CHARS) { try { store.setItem(entryKey(k), JSON.stringify({ savedAt: now(), body })); } catch { /* quota: skip */ } }
        }).catch(() => undefined);
      }
      return res;
    } catch (e) {
      const c = fromCache(k); if (c) return c;
      throw e;
    }
  }) as typeof fetch;
  return () => { win.fetch = original as typeof fetch; };
}
