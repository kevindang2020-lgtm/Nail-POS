// Nov 6 2026 — Kevin: "how does my POS automatically log me out?" The access token lives 15 minutes (AUTH_ACCESS_TTL) and
// is meant to be renewed silently through POST /auth/refresh (packages/api-client auth-refresh.ts). That renewal was built
// in October but NO app installed it, so every app signed people out ~15 minutes after sign-in, busy or not. Proven live
// (60 s access token: 401 at 70 s before the fix, 200 at 70 s and 140 s after; a real sign-out still ends the session).
// This pins the wiring in every app that signs people in.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const APPS = join(__dirname, '..', '..', '..');
const read = (p: string) => readFileSync(join(APPS, p), 'utf8');

describe('every signed-in app renews its 15-minute access token silently', () => {
  for (const app of ['pos-web', 'admin-web', 'owner-web', 'tech-web', 'customer-web', 'manager-pay-web']) {
    it(`${app}: main.tsx installs installAuthRefresh(window, …) at start-up`, () => {
      const main = read(`${app}/src/main.tsx`);
      expect(main).toMatch(/import \{ installAuthRefresh \} from '@aipowersalon\/api-client'/);
      expect(main).toMatch(/^installAuthRefresh\(window, \{/m);   // top level: before anything renders or fetches
      expect(main.indexOf('installAuthRefresh(window')).toBeLessThan(main.indexOf('createRoot'));
    });
  }
  for (const app of ['owner-web', 'tech-web', 'customer-web', 'manager-pay-web']) {
    it(`${app}: the phone build renews with the Keychain pair, and sign-in keeps the refresh token`, () => {
      expect(read(`${app}/src/main.tsx`)).toMatch(/native: Capacitor\.isNativePlatform\(\) \? nativeTokenStore : null/);
      const login = read(`${app}/src/screens/LoginScreen.tsx`);
      const at = login.indexOf('await authApi.login(');
      expect(at).toBeGreaterThan(-1);
      expect(login.slice(at, at + 600)).toMatch(/saveNativeRefreshToken\(\(r as any\)\?\.refreshToken\)/);
    });
  }
});
