// skip-line-customer-tip.vitest.spec.ts — customer-added tip for Skip-the-Line app payments (Jul 29, 2026).
// Pinned: the tip is validated by the tenant's EXISTING policy (validateCustomTip + maxTipPercent — no new rules),
// stored on the intent at start, and confirm charges bill + the STORED choice — the confirm body cannot change it.
// Declined and approved paths both record the combined tip (POS-set + customer-added).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SkipLineCheckoutService } from './skip-line-checkout.service';

const BILL = { ticketId: 'tk1', invoiceId: 'tk1', customerId: 'c1', subtotalCents: 8000, tipCents: 0, totalDueCents: 8650, paid: false, ticketStatus: 'ready' };

function harness(over: { maxTip?: number; approved?: boolean } = {}) {
  const intents: any[] = [];
  const repo: any = {
    resolveCustomerId: vi.fn().mockResolvedValue('c1'),
    getSettings: vi.fn().mockResolvedValue({ featureEnabled: true, allowCashToTechnician: true }),
    billForTicket: vi.fn().mockResolvedValue({ ...BILL }),
    maxTipPercent: vi.fn().mockResolvedValue(over.maxTip ?? 50),
    createIntent: vi.fn().mockImplementation(async (_c: any, i: any) => { const row = { id: `i${intents.length + 1}`, ticket_id: i.ticketId, amount_cents: i.amountCents, customer_tip_cents: i.customerTipCents ?? 0 }; intents.push(row); return row; }),
    getIntent: vi.fn().mockImplementation(async (_c: any, id: string) => intents.find((x) => x.id === id) ?? null),
    setIntentStatus: vi.fn(),
    savedCardToken: vi.fn().mockResolvedValue(null),
    recordDeclinedPayment: vi.fn().mockResolvedValue({ paymentId: 'pd' }),
    recordPaymentAndCloseTicket: vi.fn().mockResolvedValue({ paymentId: 'pp' }),
    audit: vi.fn(),
  };
  process.env.PAYMENTS_SANDBOX = '1';
  const svc = new SkipLineCheckoutService(repo);
  return { svc, repo, intents };
}

const ctx: any = { tenantId: 't1', branchId: 'b1', userId: 'u1' };

beforeEach(() => { process.env.PAYMENTS_SANDBOX = '1'; });

describe('skip-line customer tip', () => {
  it('start stores the validated tip on the intent and prices it into the amount', async () => {
    const { svc, repo } = harness();
    const r = await svc.startAppPayment(ctx, 'tk1', { method: 'card', tipCents: 1000 });
    expect(r.amountCents).toBe(9650);
    expect(r.tipCents).toBe(1000);
    expect(repo.createIntent.mock.calls[0][1].customerTipCents).toBe(1000);
  });

  it('a tip over the tenant maxTipPercent is REJECTED by the canonical validator', async () => {
    const { svc } = harness({ maxTip: 10 });                       // 10% of $80 subtotal = $8 cap
    await expect(svc.startAppPayment(ctx, 'tk1', { method: 'card', tipCents: 900 })).rejects.toThrow(/Tip rejected/i);
  });

  it('junk and negative tips are rejected; absent/zero means no tip', async () => {
    const { svc } = harness();
    await expect(svc.startAppPayment(ctx, 'tk1', { method: 'card', tipCents: 12.5 })).rejects.toThrow(/whole number/i);
    await expect(svc.startAppPayment(ctx, 'tk1', { method: 'card', tipCents: -5 })).rejects.toThrow(/whole number/i);
    const r = await svc.startAppPayment(ctx, 'tk1', { method: 'card' });
    expect(r.tipCents).toBe(0);
    expect(r.amountCents).toBe(8650);
  });

  it('confirm charges bill + the STORED tip and IGNORES a different tip in the confirm body (tamper-proof)', async () => {
    const { svc, repo } = harness();
    const start = await svc.startAppPayment(ctx, 'tk1', { method: 'card', tipCents: 1000 });
    await svc.confirmAppPayment(ctx, 'tk1', { intentId: start.intentId, method: 'card', token: 'tok_1', expiry: '1230', tipCents: 99999 });
    const rec = repo.recordPaymentAndCloseTicket.mock.calls[0];
    expect(rec[3]).toBe(9650);                                     // amount = bill + stored tip, not body tip
    expect(rec[4]).toBe(1000);                                     // combined tip = POS 0 + customer 1000
  });

  it('a declined charge records the combined tip too', async () => {
    const { svc, repo } = harness();
    const start = await svc.startAppPayment(ctx, 'tk1', { method: 'card', tipCents: 500 });
    (svc as any).resolveProcessor = () => ({ processor: { name: 'sbx', authorizeAndCapture: async () => ({ approved: false, retref: 'r1' }) }, sandbox: true });
    await svc.confirmAppPayment(ctx, 'tk1', { intentId: start.intentId, method: 'card', token: 'tok_1', expiry: '1230' }).catch(() => {});
    expect(repo.recordDeclinedPayment.mock.calls[0][4]).toBe(500);
  });

  it('POS-set tip and customer tip COMBINE on the payment row', async () => {
    const { svc, repo } = harness();
    repo.billForTicket.mockResolvedValue({ ...BILL, tipCents: 300, totalDueCents: 8950 });
    const start = await svc.startAppPayment(ctx, 'tk1', { method: 'card', tipCents: 700 });
    await svc.confirmAppPayment(ctx, 'tk1', { intentId: start.intentId, method: 'card', token: 'tok_1', expiry: '1230' });
    expect(repo.recordPaymentAndCloseTicket.mock.calls[0][4]).toBe(1000);
    expect(repo.recordPaymentAndCloseTicket.mock.calls[0][3]).toBe(9650);
  });
});
