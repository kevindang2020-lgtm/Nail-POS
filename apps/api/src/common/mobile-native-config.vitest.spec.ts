// mobile-native-config.vitest.spec.ts — BUILD_PLAN Phase 13 D (Constitution 6 §137–138, §303; audit bugs 8 + 10): the
// config lint for the four native shells (tooling/mobile/check-native-config.mjs) — on the real tree, and proof that each
// rule fires on the configuration it exists to stop.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-expect-error — a plain .mjs gate script (no types); its exports are what the gate runs
import { checkAll, checkApp, APPS } from '../../../../tooling/mobile/check-native-config.mjs';
import { MOBILE_BUNDLE_IDS } from '@aipowersalon/api-contracts';

const ROOT = join(__dirname, '../../../..');
const read = (app: string, p: string) => readFileSync(join(ROOT, 'apps', app, p), 'utf8');
const files = (app: string) => ({
  cap: read(app, 'capacitor.config.ts'), pbx: read(app, 'ios/App/App.xcodeproj/project.pbxproj'), gradle: read(app, 'android/app/build.gradle'),
  plist: read(app, 'ios/App/App/Info.plist'), plistDebug: read(app, 'ios/App/App/Info-Debug.plist'), manifest: read(app, 'android/app/src/main/AndroidManifest.xml'),
  nscMain: read(app, 'android/app/src/main/res/xml/network_security_config.xml'), nscDebug: read(app, 'android/app/src/debug/res/xml/network_security_config.xml'),
  pkg: read(app, 'package.json'),
});

describe('the real tree', () => {
  it('all four shells pass (bundle ids aligned, release ATS / cleartext off, backup off, plugins declared, no new signing files)', () => {
    expect(checkAll()).toEqual([]);
  });
  it('the gate’s bundle ids are the api-contracts ones the AASA / assetlinks are built from', () => {
    expect(Object.values(APPS).map((a: any) => a.bundle)).toEqual(Object.values(MOBILE_BUNDLE_IDS));
  });
});

describe('each rule fires on what it exists to stop', () => {
  const app = 'tech-web';
  const base = files(app);
  const with_ = (over: Partial<ReturnType<typeof files>>) => checkApp(app, { ...base, ...over }).join('\n');

  it('bug 8: a capacitor appId that drifted from the native project', () => {
    expect(with_({ cap: base.cap.replace("appId: 'com.powersalon.technician'", "appId: 'com.aipowersalon.technician'") })).toMatch(/bundle id drift/);
  });
  it('bug 10: NSAllowsArbitraryLoads back in the release Info.plist', () => {
    expect(with_({ plist: base.plist.replace('<key>UILaunchStoryboardName</key>', '<key>NSAppTransportSecurity</key>\n\t<dict>\n\t\t<key>NSAllowsArbitraryLoads</key>\n\t\t<true/>\n\t</dict>\n\t<key>UILaunchStoryboardName</key>') })).toMatch(/RELEASE Info.plist allows insecure loads/);
  });
  it('the Release configuration pointed at the debug plist', () => {
    expect(with_({ pbx: base.pbx.replace('INFOPLIST_FILE = App/Info.plist;', 'INFOPLIST_FILE = "App/Info-Debug.plist";') })).toMatch(/Release configuration uses/);
  });
  it('Info-Debug.plist drifting from Info.plist in anything but ATS', () => {
    expect(with_({ plistDebug: base.plistDebug.replace('<key>CFBundleDisplayName</key>', '<key>UIFileSharingEnabled</key>\n\t<true/>\n\t<key>CFBundleDisplayName</key>') })).toMatch(/differs from Info.plist/);
  });
  it('no Face ID usage string', () => {
    expect(with_({ plist: base.plist.replace(/\t<key>NSFaceIDUsageDescription<\/key>\n\t<string>[^<]*<\/string>\n/, '') })).toMatch(/NSFaceIDUsageDescription/);
  });
  it('bug 10: cleartext / backup back on in the manifest', () => {
    expect(with_({ manifest: base.manifest.replace('android:allowBackup="false"', 'android:allowBackup="true" android:usesCleartextTraffic="true"') })).toMatch(/cleartext[\s\S]*allowBackup/);
  });
  it('a release network-security config that allows cleartext', () => {
    expect(with_({ nscMain: base.nscMain.replace('cleartextTrafficPermitted="false"', 'cleartextTrafficPermitted="true"') })).toMatch(/release network_security_config/);
  });
  it('cleartext enabled outside the APS_MOBILE_ENV=dev escape', () => {
    expect(with_({ cap: base.cap.replace("androidScheme: 'https',      // → origin: https://localhost", "androidScheme: 'http', cleartext: true,") })).toMatch(/cleartext outside|androidScheme must be 'https'/);
  });
  it('a plugin missing from package.json', () => {
    expect(with_({ pkg: base.pkg.replace('"@capacitor/push-notifications"', '"@capacitor/not-push"') })).toMatch(/@capacitor\/push-notifications/);
  });
});
