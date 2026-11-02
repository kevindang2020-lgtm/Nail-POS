// portal-redirect.ts — send a signed-in user to the app that actually serves their role.
//
// The spec asks for this: "Technician → technician application when applicable". Today every authenticated tenant
// user lands in the POS shell, and a technician just gets 403s from the backend on anything they can't do. Safe,
// but not the experience described.
//
// The reason this wasn't built earlier is that `owner-web` / `tech-web` are SEPARATE deployments, and the repo
// disagrees with itself about hostnames (`pos.` vs `app.`), so hard-coding one would have been a guess. So this
// doesn't guess: the portal URLs come from configuration, and **with nothing configured the behaviour is exactly
// what it is today** — no redirect, everyone lands in the POS shell. Set the env vars and it switches on.
//
// ── The security property that matters ──
//
// A post-login redirect is a classic open-redirect hole: if the destination can be influenced, an attacker sends
// a freshly-authenticated user to a site they control. So:
//
//   • The destination is chosen ONLY by the SERVER-ISSUED role. Never a query param, never a request body,
//     never a `returnTo`. There is no input to this function that a page can influence.
//   • Destinations come from a fixed, build-time ALLOWLIST of env vars. An unknown role cannot produce a URL.
//   • Every URL is validated: it must be absolute, `https:` (except localhost, for development), and carry no
//     credentials. Anything else is discarded and we fall back to staying in this app.
//
// Failing to redirect is harmless. Redirecting somewhere attacker-chosen is not — so every doubt resolves to
// "stay here".

/** Roles that belong in a DIFFERENT app, when that app is configured. Everyone else stays in the POS. */
const PORTAL_ENV_BY_ROLE: Record<string, string> = {
  TECHNICIAN: 'VITE_TECH_WEB_URL',
  OWNER: 'VITE_OWNER_WEB_URL',
};

/** Reject anything that isn't a plainly safe absolute URL. */
export function isSafePortalUrl(raw: string | undefined | null): boolean {
  if (!raw) return false;
  let u: URL;
  try { u = new URL(String(raw)); } catch { return false; }        // must be absolute
  if (u.username || u.password) return false;                      // no embedded credentials
  const isLocal = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(isLocal && u.protocol === 'http:')) return false;
  return true;
}

/**
 * The external app this role belongs in, or `null` to stay put.
 *
 * @param role  the SERVER-ISSUED role from the verified session. Never a client-supplied value.
 * @param env   import.meta.env / process.env — injected so this is testable.
 */
export function portalUrlForRole(
  role: string | null | undefined,
  env: Record<string, string | undefined> = {},
): string | null {
  if (!role) return null;
  const key = PORTAL_ENV_BY_ROLE[String(role).toUpperCase()];
  if (!key) return null;                                           // this role belongs in the POS — stay
  const url = env[key];
  if (!isSafePortalUrl(url)) return null;                          // not configured, or not safe → stay
  return url as string;
}

/**
 * Should we bounce this user to another app? Returns the URL, or null to stay.
 *
 * Deliberately a no-op unless the portal URL is configured AND differs from where we already are — otherwise a
 * misconfiguration (pointing tech-web at the POS host) would bounce the user in a loop forever.
 */
export function crossAppRedirect(
  role: string | null | undefined,
  env: Record<string, string | undefined> = {},
  currentOrigin?: string,
): string | null {
  const url = portalUrlForRole(role, env);
  if (!url) return null;
  try {
    const target = new URL(url);
    const here = currentOrigin ?? (typeof window !== 'undefined' ? window.location.origin : '');
    if (here && target.origin === new URL(here).origin) return null;   // already here — never loop
  } catch { return null; }
  return url;
}
