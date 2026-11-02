// cors-native-origins.vitest.spec.ts — the native app must be able to reach the API at all.
//
// This is the failure that looks like nothing and breaks everything: a Capacitor/Ionic shell reports an origin of
// `capacitor://localhost`. If that origin is not in the CORS allowlist, the WebView blocks every request BEFORE it
// leaves the phone. The API logs nothing (it never sees the request), the app shows a generic network error, and
// no test anywhere fails — because in a browser everything works.
//
// So the CORS allowlist and the "who may receive a bearer token" decision are built from the SAME list
// (`nativeOrigins()`), and this pins that they cannot drift apart.
import { corsDecision } from './allowed-origins';
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { nativeOrigins, isNativeClient } from '@aipowersalon/identity';

/** Mirrors main.ts: cb(null, !origin || allowedOrigins.includes(origin)) */
function corsAllows(origin: string | undefined, env: NodeJS.ProcessEnv = {} as any): boolean {
  const configured = (env.WEB_CORS_ORIGINS || 'https://aipowersalon.com,https://www.aipowersalon.com')
    .split(',').map((o) => o.trim()).filter(Boolean);
  const allowed = [...configured, ...nativeOrigins(env)];
  return !origin || allowed.includes(origin);
}

describe('the native shells can reach the API', () => {
  it('a Capacitor/Ionic WebView origin is allowed by CORS', () => {
    for (const o of ['capacitor://localhost', 'ionic://localhost', 'http://localhost', 'https://localhost']) {
      expect(corsAllows(o), `${o} is blocked — the native app could not call the API at all`).toBe(true);
    }
  });

  it('a native HTTP client (no Origin at all) is allowed', () => {
    expect(corsAllows(undefined)).toBe(true);          // React Native fetch / URLSession send no Origin
  });

  it('the web origins still work', () => {
    expect(corsAllows('https://aipowersalon.com')).toBe(true);
  });

  it('an arbitrary site is still REFUSED', () => {
    expect(corsAllows('https://evil.example')).toBe(false);
    expect(corsAllows('http://evil.example')).toBe(false);
  });

  it('a configured extra native origin is allowed', () => {
    const env = { NATIVE_APP_ORIGINS: 'app://aipowersalon' } as any;
    expect(corsAllows('app://aipowersalon', env)).toBe(true);
    expect(corsAllows('https://evil.example', env)).toBe(false);
  });
});

describe('CORS and the bearer-token decision use the SAME list', () => {
  it('every origin CORS treats as native is also one that may receive a token — and vice versa', () => {
    for (const o of nativeOrigins()) {
      expect(corsAllows(o), `${o} allowed for tokens but blocked by CORS`).toBe(true);
      expect(isNativeClient({ headers: { origin: o } }), `${o} allowed by CORS but not treated as native`).toBe(true);
    }
  });

  it('the allow-list has ONE source: common/allowed-origins.ts wires nativeOrigins(), and main.ts consumes that list (Constitution 9 §196 shares it with the realtime gateway)', () => {
    // Before Sep 19 2026 main.ts built the list inline; now computeAllowedOrigins() builds it once so CORS and the
    // realtime gateway's pre-open origin check cannot drift from each other. The anti-drift intent of this test
    // is unchanged: nativeOrigins() must feed the list, and main.ts must use THAT list, not a copy.
    const shared = readFileSync(join(__dirname, 'allowed-origins.ts'), 'utf8');
    expect(shared).toMatch(/nativeOrigins\(\)/);
    expect(shared).toMatch(/return \[[^\]]*nativeOrigins\(\)/);
    const main = readFileSync(join(__dirname, '../main.ts'), 'utf8');
    expect(main).toMatch(/import \{ computeAllowedOrigins, corsDecision, csrfVerdict \} from '\.\/common\/allowed-origins'/);   // Security Deep Scan C5/D3: CORS per request + CSRF from the same list
    expect(main).toMatch(/allowedOrigins\s*=\s*computeAllowedOrigins\(\)/);
    expect(main).not.toMatch(/nativeOrigins\(\)/);                        // no second copy of the list in main.ts
  });

  it('the Authorization header is allowed — native has no other way to authenticate', () => {
    const main = readFileSync(join(__dirname, '../main.ts'), 'utf8');
    expect(main).toMatch(/allowedHeaders:.*Authorization/);
  });
});

