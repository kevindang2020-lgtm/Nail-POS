import { describe, it, expect, afterEach } from 'vitest';
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';
import { CheckoutService } from './checkout.service';

// Regression lock for the charge-gate bug: the POS card-charge decision MUST follow the per-tenant gateway
// (tenant_payment_config) — NOT platform env. Previously payCard/refund/void gated on settings.fiservStatus, which is
// derived purely from platform env (cardPointeConfigured() checks env FISERV creds; else PAYMENTS_SANDBOX). The effect:
// a salon with a fully configured, ACTIVE gateway was told "Card processor is not configured yet", and PAYMENTS_SANDBOX=1
// simulated every tenant's cards regardless of their real gateway. These tests drive the service with a fake per-tenant
// resolver while the in-memory repo reports fiservStatus 'not_configured' (the env default), proving the decision now
// comes from the gateway. Test 1 in particular FAILS against the old env-gated code.

function makeProcessor() {
  const calls = { capture: 0, lastAmount: 0 };
  const processor: any = {
    name: 'spy-fiserv',
    async authorizeAndCapture(input: any) { calls.capture++; calls.lastAmount = input.amountCents; return { approved: true, retref: 'RET-TENANT', authCode: 'A1', respstat: 'A', respText: 'Approved' }; },
    async voidTransaction(input: any) { return { approved: true, retref: input.retref }; },
    async refund() { return { approved: true }; },
  };
  return { processor, calls };
}

// A fake per-tenant gateway resolver returning exactly the shape the real PaymentGatewayResolver.resolve() returns. The
// real resolver only sets `processor` when the tenant gateway is active + credentials decrypt, so `processor` present is a
// faithful stand-in for "this tenant can take real cards".
function fakeGateway(resolved: any) { return { resolve: async (_tenantId: string) => resolved } as any; }

const ctx: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.card_payment'] };

describe('POS card charge follows the TENANT gateway, not platform env (charge-gate regression)', () => {
  const prevSandbox = process.env.PAYMENTS_SANDBOX;
  afterEach(() => { if (prevSandbox === undefined) delete process.env.PAYMENTS_SANDBOX; else process.env.PAYMENTS_SANDBOX = prevSandbox; });

  it('an ACTIVE tenant gateway authorizes+captures for real — even though env fiservStatus is not_configured', async () => {
    delete process.env.PAYMENTS_SANDBOX;
    const repo = new InMemoryCheckoutRepository();
    const { processor, calls } = makeProcessor();
    const svc = new CheckoutService(repo, undefined, undefined, undefined, fakeGateway({ processor, processorType: 'fiserv', environment: 'production', merchantIdMasked: '••••1234', status: 'active', configured: true }));
    const due = (await repo.totalsFor(ctx, 'tk_2044', 'card'))!.totalDueCents;
    const res: any = await svc.payCard(ctx, 'tk_2044', { cardToken: 'tok_live' } as any);
    expect(res.status).toBe('approved');            // real approval from the tenant's own processor
    expect(calls.capture).toBe(1);                  // the processor WAS actually called (not simulated)
    expect(calls.lastAmount).toBe(due);             // charged exactly the amount due
    expect(res.processorTransactionId).toBe('RET-TENANT');
  });

  it('an UNCONFIGURED tenant gateway blocks the charge — never a simulated approval', async () => {
    delete process.env.PAYMENTS_SANDBOX;
    const repo = new InMemoryCheckoutRepository();
    const { processor, calls } = makeProcessor();
    const svc = new CheckoutService(repo, undefined, undefined, undefined, fakeGateway({ processor: undefined, processorType: 'fiserv', environment: 'sandbox', merchantIdMasked: '', status: 'not_configured', configured: false }));
    const res: any = await svc.payCard(ctx, 'tk_2044', { cardToken: 'tok_live' } as any);
    expect(res.configured).toBe(false);             // blocked — not configured
    expect(calls.capture).toBe(0);                  // processor never called; no fake approval
  });

  it('with NO usable gateway, an explicit platform sandbox (PAYMENTS_SANDBOX=1) simulates — the only synthetic path', async () => {
    process.env.PAYMENTS_SANDBOX = '1';
    const repo = new InMemoryCheckoutRepository();
    const { processor, calls } = makeProcessor();
    const svc = new CheckoutService(repo, undefined, undefined, undefined, fakeGateway({ processor: undefined, processorType: 'fiserv', environment: 'sandbox', merchantIdMasked: '', status: 'not_configured', configured: false }));
    const res: any = await svc.payCard(ctx, 'tk_2044', { cardToken: 'tok_x' } as any);
    expect(res.status).toBe('approved');            // simulated approval for local dev/demo
    expect(String(res.processorTransactionId).startsWith('sbx_')).toBe(true);
    expect(calls.capture).toBe(0);                  // still no real processor call
  });
});

// Payments mandate §7 / §13 (wave 3): the charge is routed by tenant + BRANCH. The register's branch (trusted ctx) is
// what picks a branch merchant account; a checkout that only named the tenant would charge the tenant default even at a
// branch that settles to its own MID.
describe('POS card charge resolves the gateway for the register\'s BRANCH (branch merchant routing)', () => {
  it('passes ctx.branchId to the provider router', async () => {
    delete process.env.PAYMENTS_SANDBOX;
    const repo = new InMemoryCheckoutRepository();
    const { processor } = makeProcessor();
    const seen: unknown[][] = [];
    const gateway = { resolve: async (...args: unknown[]) => { seen.push(args); return { processor, processorType: 'fiserv', environment: 'production', merchantIdMasked: '••••1001', status: 'active', configured: true, scope: 'branch', branchId: ctx.branchId }; } } as any;
    const svc = new CheckoutService(repo, undefined, undefined, undefined, gateway);
    const res: any = await svc.payCard(ctx, 'tk_2044', { cardToken: 'tok_live' } as any);
    expect(res.status).toBe('approved');
    expect(seen.length).toBeGreaterThan(0);
    for (const call of seen) expect(call).toEqual(['luxe001', 'br_cherryhill']);
  });
});
