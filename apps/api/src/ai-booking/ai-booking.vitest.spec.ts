// ai-booking.vitest.spec.ts — the ai_booking foundation. Emphasis on the spec's non-negotiables: source validation,
// TRUSTED context (tenant/branch come only from the server, never the caller), bounded results, and reuse of the
// authoritative BookingService rather than a second engine.
import { describe, it, expect, vi } from 'vitest';
import { isAiBookingSource, domainSourceFor, requiresSignedContext } from './ai-booking-source';
import { resolveTrustedContext, AiBookingError } from './ai-booking-context';
import { AiBookingService } from './ai-booking.service';

describe('ai_booking source catalog', () => {
  it('validates the 7 sources and maps them onto existing appointment source values', () => {
    expect(isAiBookingSource('AI_PHONE_RECEPTIONIST')).toBe(true);
    expect(isAiBookingSource('NONSENSE')).toBe(false);
    expect(domainSourceFor('CUSTOMER_MOBILE_APP')).toBe('customer_app');
    expect(domainSourceFor('WALK_IN_CONVERSION')).toBe('walk_in');
    expect(requiresSignedContext('PARTNER_BOOKING_LINK')).toBe(true);
    expect(requiresSignedContext('FRONT_DESK_POS')).toBe(false);
  });
});

describe('resolveTrustedContext — tenant/branch isolation', () => {
  const server = { tenantId: 'ten_A', branchId: 'br_1', userId: 'u1', role: 'MANAGER', permissions: ['pos.booking.view'] };
  it('takes tenant/branch ONLY from the server context (a caller cannot inject another tenant)', () => {
    // A malicious caller may put tenantId:'ten_B' in the body — resolveTrustedContext never accepts it as an argument.
    const ctx = resolveTrustedContext(server, 'FRONT_DESK_POS');
    expect(ctx.tenantId).toBe('ten_A');       // server value, always
    expect(ctx.branchId).toBe('br_1');
    expect(ctx.source).toBe('FRONT_DESK_POS');
  });
  it('rejects an unknown/missing source', () => {
    expect(() => resolveTrustedContext(server, 'HACK')).toThrow(AiBookingError);
    expect(() => resolveTrustedContext(server, undefined)).toThrow(/source/i);
  });
  it('rejects a request with no authenticated context', () => {
    expect(() => resolveTrustedContext({ ...server, tenantId: '' } as any, 'FRONT_DESK_POS')).toThrow(/authenticated/i);
  });
  it('super-admin support mode requires an active support session', () => {
    expect(() => resolveTrustedContext(server, 'SUPER_ADMIN_SUPPORT_MODE')).toThrow(/support session/i);
    const ok = resolveTrustedContext({ ...server, supportSessionId: 'sess_1' }, 'SUPER_ADMIN_SUPPORT_MODE');
    expect(ok.supportSessionId).toBe('sess_1');
  });
  it('sanitizes a bad correlationId but keeps a valid one', () => {
    expect(resolveTrustedContext(server, 'ONLINE_BOOKING', 'has spaces!').correlationId).toMatch(/^aib_/);
    expect(resolveTrustedContext(server, 'ONLINE_BOOKING', 'sess-123_ok').correlationId).toBe('sess-123_ok');
  });
});

describe('AiBookingService — delegates + bounds', () => {
  const ctx = { tenantId: 'ten_A', branchId: 'br_1', userId: 'u1', role: 'MANAGER', permissions: ['pos.booking.view'], source: 'ONLINE_BOOKING' as const, correlationId: 'c1', supportSessionId: null };

  it('delegates to BookingService.availability with server-scoped context and bounds the result', async () => {
    const manyTechs = Array.from({ length: 12 }, (_, i) => ({ technicianId: 't' + i, name: 'Tech ' + i, slots: Array.from({ length: 20 }, (_, j) => `slot${j}`) }));
    const booking = { availability: vi.fn(async () => manyTechs) };
    const conversion = { record: vi.fn(async () => undefined) };
    const svc = new AiBookingService(booking as any, undefined, conversion as any);
    const res = await svc.searchAvailability(ctx, { date: '2026-07-11', serviceIds: ['s1'] });
    // delegated with the trusted tenant/branch, not anything caller-supplied
    expect(booking.availability.mock.calls[0][0]).toMatchObject({ tenantId: 'ten_A', branchId: 'br_1' });
    expect(res.options.length).toBe(8);                    // capped technicians
    expect(res.options[0].slots.length).toBe(12);          // capped slots
    expect(res.bounded).toBe(true);
    expect(res.domainSource).toBe('online');               // source stamped
    expect(conversion.record).toHaveBeenCalledWith(ctx, expect.objectContaining({ stage: 'AVAILABILITY_SEARCHED' }));
  });

  it('does not compute its own availability — a booking service failure surfaces (no fabricated slots)', async () => {
    const booking = { availability: vi.fn(async () => { throw new Error('engine down'); }) };
    const svc = new AiBookingService(booking as any, undefined, { record: vi.fn() } as any);
    await expect(svc.searchAvailability(ctx, {})).rejects.toThrow(/engine down/);
  });

  it('round 10 (AI Booking 03): qualified technicians come from the engine\'s ONE eligibility authority (services + working), bounded', async () => {
    const booking = { technicianPage: vi.fn(async () => ({ items: [{ technicianId: 't1', name: 'Anna', rosterNumber: 1 }, { technicianId: 't2', name: 'Bao', rosterNumber: 2 }], total: 30, page: 1, pageSize: 24 })) };
    const svc = new AiBookingService(booking as any, undefined, { record: vi.fn() } as any);
    const r = await svc.qualifiedTechnicians(ctx, { serviceIds: ['s1', 's2'], date: '2026-11-14' });
    expect(booking.technicianPage).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'ten_A', branchId: 'br_1' }), expect.objectContaining({ serviceIds: ['s1', 's2'], date: '2026-11-14', working: true, status: 'active', page: 1 }));
    expect(r.technicians).toEqual([{ technicianId: 't1', name: 'Anna' }, { technicianId: 't2', name: 'Bao' }]);   // no roster/contact extras
    expect(r).toMatchObject({ total: 30, bounded: true, correlationId: 'c1' });
  });
});

