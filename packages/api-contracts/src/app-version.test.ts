// app-version.test.ts — Constitution 6 §55–57 (BUILD_PLAN Phase 13, B): the one version comparison and the one
// SUPPORTED / UPDATE_RECOMMENDED / UPDATE_REQUIRED decision, read by the API's UPDATE_REQUIRED gate, /app-config and
// every mobile app's AppConfigGate. The hard rules are pinned here: only a NATIVE build carrying its app id and version
// can ever be refused, and with no configured minimum nothing is refused.
import { describe, it, expect } from 'vitest';
import {
  compareAppVersions, isAppVersion, appVersionState, parseClientHeaders, updateRequiredFor, isUpdateGateExempt,
  MOBILE_APP_IDS, CLIENT_HEADER, normaliseVersionPolicy, VersionPolicyError,
} from './app-version';

describe('compareAppVersions', () => {
  it('compares numerically per segment, missing segments are 0, build metadata ignored', () => {
    expect(compareAppVersions('1.10.0', '1.9.9')).toBe(1);
    expect(compareAppVersions('1.4', '1.4.0')).toBe(0);
    expect(compareAppVersions('1.4.0+512', '1.4.0')).toBe(0);
    expect(compareAppVersions('2.0.0', '10.0.0')).toBe(-1);
  });
  it('only x[.y[.z]] (optionally +build) is a version', () => {
    expect(isAppVersion('1.4.0')).toBe(true);
    expect(isAppVersion('1.4')).toBe(true);
    expect(isAppVersion('1.4.0+512')).toBe(true);
    expect(isAppVersion('unknown')).toBe(false);
    expect(isAppVersion('1.4.0; drop table')).toBe(false);
  });
});

describe('appVersionState (§55)', () => {
  const p = { minSupported: '1.4.0', recommended: '1.6.0', latest: '1.7.0' };
  it('below minimum → UPDATE_REQUIRED, below recommended → UPDATE_RECOMMENDED, else SUPPORTED', () => {
    expect(appVersionState('1.3.9', p)).toBe('UPDATE_REQUIRED');
    expect(appVersionState('1.4.0', p)).toBe('UPDATE_RECOMMENDED');
    expect(appVersionState('1.6.0', p)).toBe('SUPPORTED');
    expect(appVersionState('1.8.0', p)).toBe('SUPPORTED');
  });
  it('no policy, or a version that is not a version, is never refused', () => {
    expect(appVersionState('0.0.1', null)).toBe('SUPPORTED');
    expect(appVersionState('0.0.1', { minSupported: null, recommended: null, latest: null })).toBe('SUPPORTED');
    expect(appVersionState('garbage', p)).toBe('SUPPORTED');
    expect(appVersionState(null, p)).toBe('SUPPORTED');
  });
});

describe('parseClientHeaders', () => {
  it('reads the three headers case-insensitively and keeps only known values', () => {
    expect(CLIENT_HEADER).toEqual({ type: 'X-Client-Type', version: 'X-Client-Version', platform: 'X-Client-Platform' });
    expect(MOBILE_APP_IDS).toEqual(['customer', 'tech', 'owner', 'manager-pay']);
    expect(parseClientHeaders({ 'x-client-type': 'tech', 'x-client-version': '1.4.0', 'x-client-platform': 'ios' })).toEqual({ app: 'tech', version: '1.4.0', platform: 'ios' });
    expect(parseClientHeaders({ 'x-client-type': 'native' })).toEqual({ app: null, version: null, platform: null });
    expect(parseClientHeaders({ 'x-client-type': 'owner', 'x-client-version': 'x;y', 'x-client-platform': 'symbian' })).toEqual({ app: 'owner', version: null, platform: null });
    expect(parseClientHeaders(undefined)).toEqual({ app: null, version: null, platform: null });
  });
});

