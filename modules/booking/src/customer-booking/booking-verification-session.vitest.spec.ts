// booking-verification-session.vitest.spec.ts — Constitution 3 Step 10c at the route: the verification routes accept only
// the booking-session token they issued, for the same salon and customer.
import { describe, it, expect } from 'vitest';
import { BookingVerificationController } from './booking-verification.controller';

const seen: string[] = [];
const svc: any = {
  send: async (ctx: any) => { seen.push('send:' + ctx.bookingSessionId); return { status: 'code_sent', maskedPhone: '***4567', message: 'sent' }; },
  check: async (ctx: any) => { seen.push('check:' + ctx.bookingSessionId + '@' + ctx.branchId); return { status: 'phone_verified', message: 'ok' }; },
  // Phase 4 (live proof): the code is for the location the 428 opened the session at — a customer session has none
  sessionBranch: async () => 'branch-of-the-booking',
};
// Phase 4: the customer is resolved from the signed-in USER (customers.user_id), and the number is theirs — the body's
// phone is never used. Users u1/u2 are customers c1/c2.
const sent: string[] = [];
const phones: any = { phoneFor: async (_t: string, customerId: string) => (customerId === 'c1' ? '+18565550101' : customerId === 'c2' ? '+18565550102' : null) };
const customers: any = { resolveCustomerId: async ({ userId }: any) => (userId === 'u1' ? 'c1' : userId === 'u2' ? 'c2' : null) };
svc.send = async (ctx: any, phone: string) => { seen.push('send:' + ctx.bookingSessionId); sent.push(`${ctx.customerId}:${phone}`); return { status: 'code_sent', maskedPhone: '***4567', message: 'sent' }; };
const ctl = new BookingVerificationController(svc, {} as any, undefined, undefined, phones, customers);
const req = (userId: string, tenantId = 't1') => ({ ctx: { tenantId, branchId: 'b1', userId }, headers: {}, ip: '10.0.0.1' });

describe('verification routes and the booking session', () => {
  it('send issues a signed token (never echoes a client-chosen id); check with that token reaches the same session', async () => {
    seen.length = 0;
    const out: any = await ctl.send(req('u1') as any, { phone: '+18565550101', bookingSessionId: 'victim-session-id' });
    expect(out.bookingSessionId.startsWith('bs~')).toBe(true);
    const sid = seen[0].slice('send:'.length);
    expect(sid).not.toBe('victim-session-id');                        // a client-chosen id is ignored
    await ctl.check(req('u1') as any, { bookingSessionId: out.bookingSessionId, phone: '+18565550101', code: '123456' });
    expect(seen[1]).toBe('check:' + sid + '@branch-of-the-booking');
  });
  it('check refuses a raw id, and the same token presented by ANOTHER customer or salon', async () => {
    const out: any = await ctl.send(req('u1') as any, { phone: '+18565550101' });
    await expect(ctl.check(req('u1') as any, { bookingSessionId: 'some-raw-id', phone: '+1', code: '1' })).rejects.toMatchObject({ status: 400 });
    await expect(ctl.check(req('u2') as any, { bookingSessionId: out.bookingSessionId, phone: '+1', code: '1' })).rejects.toMatchObject({ status: 400 });
    await expect(ctl.check(req('u1', 't2') as any, { bookingSessionId: out.bookingSessionId, phone: '+1', code: '1' })).rejects.toMatchObject({ status: 400 });
  });
  it('a resend with its own token keeps the same session (one session, one hold)', async () => {
    seen.length = 0;
    const first: any = await ctl.send(req('u1') as any, { phone: '+18565550101' });
    await ctl.send(req('u1') as any, { phone: '+18565550101', bookingSessionId: first.bookingSessionId });
    expect(seen[0]).toBe(seen[1]);
  });
});

describe('Phase 4: whose number is verified', () => {
  it('the signed-in customer\u2019s OWN number, never a phone in the body; the session records the customer, not the user', async () => {
    sent.length = 0;
    await ctl.send(req('u1') as any, { phone: '+19998887777' });
    expect(sent).toEqual(['c1:+18565550101']);
  });
  it('a user with no customer record at this salon is refused (403); one without a number is told to add it (400)', async () => {
    await expect(ctl.send(req('u9') as any, {})).rejects.toMatchObject({ status: 403 });
    const noPhone: any = { phoneFor: async () => null };
    const c2 = new BookingVerificationController(svc, {} as any, undefined, undefined, noPhone, customers);
    await expect(c2.send(req('u1') as any, {})).rejects.toMatchObject({ status: 400 });
  });
});

describe('Phase 4: the code is for the booking\'s location', () => {
  it('a signed-in customer (no branch on the session) checks at the branch the booking session belongs to', async () => {
    seen.length = 0;
    const r: any = await ctl.send({ ctx: { tenantId: 't1', userId: 'u1' }, headers: {} }, {});
    await ctl.check({ ctx: { tenantId: 't1', userId: 'u1' }, headers: {} }, { bookingSessionId: r.bookingSessionId, code: '123456' });
    expect(seen.find((x) => x.startsWith('check:'))).toMatch(/@branch-of-the-booking$/);
  });
});

