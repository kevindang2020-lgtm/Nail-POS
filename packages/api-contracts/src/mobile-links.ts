// mobile-links.ts — Constitution 6 §64–65 (BUILD_PLAN Phase 13, D): universal links / Android App Links.
//
// One https URL shape for every app: https://<links host>/app-links/<app>/<route>[/<id>]. The API serves the association
// files for that host (/.well-known/apple-app-site-association, /.well-known/assetlinks.json — from env: Kevin's Apple Team
// ID and each app's signing-cert SHA-256) and, when the app is NOT installed, /app-links/... redirects to that app's web
// build with ?link=<route>[/<id>] (§65 fallback to web). A link only NAMES a destination: the app opens it after its normal
// session check and the screen loads through the API, which authorizes (§64). Never a token in a link (§66).
import { PUSH_ROUTES, ROUTE_ID_RE, type PushRoute, type PushRouteName, type PushRouteParam } from './mobile-push';

/** The native truth (Xcode PRODUCT_BUNDLE_IDENTIFIER / Gradle applicationId) — Phase 13 decision, bug 8. */
export const MOBILE_BUNDLE_IDS = {
  customer: 'com.powersalon.customer',
  tech: 'com.powersalon.technician',
  owner: 'com.powersalon.owner',
  'manager-pay': 'com.aipowersalon.pay',
} as const;
export type LinkAppId = keyof typeof MOBILE_BUNDLE_IDS;
export const LINK_APPS = Object.keys(MOBILE_BUNDLE_IDS) as LinkAppId[];
export const APP_LINK_PREFIX = '/app-links';

/** Which route takes an id, and under which param name. */
const ROUTE_ID_PARAM: Partial<Record<PushRouteName, PushRouteParam>> = {
  appointment: 'appointmentId', 'queue-ticket': 'techQueueTicketId', 'community-post': 'postId',
};

/** Build the https path for a route (the server's email / SMS links use this). */
export function appLinkPath(app: LinkAppId, route: PushRoute): string {
  const idKey = ROUTE_ID_PARAM[route.name];
  const id = idKey ? route.params[idKey] : undefined;
  return `${APP_LINK_PREFIX}/${app}/${route.name}${id && ROUTE_ID_RE.test(id) ? `/${id}` : ''}`;
}

/** Parse /app-links/<app>/<route>[/<id>] (or the `?link=<route>[/<id>]` the web fallback receives, with `app` given).
 *  Anything off the closed lists → null. */
export function parseAppLink(pathOrUrl: string, expectApp?: LinkAppId): { app: LinkAppId; route: PushRoute } | null {
  let path = String(pathOrUrl ?? '');
  path = path.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i, '');   // drop scheme + host (no URL global: this package is lib-free)
  path = path.split(/[?#]/)[0];
  let parts = path.split('/').filter(Boolean);
  let app: string | undefined;
  if (parts[0] === APP_LINK_PREFIX.slice(1)) { app = parts[1]; parts = parts.slice(2); }
  else app = expectApp;
  if (!app || !(LINK_APPS as string[]).includes(app)) return null;
  if (expectApp && app !== expectApp) return null;
  const [name, id, ...rest] = parts;
  if (rest.length || !name || !(PUSH_ROUTES as readonly string[]).includes(name)) return null;
  const idKey = ROUTE_ID_PARAM[name as PushRouteName];
  if (id !== undefined && (!idKey || !ROUTE_ID_RE.test(id))) return null;
  return { app: app as LinkAppId, route: { name: name as PushRouteName, params: id && idKey ? { [idKey]: id } : {} } };
}

/** GET /.well-known/apple-app-site-association */
export interface AppleAppSiteAssociation { applinks: { details: { appIDs: string[]; components: { '/': string; comment?: string }[] }[] } }
/** GET /.well-known/assetlinks.json */
export type AndroidAssetLinks = { relation: string[]; target: { namespace: 'android_app'; package_name: string; sha256_cert_fingerprints: string[] } }[];
/** GET /app-links/... when the app is not installed: where the browser is sent (Nest @Redirect shape). */
export interface AppLinkRedirect { url: string; statusCode: 302 }

/** Apple's association file (applinks, modern `components` form). null when no Team ID is configured. */
export function appleAppSiteAssociation(teamId: string | null | undefined): AppleAppSiteAssociation | null {
  const t = String(teamId ?? '').trim();
  if (!/^[A-Z0-9]{10}$/.test(t)) return null;
  return {
    applinks: {
      details: LINK_APPS.map((app) => ({ appIDs: [`${t}.${MOBILE_BUNDLE_IDS[app]}`], components: [{ '/': `${APP_LINK_PREFIX}/${app}/*`, comment: `AIPowerSalon ${app}` }] })),
    },
  };
}

const FP_RE = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;
/** Google's Digital Asset Links file. `fingerprints[app]` = comma-separated SHA-256 signing-cert fingerprints (upload key
 *  AND the Play app-signing key). Apps without one are left out; none at all → null. */
export function androidAssetLinks(fingerprints: Partial<Record<LinkAppId, string | undefined>>): AndroidAssetLinks | null {
  const out: AndroidAssetLinks = [];
  for (const app of LINK_APPS) {
    const fps = String(fingerprints[app] ?? '').split(',').map((s) => s.trim().toUpperCase()).filter((s) => FP_RE.test(s));
    if (!fps.length) continue;
    out.push({ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: MOBILE_BUNDLE_IDS[app], sha256_cert_fingerprints: fps } });
  }
  return out.length ? out : null;
}
