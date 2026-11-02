// ai-booking-public-ratelimit.vitest.spec.ts — abuse protection on the unauthenticated public surface (§31/§43).
import { describe, it, expect, vi } from 'vitest';
import { AiBookingPublicController } from './ai-booking-public.controller';
import { signBookingContext } from './ai-booking-signed-context';
import { AiBookingPublicResolver } from './ai-booking-public.resolver';

const SECRET = 'rl-secret-0123456789abcdef';
const token = () => signBookingContext({ tenantId: 'ten_A', branchId: 'br_1', source: 'ONLINE_BOOKING' }, { secret: SECRET });
const svc = { searchAvailability: vi.fn(async () => ({ options: [] })) };
const mutation = {};
const withSecret = (fn: () => Promise<void>) => { process.env.AI_BOOKING_LINK_SECRET = SECRET; return fn().finally(() => { delete process.env.AI_BOOKING_LINK_SECRET; }); };

describe('public endpoint abuse protection', () => {
  it('passes through when the limiter is disabled (default)', async () => {
    await withSecret(async () => {
      const limiter = { enabled: false, hit: vi.fn() };
      const c = new AiBookingPublicController(svc as any, mutation as any, new AiBookingPublicResolver(), limiter as any, { isRevoked: async () => false } as any);
      await c.search({ token: token() });
      expect(limiter.hit).not.toHaveBeenCalled();
      expect(svc.searchAvailability).toHaveBeenCalled();
    });
  });

  it('buckets per tenant+source and 429s when the budget is exceeded', async () => {
    await withSecret(async () => {
      const limiter = { enabled: true, hit: vi.fn(async () => ({ allowed: false, remaining: 0, limit: 5, retryAfterMs: 2000 })) };
      const c = new AiBookingPublicController(svc as any, mutation as any, new AiBookingPublicResolver(), limiter as any, { isRevoked: async () => false } as any);
      await expect(c.search({ token: token() })).rejects.toMatchObject({ response: { code: 'TEMPORARY_CAPACITY_PROTECTION', retryAfterSeconds: 2 } });
      expect(limiter.hit).toHaveBeenCalledWith('aib:pub:ten_A:ONLINE_BOOKING');   // per-tenant-per-source key
    });
  });

  it('rejects a forged token BEFORE consuming any rate budget', async () => {
    await withSecret(async () => {
      const limiter = { enabled: true, hit: vi.fn() };
      const c = new AiBookingPublicController(svc as any, mutation as any, new AiBookingPublicResolver(), limiter as any, { isRevoked: async () => false } as any);
      await expect(c.search({ token: 'forged.token' })).rejects.toBeDefined();
      expect(limiter.hit).not.toHaveBeenCalled();   // invalid traffic is cheap-rejected, doesn't touch the limiter
    });
  });
});
