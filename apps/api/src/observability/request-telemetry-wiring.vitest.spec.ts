// request-telemetry-wiring.vitest.spec — the request-telemetry KERNEL lives in @aipowersalon/observability (its own unit
// tests live there); what makes it real is the API's wiring, which only the API can assert (Constitution 13 §90/§222:
// a package test must not read the API's files).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('the wiring in app.module is what makes any of this real', () => {
  const src = readFileSync(join(process.cwd(), 'src/app.module.ts'), 'utf8');
  it('RequestContextMiddleware runs on EVERY route, and before TenantContextMiddleware', () => {
    const a = src.indexOf("apply(RequestContextMiddleware).forRoutes('*')");
    const b = src.indexOf('apply(TenantContextMiddleware)');
    expect(a).toBeGreaterThan(-1);
    expect(a).toBeLessThan(b);
  });
  it('PlatformExceptionFilter is the global APP_FILTER', () => {
    expect(src).toMatch(/provide: APP_FILTER, useClass: PlatformExceptionFilter/);
  });
});
