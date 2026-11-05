#!/usr/bin/env node
// check-native-config.mjs — BUILD_PLAN Phase 13 D (Constitution 6 §137–138, §303; audit bugs 8 + 10): the native shells of
// the four store apps are release-safe and agree with each other.
//
//   appId     capacitor.config.ts appId == Xcode PRODUCT_BUNDLE_IDENTIFIER (every config) == Gradle applicationId ==
//             api-contracts MOBILE_BUNDLE_IDS (the native projects are the truth — the APNs topic and the store listing)
//   iOS       the RELEASE Info.plist has no ATS exception (NSAllowsArbitraryLoads & co.) and has NSFaceIDUsageDescription;
//             the Debug configuration uses Info-Debug.plist, identical except NSAllowsLocalNetworking; Release uses Info.plist
//   Android   no usesCleartextTraffic; allowBackup=false + data-extraction rules; the release network-security config
//             permits no cleartext; cleartext hosts exist ONLY in src/debug
//   Capacitor the default (non-dev) server block: https Android scheme, no cleartext — `APS_MOBILE_ENV=dev` is the only escape
//   plugins   push, app (links), secure storage, biometrics declared in every app
//   secrets   no signing key / store credential / APNs key / Firebase config in an app tree (three legacy keystores are
//             allow-listed until Kevin rotates them — see docs/mobile/MOBILE_RELEASE_SETUP.md)
//
// Exit 1 lists every violation. `checkApp(files)` is exported for the spec (mobile-native-config.vitest.spec.ts).
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const APPS = {
  'customer-web': { bundle: 'com.powersalon.customer' },
  'tech-web': { bundle: 'com.powersalon.technician' },
  'owner-web': { bundle: 'com.powersalon.owner' },
  'manager-pay-web': { bundle: 'com.aipowersalon.pay' },
};
/** Committed before the rule existed; Kevin rotates them (MOBILE_RELEASE_SETUP.md §Android signing). Only shrinks. */
export const LEGACY_SIGNING_FILES = [];
const SECRET_FILE = /(\.jks|\.keystore|\.p8|\.p12|\.mobileprovision|\.provisionprofile|^key\.properties|^google-services\.json|^GoogleService-Info\.plist)$/i;
const ATS_INSECURE = /NSAllowsArbitraryLoads|NSAllowsArbitraryLoadsInWebContent|NSAllowsArbitraryLoadsForMedia|NSExceptionAllowsInsecureHTTPLoads|NSThirdPartyExceptionAllowsInsecureHTTPLoads/;

const plistKeys = (s) => [...String(s).matchAll(/<key>([^<]+)<\/key>/g)].map((m) => m[1]);
const stripAts = (s) => String(s).replace(/<!--[\s\S]*?-->\n?/g, '').replace(/\n\t<key>NSAppTransportSecurity<\/key>\n\t<dict>[\s\S]*?\n\t<\/dict>/, '');
/** The capacitor config's DEFAULT server block: the `...(DEV ? {…} : {})` escape removed. */
const capDefault = (s) => String(s).replace(/\.\.\.\(DEV \?[\s\S]*?: \{\}\),?/g, '');

/**
 * Check one app from its file contents. `f` = { cap, pbx, gradle, plist, plistDebug, manifest, nscMain, nscDebug, pkg }.
 * Returns the list of violations (empty = clean).
 */
