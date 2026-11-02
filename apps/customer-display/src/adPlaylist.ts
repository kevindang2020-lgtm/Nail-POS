// adPlaylist.ts — what the 23-inch display does with the salon's advertising playlist (spec §47, §56, §58–§60, §72,
// §114). PURE helpers; the hook (useAdPlaylist) wires them to the network, the clock and the asset cache.
//
// §72 "cache the active approved ad playlist … if network temporarily disappears, cached ads continue … no customer
// data". The ONLY thing saved on the device is the playlist the server sent (ad pictures' addresses, their text, QR,
// durations) — never a name, ticket, phone or payment. The saved list is trusted only until its validUntil (the next
// moment a schedule could change it); after that, without a fresh list, the panel shows the salon's branded fallback
// (§114) instead of an ad that may have ended.
import type { CustomerDisplayAd, CustomerDisplayAdImage, CustomerDisplayAdPlaylist } from '@aipowersalon/api-contracts/customer';
import type { RotatingAd } from '@aipowersalon/ui';

export const PLAYLIST_STORE_KEY = 'aps.customerDisplay.adPlaylist.v1';
/** Retry cadence while the server cannot be reached (the saved list keeps playing meanwhile). */
export const PLAYLIST_RETRY_MS = 30_000;
const MIN_REFRESH_MS = 5_000, MAX_REFRESH_MS = 900_000;

type KV = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** A playlist as the server sends it — or null for anything that is not one (a corrupted or foreign saved value). */
export function asPlaylist(v: unknown): CustomerDisplayAdPlaylist | null {
  const p = v as CustomerDisplayAdPlaylist;
  if (!p || typeof p !== 'object' || typeof p.enabled !== 'boolean' || !Array.isArray(p.ads) || typeof p.playlistVersion !== 'string') return null;
  const okImg = (i: CustomerDisplayAdImage | null | undefined) => !i || (typeof i.url === 'string' && i.url.length > 0 && Number.isFinite(i.width) && Number.isFinite(i.height));
  if (!p.ads.every((a) => a && typeof a.id === 'string' && okImg(a.image) && okImg(a.imageLarge) && okImg(a.fullscreenImage) && Number.isFinite(a.durationSeconds))) return null;
  return p;
}

export function loadPlaylist(store: KV | null): CustomerDisplayAdPlaylist | null {
  if (!store) return null;
  try { const raw = store.getItem(PLAYLIST_STORE_KEY); return raw ? asPlaylist(JSON.parse(raw)) : null; } catch { return null; }
}
export function savePlaylist(store: KV | null, p: CustomerDisplayAdPlaylist): void {
  if (!store) return;
  try { store.setItem(PLAYLIST_STORE_KEY, JSON.stringify(p)); } catch { /* full or blocked storage: the live list still plays */ }
}

/** §114: may this list play right now? Ads on, something to play, and not past the moment its schedule could change. */
export function playlistUsable(p: CustomerDisplayAdPlaylist | null, nowMs: number): boolean {
  if (!p || !p.enabled || p.ads.length === 0) return false;
  if (p.validUntil == null) return true;
  const until = Date.parse(p.validUntil);
  return Number.isFinite(until) ? nowMs < until : false;
}

/** When to ask the server again: its own refreshAfterSeconds (the next schedule boundary), or a retry after a failure. */
export function nextFetchDelayMs(p: CustomerDisplayAdPlaylist | null, failed: boolean): number {
  if (failed || !p) return PLAYLIST_RETRY_MS;
  const ms = Math.round((Number.isFinite(p.refreshAfterSeconds) ? p.refreshAfterSeconds : 900) * 1000);
  return Math.min(MAX_REFRESH_MS, Math.max(MIN_REFRESH_MS, ms));
}

/** The right-panel picture for this screen: the 1080 px copy, or the 1920 px one when the panel is taller than that in
 *  real pixels (a high-density screen) — the display downloads only what it shows (§71). */
export function panelImage(ad: CustomerDisplayAd, panelCssHeight: number, dpr: number): CustomerDisplayAdImage {
  const need = Math.max(1, panelCssHeight) * Math.max(1, dpr || 1);
  return Math.max(ad.image.width, ad.image.height) >= need * 0.9 ? ad.image : ad.imageLarge;
}

/** §7 / §56: the full-screen picture — the salon's landscape creative when it has one; otherwise its panel picture
 *  shown WHOLE (contain, over a blurred copy) — a tall poster is never cropped to fill a wide screen. */
export function fullscreenImage(ad: CustomerDisplayAd): { image: CustomerDisplayAdImage; fit: 'cover' | 'contain' } {
  return ad.fullscreenImage ? { image: ad.fullscreenImage, fit: 'cover' } : { image: ad.imageLarge, fit: 'contain' };
}

/** The slides the rotator plays: only ads whose picture is READY on this device (`resolve` returns a loadable address,
 *  e.g. from the asset cache) — an ad whose picture would not load is skipped, never shown as a broken frame. */
export function toSlides(
  ads: readonly CustomerDisplayAd[], pick: (ad: CustomerDisplayAd) => { image: CustomerDisplayAdImage; fit: CustomerDisplayAd['fit'] },
  resolve: (url: string) => string | null,
): RotatingAd[] {
  const out: RotatingAd[] = [];
  for (const ad of ads) {
    const { image, fit } = pick(ad);
    const url = resolve(image.url);
    if (!url) continue;
    out.push({
      id: ad.id, version: ad.version, durationSeconds: ad.durationSeconds,
      image: { url, width: image.width, height: image.height }, fit, focalX: ad.focalX, focalY: ad.focalY,
      headline: ad.headline, subheadline: ad.subheadline, description: ad.description, ctaText: ad.ctaText, qr: ad.qr,
    });
  }
  return out;
}
