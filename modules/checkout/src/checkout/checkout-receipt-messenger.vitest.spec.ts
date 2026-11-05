// checkout-receipt-messenger.vitest.spec — BUILD_PLAN Phase 2 (Constitution 8 §79): an SMS receipt is a SALON's text.
// It used to go out on the platform's own Twilio number from a sender built from env — no salon number, no opt-out
// check, no notification ledger, no communication.sms_sent event, and a provider failure surfaced as a 500.
// With the tenant messenger present the receipt goes through it, carrying the salon, the customer and the purpose.
import { describe, it, expect } from 'vitest';
import type { TenantMessenger, TenantSmsRequest } from '@aipowersalon/notifications';
import { CheckoutService } from './checkout.service';

const ctx: any = { tenantId: '11111111-1111-4111-8111-111111111111', branchId: '22222222-2222-4222-8222-222222222222', userId: 'u1', role: 'OWNER', permissions: ['pos.receipts.send'] };
const repo: any = {
  ticket: async () => ({ id: 'tk1', customerId: 'c1', customerPhone: '+18565550100', customerEmail: null, method: 'cash' }),
  totalsFor: async () => ({ totalDueCents: 5000, tipCents: 0, surchargeCents: 0 }),
  paidBreakdown: async () => ({ totalCents: 5000, surchargeCents: 0 }),
  recordReceipt: async () => ({ receiptNumber: 'R-1' }),
};
const svcWith = (messenger: TenantMessenger, envSms: any = { send: async () => { throw new Error('the platform env sender must not be used'); } }) =>
  new CheckoutService(repo, envSms, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, messenger);

describe('SMS receipts go through the tenant messenger', () => {
  it('sends as the salon: tenant, branch, customer and purpose=receipt', async () => {
    const calls: TenantSmsRequest[] = [];
    const svc = svcWith({ async sendSms(r) { calls.push(r); return { sent: true, status: 'sent', providerId: 'SM1' }; } });
    const out = await (svc as any).sendOne(ctx, 'tk1', 'sms');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ tenantId: ctx.tenantId, branchId: ctx.branchId, customerId: 'c1', to: '+18565550100', purpose: 'receipt' });
    expect(calls[0].body).toContain('$50.00');
    expect(out).toMatchObject({ configured: true, delivery: 'sent', providerRef: 'SM1', receiptNumber: 'R-1' });
  });
  it('a blocked (opted-out) or failed text is reported as such — never "sent"', async () => {
    const blocked = await (svcWith({ async sendSms() { return { sent: false, status: 'blocked', reason: 'opted_out' }; } }) as any).sendOne(ctx, 'tk1', 'sms');
    expect(blocked).toMatchObject({ configured: true, delivery: 'blocked', reason: 'opted_out' });
    const failed = await (svcWith({ async sendSms() { return { sent: false, status: 'failed', reason: 'provider_unavailable' }; } }) as any).sendOne(ctx, 'tk1', 'sms');
    expect(failed).toMatchObject({ configured: true, delivery: 'failed', reason: 'provider_unavailable' });
  });
  it('a simulated provider (no SMS configured) says so', async () => {
    const out = await (svcWith({ async sendSms() { return { sent: true, status: 'sent', providerId: 'SM-MOCK-1', simulated: true }; } }) as any).sendOne(ctx, 'tk1', 'sms');
    expect(out.delivery).toBe('simulated');
  });
});

describe('the customer display\'s receipt choice reports the messenger\'s outcome', () => {
  // Found by the live devices proof (Oct 7 2026): through the messenger a failed send RETURNS { delivery: 'failed' }
  // instead of throwing, and the display mapping called everything not simulated "sent" — the customer would read
  // "Receipt texted" for a text that never left.
  const scope = { tenantId: ctx.tenantId, branchId: ctx.branchId };
  it('failed → failed, blocked → failed, simulated → unavailable, sent → sent', async () => {
    const out = async (r: any) => (svcWith({ async sendSms() { return r; } }) as any).sendReceiptForDisplay(scope, 'tk1', 'sms');
    expect(await out({ sent: false, status: 'failed', reason: 'provider_unavailable' })).toBe('failed');
    expect(await out({ sent: false, status: 'blocked', reason: 'opted_out' })).toBe('failed');
    expect(await out({ sent: true, status: 'sent', providerId: 'SM-MOCK-1', simulated: true })).toBe('unavailable');
    expect(await out({ sent: true, status: 'sent', providerId: 'SM1' })).toBe('sent');
  });
});

describe('P-11 (wave 4 pilot): no texting provider in production', () => {
  it('the messenger\'s not_configured answer is a channel that is not configured — never "sent", the display offers it as unavailable', async () => {
    const nc = { sent: false, status: 'blocked', reason: 'not_configured' } as const;
    const out = await (svcWith({ async sendSms() { return nc; } }) as any).sendOne(ctx, 'tk1', 'sms');
    expect(out).toMatchObject({ configured: false, disabledReason: 'SMS receipts are not configured yet.' });
    expect(await (svcWith({ async sendSms() { return nc; } }) as any).sendReceiptForDisplay({ tenantId: ctx.tenantId, branchId: ctx.branchId }, 'tk1', 'sms')).toBe('unavailable');
  });
  it('a not-configured env sender reports both receipt channels as not live', async () => {
    const { NotConfiguredSmsSender, NotConfiguredEmailSender } = await import('@aipowersalon/notifications');
    const svc = new CheckoutService(repo, new NotConfiguredSmsSender() as any, new NotConfiguredEmailSender() as any);
    expect(svc.receiptChannelsLive()).toEqual({ sms: false, email: false });
  });
});
