// mobile-client-guard.vitest.spec.ts — the four Capacitor apps' HTTP clients (Phase 1 of BUILD_PLAN_2026-10-06).
// Found Oct 6 2026 (Constitution 6 audit): tech-web and owner-web fell back to http://localhost:3000 inside the native
// shell — a base the native start-up check refuses; customer-web and manager-pay captured the base at module load so a
// runtime override never reached requests; tech-web's upload sent no bearer, so every native upload answered 401.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const APPS_ROOT = resolve(__dirname, '..', '..', '..');
const APPS = ['customer-web', 'tech-web', 'owner-web', 'manager-pay-web'];
const src = (app: string) => readFileSync(join(APPS_ROOT, app, 'src', 'api', 'client.ts'), 'utf8');
const code = (s: string) => s.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join('\n');

describe('mobile app HTTP clients', () => {
  it('no app silently falls back to an http:// or localhost API inside the native shell', () => {
    for (const app of APPS) expect(code(src(app)), app).not.toMatch(/['"]https?:\/\/localhost/);
  });
  it('every request resolves the base when it is made (apiBase()), never a constant captured at load', () => {
    for (const app of APPS) {
      const s = code(src(app));
      expect(s, app).not.toMatch(/build(Api)?Url\(BASE\b/);
      expect(s, app).toMatch(/buildApiUrl\(apiBase\(\)/);   // BUILD_PLAN Phase 12: and every call is /api/v1/<path>
      expect(s, app).not.toMatch(/\bbuildUrl\(/);
    }
  });
  it('every upload carries the native bearer (the native shell has no cookie)', () => {
    for (const app of APPS) {
      const s = code(src(app));
      const m = /async function upload[\s\S]*?\n}/.exec(s);
      if (!m) continue;   // this app has no upload helper
      expect(m[0], app).toMatch(/authHeader\(\)/);
      expect(m[0], app).toMatch(/\.\.\.bearer/);
    }
  });
});
