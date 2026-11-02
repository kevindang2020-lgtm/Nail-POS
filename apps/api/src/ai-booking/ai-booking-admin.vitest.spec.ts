import { describe, it, expect } from 'vitest';
import { AiBookingAdminController } from './ai-booking-admin.controller';

describe('AiBookingAdminController.systemStatus (§53)', () => {
  const c = new AiBookingAdminController({} as any, {} as any, {} as any);
  it('reports honest config-driven status (no fabricated values)', () => {
    delete process.env.AI_BOOKING_LINK_SECRET; delete process.env.RATE_LIMIT_STORE; process.env.TENANT_RATE_LIMIT = 'off';
    const s: any = c.systemStatus();
    delete process.env.TENANT_RATE_LIMIT;
    expect(s.operational).toBe(true);
    expect(s.linkSigningConfigured).toBe(false);          // no secret set
    expect(s.publicAbuseProtection).toBe('pass_through');  // limiter switched off
    expect((c.systemStatus() as any).publicAbuseProtection).toBe('active');   // Phase 11: on by default (in-memory without Redis)
    expect(s.conversionPipeline).toBe('ready');
    expect(s.permissionMatrix).toBe('enforced');
  });
  it('reflects link signing once the secret is present', () => {
    process.env.AI_BOOKING_LINK_SECRET = 'x'.repeat(40);
    expect((c.systemStatus() as any).linkSigningConfigured).toBe(true);
    delete process.env.AI_BOOKING_LINK_SECRET;
  });
});