describe('updateRequiredFor — the hard rules', () => {
  const policy = { app: 'tech' as const, platform: 'ios' as const, minSupported: '1.5.0', recommended: null, latest: null, storeUrl: 'https://apps.apple.com/app/id1', message: null };
  const lookup = (app: string, platform: string) => (app === 'tech' && platform === 'ios' ? policy : null);
  const anyRow = () => policy;   // a store that would answer for ANY app / platform: the gate itself must still refuse nothing it should not
  const req = (h: Record<string, string>, path = '/tech/queue', method = 'GET') => ({ headers: h, path, method });
  const old = { 'x-client-type': 'tech', 'x-client-version': '1.4.0', 'x-client-platform': 'ios' };
  it('a native build below the minimum is refused, with the store url', () => {
    expect(updateRequiredFor(req(old), lookup)).toMatchObject({ statusCode: 426, code: 'UPDATE_REQUIRED', storeUrl: 'https://apps.apple.com/app/id1', minimumVersion: '1.5.0', app: 'tech', platform: 'ios' });
  });
  it('a current build passes', () => { expect(updateRequiredFor(req({ ...old, 'x-client-version': '1.5.0' }), lookup)).toBeNull(); });
  it('no client headers (web apps, display, kiosk, curl) are never refused', () => {
    expect(updateRequiredFor(req({}), anyRow)).toBeNull();
    expect(updateRequiredFor(req({ 'x-client-type': 'tech', 'x-client-platform': 'ios' }), anyRow)).toBeNull();          // no version
    expect(updateRequiredFor(req({ 'x-client-version': '0.0.1', 'x-client-platform': 'ios' }), anyRow)).toBeNull();     // no app
    expect(updateRequiredFor(req({ 'x-client-type': 'kiosk', 'x-client-version': '0.0.1', 'x-client-platform': 'ios' }), anyRow)).toBeNull();   // not a store app
  });
  it('the web platform is never refused, nor an unknown platform', () => {
    expect(updateRequiredFor(req({ ...old, 'x-client-platform': 'web' }), anyRow)).toBeNull();
    expect(updateRequiredFor(req({ 'x-client-type': 'tech', 'x-client-version': '1.0.0' }), anyRow)).toBeNull();
    expect(updateRequiredFor(req({ ...old, 'x-client-platform': 'android' }), anyRow)).not.toBeNull();   // android is native
  });
  it('no configured row → nothing refused', () => { expect(updateRequiredFor(req(old), () => null)).toBeNull(); });
  it('sign-in, refresh, logout, health, /app-config, webhooks, metrics, telemetry and preflight are exempt — with or without /api/v1', () => {
    for (const p of ['/auth/login', '/auth/refresh', '/auth/logout', '/auth/me', '/health', '/health/ready', '/app-config', '/webhooks/payments/x',
      '/metrics', '/client-telemetry/errors', '/api/v1/auth/login', '/api/v1/app-config', '/api/v1/health', '/customer/auth/register', '/oauth/token']) {
      expect(isUpdateGateExempt(p, 'POST'), p).toBe(true);
      expect(updateRequiredFor(req(old, p, 'POST'), lookup), p).toBeNull();
    }
    expect(updateRequiredFor(req(old, '/tech/queue', 'OPTIONS'), lookup)).toBeNull();
    expect(isUpdateGateExempt('/tech/queue', 'GET')).toBe(false);
    expect(isUpdateGateExempt('/authors', 'GET')).toBe(false);
  });
});

describe('normaliseVersionPolicy (Super Admin input)', () => {
  it('min ≤ recommended ≤ latest, versions valid, https store url, short message', () => {
    expect(normaliseVersionPolicy({ app: 'tech', platform: 'android', minSupported: '1.4.0', recommended: '1.5.0', latest: '1.6.0', storeUrl: 'https://play.google.com/store/apps/details?id=com.powersalon.technician', message: ' Please update. ' }))
      .toEqual({ app: 'tech', platform: 'android', minSupported: '1.4.0', recommended: '1.5.0', latest: '1.6.0', storeUrl: 'https://play.google.com/store/apps/details?id=com.powersalon.technician', message: 'Please update.' });
    expect(() => normaliseVersionPolicy({ app: 'pos', platform: 'ios' })).toThrow(VersionPolicyError);
    expect(() => normaliseVersionPolicy({ app: 'tech', platform: 'web' })).toThrow(/platform/);
    expect(() => normaliseVersionPolicy({ app: 'tech', platform: 'ios', minSupported: '2.0.0', recommended: '1.0.0' })).toThrow(/recommended/);
    expect(() => normaliseVersionPolicy({ app: 'tech', platform: 'ios', minSupported: 'abc' })).toThrow(/minSupported/);
    expect(() => normaliseVersionPolicy({ app: 'tech', platform: 'ios', storeUrl: 'http://evil' })).toThrow(/storeUrl/);
    expect(() => normaliseVersionPolicy({ app: 'tech', platform: 'ios', minSupported: '1.0.0' })).toThrow(/storeUrl/);   // forcing an update needs somewhere to send people
    expect(normaliseVersionPolicy({ app: 'tech', platform: 'ios' })).toMatchObject({ minSupported: null, recommended: null, latest: null, storeUrl: null, message: null });
  });
});
