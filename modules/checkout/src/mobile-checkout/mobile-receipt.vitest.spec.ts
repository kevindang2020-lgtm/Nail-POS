import { describe, it, expect, vi } from 'vitest';
import { MobileCheckoutService } from './mobile-checkout.service';
import type { Ctx } from '@aipowersalon/permissions';

const ctx: Ctx = { tenantId: 'T1', branchId: 'B1', userId: 'u_owner', role: 'OWNER', permissions: ['pos.receipts.send'] };

function make() {
  const checkout = {
    receiptSms: vi.fn().mockResolvedValue({ channel: 'sms', configured: false, disabledReason: 'SMS receipts are not configured yet.' }),
    receiptEmail: vi.fn().mockResolvedValue({ channel: 'email', configured: true, delivery: 'sent', receiptNumber: 'R1' }),
    receiptApp: vi.fn().mockResolvedValue({ channel: 'app', configured: true, delivery: 'saved', receiptNumber: 'R2' }),
  };
  const svc = new MobileCheckoutService(undefined as any, undefined as any, checkout as any, undefined as any, undefined as any);
  return { svc, checkout };
}

describe('MobileCheckoutService.sendReceipt (delegates to the canonical receipt system)', () => {
  it('routes each channel to the matching canonical method', async () => {
    const { svc, checkout } = make();
    await svc.sendReceipt(ctx, 'tk1', 'sms');
    await svc.sendReceipt(ctx, 'tk1', 'email');
    await svc.sendReceipt(ctx, 'tk1', 'app');
    expect(checkout.receiptSms).toHaveBeenCalledWith(ctx, 'tk1');
    expect(checkout.receiptEmail).toHaveBeenCalledWith(ctx, 'tk1');
    expect(checkout.receiptApp).toHaveBeenCalledWith(ctx, 'tk1');
  });

  it('passes through the honest unconfigured result rather than faking a send', async () => {
    const { svc } = make();
    const res: any = await svc.sendReceipt(ctx, 'tk1', 'sms');
    expect(res.configured).toBe(false);
    expect(res.disabledReason).toMatch(/not configured/i);
  });
});
