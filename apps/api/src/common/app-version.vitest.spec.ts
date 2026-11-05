// app-version.vitest.spec.ts — every app build stamps VITE_APP_VERSION (Phase 1, Oct 6 2026). It was read by the client
// error reporter and the Tap-to-Pay minimum-version check and set by nothing: every error said "unknown", and turning on
// MOBILE_PAY_MIN_APP_VERSION would have refused every Tap-to-Pay device.
// BUILD_PLAN Phase 13 B (Constitution 6 §55, §142–147): ONE version source per app — package.json `version` — stamped into
// VITE_APP_VERSION, and the store versions (Android versionName, iOS MARKETING_VERSION) aligned to it by
// tooling/mobile/sync-versions.mjs (`--check` is a gate). The version the app sends in X-Client-Version is therefore the
// one the store shows, the one the UPDATE_REQUIRED gate compares, and the one Super Admin sees in the distribution.
import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, cpSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveAppVersion } from '../../../../tooling/vite/app-version.mjs';
import { MOBILE_APPS, versionFacts, versionDrift, syncApp } from '../../../../tooling/mobile/sync-versions.mjs';

const app = (a: string) => resolve(__dirname, '..', '..', '..', a);
const APPS = ['pos-web', 'admin-web', 'owner-web', 'tech-web', 'customer-web', 'customer-display', 'manager-pay-web'];

describe('app versions', () => {
  it('every app reports its package.json version (semver) — for a store app that IS the store version', () => {
    expect(resolveAppVersion(app('manager-pay-web'), {})).toBe('1.0.0');
    expect(resolveAppVersion(app('customer-web'), {})).toBe('1.6.0');
    expect(resolveAppVersion(app('tech-web'), {})).toBe('1.4.0');
    expect(resolveAppVersion(app('owner-web'), {})).toBe('1.4.0');
    expect(resolveAppVersion(app('pos-web'), {})).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it('an explicit VITE_APP_VERSION (a CI build number) wins', () => {
    expect(resolveAppVersion(app('tech-web'), { VITE_APP_VERSION: '1.4.0+512' })).toBe('1.4.0+512');
  });
  it('every app\'s Vite config stamps it', () => {
    for (const a of APPS) expect(readFileSync(resolve(app(a), 'vite.config.ts'), 'utf8'), a).toMatch(/appVersion\(\)/);
  });
});

describe('store versions follow package.json (sync-versions --check)', () => {
  it('the four store apps: Android versionName and every iOS MARKETING_VERSION equal package.json', () => {
    expect(MOBILE_APPS).toEqual(['customer-web', 'tech-web', 'owner-web', 'manager-pay-web']);
    for (const a of MOBILE_APPS) expect(versionDrift(versionFacts(app(a))), a).toEqual([]);
  });
  it('drift is found and fixed: a bumped package.json is written into Gradle and Xcode; versionCode only ever goes up', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ver-'));
    cpSync(join(app('tech-web'), 'package.json'), join(dir, 'package.json'));
    cpSync(join(app('tech-web'), 'android', 'app', 'build.gradle'), join(dir, 'android', 'app', 'build.gradle'), { recursive: true });
    cpSync(join(app('tech-web'), 'ios', 'App', 'App.xcodeproj', 'project.pbxproj'), join(dir, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj'), { recursive: true });
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ ...pkg, version: '1.5.0' }, null, 2) + '\n');
    const before = versionFacts(dir);
    expect(versionDrift(before)).toEqual([expect.stringMatching(/android versionName/), expect.stringMatching(/iOS MARKETING_VERSION/)]);
    syncApp(dir);
    const after = versionFacts(dir);
    expect(versionDrift(after)).toEqual([]);
    expect(after.androidVersionName).toBe('1.5.0');
    expect(after.iosMarketingVersions.every((v: string) => v === '1.5.0')).toBe(true);
    expect(after.androidVersionCode).toBe(before.androidVersionCode! + 1);
    syncApp(dir);   // idempotent: nothing to change, versionCode untouched
    expect(versionFacts(dir).androidVersionCode).toBe(after.androidVersionCode);
  });
});
