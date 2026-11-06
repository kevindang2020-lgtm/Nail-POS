// native-auth-coverage.vitest.spec.ts — every app that ships as a NATIVE iOS/Android build must be able to
// authenticate there.
//
// Why a guard and not just a fix: a native shell cannot use the session cookie at all. Inside Capacitor/WebView
// the page origin is `capacitor://localhost`, so a call to `api.aipowersalon.com` is cross-site and a
// `SameSite=Lax` cookie is never sent. An app that only knows about cookies will simply never authenticate on a
// phone — and nothing in its own test suite would notice, because in a browser it works fine.
//
// I fixed this in `customer-web` first and then found `tech-web`, `owner-web` and `manager-pay-web` had exactly
// the same wall waiting for them. That is the third time in this codebase a fix landed in one app out of several,
// so it becomes an invariant rather than a memory.
//
// `pos-web` and `admin-web` are deliberately NOT in the list: the POS runs on an iMac in Safari and Super Admin
// on desktop, both same-origin with the API, where the httpOnly cookie is the correct and stronger choice.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const APPS_ROOT = join(__dirname, '../../..');

/** Apps that ship (or will ship) as native iOS/Android builds. */
const NATIVE_APPS = ['customer-web', 'tech-web', 'owner-web', 'manager-pay-web'];
const APP_IDS: Record<string, string> = { 'customer-web': 'customer', 'tech-web': 'tech', 'owner-web': 'owner', 'manager-pay-web': 'manager-pay' };
const TRANSPORT = join(__dirname, '../../../..', 'packages/mobile-sdk/src/network/transport.ts');   // BUILD_PLAN Phase 13: the one transport

const read = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : '');

/** Comments explaining "never localStorage" must not TRIP the check that says "never localStorage".
 *  (A guard that fires on its own documentation is the same false-alarm trap that makes people ignore guards.) */
