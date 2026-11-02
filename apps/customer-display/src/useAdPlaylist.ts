// useAdPlaylist.ts — the 23-inch display's advertising, end to end (spec §47, §58–§60, §72–§74, §108, §114):
//   • asks the server for THIS display's playlist (device token → salon, branch, display — never chosen here), again
//     when the server says a schedule changes (refreshAfterSeconds), when realtime says the salon changed something
//     (customer_display_ads_updated → `nudge`), and after a reconnect;
//   • keeps the last list on the device and plays it through a network drop — until its validUntil (§72/§114);
//   • plays an ad only once its picture is on the device (adAssets) — a picture that will not load is skipped;
//   • reports each ad slot as a DISPLAY (adReports, §108).
// Session-mode (one-off) displays have no advertising: everything here is inert without a device token.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CustomerDisplayAdPlaylist } from '@aipowersalon/api-contracts/customer';
import type { RotatingAd } from '@aipowersalon/ui';
import { fetchAdPlaylist, postAdDisplays, type Creds } from './api';
import { asPlaylist, fullscreenImage, loadPlaylist, nextFetchDelayMs, panelImage, playlistUsable, savePlaylist, toSlides } from './adPlaylist';
import { AdAssetCache } from './adAssets';
import { AdReportQueue, REPORT_FLUSH_MS } from './adReports';

function deviceStore(): Storage | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}
const NO_FULLSCREEN = Object.freeze({ enabled: false, afterSeconds: 60 });

export interface AdPlayback {
  playlist: CustomerDisplayAdPlaylist | null;
  /** May the saved/fetched list play right now (§114)? */
  usable: boolean;
  /** Right-panel slides whose pictures are ready on this device. Empty → the salon's branded fallback. */
  panelAds: RotatingAd[];
  /** Full-screen idle slides (§7) — only when the salon turned full-screen idle ads on. */
  fullAds: RotatingAd[];
  fullScreenIdle: { enabled: boolean; afterSeconds: number };
  /** One ad slot ended after `ms` on screen (the rotator calls this) — counted as a display (§108). */
  onShown: (adId: string, ms: number) => void;
}

export function useAdPlaylist(creds: Creds | null, nudge: number, view: { panelHeight: number; dpr: number }, deps?: { assets?: AdAssetCache }): AdPlayback {
  const device = creds?.mode === 'device' ? creds : null;
  const token = device?.deviceToken ?? null;
  const store = useMemo(() => (token ? deviceStore() : null), [token]);
  const [playlist, setPlaylist] = useState<CustomerDisplayAdPlaylist | null>(() => (token ? loadPlaylist(deviceStore()) : null));
  const [now, setNow] = useState(() => Date.now());
  const [assetsRev, setAssetsRev] = useState(0);
  const assets = useRef<AdAssetCache | null>(deps?.assets ?? null);
  if (!assets.current) assets.current = new AdAssetCache();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const alive = useRef(true);

  const fetchNow = useCallback(async () => {
    if (!device) return;
    clearTimeout(timer.current);
    let p: CustomerDisplayAdPlaylist | null = null;
    try { p = asPlaylist(await fetchAdPlaylist(device)); } catch { p = null; }
    if (!alive.current) return;
    if (p) { setPlaylist(p); savePlaylist(store, p); setNow(Date.now()); }
    timer.current = setTimeout(() => { void fetchNow(); }, nextFetchDelayMs(p, !p));
  }, [token, store]);   // eslint-disable-line react-hooks/exhaustive-deps -- `device` is identified by its token

  useEffect(() => {
    alive.current = true;
    void fetchNow();
    return () => { alive.current = false; clearTimeout(timer.current); };
  }, [fetchNow]);
  // §73–§74: the salon published, paused, edited or removed something (or the stream reconnected) — ask now
  useEffect(() => { if (nudge > 0) void fetchNow(); }, [nudge]);   // eslint-disable-line react-hooks/exhaustive-deps

  // §114: wake up exactly when a saved list stops being trustworthy, so it stops playing on time even offline
  useEffect(() => {
    const until = playlist?.validUntil ? Date.parse(playlist.validUntil) : NaN;
    if (!Number.isFinite(until)) return;
    const ms = until - Date.now();
    if (ms <= 0) { setNow(Date.now()); return; }
    const t = setTimeout(() => setNow(Date.now()), Math.min(ms + 50, 2_147_000_000));
    return () => clearTimeout(t);
  }, [playlist?.validUntil]);

  const usable = playlistUsable(playlist, now);
  const panelPick = useCallback((ad: CustomerDisplayAdPlaylist['ads'][number]) => ({ image: panelImage(ad, view.panelHeight, view.dpr), fit: ad.fit }), [view.panelHeight, view.dpr]);
  const fullOn = !!(usable && playlist?.fullScreenIdle.enabled);
  const wanted = useMemo(() => (!usable || !playlist ? [] : [
    ...playlist.ads.map((a) => panelPick(a).image.url),
    ...(fullOn ? playlist.ads.map((a) => fullscreenImage(a).image.url) : []),
  ]), [usable, playlist, panelPick, fullOn]);
  const wantedKey = wanted.join('\n');
  useEffect(() => {
    let live = true;
    void assets.current!.prepare(wanted).then(() => { if (live) setAssetsRev((r) => r + 1); });
    return () => { live = false; };
  }, [wantedKey]);   // eslint-disable-line react-hooks/exhaustive-deps -- `wanted` is identified by its content
  useEffect(() => () => assets.current?.clear(), []);

  const resolve = useCallback((u: string) => assets.current!.resolve(u), []);
  // assetsRev is the signal that the device cache (a mutable ref, outside React) gained pictures — the slides are rebuilt
  const panelAds = useMemo(() => (usable && playlist ? toSlides(playlist.ads, panelPick, resolve) : []), [usable, playlist, panelPick, resolve, assetsRev]);   // eslint-disable-line react-hooks/exhaustive-deps -- assetsRev: see above
  const fullAds = useMemo(() => (fullOn && playlist ? toSlides(playlist.ads, fullscreenImage, resolve) : []), [fullOn, playlist, resolve, assetsRev]);   // eslint-disable-line react-hooks/exhaustive-deps -- assetsRev: see above

  // §108 display counts: batched, retried with the same batch id, kept on the device while offline
  const reports = useRef<AdReportQueue | null>(null);
  if (device && !reports.current) reports.current = new AdReportQueue((r) => postAdDisplays(device, r), store);
  useEffect(() => {
    const q = reports.current;
    if (!token || !q) return;
    const id = setInterval(() => { void q.flush(); }, REPORT_FLUSH_MS);
    const onHide = () => { if (document.visibilityState === 'hidden') void q.flush(); };
    document.addEventListener('visibilitychange', onHide);
    void q.flush();   // whatever was left from before a restart
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onHide); };
  }, [token]);
  const onShown = useCallback((adId: string, ms: number) => { reports.current?.record(adId, ms); }, []);

  return {
    playlist, usable, panelAds, fullAds,
    fullScreenIdle: usable && playlist ? playlist.fullScreenIdle : NO_FULLSCREEN,
    onShown,
  };
}