export function checkApp(app, f, bundle = APPS[app]?.bundle) {
  const v = [];
  const bad = (m) => v.push(`${app}: ${m}`);
  // ── appId (bug 8) ──
  const capId = /appId:\s*'([^']+)'/.exec(f.cap ?? '')?.[1];
  const xcIds = [...String(f.pbx ?? '').matchAll(/PRODUCT_BUNDLE_IDENTIFIER = ([^;]+);/g)].map((m) => m[1].replace(/"/g, '').trim());
  const gradleId = /applicationId\s+"([^"]+)"/.exec(f.gradle ?? '')?.[1];
  if (!capId) bad('capacitor.config.ts declares no appId');
  if (!xcIds.length) bad('project.pbxproj has no PRODUCT_BUNDLE_IDENTIFIER');
  for (const id of new Set([capId, ...xcIds, gradleId].filter(Boolean))) if (id !== bundle) bad(`bundle id drift: "${id}" (expected ${bundle} — the native projects are the truth)`);
  // ── iOS (bug 10) ──
  if (ATS_INSECURE.test(f.plist ?? '')) bad('RELEASE Info.plist allows insecure loads (NSAllowsArbitraryLoads / an insecure exception) — debug-only in Info-Debug.plist');
  if (!/NSFaceIDUsageDescription/.test(f.plist ?? '')) bad('Info.plist has no NSFaceIDUsageDescription — Face ID would crash the app on first use');
  if (!f.plistDebug) bad('ios/App/App/Info-Debug.plist is missing');
  else {
    if (ATS_INSECURE.test(f.plistDebug)) bad('Info-Debug.plist uses NSAllowsArbitraryLoads — NSAllowsLocalNetworking is the debug exception');
    if (stripAts(f.plistDebug).trim() !== stripAts(f.plist).trim()) bad('Info-Debug.plist differs from Info.plist in more than the ATS block — keep them in step');
  }
  const infoFiles = [...String(f.pbx ?? '').matchAll(/INFOPLIST_FILE = ([^;]+);[\s\S]*?name = (Debug|Release);/g)].map((m) => [m[2], m[1].replace(/"/g, '')]);
  for (const [cfg, file] of infoFiles) {
    if (cfg === 'Release' && file !== 'App/Info.plist') bad(`the Release configuration uses ${file} (must be App/Info.plist)`);
    if (cfg === 'Debug' && file !== 'App/Info-Debug.plist') bad(`the Debug configuration uses ${file} (expected App/Info-Debug.plist)`);
  }
  // ── Android (bug 10) ──
  const m = f.manifest ?? '';
  if (/usesCleartextTraffic="true"/.test(m)) bad('AndroidManifest allows cleartext traffic (usesCleartextTraffic="true")');
  if (!/allowBackup="false"/.test(m)) bad('AndroidManifest: allowBackup must be "false" (tokens must not be backed up / restored elsewhere)');
  if (!/dataExtractionRules="@xml\/data_extraction_rules"/.test(m)) bad('AndroidManifest: no dataExtractionRules (Android 12+ device transfer)');
  if (!/networkSecurityConfig="@xml\/network_security_config"/.test(m)) bad('AndroidManifest: no networkSecurityConfig');
  if (!f.nscMain || !/cleartextTrafficPermitted="false"/.test(f.nscMain) || /cleartextTrafficPermitted="true"/.test(f.nscMain)) bad('release network_security_config must permit no cleartext');
  if (f.nscDebug && /<base-config[^>]*cleartextTrafficPermitted="true"/.test(f.nscDebug)) bad('debug network_security_config opens cleartext to EVERY host — list the dev hosts only');
  // ── Capacitor defaults ──
  const d = capDefault(f.cap ?? '');
  if (/cleartext:\s*true/.test(d)) bad('capacitor.config.ts enables cleartext outside the APS_MOBILE_ENV=dev escape');
  if (!/androidScheme:\s*'https'/.test(d)) bad("capacitor.config.ts: the default androidScheme must be 'https'");
  // ── plugins ──
  const pkg = (() => { try { return JSON.parse(f.pkg ?? '{}'); } catch { return {}; } })();
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  for (const p of ['@capacitor/push-notifications', '@capacitor/app', 'capacitor-secure-storage-plugin', '@capgo/capacitor-native-biometric']) if (!(p in deps)) bad(`package.json does not declare ${p}`);
  return v;
}

function readApp(app) {
  const a = join(ROOT, 'apps', app);
  const r = (p) => (existsSync(join(a, p)) ? readFileSync(join(a, p), 'utf8') : null);
  return {
    cap: r('capacitor.config.ts'), pbx: r('ios/App/App.xcodeproj/project.pbxproj'), gradle: r('android/app/build.gradle'),
    plist: r('ios/App/App/Info.plist'), plistDebug: r('ios/App/App/Info-Debug.plist'), manifest: r('android/app/src/main/AndroidManifest.xml'),
    nscMain: r('android/app/src/main/res/xml/network_security_config.xml'), nscDebug: r('android/app/src/debug/res/xml/network_security_config.xml'),
    pkg: r('package.json'),
  };
}

export function secretFiles(root = ROOT) {
  const out = [];
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      if (n === 'node_modules' || n === 'build' || n === 'dist' || n === 'Pods' || n === '.gradle' || n.startsWith('.git')) continue;
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (SECRET_FILE.test(n)) out.push(relative(root, p));
    }
  };
  for (const app of Object.keys(APPS)) walk(join(root, 'apps', app));
  return out;
}

export function checkAll() {
  const v = [];
  for (const app of Object.keys(APPS)) v.push(...checkApp(app, readApp(app)));
  for (const f of secretFiles()) if (!LEGACY_SIGNING_FILES.includes(f)) v.push(`${f}: a signing key / store credential / provider config is in the app tree — keep it outside the repo (MOBILE_RELEASE_SETUP.md)`);
  return v;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const v = checkAll();
  if (v.length) { console.error(`check-native-config: ${v.length} violation(s)\n` + v.map((x) => '  ✗ ' + x).join('\n')); process.exit(1); }
  const legacy = secretFiles().filter((f) => LEGACY_SIGNING_FILES.includes(f));
  console.log(`check-native-config: 4 apps clean (bundle ids aligned, release ATS / cleartext off, backup off, plugins declared)` +
    (legacy.length ? `; KEVIN: ${legacy.length} legacy signing file(s) still in the repo — rotate + remove (MOBILE_RELEASE_SETUP.md)` : ''));
}
