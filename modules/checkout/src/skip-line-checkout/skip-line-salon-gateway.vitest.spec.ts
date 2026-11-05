// Skip-line card payments charge through the SALON's own gateway (the per-tenant resolver), never a server-wide
// processor — found while wiring the payment kill switch (Constitution 7 §34).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { SkipLineCheckoutService } from './skip-line-checkout.service';

const BILL = { ticketId: 'tk1', invoiceId: 'tk1', customerId: 'c1', subtotalCents: 8000, tipCents: 0, totalDueCents: 8650, paid: false, ticketStatus: 'ready' };
function repo() {
  const intents: any[] = [];
  return {
    resolveCustomerId: vi.fn().mockResolvedValue('c1'),
    getSettings: vi.fn().mockResolvedValue({ featureEnabled: true, allowCashToTechnician: true }),
    billForTicket: vi.fn().mockResolvedValue({ ...BILL }),
    maxTipPercent: vi.fn().mockResolvedValue(50),
    createIntent: vi.fn().mockImplementation(async (_c: any, i: any) => { const row = { id: `i${intents.length + 1}`, ticket_id: i.ticketId, amount_cents: i.amountCents, customer_tip_cents: i.customerTipCents ?? 0, status: i.status, gateway: i.gateway }; intents.push(row); return row; }),
    getIntent: vi.fn(), setIntentStatus: vi.fn(), savedCardToken: vi.fn().mockResolvedValue(null), audit: vi.fn(),
  } as any;
}
const ctx: any = { tenantId: 'salon-1', branchId: 'b1', userId: 'u1' };
const salonProcessor = { name: 'cardpointe-salon-1', authorizeAndCapture: vi.fn() } as any;
afterEach(() => { for (const k of ['PAYMENTS_SANDBOX', 'PAYMENTS_ALLOW_ENV_FALLBACK', 'CARDPOINTE_BASE_URL', 'CARDPOINTE_MERCHID', 'CARDPOINTE_USERNAME', 'CARDPOINTE_PASSWORD']) delete process.env[k]; });

describe('skip-line uses the salon gateway', () => {
  it("the salon's own processor is used, resolved for THAT tenant", async () => {
    const gw = { resolve: vi.fn().mockResolvedValue({ processor: salonProcessor }) };
    const r = await new SkipLineCheckoutService(repo(), undefined, gw).startAppPayment(ctx, 'tk1', { method: 'card' });
    expect(gw.resolve).toHaveBeenCalledWith('salon-1', 'b1');   // wave 3 §13: tenant + the customer's branch
    expect(r).toMatchObject({ configured: true, gateway: 'cardpointe-salon-1' });
  });
  it('a salon with no usable gateway (or a paused integration) is NOT charged through any server-wide processor', async () => {
    // a server-wide CardPointe processor IS configurable from the environment here — it must still not be used
    Object.assign(process.env, { CARDPOINTE_BASE_URL: 'https://platform.example/cardconnect/rest', CARDPOINTE_MERCHID: 'PLATFORM-MID', CARDPOINTE_USERNAME: 'u', CARDPOINTE_PASSWORD: 'p' });
    const gw = { resolve: vi.fn().mockResolvedValue({ processor: undefined }) };
    const r = await new SkipLineCheckoutService(repo(), undefined, gw).startAppPayment(ctx, 'tk1', { method: 'card' });
    expect(r).toMatchObject({ configured: false, gateway: null, status: 'requires_action' });
  });
  it('the sandbox still works in development, clearly labelled, only when PAYMENTS_SANDBOX=1', async () => {
    process.env.PAYMENTS_SANDBOX = '1';
    const gw = { resolve: vi.fn().mockResolvedValue({ processor: undefined }) };
    const r = await new SkipLineCheckoutService(repo(), undefined, gw).startAppPayment(ctx, 'tk1', { method: 'card' });
    expect(r.configured).toBe(true);
    expect(String(r.gateway)).toMatch(/sandbox/i);
  });
});
