// api-version.test — BUILD_PLAN Phase 12 (Constitution 5 #57): every frontend calls /api/v1/<path>. The ONE rule every
// app's client applies, with the paths that stay where they are (cookie-scoped refresh, provider/infra URLs, media).
import { describe, it, expect } from 'vitest';
import { API_V1_PREFIX, apiV1Path, buildApiUrl, isUnversionedPath } from './api-version';

describe('apiV1Path — the canonical /api/v1 path for an API path', () => {
  it('prefixes every realm path, keeping the query', () => {
    expect(API_V1_PREFIX).toBe('/api/v1');
    expect(apiV1Path('/pos/customers')).toBe('/api/v1/pos/customers');
    expect(apiV1Path('/owner/stream')).toBe('/api/v1/owner/stream');
    expect(apiV1Path('/super-admin/tenants?limit=5')).toBe('/api/v1/super-admin/tenants?limit=5');
    expect(apiV1Path('/auth/login')).toBe('/api/v1/auth/login');
    expect(apiV1Path('/customer-display/device/current')).toBe('/api/v1/customer-display/device/current');
    expect(apiV1Path('/go-check-in/abc/config')).toBe('/api/v1/go-check-in/abc/config');
    expect(apiV1Path('pos/x')).toBe('/api/v1/pos/x');                                  // a relative spelling is still an API path
  });
  it('is idempotent and leaves absolute URLs (presigned uploads, CDN pictures) alone', () => {
    expect(apiV1Path('/api/v1/pos/x')).toBe('/api/v1/pos/x');
    expect(apiV1Path('https://bucket.s3.amazonaws.com/k?sig=1')).toBe('https://bucket.s3.amazonaws.com/k?sig=1');
    expect(apiV1Path('blob:http://x/1')).toBe('blob:http://x/1');
  });
  it('never moves the paths that must stay put', () => {
    // the refresh cookie is Path=/auth/refresh — a browser sends it nowhere else
    for (const p of ['/auth/refresh', '/health/ready', '/metrics', '/webhooks/twilio', '/media/a/b.png', '/oauth/token',
      '/api/ai-booking/v1/public/services', '/platform/branding', '/.well-known/x'])
      { expect(isUnversionedPath(p), p).toBe(true); expect(apiV1Path(p), p).toBe(p); }
    expect(isUnversionedPath('/auth/refreshx')).toBe(false);
    expect(isUnversionedPath('/pos/media')).toBe(false);
  });
});

describe('buildApiUrl — base + /api/v1 path + query', () => {
  it('same origin, a separate API origin, and a base that already names /api/v1', () => {
    expect(buildApiUrl('', '/pos/x', { a: 1, b: undefined })).toBe('/api/v1/pos/x?a=1');
    expect(buildApiUrl('https://api.aipowersalon.com/', '/owner/me')).toBe('https://api.aipowersalon.com/api/v1/owner/me');
    expect(buildApiUrl('https://api.aipowersalon.com/api/v1', '/owner/me')).toBe('https://api.aipowersalon.com/api/v1/owner/me');
    expect(buildApiUrl('https://api.aipowersalon.com', '/auth/refresh')).toBe('https://api.aipowersalon.com/auth/refresh');
  });
});
