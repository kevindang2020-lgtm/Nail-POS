// ai-booking-public-verification.vitest.spec.ts — BUILD_PLAN Phase 4: the guest on a signed booking link proves the
// phone on the booking. The routes are scoped by the link (tenant/branch from the token) and by the booking session a
// "verify first" refusal sealed for THAT link: a session from another link or salon, a raw id, or none at all opens to
// nothing — so the routes cannot be used to text arbitrary numbers on a salon's account.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RemoteBookingAdmission } from '@aipowersalon/booking';
import { AiBookingPublicController } from './ai-booking-public.controller';
import { signBookingContext } from './ai-booking-signed-context';
import { AiBookingPublicResolver } from './ai-booking-public.resolver';

const SECRET = 'pv-secret-0123456789abcdef';
const link = (jti: string, tenantId = 'ten_A') => signBookingContext({ tenantId, branchId: 'br_1', source: 'ONLINE_BOOKING' }, { secret: SECRET, jti });
const admission = new RemoteBookingAdmission(null as any, null as any);   // seal/open only
const SID = '11111111-2222-4333-8444-555555555555';
const req = { headers: { 'accept-language': 'es-US' }, ip: '203.0.113.9', socket: { remoteAddress: '203.0.113.9' } };

let verification: any;
const mk = () => new AiBookingPublicController({} as any, {} as any, new AiBookingPublicResolver(), { enabled: false } as any, { isRevoked: async () => false } as any, verification, admission);

beforeEach(() => {
  process.env.AI_BOOKING_LINK_SECRET = SECRET;
  verification = {
    send: vi.fn(async () => ({ status: 'code_sent', maskedPhone: '••••0101', message: 'sent' })),
    check: vi.fn(async (_c: any, _p: string, code: string) => (code === '424242' ? { status: 'phone_verified', message: 'ok' } : { status: 'incorrect_code', message: 'That code is incorrect.' })),
  };
});

describe('public link: send and check the code', () => {
  it('sends for the session sealed for THIS link, on the link’s tenant/branch, channel online, with the guest’s locale', async () => {
    const r = await mk().sendCode(req, { token: link('L1'), bookingSessionId: admission.seal('ten_A', 'link:L1', SID), customerPhone: '+18565550101', deviceId: 'dev-9' });
    expect(r).toMatchObject({ status: 'code_sent', maskedPhone: '••••0101' });
    expect(verification.send.mock.calls[0][0]).toMatchObject({ tenantId: 'ten_A', branchId: 'br_1', channel: 'online', bookingSessionId: SID, deviceId: 'dev-9', locale: 'es-US' });
  });

  it('a session sealed for ANOTHER link, another salon, a raw id, or none → refused, nothing sent', async () => {
    for (const bookingSessionId of [admission.seal('ten_A', 'link:OTHER', SID), admission.seal('ten_B', 'link:L1', SID), SID, undefined]) {
      await expect(mk().sendCode(req, { token: link('L1'), bookingSessionId, customerPhone: '+18565550101' })).rejects.toMatchObject({ status: 400 });
    }
    expect(verification.send).not.toHaveBeenCalled();
  });

  it('a forged link → 401, nothing sent', async () => {
    await expect(mk().sendCode(req, { token: 'forged.token', bookingSessionId: admission.seal('ten_A', 'link:L1', SID), customerPhone: '+18565550101' })).rejects.toMatchObject({ status: 401 });
    expect(verification.send).not.toHaveBeenCalled();
  });

  it('check: the right code → phone_verified; a wrong one → 400 with the service’s message', async () => {
    const body = { token: link('L1'), bookingSessionId: admission.seal('ten_A', 'link:L1', SID), customerPhone: '+18565550101' };
    expect(await mk().checkCode(req, { ...body, code: '424242' })).toMatchObject({ status: 'phone_verified' });
    await expect(mk().checkCode(req, { ...body, code: '000000' })).rejects.toMatchObject({ status: 400, response: { message: 'That code is incorrect.' } });
  });

  it('provider limits map to honest statuses (429 cooldown, 503 not configured)', async () => {
    const body = { token: link('L1'), bookingSessionId: admission.seal('ten_A', 'link:L1', SID), customerPhone: '+18565550101' };
    verification.send = vi.fn(async () => ({ status: 'rate_limited', retryAfterSeconds: 30, message: 'wait' }));
    await expect(mk().sendCode(req, body)).rejects.toMatchObject({ status: 429, response: { retryAfterSeconds: 30 } });
    verification.send = vi.fn(async () => ({ status: 'twilio_not_configured', message: 'call the salon' }));
    await expect(mk().sendCode(req, body)).rejects.toMatchObject({ status: 503 });
  });

  it('module not deployed → 503, never a crash', async () => {
    const c = new AiBookingPublicController({} as any, {} as any, new AiBookingPublicResolver(), { enabled: false } as any, { isRevoked: async () => false } as any);
    await expect(c.sendCode(req, { token: link('L1'), bookingSessionId: 'x', customerPhone: '+18565550101' })).rejects.toMatchObject({ status: 503 });
  });
});

describe('Phase 4: the page lists services from the LINK (not public discovery)', () => {
  it('returns the engine catalog for the link’s salon, narrowed to a partner link’s allowed services', async () => {
    const catalog = [{ serviceId: 's1', name: 'Gel', durationMinutes: 45, priceCents: 4500 }, { serviceId: 's2', name: 'Acrylic', durationMinutes: 60, priceCents: 6000 }];
    const svcFake = { services: vi.fn(async () => catalog) };
    const c = new AiBookingPublicController(svcFake as any, {} as any, new AiBookingPublicResolver(), { enabled: false } as any, { isRevoked: async () => false } as any);
    expect((await c.services({ token: link('L1') })).services.map((s: any) => s.id)).toEqual(['s1', 's2']);
    const partner = signBookingContext({ tenantId: 'ten_A', branchId: 'br_1', source: 'PARTNER_BOOKING_LINK', allowedServiceIds: ['s2'], partnerId: 'p1' }, { secret: SECRET });
    expect((await c.services({ token: partner })).services).toEqual([{ id: 's2', name: 'Acrylic', durationMinutes: 60, priceCents: 6000 }]);
    expect(svcFake.services.mock.calls[0][0]).toMatchObject({ tenantId: 'ten_A', branchId: 'br_1' });
    await expect(c.services({ token: 'forged.token' })).rejects.toMatchObject({ status: 401 });
  });
});
