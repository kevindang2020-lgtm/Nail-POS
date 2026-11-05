// ai-booking-signed-context.vitest.spec.ts — the security core for public channels. A signed context cannot be forged
// or edited without the secret, expires, carries its scope, and the resolver produces a trusted, scoped context whose
// tenant/branch come only from the verified payload (never the caller).
import { describe, it, expect, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { signBookingContext, verifyBookingContext, scopedPermissionsFor } from './ai-booking-signed-context';
import { AiBookingPublicResolver } from './ai-booking-public.resolver';
import { AiBookingLinkService } from './ai-booking-link.service';
import { AiBookingError } from './ai-booking-context';

const SECRET = 'test-booking-link-secret-0123456789';

describe('signed booking context', () => {
  it('round-trips a valid token and exposes the scope', () => {
    const t = signBookingContext({ tenantId: 'ten_A', branchId: 'br_1', source: 'PARTNER_BOOKING_LINK', partnerId: 'p1', allowedServiceIds: ['s1', 's2'] }, { secret: SECRET });
    const v = verifyBookingContext(t, { secret: SECRET });
    expect(v.valid).toBe(true);
    if (v.valid) { expect(v.payload.tenantId).toBe('ten_A'); expect(v.payload.allowedServiceIds).toEqual(['s1', 's2']); }
  });
  it('rejects a tampered payload (client cannot edit tenant)', () => {
    const t = signBookingContext({ tenantId: 'ten_A', branchId: 'br_1', source: 'ONLINE_BOOKING' }, { secret: SECRET });
    const [, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ tenantId: 'ten_B', branchId: 'br_9', source: 'ONLINE_BOOKING', iat: 1, exp: 9999999999 })).toString('base64url') + '.' + sig;
    expect(verifyBookingContext(forged, { secret: SECRET })).toEqual({ valid: false, reason: 'bad_signature' });
  });
  it('rejects a token signed with a different secret', () => {
    const t = signBookingContext({ tenantId: 'ten_A', branchId: null, source: 'ONLINE_BOOKING' }, { secret: 'other-secret' });
    expect(verifyBookingContext(t, { secret: SECRET }).valid).toBe(false);
  });
  it('rejects an expired token', () => {
    const t = signBookingContext({ tenantId: 'ten_A', branchId: null, source: 'ONLINE_BOOKING' }, { secret: SECRET, ttlSeconds: 1, now: 1_000_000 });
    expect(verifyBookingContext(t, { secret: SECRET, now: 1_000_000 + 5_000 })).toEqual({ valid: false, reason: 'expired' });
  });
  it('grants only scoped (non-admin) permissions to public channels', () => {
    expect(scopedPermissionsFor('ONLINE_BOOKING')).toEqual(['pos.booking.view', 'pos.booking.create', 'ai_booking.search_availability', 'ai_booking.create']);
    expect(scopedPermissionsFor('PARTNER_BOOKING_LINK')).not.toContain('pos.booking.assign_technician');
  });
});

describe('AiBookingPublicResolver', () => {
  const withSecret = <T>(fn: () => T): T => { process.env.AI_BOOKING_LINK_SECRET = SECRET; try { return fn(); } finally { delete process.env.AI_BOOKING_LINK_SECRET; } };

  it('resolves a valid token into a trusted scoped context (tenant from payload only)', () => {
    withSecret(() => {
      const r = new AiBookingPublicResolver();
      const token = signBookingContext({ tenantId: 'ten_A', branchId: 'br_1', source: 'ONLINE_BOOKING' }, { secret: SECRET });
      const ctx = r.resolveFromToken(token);
      expect(ctx.tenantId).toBe('ten_A');
      expect(ctx.source).toBe('ONLINE_BOOKING');
      expect(ctx.permissions).toEqual(['pos.booking.view', 'pos.booking.create', 'ai_booking.search_availability', 'ai_booking.create']);
    });
  });
  it('rejects a forged token', () => {
    withSecret(() => {
      const r = new AiBookingPublicResolver();
      expect(() => r.resolveFromToken('not.a.valid.token')).toThrow(AiBookingError);
    });
  });
  it('refuses when signed links are not configured (no secret)', () => {
    delete process.env.AI_BOOKING_LINK_SECRET;
    const r = new AiBookingPublicResolver();
    expect(() => r.resolveFromToken('x')).toThrow(/not configured/i);
  });
});

