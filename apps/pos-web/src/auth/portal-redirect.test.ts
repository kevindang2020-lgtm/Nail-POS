// portal-redirect.test.ts — cross-app routing must never become an open redirect.
//
// A post-login redirect is a classic open-redirect hole: if an attacker can influence the destination, they send
// a freshly-authenticated user (cookie in hand) somewhere they control. So the tests that matter here are the
// negative ones — the destination must be impossible to influence, and every doubt must resolve to "stay here".
import { describe, it, expect } from 'vitest';
import { portalUrlForRole, crossAppRedirect, isSafePortalUrl } from './portal-redirect';

const HERE = 'https://pos.aipowersalon.com';

describe('off by default — configuring nothing changes nothing', () => {
  it('with no env, NOBODY is redirected (today\'s behaviour, exactly)', () => {
    for (const role of ['OWNER', 'MANAGER', 'RECEPTIONIST', 'TECHNICIAN', 'CUSTOMER']) {
      expect(crossAppRedirect(role, {}, HERE)).toBeNull();
    }
  });

  it('roles that belong in the POS are never redirected, even when portals ARE configured', () => {
    const env = { VITE_TECH_WEB_URL: 'https://tech.aipowersalon.com', VITE_OWNER_WEB_URL: 'https://owner.aipowersalon.com' };
    expect(crossAppRedirect('MANAGER', env, HERE)).toBeNull();
    expect(crossAppRedirect('RECEPTIONIST', env, HERE)).toBeNull();
  });
});

describe('it routes only the roles that belong elsewhere', () => {
  const env = { VITE_TECH_WEB_URL: 'https://tech.aipowersalon.com', VITE_OWNER_WEB_URL: 'https://owner.aipowersalon.com' };

  it('a technician goes to tech-web', () => {
    expect(crossAppRedirect('TECHNICIAN', env, HERE)).toBe('https://tech.aipowersalon.com');
  });

  it('an owner goes to owner-web', () => {
    expect(crossAppRedirect('OWNER', env, HERE)).toBe('https://owner.aipowersalon.com');
  });

  it('an UNKNOWN role cannot produce a URL — there is no default destination', () => {
    expect(portalUrlForRole('SOMETHING_NEW', env)).toBeNull();
    expect(portalUrlForRole('', env)).toBeNull();
    expect(portalUrlForRole(null, env)).toBeNull();
  });
});

describe('SECURITY: it cannot be turned into an open redirect', () => {
  it('the destination comes ONLY from the role — there is no input a page can influence', () => {
    // The function takes a role and an env. Not a query param, not a returnTo, not a request body.
    // An attacker who controls the page cannot supply a destination at all.
    const env = { VITE_TECH_WEB_URL: 'https://tech.aipowersalon.com' };
    expect(crossAppRedirect('TECHNICIAN', env, HERE)).toBe('https://tech.aipowersalon.com');
    // even a role that LOOKS like a url gets nothing
    expect(crossAppRedirect('https://evil.example', env, HERE)).toBeNull();
  });

  it('REJECTS a non-https destination (except localhost, for dev)', () => {
    expect(isSafePortalUrl('http://evil.example')).toBe(false);
    expect(isSafePortalUrl('http://tech.aipowersalon.com')).toBe(false);   // plain http, even our own host
    expect(isSafePortalUrl('http://localhost:5175')).toBe(true);           // dev only
    expect(isSafePortalUrl('https://tech.aipowersalon.com')).toBe(true);
  });

  it('REJECTS dangerous schemes outright', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,<script>', 'file:///etc/passwd', 'vbscript:x']) {
      expect(isSafePortalUrl(bad), bad).toBe(false);
    }
  });

  it('REJECTS a relative or malformed URL (no protocol-relative //evil.example)', () => {
    for (const bad of ['//evil.example', '/tech', 'tech.aipowersalon.com', '', '   ']) {
      expect(isSafePortalUrl(bad), bad).toBe(false);
    }
  });

  it('REJECTS a URL carrying embedded credentials', () => {
    expect(isSafePortalUrl('https://user:pass@evil.example')).toBe(false);
  });

  it('a misconfigured (unsafe) portal URL means STAY — never a partial or coerced redirect', () => {
    expect(crossAppRedirect('TECHNICIAN', { VITE_TECH_WEB_URL: 'javascript:alert(1)' }, HERE)).toBeNull();
    expect(crossAppRedirect('TECHNICIAN', { VITE_TECH_WEB_URL: '//evil.example' }, HERE)).toBeNull();
    expect(crossAppRedirect('TECHNICIAN', { VITE_TECH_WEB_URL: 'not a url' }, HERE)).toBeNull();
  });
});

describe('it never loops', () => {
  it('a portal pointing at the CURRENT origin does not bounce the user forever', () => {
    // A plausible misconfiguration: tech-web's URL accidentally set to the POS host. Without this guard the user
    // would be redirected to the page they are already on, land, be redirected again, forever.
    const env = { VITE_TECH_WEB_URL: HERE };
    expect(crossAppRedirect('TECHNICIAN', env, HERE)).toBeNull();
  });

  it('the same host with a different path still counts as here', () => {
    expect(crossAppRedirect('TECHNICIAN', { VITE_TECH_WEB_URL: `${HERE}/tech` }, HERE)).toBeNull();
  });
});
