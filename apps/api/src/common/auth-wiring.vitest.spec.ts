// auth-wiring.vitest.spec.ts — locks the §7 wiring chain that unit tests can't see.
//
// Every bug this audit found had the same shape: a control that LOOKED wired but wasn't (login_attempts never
// written, revocation never checked, community.* permissions never grantable). Unit tests all passed, because
// unit tests exercise the pieces, not the wiring between them. These assertions guard the seams.
import { sourcePath } from '../../test-support/code-roots';
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

import { TenantContextMiddleware } from './tenant-context.middleware';

// identity is modules/identity (Constitution 13): 'auth/…' paths read from the module, everything else from apps/api/src.
const src = (p: string) => readFileSync(sourcePath(p), 'utf8');   // API or owning module — the one resolver

describe('auth DI wiring (the seams unit tests miss)', () => {
  const authModule = src('auth/auth.module.ts');
  const appModule = src('app.module.ts');
  const middleware = src('common/tenant-context.middleware.ts');

  it("AuthModule PROVIDES 'SessionStore'", () => {
    expect(authModule).toMatch(/provide:\s*'SessionStore'/);
  });

  it("AuthModule EXPORTS 'SessionStore' — without this the middleware silently gets undefined", () => {
    expect(authModule).toMatch(/exports:\s*\[[^\]]*'SessionStore'/);
  });

  it('AppModule imports AuthModule (so the exported token is resolvable where the middleware is applied)', () => {
    expect(appModule).toMatch(/^\s*AuthModule,/m);
  });

  it('the middleware actually asks for the store and enforces revocation', () => {
    expect(middleware).toMatch(/@Inject\('SessionStore'\)/);
    expect(middleware).toMatch(/isRevoked/);
  });

  it('LoginService is constructed WITH the login-attempt sink (audit was never written before)', () => {
    expect(authModule).toMatch(/new LoginService\(repo,\s*makeLoginThrottle\(\),\s*db \?/);
    expect(authModule).toMatch(/KyselyLoginAttemptSink/);
  });

  it('the login route is EXCLUDED from the session middleware (else login itself would 401)', () => {
    expect(appModule).toMatch(/path:\s*'auth\/login'/);
  });

  it('authenticated auth routes are NOT excluded, so revocation applies to them', () => {
    // /auth/me, /auth/branches and /auth/select-branch must stay behind the middleware.
    expect(appModule).not.toMatch(/path:\s*'auth\/me'/);
    expect(appModule).not.toMatch(/path:\s*'auth\/select-branch'/);
    expect(appModule).not.toMatch(/path:\s*'auth\/branches'/);
  });

  it('the middleware applies to all routes', () => {
    expect(appModule).toMatch(/forRoutes\('\*'\)/);
  });
});

describe('the security control cannot silently disable itself', () => {
  const prevUrl = process.env.DATABASE_URL;
  const prevDriver = process.env.REPO_DRIVER;

  it('REFUSES TO START when a database is configured but the SessionStore did not resolve', () => {
    process.env.DATABASE_URL = 'postgres://localhost/x';
    try {
      // undefined store = the DI token failed to resolve. Previously this degraded silently and revocation
      // just stopped working, with every test still green. Now it is a hard boot failure.
      expect(() => new TenantContextMiddleware(undefined)).toThrow(/silently disabled|did not resolve/i);
    } finally {
      if (prevUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = prevUrl;
    }
  });

  it('still works with NO database (dev/tests) — no store required', () => {
    delete process.env.DATABASE_URL;
    delete process.env.REPO_DRIVER;
    try {
      expect(() => new TenantContextMiddleware(undefined)).not.toThrow();
    } finally {
      if (prevUrl !== undefined) process.env.DATABASE_URL = prevUrl;
      if (prevDriver !== undefined) process.env.REPO_DRIVER = prevDriver;
    }
  });
});
