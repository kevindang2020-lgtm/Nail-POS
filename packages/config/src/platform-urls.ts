// platform-urls.ts — where the tenant portal actually lives.
//
// ── Why this exists ──
//
// The portal URL was hard-coded in two places, behind three different env vars, each falling back to a GUESS:
//
//   inviteBaseUrl() → APP_BASE_URL || ADMIN_BASE_URL || 'https://pos.aipowersalon.com'
//   PUBLIC_BASE     → PUBLIC_APP_URL                 || 'https://pos.aipowersalon.com'
//
// Two problems. First, the guess can be wrong — earlier in this codebase the fallbacks pointed at
// `app.aipowersalon.com`, a host provisioned nowhere, so invite links and branded-email logos pointed at a domain
// that did not exist. Nothing failed; the links simply went nowhere, and only a customer clicking one would ever
// find out. Second, three env vars for one concept means they can disagree, and nothing notices.
//
// ── The fix: derive it, don't configure it ──
//
// `WEB_CORS_ORIGINS` must already be correct — it is how the browser is allowed to talk to the API at all. If it
// is wrong, nothing works and you know immediately. So the portal URL is taken from there, and a hard-coded
// hostname is never guessed.
//
// The explicit env vars still win when set, so nothing is taken away. What is removed is the silent guess.
export interface PortalUrlResult {
  url: string;
  source: 'APP_BASE_URL' | 'PUBLIC_APP_URL' | 'ADMIN_BASE_URL' | 'WEB_CORS_ORIGINS' | 'fallback';
  /** Set when the value could not be derived and a last-resort default was used — this is worth logging. */
  guessed?: boolean;
}

const strip = (u: string) => u.replace(/\/+$/, '');

/** Origins from the CORS allowlist, in order, excluding the ones that are never the tenant portal. */
export function candidatePortalOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const origins = (env.WEB_CORS_ORIGINS || '')
    .split(',').map((o) => o.trim()).filter(Boolean)
    .filter((o) => /^https:\/\//i.test(o));

  return origins.filter((o) => {
    const host = (() => { try { return new URL(o).hostname.toLowerCase(); } catch { return ''; } })();
    if (!host) return false;
    // The bare marketing domain is the public website, not the staff portal.
    if (/^(www\.)?aipowersalon\.com$/.test(host)) return false;
    // The Super Admin console is a different application.
    if (host.startsWith('admin.')) return false;
    return true;
  });
}

/**
 * The base URL of the tenant portal (where staff sign in; where invite links and branded emails point).
 *
 * Order: explicit env var → derived from the CORS allowlist → a last-resort default that is flagged as a guess.
 */
export function tenantPortalBaseUrl(env: NodeJS.ProcessEnv = process.env): PortalUrlResult {
  if (env.APP_BASE_URL) return { url: strip(env.APP_BASE_URL), source: 'APP_BASE_URL' };
  if (env.PUBLIC_APP_URL) return { url: strip(env.PUBLIC_APP_URL), source: 'PUBLIC_APP_URL' };
  if (env.ADMIN_BASE_URL) return { url: strip(env.ADMIN_BASE_URL), source: 'ADMIN_BASE_URL' };

  const derived = candidatePortalOrigins(env)[0];
  if (derived) return { url: strip(derived), source: 'WEB_CORS_ORIGINS' };

  // Nothing to derive from. Return something usable, but mark it: a link built on a guess may point nowhere, and
  // that must be visible in the logs rather than discovered by a customer clicking it.
  return { url: 'https://pos.aipowersalon.com', source: 'fallback', guessed: true };
}

/** Convenience for callers that just want the string. */
export function portalUrl(env: NodeJS.ProcessEnv = process.env): string {
  const r = tenantPortalBaseUrl(env);
  if (r.guessed) {
    // eslint-disable-next-line no-console
    console.warn(
      '[platform-urls] The tenant portal URL could not be derived (no APP_BASE_URL, and no usable host in ' +
      `WEB_CORS_ORIGINS). Falling back to ${r.url}. Invite links and branded emails will point there — set ` +
      'APP_BASE_URL if that is not right.',
    );
  }
  return r.url;
}
