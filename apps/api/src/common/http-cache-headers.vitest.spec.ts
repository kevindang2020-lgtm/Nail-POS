// Verifies HTTP caching headers (Roadmap Phase 2.3) are applied to the PUBLIC, cacheable GET routes — and, crucially,
// NOT to authenticated tenant routes. We assert on the @Header metadata NestJS attaches to each handler (unit-level;
// no HTTP server needed). The safety property is negative as much as positive: per-user/tenant data must never carry
// a `public` Cache-Control.
import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { PublicBrandingController } from '@aipowersalon/tenants';
import { CustomerSalonsController } from '@aipowersalon/customers';
import { CustomerTechController } from '@aipowersalon/workforce';

const HEADERS = '__headers__';
function cacheControl(proto: any, method: string): string | undefined {
  const headers = Reflect.getMetadata(HEADERS, proto[method]) as { name: string; value: string }[] | undefined;
  return headers?.find((h) => h.name.toLowerCase() === 'cache-control')?.value;
}

describe('HTTP caching headers on public GETs (Phase 2.3)', () => {
  it('platform branding is publicly cacheable (fetched by every app before auth)', () => {
    const cc = cacheControl(PublicBrandingController.prototype, 'get');
    expect(cc).toBeDefined();
    expect(cc).toContain('public');
    expect(cc).toContain('max-age=300');
  });

  it('public salon discovery reads are cacheable', () => {
    expect(cacheControl(CustomerSalonsController.prototype, 'nearby')).toContain('public');
    expect(cacheControl(CustomerSalonsController.prototype, 'detail')).toContain('max-age=300');
    expect(cacheControl(CustomerSalonsController.prototype, 'services')).toContain('max-age=300');
  });

  it('public tech discovery reads are cacheable', () => {
    expect(cacheControl(CustomerTechController.prototype, 'nearby')).toContain('public');
    expect(cacheControl(CustomerTechController.prototype, 'profile')).toContain('public');
    expect(cacheControl(CustomerTechController.prototype, 'salonTechs')).toContain('public');
    expect(cacheControl(CustomerTechController.prototype, 'serviceTechs')).toContain('public');
  });

  it('authenticated tech routes are NOT publicly cacheable (no per-user data leak into caches)', () => {
    // bookingTechs is an authed route (tenant middleware supplies req.ctx) — it must have no public Cache-Control.
    expect(cacheControl(CustomerTechController.prototype, 'bookingTechs')).toBeUndefined();
  });
});
