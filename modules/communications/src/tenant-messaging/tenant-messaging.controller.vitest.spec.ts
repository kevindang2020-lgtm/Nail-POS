// tenant-messaging.controller.vitest.spec.ts — Super Admin → a salon's texting (gap sweep, Oct 30 2026, Phone & Messaging
// guide §6.4): Super Admin buys a number through the SAME two-step purchase as the salon (quote → confirm with the
// single-use confirmation; a buy without one is refused), and a credential save keeps its coded refusal and forwards the
// operator's "save as unverified" choice (before: every refusal became VALIDATION_FAILED and the choice was dropped).
import { describe, it, expect, vi } from 'vitest';
import { HttpException } from '@nestjs/common';
import { TenantMessagingController } from './tenant-messaging.controller';
import { CredentialsInputError } from './tenant-messaging-credentials.service';
import { NumberPurchaseError } from './tenant-number.service';
import { withCode } from '@aipowersalon/api-contracts';

let unreachable = false;   // the next save meets an unreachable Twilio
const svc = { set: vi.fn(async (_u: string, t: string, _i: any) => {
  if (unreachable) { unreachable = false; throw withCode(new CredentialsInputError('Twilio could not be reached to check these credentials. Nothing was changed.'), 'MESSAGING_PROVIDER_UNREACHABLE', { canSaveUnverified: true }); }
  return { tenantId: t, status: 'configured' };
}), revealAccountSid: vi.fn(async (_u: string, _t: string, _b: string | null) => ({ accountSid: 'AC' + 'a'.repeat(32), branchId: null })) };
const numbers = {
  quote: vi.fn(async (_u: string, _t: string, pn: string) => ({ ok: true, confirmationToken: 'tok', phoneNumber: pn, price: { amount: '1.15', unit: 'USD' } })),
  confirmPurchase: vi.fn(async (_u: string, _t: string, pn: string, token: string) => {
    if (!token) throw withCode(new NumberPurchaseError('Review the number and its price, then confirm the purchase.'), 'NUMBER_PURCHASE_CONFIRMATION_REQUIRED');
    return { ok: true, number: pn };
  }),
  buyAndRegister: vi.fn(async () => ({ ok: true })),
};
const ctrl = new TenantMessagingController(svc as any, numbers as any, {} as any);
const req = { ctx: { userId: 'sa-1' } };
const refusal = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e instanceof HttpException ? { status: e.getStatus(), body: e.getResponse() as any } : e; } };

describe('Super Admin number purchase', () => {
  it('quote buys nothing; buy needs the confirmation and goes through confirmPurchase (never a direct buy)', async () => {
    const q: any = await ctrl.quoteNumber(req, 'ten_a', { phoneNumber: ' +18565550100 ' });
    expect(q).toMatchObject({ ok: true, confirmationToken: 'tok', price: { amount: '1.15' } });
    expect(numbers.quote).toHaveBeenCalledWith('sa-1', 'ten_a', '+18565550100');

    const r = await refusal(ctrl.buyNumber(req, 'ten_a', { phoneNumber: '+18565550100' }));
    expect(r).toMatchObject({ body: { code: 'NUMBER_PURCHASE_CONFIRMATION_REQUIRED' } });

    expect(await ctrl.buyNumber(req, 'ten_a', { phoneNumber: '+18565550100', confirmationToken: 'tok' })).toMatchObject({ ok: true, number: '+18565550100' });
    expect(numbers.confirmPurchase).toHaveBeenLastCalledWith('sa-1', 'ten_a', '+18565550100', 'tok');
    expect(numbers.buyAndRegister).not.toHaveBeenCalled();
  });
});

describe('Super Admin credential save', () => {
  it('forwards confirmUnverified only when it is exactly true', async () => {
    await ctrl.set(req, 'ten_a', { accountSid: 'AC1', fromNumber: '+18565550100', confirmUnverified: true });
    expect(svc.set.mock.calls.at(-1)?.[2]).toMatchObject({ confirmUnverified: true });
    await ctrl.set(req, 'ten_a', { accountSid: 'AC1', fromNumber: '+18565550100' });
    expect(svc.set.mock.calls.at(-1)?.[2]).toMatchObject({ confirmUnverified: false });
  });
  it('a coded refusal keeps its code and params (the screen offers "save anyway as unverified")', async () => {
    unreachable = true;
    const r: any = await refusal(ctrl.set(req, 'ten_a', { accountSid: 'AC1', fromNumber: '+18565550100' }));
    expect(r.body).toMatchObject({ code: 'MESSAGING_PROVIDER_UNREACHABLE', params: { canSaveUnverified: true } });
    expect(r.status).not.toBe(400);
  });
});

describe('Super Admin Account SID reveal (PM-02)', () => {
  it('goes through the audited reveal for the salon default, as the acting operator', async () => {
    expect(await ctrl.revealSid(req, 'ten_a', {})).toMatchObject({ accountSid: 'AC' + 'a'.repeat(32) });
    expect(svc.revealAccountSid).toHaveBeenLastCalledWith('sa-1', 'ten_a', null);
  });
});
