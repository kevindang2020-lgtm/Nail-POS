// app-links.ts — BUILD_PLAN Phase 13 D (Constitution 6 §64–66): universal links / App Links into the app.
//
// `@capacitor/app` fires `appUrlOpen` with the https URL the OS matched (the association files the API serves). The URL
// is parsed against the closed route list (api-contracts parseAppLink) and handed to the route gate — it identifies a
// destination; it grants nothing. On the WEB build the same link arrives as `?link=<route>[/<id>]` (the API's
// not-installed fallback redirect) and goes through the same gate. Any query parameter other than `link` is ignored: a
// session token never travels in a link (§66).
import { parseAppLink, type LinkAppId } from '@aipowersalon/api-contracts';
import type { RouteGate } from './route-gate';

export interface AppPluginLike {
  addListener(event: 'appUrlOpen', cb: (e: { url: string }) => void): Promise<{ remove(): Promise<void> | void }> | { remove(): Promise<void> | void };
  getLaunchUrl?(): Promise<{ url?: string } | undefined>;
}

/** Native: route every universal link / App Link (and the one that launched the app) through the gate. */
export async function installAppLinks(o: { app: LinkAppId; plugin: AppPluginLike | null | undefined; gate: RouteGate }): Promise<() => void> {
  if (!o.plugin) return () => {};
  const handle = (url: string | undefined) => {
    const p = url ? parseAppLink(url) : null;
    if (p && p.app === o.app) void o.gate.request(p.route);
  };
  let sub: { remove(): Promise<void> | void } | null = null;
  try { sub = await o.plugin.addListener('appUrlOpen', (e) => handle(e?.url)); } catch { /* no plugin in this shell */ }
  try { handle((await o.plugin.getLaunchUrl?.())?.url); } catch { /* none */ }
  return () => { try { void sub?.remove(); } catch { /* gone */ } };
}

/** Web: the fallback redirect's `?link=`. Removed from the address bar once read, so a reload does not re-open it. */
export function consumeWebLink(app: LinkAppId, gate: RouteGate, loc: { search: string; pathname: string; hash: string } | null = typeof location !== 'undefined' ? location : null,
                               replace: ((url: string) => void) | null = typeof history !== 'undefined' ? (u) => history.replaceState(null, '', u) : null): boolean {
  if (!loc) return false;
  const q = new URLSearchParams(loc.search);
  const link = q.get('link');
  if (!link) return false;
  q.delete('link');
  try { replace?.(`${loc.pathname}${q.toString() ? `?${q}` : ''}${loc.hash}`); } catch { /* cosmetic */ }
  const p = parseAppLink(link, app);
  if (!p) return false;
  void gate.request(p.route);
  return true;
}
