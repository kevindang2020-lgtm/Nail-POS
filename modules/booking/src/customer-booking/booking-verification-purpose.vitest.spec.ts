// booking-verification-purpose.vitest.spec.ts — pins §17 purpose threading through the shared choke point
// (Jul 29, 2026, sms-packages P2b). The phone-change port sends through THIS service; without the purpose field,
// its traffic would ledger as BOOKING_VERIFICATION and §17's "see exactly where SMS money is being spent" breaks.
// Two pins: absent purpose defaults to BOOKING_VERIFICATION; a caller-supplied purpose reaches BOTH the precheck
// and the ledger record untouched. Also pins the invariant that a record failure never breaks code delivery.
import { describe, it, expect } from 'vitest';
import { BookingVerificationService, type VerificationStore, type VerificationCtx } from './booking-verification.service';
import type { TenantCredentialResolver, VerificationProvider } from './booking-verification-provider';

const CREDS = { accountSid: 'ACtenant', authToken: 'tok', verifyServiceSid: 'VAtenant', fromNumber: '+15550000000' } as any;

const resolver = (): TenantCredentialResolver => ({
  async resolve() { return { status: 'configured' as const, credentials: CREDS, kind: 'twilio_verify' as any }; },
});
const verifyProvider = (): VerificationProvider => ({
  kind: 'twilio_verify',
  async send() { return { ok: true, providerVerificationSid: 'VE_purpose_1' }; },
  async check() { return { ok: true }; },
} as any);
function store(): VerificationStore {
  const rows: any = { session: null };
  return {
    async findSession() { return rows.session; },
    async createSession(input: any) { rows.session = { id: 'vs1', ...input, attempts: 0, consumed: false, resendCount: 0, lastSentAt: Date.now() }; return { id: 'vs1' }; },
    async markSent(_id: string, at: number) { if (rows.session) rows.session.lastSentAt = at; },
    async reserveAttempt() { return 1; }, async markVerified() {}, async markFailed() {}, async recordVerifiedPhone() {},
  } as any;
}

function captureEntitlement() {
  const calls: { precheck: string[]; record: string[] } = { precheck: [], record: [] };
  const ent = {
    async precheck(_t: string, p: string) { calls.precheck.push(p); return { allowed: true }; },
    async recordSubmission(_t: string, p: string, _i: Record<string, unknown>) { calls.record.push(p); return {}; },
  };
  return { ent, calls };
}

const BASE: VerificationCtx = { tenantId: 't1', branchId: '22222222-2222-2222-2222-222222222222', channel: 'online', bookingSessionId: 'bs-p1', customerId: 'c1' };

describe('§17 purpose threading through the verification choke point', () => {
  it('no purpose on ctx → both entitlement calls see BOOKING_VERIFICATION', async () => {
    const { ent, calls } = captureEntitlement();
    const svc = new BookingVerificationService(resolver(), { twilio_verify: verifyProvider() }, store(), undefined, ent as any);
    await svc.send(BASE, '+16095551212');
    expect(calls.precheck).toEqual(['BOOKING_VERIFICATION']);
    expect(calls.record).toEqual(['BOOKING_VERIFICATION']);
  });

  it('ctx.purpose = CUSTOMER_PHONE_CHANGE (what the phone port passes) reaches precheck AND the ledger record', async () => {
    const { ent, calls } = captureEntitlement();
    const svc = new BookingVerificationService(resolver(), { twilio_verify: verifyProvider() }, store(), undefined, ent as any);
    await svc.send({ ...BASE, bookingSessionId: 'bs-p2', purpose: 'CUSTOMER_PHONE_CHANGE' }, '+16095551213');
    expect(calls.precheck).toEqual(['CUSTOMER_PHONE_CHANGE']);
    expect(calls.record).toEqual(['CUSTOMER_PHONE_CHANGE']);
  });

  it('a throwing recordSubmission never breaks code delivery (billing is subordinate to the send)', async () => {
    const ent = { async precheck() { return { allowed: true }; }, async recordSubmission() { throw new Error('billing db down'); } };
    const svc = new BookingVerificationService(resolver(), { twilio_verify: verifyProvider() }, store(), undefined, ent as any);
    const out = await svc.send({ ...BASE, bookingSessionId: 'bs-p3' }, '+16095551214');
    expect(out.status).toBe('code_sent');
  });
});
