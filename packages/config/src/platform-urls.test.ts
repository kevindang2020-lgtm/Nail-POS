// platform-urls.vitest.spec.ts — the tenant portal URL is DERIVED, never guessed.
//
// The `pos.` vs `app.` ambiguity existed because the portal host was hard-coded in two places behind three
// different env vars, each falling back to a guess. Earlier in this codebase those fallbacks pointed at
// `app.aipowersalon.com` — a host provisioned NOWHERE. Invite links and branded-email logos pointed at a domain
// that did not exist. Nothing failed, nothing logged; only a customer clicking a dead link would ever have found
// out.
//
// So it is now taken from `WEB_CORS_ORIGINS`, which must already be right — it is how the browser is allowed to
// reach the API at all. If that is wrong, nothing works and you know at once.
import { describe, it, expect } from 'vitest';
import { tenantPortalBaseUrl, candidatePortalOrigins, portalUrl } from './platform-urls';

const env = (o: Record<string, string>) => o as any;

describe('derived from the CORS allowlist', () => {
  it('uses the portal origin from WEB_CORS_ORIGINS — no hard-coded host', () => {
    const r = tenantPortalBaseUrl(env({ WEB_CORS_ORIGINS: 'https://pos.aipowersalon.com,https://admin.aipowersalon.com,https://aipowersalon.com' }));
    expect(r.url).toBe('https://pos.aipowersalon.com');
    expect(r.source).toBe('WEB_CORS_ORIGINS');
    expect(r.guessed).toBeFalsy();
  });

  it('follows the allowlist if you move the portal — nothing to remember, nothing to re-guess', () => {
    const r = tenantPortalBaseUrl(env({ WEB_CORS_ORIGINS: 'https://app.aipowersalon.com,https://admin.aipowersalon.com' }));
    expect(r.url).toBe('https://app.aipowersalon.com');   // the `pos.` vs `app.` question answers itself
  });

  it('never picks the Super Admin console', () => {
    expect(candidatePortalOrigins(env({ WEB_CORS_ORIGINS: 'https://admin.aipowersalon.com,https://pos.aipowersalon.com' })))
      .toEqual(['https://pos.aipowersalon.com']);
  });

  it('never picks the public marketing site', () => {
    expect(candidatePortalOrigins(env({ WEB_CORS_ORIGINS: 'https://aipowersalon.com,https://www.aipowersalon.com,https://pos.aipowersalon.com' })))
      .toEqual(['https://pos.aipowersalon.com']);
  });

  it('ignores non-https entries', () => {
    expect(candidatePortalOrigins(env({ WEB_CORS_ORIGINS: 'http://pos.aipowersalon.com,https://pos.aipowersalon.com' })))
      .toEqual(['https://pos.aipowersalon.com']);
  });

  it('the derived URL is ALWAYS one the browser is allowed to reach — that is the whole point', () => {
    const cors = 'https://pos.aipowersalon.com,https://admin.aipowersalon.com';
    const r = tenantPortalBaseUrl(env({ WEB_CORS_ORIGINS: cors }));
    expect(cors.split(',')).toContain(r.url);
  });
});

describe('explicit configuration still wins', () => {
  it('APP_BASE_URL overrides everything', () => {
    const r = tenantPortalBaseUrl(env({ APP_BASE_URL: 'https://portal.example.com', WEB_CORS_ORIGINS: 'https://pos.aipowersalon.com' }));
    expect(r.url).toBe('https://portal.example.com');
    expect(r.source).toBe('APP_BASE_URL');
  });

  it('a trailing slash is normalised away (or every built link would double-slash)', () => {
    expect(tenantPortalBaseUrl(env({ APP_BASE_URL: 'https://portal.example.com/' })).url).toBe('https://portal.example.com');
  });
});

describe('a guess is flagged, not hidden', () => {
  it('with nothing to derive from, the fallback is MARKED as a guess', () => {
    const r = tenantPortalBaseUrl(env({}));
    expect(r.guessed).toBe(true);
    expect(r.source).toBe('fallback');
    // …and portalUrl() warns, so a link built on a guess is visible in the logs rather than discovered by a
    // customer clicking a dead one.
    expect(portalUrl(env({}))).toBe(r.url);
  });

  it('a CORS list with only the marketing site and admin cannot yield a portal — and says so', () => {
    const r = tenantPortalBaseUrl(env({ WEB_CORS_ORIGINS: 'https://aipowersalon.com,https://admin.aipowersalon.com' }));
    expect(r.guessed).toBe(true);
  });
});
