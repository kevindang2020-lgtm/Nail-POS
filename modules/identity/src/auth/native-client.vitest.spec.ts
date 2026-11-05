// native-client.vitest.spec.ts — the native app gets a bearer token. A browser NEVER does.
//
// Why this is the security test that matters:
//
// The web session is an httpOnly cookie. The token never reaches JavaScript, so an XSS bug in the web app can
// abuse the session in-place but cannot *exfiltrate* a long-lived credential. That is a real protection.
//
// The native app cannot use that cookie at all (inside a Capacitor/WebView shell the origin is
// `capacitor://localhost`, so a SameSite=Lax cookie is never sent), so it needs the token itself — held in the
// Keychain/Keystore and sent as `Authorization: Bearer`.
//
// The trap: if "give me the token" were requested by any header the client controls, **XSS in the web app could
// ask for it too**, and walk off with a 30-day bearer token — destroying the very protection the cookie provides.
//
// So the signal is `Origin`, which a browser sets and page script CANNOT change. These tests hold that line.
import { describe, it, expect } from 'vitest';
import { isNativeClient, shouldReturnToken } from './native-client';
import { loginResponse } from './auth.http';

const SECRET = 'test-session-secret-value-32-chars-long';
const req = (headers: Record<string, string | undefined>) => ({ headers });

const principal: any = {
  userId: '11111111-1111-1111-1111-111111111111',
  tenantId: '22222222-2222-2222-2222-222222222222',
  branchId: null, role: 'CUSTOMER', permissions: [], subscriptionStatus: 'active',
  needsBranchSelection: false, fullName: 'Sam',
};
const success: any = { outcome: 'SUCCESS', message: 'ok', principal };

describe('a BROWSER is never treated as native', () => {
  it('the web app origin is not native', () => {
    for (const origin of [
      'https://aipowersalon.com',
      'https://pos.aipowersalon.com',
      'https://admin.aipowersalon.com',
      'https://evil.example',
      'http://evil.example',
    ]) {
      expect(isNativeClient(req({ origin })), origin).toBe(false);
    }
  });

  it('an opaque origin (sandboxed iframe, data: URL) is NOT native — it fails closed', () => {
    expect(isNativeClient(req({ origin: 'null' }))).toBe(false);
  });

  it('XSS CANNOT claim to be native: no client-supplied header is consulted', () => {
    // An XSS payload can set any custom header it likes on a fetch. None of them may help.
    const xss = req({
      origin: 'https://aipowersalon.com',       // ← the browser sets this, and script cannot change it
      'x-client': 'native',
      'x-client-type': 'native',
      'x-requested-with': 'aipowersalon-native',
      'user-agent': 'AIPowerSalon/1.0 (iPhone; Capacitor)',
    } as any);
    expect(isNativeClient(xss)).toBe(false);
    expect(shouldReturnToken(xss)).toBe(false);
  });
});

describe('the NATIVE app is recognised', () => {
  it('Capacitor / Ionic / Android WebView origins are native', () => {
    for (const origin of ['capacitor://localhost', 'ionic://localhost', 'http://localhost', 'https://localhost']) {
      expect(isNativeClient(req({ origin })), origin).toBe(true);
    }
  });

  it('a native HTTP client sends NO Origin — browsers always do, so that means "not a browser"', () => {
    expect(isNativeClient(req({}))).toBe(true);
    expect(isNativeClient(req({ origin: undefined }))).toBe(true);
  });

  it('extra native origins can be configured', () => {
    const env = { NATIVE_APP_ORIGINS: 'app://aipowersalon' } as any;
    expect(isNativeClient(req({ origin: 'app://aipowersalon' }), env)).toBe(true);
    expect(isNativeClient(req({ origin: 'https://aipowersalon.com' }), env)).toBe(false);   // still not native
  });
});

describe('the login RESPONSE reflects it', () => {
  it('a BROWSER gets a cookie and NO token in the body', () => {
    const res = loginResponse(success, { secret: SECRET, secure: true, includeToken: false });
    expect(res.cookie?.value).toBeTruthy();
    expect(res.cookie?.httpOnly).toBe(true);
    expect((res.body as any).accessToken).toBeUndefined();
    // and the cookie's token appears nowhere in the body
    expect(JSON.stringify(res.body)).not.toContain(res.cookie!.value);
  });

  it('the NATIVE app gets the token in the body — the only way it can authenticate', () => {
    const res = loginResponse(success, { secret: SECRET, secure: true, includeToken: true });
    const body: any = res.body;
    expect(body.accessToken).toBeTruthy();
    expect(body.accessToken).toBe(res.cookie!.value);     // the same session, usable as `Authorization: Bearer`
    expect(body.expiresIn).toBeGreaterThan(0);
  });

  it('the native token still carries a sid — a native session is REVOCABLE', () => {
    const res = loginResponse(success, { secret: SECRET, secure: true, includeToken: true, sid: 'sess-1' });
    const payload = JSON.parse(
      Buffer.from((res.body as any).accessToken.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(),
    );
    expect(payload.sid).toBe('sess-1');    // "sign out other devices" works for the phone too
  });

  it('the default is SAFE: with no option passed, no token is returned', () => {
    const res = loginResponse(success, { secret: SECRET, secure: true });
    expect((res.body as any).accessToken).toBeUndefined();
  });
});
