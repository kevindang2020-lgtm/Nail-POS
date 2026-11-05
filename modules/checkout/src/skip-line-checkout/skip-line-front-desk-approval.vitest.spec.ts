// skip-line-front-desk-approval.vitest.spec — Kevin's decision: "require front desk approval" governs the ONE
// path where a customer settles without the front desk, which is cash-to-technician.
//
// Card payments are started BY the front desk (sendAppPayment), so they are approved by construction and stay
// available. Before this change the setting was stored, displayed and editable, and read by nothing.
import { describe, it, expect } from 'vitest';
import { SkipLineCheckoutService } from './skip-line-checkout.service';
import { DEFAULT_SKIP_LINE_SETTINGS } from './skip-line-checkout.dto';

const CUST = 'cust-1';
const ctx = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'CUSTOMER', permissions: [] } as never;

function harness(requireFrontDeskApproval: boolean) {
  const created: unknown[] = [];
  const repo = {
    resolveCustomerId: async () => CUST,
    getSettings: async () => ({ ...DEFAULT_SKIP_LINE_SETTINGS, allowCashToTechnician: true, requireFrontDeskApproval }),
    activeBillForCustomer: async () => ({ ticketId: 'tk1', customerId: CUST, paid: false, totalDueCents: 4500 }),
    billForTicket: async () => ({ ticketId: 'tk1', customerId: CUST, paid: false, totalDueCents: 4500, technicianId: 'tech1', technicianName: 'Mia', customerName: 'Ada' }),
    createIntent: async (_c: unknown, i: unknown) => { created.push(i); return { id: 'intent-1' }; },
    createCashConfirmation: async () => ({ id: 'conf-1' }),
    audit: async () => undefined,
  };
  return { created, svc: new SkipLineCheckoutService(repo as never) };
}

describe('approval OFF — unchanged behaviour', () => {
  it('cash-to-technician is offered', async () => {
    const { svc } = harness(false);
    expect((await svc.customerActiveBill(ctx)).enabledMethods).toContain('cash_to_technician');
  });

  it('and the customer can select it', async () => {
    const { svc, created } = harness(false);
    await svc.payCashToTech(ctx, 'tk1');
    expect(created).toHaveLength(1);
  });
});

describe('approval ON — the customer cannot close their own ticket', () => {
  it('cash-to-technician is NOT offered on the bill', async () => {
    const { svc } = harness(true);
    expect((await svc.customerActiveBill(ctx)).enabledMethods).not.toContain('cash_to_technician');
  });

  it('card methods remain — the front desk starts those, so they are approved by construction', async () => {
    const { svc } = harness(true);
    expect((await svc.customerActiveBill(ctx)).enabledMethods).toContain('card');
  });

  it('SERVER-SIDE: selecting cash anyway is REFUSED, not just hidden', async () => {
    const { svc } = harness(true);
    await expect(svc.payCashToTech(ctx, 'tk1')).rejects.toMatchObject({ code: 'front_desk_approval_required' });
  });

  it('…and the refusal happens BEFORE any payment intent is created', async () => {
    const { svc, created } = harness(true);
    await svc.payCashToTech(ctx, 'tk1').catch(() => undefined);
    expect(created).toHaveLength(0);
  });
});
