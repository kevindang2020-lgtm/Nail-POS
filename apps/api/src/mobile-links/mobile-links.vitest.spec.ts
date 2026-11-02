// mobile-links.vitest.spec.ts — BUILD_PLAN Phase 13 D (Constitution 6 §64–65): the association files come from env only
// (Kevin's Team ID / cert fingerprints — none is committed), 404 without them; the not-installed fallback never redirects
// off the env-configured web host.
import { describe, it, expect, afterEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { MobileLinksController } from './mobile-links.controller';

const KEYS = ['APPLE_TEAM_ID', 'ANDROID_CERT_SHA256_TECH', 'APP_LINK_WEB_CUSTOMER'];
afterEach(() => { for (const k of KEYS) delete process.env[k]; });
const FP = Array.from({ length: 32 }, () => 'AB').join(':');

describe('/.well-known', () => {
  it('404 until Kevin sets APPLE_TEAM_ID / ANDROID_CERT_SHA256_*', () => {
    const c = new MobileLinksController();
    expect(() => c.aasa()).toThrow(NotFoundException);
    expect(() => c.assetLinks()).toThrow(NotFoundException);
  });
  it('serves the AASA for the configured Team ID and the assetlinks for the configured fingerprints', () => {
    process.env.APPLE_TEAM_ID = 'ABCDE12345'; process.env.ANDROID_CERT_SHA256_TECH = FP;
    const c = new MobileLinksController();
    expect(c.aasa().applinks.details[1].appIDs).toEqual(['ABCDE12345.com.powersalon.technician']);
    expect(c.assetLinks()[0].target.package_name).toBe('com.powersalon.technician');
  });
});

describe('/app-links fallback (§65)', () => {
  it('redirects to the env web host with the parsed route only', () => {
    process.env.APP_LINK_WEB_CUSTOMER = 'https://book.example.com/app';
    expect(new MobileLinksController().fallback({ path: '/app-links/customer/appointment/a1' })).toEqual({ url: 'https://book.example.com/app?link=appointment%2Fa1', statusCode: 302 });
  });
  it('404 for an unknown route, a foreign app, or no configured host — never an open redirect', () => {
    process.env.APP_LINK_WEB_CUSTOMER = 'https://book.example.com';
    const c = new MobileLinksController();
    expect(() => c.fallback({ path: '/app-links/customer/https:%2F%2Fevil.example' })).toThrow(NotFoundException);
    expect(() => c.fallback({ path: '/app-links/owner/approvals' })).toThrow(NotFoundException);   // APP_LINK_WEB_OWNER unset
  });
});
