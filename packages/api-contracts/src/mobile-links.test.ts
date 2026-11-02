import { describe, it, expect } from 'vitest';
import { appLinkPath, parseAppLink, appleAppSiteAssociation, androidAssetLinks, MOBILE_BUNDLE_IDS } from './mobile-links';

const FP = Array.from({ length: 32 }, (_, i) => (i + 16).toString(16).toUpperCase().padStart(2, '0')).join(':');

describe('§64 app links', () => {
  it('round-trips a route with an id', () => {
    const p = appLinkPath('customer', { name: 'appointment', params: { appointmentId: 'a-1' } });
    expect(p).toBe('/app-links/customer/appointment/a-1');
    expect(parseAppLink('https://links.example.com' + p)).toEqual({ app: 'customer', route: { name: 'appointment', params: { appointmentId: 'a-1' } } });
  });
  it('the web fallback form (?link=route/id) parses for the expected app only', () => {
    expect(parseAppLink('approvals', 'owner')).toEqual({ app: 'owner', route: { name: 'approvals', params: {} } });
    expect(parseAppLink('/app-links/tech/queue', 'owner')).toBeNull();
  });
  it('refuses anything off the closed lists — unknown app, route, extra segments, ids on id-less routes, bad ids', () => {
    for (const bad of ['/app-links/casino/queue', '/app-links/customer/admin', '/app-links/customer/appointment/a/b',
      '/app-links/tech/queue/123', '/app-links/customer/appointment/..%2Fsecret', '/app-links/customer/appointment/<script>', '']) expect(parseAppLink(bad)).toBeNull();
  });
  it('never carries a token: only route names and ids survive', () => {
    expect(parseAppLink('/app-links/customer/appointment/a1?token=abc')).toEqual({ app: 'customer', route: { name: 'appointment', params: { appointmentId: 'a1' } } });
  });
});

describe('§65 association files (env-built)', () => {
  it('AASA lists each app under the Team ID with its own path prefix; absent / malformed Team ID → null', () => {
    const a: any = appleAppSiteAssociation('ABCDE12345');
    expect(a.applinks.details.map((d: any) => d.appIDs[0])).toEqual(Object.values(MOBILE_BUNDLE_IDS).map((b) => 'ABCDE12345.' + b));
    expect(a.applinks.details[0].components[0]['/']).toBe('/app-links/customer/*');
    expect(appleAppSiteAssociation('')).toBeNull();
    expect(appleAppSiteAssociation('not-a-team')).toBeNull();
  });
  it('assetlinks has only apps with a well-formed SHA-256 fingerprint', () => {
    const l: any = androidAssetLinks({ tech: FP + ', junk', owner: 'nope' });
    expect(l).toHaveLength(1);
    expect(l[0].target).toEqual({ namespace: 'android_app', package_name: 'com.powersalon.technician', sha256_cert_fingerprints: [FP] });
    expect(androidAssetLinks({})).toBeNull();
  });
});