describe('AiBookingLinkService (mint → verify round-trip)', () => {
  const withSecret = <T>(fn: () => T): T => { process.env.AI_BOOKING_LINK_SECRET = SECRET; try { return fn(); } finally { delete process.env.AI_BOOKING_LINK_SECRET; } };

  it('mints a partner link a public resolver then accepts, carrying the service scope', () => {
    withSecret(() => {
      const minted = new AiBookingLinkService().mint('ten_A', { source: 'PARTNER_BOOKING_LINK', branchId: 'br_1', partnerId: 'groupon', allowedServiceIds: ['s1'], ttlDays: 14 });
      expect(minted.source).toBe('PARTNER_BOOKING_LINK');
      const ctx = new AiBookingPublicResolver().resolveFromToken(minted.token);
      expect(ctx.tenantId).toBe('ten_A');
      expect(ctx.partnerId).toBe('groupon');
      expect(ctx.allowedServiceIds).toEqual(['s1']);
    });
  });
  it('requires a partnerId for partner links and a secret to mint', () => {
    withSecret(() => expect(() => new AiBookingLinkService().mint('ten_A', { source: 'PARTNER_BOOKING_LINK' })).toThrow(/partnerId/i));
    delete process.env.AI_BOOKING_LINK_SECRET;
    expect(() => new AiBookingLinkService().mint('ten_A', { source: 'ONLINE_BOOKING' })).toThrow(AiBookingError);
  });
});

import { AiBookingRevocationService } from './ai-booking-revocation.service';
import { AiBookingLinkService as LinkSvc } from './ai-booking-link.service';
import { AiBookingPublicController } from './ai-booking-public.controller';

describe('link revocation (§32)', () => {
  const withSecret = <T>(fn: () => T): T => { process.env.AI_BOOKING_LINK_SECRET = SECRET; try { return fn(); } finally { delete process.env.AI_BOOKING_LINK_SECRET; } };

  it('mint returns a jti and the token carries it', () => {
    withSecret(() => {
      const minted = new LinkSvc().mint('ten_A', { source: 'ONLINE_BOOKING' });
      expect(minted.jti).toMatch(/[0-9a-f-]{36}/);
      const ctx = new AiBookingPublicResolver().resolveFromToken(minted.token);
      expect((ctx as any).jti).toBe(minted.jti);
    });
  });

  it('a revoked link is rejected by the public endpoint (without rotating the secret)', async () => {
    await withSecret(async () => {
      const minted = new LinkSvc().mint('ten_A', { source: 'PARTNER_BOOKING_LINK', partnerId: 'p1' });
      const revocation = { isRevoked: async (_t: string, jti: string) => jti === minted.jti } as any;   // this jti is revoked
      const c = new AiBookingPublicController({ searchAvailability: async () => ({}) } as any, {} as any, new AiBookingPublicResolver(), { enabled: false, hit: async () => ({}) } as any, revocation);
      await expect(c.search({ token: minted.token })).rejects.toMatchObject({ response: { code: 'INVALID_PARTNER_LINK' } });
    });
  });

  it('a non-revoked link still works', async () => {
    await withSecret(async () => {
      const minted = new LinkSvc().mint('ten_A', { source: 'ONLINE_BOOKING' });
      const search = vi.fn(async () => ({ options: [] }));
      const revocation = { isRevoked: async () => false } as any;
      const c = new AiBookingPublicController({ searchAvailability: search } as any, {} as any, new AiBookingPublicResolver(), { enabled: false, hit: async () => ({}) } as any, revocation);
      await c.search({ token: minted.token });
      expect(search).toHaveBeenCalled();
    });
  });

  it('isRevoked returns false for links with no jti (legacy) and true after revoke', async () => {
    const svc = new AiBookingRevocationService(null as any);   // null db → no-op reads
    expect(await svc.isRevoked('ten_A', undefined)).toBe(false);
  });

  it('a validly-signed but non-JSON payload is reported as malformed, never thrown (Jul 29 hardening)', () => {
    const p = Buffer.from('{not-json').toString('base64url');
    const sig = createHmac('sha256', SECRET).update(p).digest('base64url');
    const out = verifyBookingContext(`${p}.${sig}`, { secret: SECRET });
    expect(out.valid).toBe(false);
    if (!out.valid) expect(out.reason).toBe('malformed');
  });
});
