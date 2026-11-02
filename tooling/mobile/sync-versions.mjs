#!/usr/bin/env node
// sync-versions.mjs — BUILD_PLAN Phase 13 B (Constitution 6 §55, §142–147): ONE version source per store app.
//
// The app's package.json `version` (semver x.y.z) is the truth. Vite stamps it into VITE_APP_VERSION
// (tooling/vite/app-version.mjs), the one transport sends it as X-Client-Version, the API's UPDATE_REQUIRED gate and
// Super Admin's version dashboard compare it — so the store versions must equal it:
//   Android  android/app/build.gradle  versionName "<version>"   (versionCode +1 whenever versionName changes — Play needs
//                                                                 a strictly larger code for every upload)
//   iOS      ios/App/App.xcodeproj/project.pbxproj  MARKETING_VERSION = <version>; (every build configuration)
// CURRENT_PROJECT_VERSION (the iOS build number) is left to the release pipeline / Xcode.
//
//   node tooling/mobile/sync-versions.mjs           write: align every store app to its package.json
//   node tooling/mobile/sync-versions.mjs --check   gate: exit 1 and name every drift (run in tooling/ci/run-gates.mjs)
// To release: bump package.json `version`, run this, commit all three files together.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const MOBILE_APPS = ['customer-web', 'tech-web', 'owner-web', 'manager-pay-web'];
const SEMVER = /^\d+\.\d+\.\d+$/;
const gradlePath = (dir) => join(dir, 'android', 'app', 'build.gradle');
const pbxPath = (dir) => join(dir, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');

export function versionFacts(dir) {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const g = existsSync(gradlePath(dir)) ? readFileSync(gradlePath(dir), 'utf8') : null;
  const x = existsSync(pbxPath(dir)) ? readFileSync(pbxPath(dir), 'utf8') : null;
  return {
    packageVersion: String(pkg.version ?? ''),
    androidVersionName: g ? (/versionName\s+"([^"]+)"/.exec(g)?.[1] ?? null) : null,
    androidVersionCode: g ? Number(/versionCode\s+(\d+)/.exec(g)?.[1] ?? NaN) : null,
    iosMarketingVersions: x ? [...x.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map((m) => m[1].trim()) : [],
    hasAndroid: !!g, hasIos: !!x,
  };
}

export function versionDrift(f) {
  const out = [];
  if (!SEMVER.test(f.packageVersion)) out.push(`package.json version "${f.packageVersion}" is not x.y.z`);
  if (f.hasAndroid) {
    if (f.androidVersionName !== f.packageVersion) out.push(`android versionName "${f.androidVersionName}" ≠ package.json "${f.packageVersion}"`);
    if (!Number.isInteger(f.androidVersionCode) || f.androidVersionCode < 1) out.push(`android versionCode "${f.androidVersionCode}" is not a positive integer`);
  }
  if (f.hasIos) {
    if (!f.iosMarketingVersions.length) out.push('iOS project has no MARKETING_VERSION');
    for (const v of f.iosMarketingVersions) if (v !== f.packageVersion) { out.push(`iOS MARKETING_VERSION ${v} ≠ package.json "${f.packageVersion}"`); break; }
  }
  return out;
}

/** Align one app. Returns the list of files changed. */
export function syncApp(dir) {
  const f = versionFacts(dir);
  if (!SEMVER.test(f.packageVersion)) throw new Error(`${dir}: package.json version "${f.packageVersion}" is not x.y.z`);
  const changed = [];
  if (f.hasAndroid && f.androidVersionName !== f.packageVersion) {
    const g = readFileSync(gradlePath(dir), 'utf8')
      .replace(/versionName\s+"[^"]+"/, `versionName "${f.packageVersion}"`)
      .replace(/versionCode\s+(\d+)/, (_m, n) => `versionCode ${Number(n) + 1}`);
    writeFileSync(gradlePath(dir), g); changed.push(gradlePath(dir));
  }
  if (f.hasIos && f.iosMarketingVersions.some((v) => v !== f.packageVersion)) {
    writeFileSync(pbxPath(dir), readFileSync(pbxPath(dir), 'utf8').replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${f.packageVersion};`));
    changed.push(pbxPath(dir));
  }
  return changed;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const check = process.argv.includes('--check');
  const problems = [];
  for (const a of MOBILE_APPS) {
    const dir = join(ROOT, 'apps', a);
    if (check) { for (const d of versionDrift(versionFacts(dir))) problems.push(`${a}: ${d}`); continue; }
    for (const c of syncApp(dir)) console.log(`sync-versions: wrote ${c.replace(ROOT + '/', '')}`);
  }
  if (check) {
    if (problems.length) { console.error(`❌ store versions drift from package.json — run node tooling/mobile/sync-versions.mjs:\n  ${problems.join('\n  ')}`); process.exit(1); }
    console.log(`✅ sync-versions: ${MOBILE_APPS.length} store apps — Android versionName and iOS MARKETING_VERSION equal package.json`);
  }
}
