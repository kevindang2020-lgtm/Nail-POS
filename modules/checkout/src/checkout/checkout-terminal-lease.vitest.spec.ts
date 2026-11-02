// checkout-terminal-lease.vitest.spec.ts — Functional Decision 34 through payCard: while one ticket's charge is in flight
// on a shared terminal, another ticket on that terminal gets TERMINAL_BUSY; the terminal frees when the charge ends —
// approved, declined, or thrown.
import { describe, it, expect } from 'vitest';
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';
import { CheckoutService } from './checkout.service';

const ctx: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.card_payment'] } as any;
class ConnectedRepo extends InMemoryCheckoutRepository {
  async settings(c: CheckoutContext) { return { ...(await super.settings(c)), fiservStatus: 'connected' } as any; }
}
function gatedProcessor(mode: 'approve' | 'throw' = 'approve') {
  let release!: () => void; const gate = new Promise<void>((r) => { release = r; });
  const p: any = { name: 'spy', async authorizeAndCapture() { await gate; if (mode === 'throw') throw new Error('ETIMEDOUT'); return { approved: true, retref: 'R1', respstat: 'A' }; },
    async voidTransaction() { return { ok: true }; }, async refund() { return { ok: true }; } };
  return { p, release };
}

describe('Functional Decision 34 — one transaction per shared terminal', () => {
  it('ticket B gets TERMINAL_BUSY while ticket A is charging on the same terminal; B can pay once A finishes', async () => {
    const repo = new ConnectedRepo(); const { p, release } = gatedProcessor();
    const svc = new CheckoutService(repo, undefined, undefined, p);
    const a = svc.payCard(ctx, 'tk_2042', { cardToken: 'tok', terminalId: 'term-1' } as any);
    await new Promise((r) => setTimeout(r, 10));
    await expect(svc.payCard(ctx, 'tk_2043', { cardToken: 'tok', terminalId: 'term-1' } as any)).rejects.toThrow('TERMINAL_BUSY');
    release(); expect(((await a) as any).status).toBe('approved');
    const b: any = await svc.payCard(ctx, 'tk_2043', { cardToken: 'tok', terminalId: 'term-1' } as any);
    expect(b.status).toBe('approved');
  });
  it('a different terminal is not blocked', async () => {
    const repo = new ConnectedRepo(); const { p, release } = gatedProcessor();
    const svc = new CheckoutService(repo, undefined, undefined, p);
    const a = svc.payCard(ctx, 'tk_2042', { cardToken: 'tok', terminalId: 'term-1' } as any);
    await new Promise((r) => setTimeout(r, 10));
    const b = svc.payCard(ctx, 'tk_2043', { cardToken: 'tok', terminalId: 'term-2' } as any);
    release(); expect(((await a) as any).status).toBe('approved'); expect(((await b) as any).status).toBe('approved');
  });
  it('a charge that THROWS still frees the terminal', async () => {
    const repo = new ConnectedRepo(); const { p, release } = gatedProcessor('throw');
    const svc = new CheckoutService(repo, undefined, undefined, p);
    const a = svc.payCard(ctx, 'tk_2042', { cardToken: 'tok', terminalId: 'term-1' } as any);
    release(); await expect(a).rejects.toThrow(/PAYMENT_STATUS_UNKNOWN/);
    expect(await repo.terminalLeases.acquire('luxe001', 'term-1', 'ticket:someone-else')).toBe(true);
  });
});