const code = (p: string) =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('every native-shipped app can authenticate on a phone', () => {
  for (const app of NATIVE_APPS) {
    const client = join(APPS_ROOT, app, 'src/api/client.ts');
    // Constitution 13 Phase 5: the four identical native-auth/bootstrap copies became @aipowersalon/mobile-sdk. The
    // property is unchanged — a native-safe token store exists and THIS app wires it — but the file lives in the package.
    const nativeAuth = join(APPS_ROOT, '..', 'packages/mobile-sdk/src/native-auth.ts');

    it(`${app}: has the secure-token module`, () => {
      expect(existsSync(nativeAuth), 'packages/mobile-sdk/src/native-auth.ts is missing').toBe(true);
      const main = code(join(APPS_ROOT, app, 'src/main.tsx'));
      // Nov 5 2026: the wiring may sit in src/api/client.ts — it runs at module load, which every app reaches through its
      // import graph before main.tsx's body runs (ES imports evaluate first). Either place is "at start-up".
      const client = code(join(APPS_ROOT, app, 'src/api/client.ts'));
      const wired = (f: string) => /from '@aipowersalon\/mobile-sdk'/.test(f) && /configureMobileSdk\(/.test(f);
      expect(
        wired(main) || wired(client),
        `${app} does not wire @aipowersalon/mobile-sdk at start-up. On a native build its session cookie is never sent ` +
        `(origin is capacitor://localhost → cross-site), so it can NEVER authenticate on a phone — while its ` +
        `browser tests all pass.`,
      ).toBe(true);
    });

    it(`${app}: sends the bearer token on every request`, () => {
      // BUILD_PLAN Phase 13: the app's client is the ONE mobile transport — the bearer is attached THERE, for every method
      // (uploads and raw export GETs included): clientHeaders() spreads authHeader(), and the single send path spreads
      // clientHeaders(). The app must build its client on it (with its own app id).
      const src = code(client);
      const t = code(TRANSPORT);
      expect(
        new RegExp(`createTransport\\(\\{[\\s\\S]{0,80}app:\\s*'${APP_IDS[app]}'`).test(src)
          && /async function clientHeaders\(\)[\s\S]{0,500}\.\.\.\(await authHeader\(\)\)/.test(t)
          && /\.\.\.\(await clientHeaders\(\)\)/.test(t),
        `${app}/src/api/client.ts is not built on the mobile transport, or the transport no longer attaches the bearer token. Native requests would be unauthenticated.`,
      ).toBe(true);
    });

    it(`${app}: stores the token in the SECURE store, never localStorage`, () => {
      expect(read(nativeAuth)).toMatch(/SecureStore/);
      // CODE only — a comment saying "never localStorage" must not trip this.
      expect(
        /localStorage/.test(code(nativeAuth)),
        `${app} native-auth must not use localStorage — on a jailbroken device that is a plain file.`,
      ).toBe(false);
    });

    it(`${app}: a 401 (expired or REVOKED session) wipes the token from the device`, () => {
      // Without this, a dead token lingers in the Keychain and is resent on every request forever — and Face ID
      // would keep unlocking a credential the server has already rejected.
      const ctx = code(join(APPS_ROOT, app, 'src/auth/AuthContext.tsx'));
      const client = code(join(APPS_ROOT, app, 'src/api/client.ts'));
      // some apps handle it in the client — since Phase 13 through the transport's onUnauthorized hook, which runs right
      // before the transport announces aps:unauthorized (packages/mobile-sdk/src/network/transport.ts)
      const viaTransport = /onUnauthorized:[^\n]*clearNativeToken/.test(client)
        && /cfg\.onUnauthorized\?\.\(\)[\s\S]{0,200}aps:unauthorized/.test(code(TRANSPORT));
      const src = /aps:unauthorized/.test(ctx) ? ctx : viaTransport ? 'aps:unauthorized clearNativeToken' : client;

      // Scope the check to the 401 HANDLER, not the whole file. Checking the file merely mentions
      // `clearNativeToken` passes on the LOGOUT handler alone — which is exactly how this guard first reported
      // safety it had not checked. Take the window around the unauthorized handling and look only there.
      const at = src.indexOf('aps:unauthorized');
      const window401 = at === -1 ? '' : src.slice(Math.max(0, at - 400), at + 200);

      expect(
        /clearNativeToken/.test(window401),
        `${app}: the 401 handler does not clear the stored native token. A dead token would sit in the Keychain ` +
        `and be resent on every request forever, and Face ID would keep unlocking a credential the server has ` +
        `already rejected.`,
      ).toBe(true);
    });

    it(`${app}: declares the secure-storage plugin (without it there IS no Keychain)`, () => {
      const pkg = JSON.parse(readFileSync(join(APPS_ROOT, app, 'package.json'), 'utf8'));
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      expect(
        'capacitor-secure-storage-plugin' in deps,
        `${app} has no secure-storage plugin. The bearer token would live in memory only — the user would have ` +
        `to sign in again on every app launch. (It must NEVER fall back to localStorage: on a jailbroken device ` +
        `that is a plain file.)`,
      ).toBe(true);
    });

    it(`${app}: installs a SECURE token store at start-up (or the token dies with the app)`, () => {
      const boot = code(join(APPS_ROOT, '..', 'packages/mobile-sdk/src/native-bootstrap.ts'));
      const main = code(join(APPS_ROOT, app, 'src/main.tsx'));
      expect(boot, 'packages/mobile-sdk/src/native-bootstrap.ts does not install the secure store').toMatch(/setSecureStore/);
      expect(
        /initNative\(\)/.test(main),
        `${app}: main.tsx never calls initNative(), so the Keychain store is never installed — the bearer token ` +
        `would live in memory only and the user would have to sign in again on every app launch.`,
      ).toBe(true);
    });

    it(`${app}: sign-out clears the token from the device`, () => {
      const ctx = code(join(APPS_ROOT, app, 'src/auth/AuthContext.tsx'));
      expect(code(nativeAuth)).toMatch(/clearNativeToken/);
      // manager-pay-web holds its principal in a screen, not a context — the module must still expose the clear.
      if (ctx) {
        expect(
          /clearNativeToken/.test(ctx),
          `${app}: logout does not clear the native token. A token left in the Keychain outlives the sign-out.`,
        ).toBe(true);
      }
    });
  }
});

describe('Face ID in all four apps is the device credential (BUILD_PLAN Phase 13 D, bug 2 / bug 3 follow-up)', () => {
  // Phase 13 D: Face ID unlocks a server-issued DEVICE CREDENTIAL (packages/mobile-sdk native-faceid.ts), never the access
  // token. Every native app ships the plugin the shared adapter loads, and clears the credential with the session.
  it('every native app declares the biometric plugin the shared adapter loads (manager-pay included since Phase 13)', () => {
    for (const app of NATIVE_APPS) {
      const pkg = JSON.parse(readFileSync(join(APPS_ROOT, app, 'package.json'), 'utf8'));
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      expect('@capgo/capacitor-native-biometric' in deps, `${app} has Face ID but no biometric plugin — the native path would have no implementation.`).toBe(true);
    }
  });
  // Nov 5 2026 (Kevin; changes Constitution 6 §37): Face ID SURVIVES a normal sign-out and a 401 in customer / tech / owner
  // — the person signs back in with their face; the server ends the credential whenever trust ends (migration 705 +
  // biometric-auth.pgtest). Turning it off is an explicit choice at sign-out. Manager Pay (a phone often shared at the
  // front desk) keeps the strict rule: a 401 and a sign-out end Face ID there.
  it('customer, tech, owner: a 401 keeps Face ID; sign-out ends it only when the person chose to', () => {
    for (const app of ['customer-web', 'tech-web', 'owner-web']) {
      const src = code(join(APPS_ROOT, app, 'src/auth/AuthContext.tsx'));
      const at = src.indexOf("'aps:unauthorized'");
      expect(at, `${app}: no aps:unauthorized handler`).toBeGreaterThan(-1);
      expect(/clearFaceId|disableFaceId/.test(src.slice(Math.max(0, at - 600), at)), `${app}: the 401 handler must not end Face ID`).toBe(false);
      expect(/if \(opts\?\.endFaceId\)[^\n]*disableFaceId\(\)/.test(src), `${app}: sign-out must turn Face ID off (server revoke) when the person chose to`).toBe(true);
      expect(src.indexOf('disableFaceId()'), `${app}: the server revoke must run while the session still exists`).toBeLessThan(src.indexOf('authApi.logout()'));
      expect(/^\s*await clearFaceId\(\);/m.test(src), `${app}: an unconditional clearFaceId() on sign-out would end Face ID every time`).toBe(false);
    }
  });
  it('manager-pay: a 401 and a sign-out end Face ID (server revoke before the session ends)', () => {
    const app = code(join(APPS_ROOT, 'manager-pay-web', 'src/App.tsx'));
    const at = app.indexOf("'aps:unauthorized'");
    expect(/clearFaceId/.test(app.slice(Math.max(0, at - 600), at + 200)), 'manager-pay: the 401 handler does not clear the Face ID credential').toBe(true);
    const acct = code(join(APPS_ROOT, 'manager-pay-web', 'src/screens/AccountScreen.tsx'));
    const signOut = acct.slice(acct.indexOf('const onSignOut'));
    expect(signOut.indexOf('disableFaceId()')).toBeGreaterThan(-1);
    expect(signOut.indexOf('disableFaceId()')).toBeLessThan(signOut.indexOf('authApi.logout()'));
    expect(/clearFaceId\(\)/.test(signOut)).toBe(true);
  });
  it('the server: a normal sign-out keeps Face ID; every other revoke ends it (migration 705)', () => {
    const ctl = readFileSync(join(APPS_ROOT, '..', 'modules/identity/src/auth/auth.controller.ts'), 'utf8');
    const logout = ctl.slice(ctl.indexOf("@Post('logout')"), ctl.indexOf("@Get('branches')"));
    expect(logout).toMatch(/set_config\('aps\.keep_face_id', 'on', true\)/);
    expect(logout).not.toMatch(/revokeForDevice/);
    const mig = readFileSync(join(APPS_ROOT, 'api/db/migrations/705_face_id_survives_sign_out.sql'), 'utf8');
    expect(mig).toMatch(/AFTER UPDATE OF status ON sessions/);
    expect(mig).toMatch(/current_setting\('aps\.keep_face_id', true\)/);
  });
  it('no app reads the never-set aps_bio_login_success flag any more (bug 14)', () => {
    for (const app of NATIVE_APPS) for (const f of ['src/screens/SettingsScreen.tsx', 'src/screens/OwnerSettingScreen.tsx', 'src/screens/ProfileSecurityScreen.tsx', 'src/screens/LoginScreen.tsx']) {
      expect(code(join(APPS_ROOT, app, f)).includes('aps_bio_login_success'), `${app}/${f} still reads aps_bio_login_success`).toBe(false);
    }
  });
});
