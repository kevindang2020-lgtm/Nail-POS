// customer-sms-messenger.vitest.spec — the customer app's texts are the SALON's texts.
// BUILD_PLAN Phase 2: gift-card claim links go through the tenant messenger (the salon's number, ledger, events).
// BUILD_PLAN Phase 3: "verify my phone number" is no longer an OTP implemented here — it is delegated to the canonical
// phone service (the salon's Twilio, the one activation path, customer.phone_verified).
import { describe, it, expect } from 'vitest';
import type { TenantMessenger, TenantSmsRequest } from '@aipowersalon/notifications';
import { CustomerService } from './customer.service';

const ctx: any = { tenantId: '11111111-1111-4111-8111-111111111111', branchId: '22222222-2222-4222-8222-222222222222', userId: 'u1', role: 'CUSTOMER', permissions: [] };
const noEnv: any = { send: async () => { throw new Error('the platform env sender must not be used'); } };

describe('verify my phone number → the ONE phone route family (Phase 4)', () => {
  it('the customer service no longer carries its own "verify my phone" (the duplicate /customer/verify/phone is gone)', () => {
    const svc: any = new CustomerService({ resolveCustomerId: async () => 'c1' } as any, noEnv);
    expect(svc.requestPhoneVerification).toBeUndefined();
    expect(svc.confirmPhoneVerification).toBeUndefined();
  });
});

describe('gift-card claim links go through the tenant messenger', () => {
  it('sent as the salon, purpose=notification, and recorded as sent', async () => {
    const prev = process.env.PUBLIC_CUSTOMER_BASE_URL; process.env.PUBLIC_CUSTOMER_BASE_URL = 'https://app.example.test';
    try {
      const calls: TenantSmsRequest[] = []; const deliveries: any[] = [];
      const messenger: TenantMessenger = { async sendSms(r) { calls.push(r); return { sent: true, status: 'sent', providerId: 'SM1' }; } };
      const repo: any = {
        resolveCustomerId: async () => 'c1',
        giftCardForTransfer: async () => ({ id: 'g1', status: 'active', balanceCents: 2500 }),
        createGiftCardClaim: async () => ({ senderName: 'Ana' }),
        recordGiftCardDelivery: async (_c: any, d: any) => { deliveries.push(d); },
      };
      const svc = new CustomerService(repo, noEnv, undefined, undefined, messenger);
      const r = await svc.sendGiftCard(ctx, 'g1', { phone: '(856) 555-0100' });
      expect(r.delivery).toEqual({ channel: 'sms', status: 'sent' });
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ tenantId: ctx.tenantId, purpose: 'notification' });
      expect(calls[0].body).toContain('https://app.example.test/gift-cards/claim?token=');
      expect(deliveries[0]).toMatchObject({ channel: 'sms', status: 'sent', providerMessageId: 'SM1' });
    } finally { if (prev === undefined) delete process.env.PUBLIC_CUSTOMER_BASE_URL; else process.env.PUBLIC_CUSTOMER_BASE_URL = prev; }
  });
});