// The Capacitor shell's WebView scheme DETERMINES the Origin the API sees. If someone changes it in
// capacitor.config.ts without adding the new origin to the API's native allowlist, the app is hit twice at once:
// CORS blocks every request, AND it would not be recognised as native (so no bearer token). Both failures are
// silent from the API's point of view — it never sees the requests. Pin the link.
describe('every Capacitor shell agrees with the API', () => {
  // All four apps that ship native. pos-web and admin-web have no shell (iMac/desktop, same-origin cookie).
  const SHELLS = ['customer-web', 'tech-web', 'owner-web', 'manager-pay-web'];

  for (const app of SHELLS) {
  const CONFIG = join(__dirname, '../../../', app, 'capacitor.config.ts');

  it(`${app}: the shell config exists`, () => {
    expect(readFileSync(CONFIG, 'utf8').length).toBeGreaterThan(0);
  });

  it(`${app}: every scheme it uses maps to an origin the API accepts as native`, () => {
    const cfg = readFileSync(CONFIG, 'utf8');
    const ios = cfg.match(/iosScheme:\s*'([a-z]+)'/i)?.[1];
    const android = cfg.match(/androidScheme:\s*'([a-z]+)'/i)?.[1];
    expect(ios, 'iosScheme is not declared — the Origin becomes implicit').toBeTruthy();
    expect(android, 'androidScheme is not declared').toBeTruthy();

    const allowed = nativeOrigins();
    for (const origin of [`${ios}://localhost`, `${android}://localhost`]) {
      expect(
        allowed.includes(origin),
        `The shell reports Origin "${origin}", which the API does NOT treat as native. The app would be blocked ` +
        `by CORS and would never receive a bearer token — and the API would log nothing, because the requests ` +
        `never reach it. Add it to NATIVE_APP_ORIGINS (or auth/native-client.ts).`,
      ).toBe(true);
      expect(corsAllows(origin)).toBe(true);
    }
  });
  }
});

// ⚠️ The bug this pins actually shipped, and it broke production login.
//
// The web apps are deployed CROSS-ORIGIN from the API (pos-web at pos.aipowersalon.com, built with
// VITE_API_BASE=https://api.aipowersalon.com). Every client fetch uses `credentials: "include"` because it needs
// the session cookie. Per the Fetch spec, the browser **DISCARDS the response** to a credentialed request unless
// it carries `Access-Control-Allow-Credentials: true`.
//
// CORS had `credentials: isDev` — false in production — on the reasoning that "the browser won't send cookies
// cross-origin anyway, so leaving it off is safe". That reasoning is inverted: the apps NEED the cookie
// cross-origin, and turning credentials off is exactly what stops them getting it. Every authenticated call from
// the POS and Admin apps failed in production, login included.
//
// Two files disagreed and nothing checked. Now something does.
describe('CORS credentials must match what the clients actually send', () => {
  const APPS = ['pos-web', 'admin-web', 'customer-web', 'owner-web', 'tech-web', 'manager-pay-web'];

  it('the clients DO send credentials — so the server must allow them', () => {
    const senders = APPS.filter((a) => {
      const p = join(__dirname, '../../../', a, 'src/api/client.ts');
      try { return /credentials:\s*["']include["']/.test(readFileSync(p, 'utf8')); } catch { return false; }
    });
    expect(senders.length, 'no client sends credentials — this test needs rewriting').toBeGreaterThan(0);

    const main = readFileSync(join(__dirname, '../main.ts'), 'utf8');
    expect(
      /credentials:\s*d\.credentials/.test(main) && corsDecision('https://pos.aipowersalon.com', '/pos/x', ['https://pos.aipowersalon.com'], []).credentials === true,
      `${senders.join(', ')} fetch with credentials:"include", but the API's CORS does not set ` +
      `credentials:true. The browser DISCARDS every response to a credentialed cross-origin request without ` +
      `Access-Control-Allow-Credentials — so login fails in production and nothing in the API logs shows why.`,
    ).toBe(true);
  });

  it('the origin allowlist is never "*" — a wildcard with credentials is forbidden by browsers and unsafe', () => {
    const main = readFileSync(join(__dirname, '../main.ts'), 'utf8');
    expect(main).not.toMatch(/origin:\s*['"]\*['"]/);
    expect(main).not.toMatch(/origin:\s*true/);      // Nest's `true` reflects ANY origin — with credentials that is a hole
  });
});
