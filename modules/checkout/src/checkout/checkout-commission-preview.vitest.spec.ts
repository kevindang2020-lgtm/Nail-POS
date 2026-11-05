import { describe, it, expect } from 'vitest';

// Oct 13 2026 (FLOW duplicate D6 merged): the ticket detail's commission block is the compensation AUTHORITY's answer —
// the immutable snapshot for a paid ticket, the engine's live computation otherwise (rule → service rate → tenant
// default, discount basis). The detail never re-resolves a rate of its own (it used to: rules > stamp > current tech
// rate > service rate > a 50 % guess, on the undiscounted price).
import { InMemoryCheckoutRepository, type CheckoutContext } from './checkout.repository';
import { CheckoutService } from './checkout.service';
describe('CheckoutService.detail commission = the compensation authority (D6)', () => {
  const ctx: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: ['pos.checkout.view', 'pos.checkout.take_payment', 'pos.checkout.refund'] } as any;
  const TK = 'tk_2042';
  it('maps the authority\'s per-technician cents onto the detail rows (names from the ticket lines), source stamped', async () => {
    const repo = new InMemoryCheckoutRepository();
    const lines = (await repo.ticket(ctx, TK))!.lines;
    const techId = lines[0].technicianId ?? 'tech_primary';   // the in-memory ticket names its primary technician 'tech_primary'
    const seen: string[] = [];
    const compensation = {
      snapshotPaidTicket: async () => ({ ok: true }),
      reverseForRefund: async () => ({ ok: true }),
      previewForTicket: async (_c: any, ticketId: string) => { seen.push(ticketId); return { source: 'snapshot' as const, byTechnician: [{ technicianId: techId, cents: 1234 }, { technicianId: 'someone-else', cents: 100 }] }; },
    };
    const svc = new CheckoutService(repo, undefined, undefined, undefined, undefined, undefined, compensation as any);
    const d = await svc.detail(ctx, TK);
    expect(seen).toEqual([TK]);
    expect(d.commission).toEqual({
      rows: [{ name: lines[0].technicianName ?? 'Ava', role: 'Primary Tech', percent: Math.round((1234 / 1334) * 100) }, { name: 'Technician', role: 'Assist Tech', percent: Math.round((100 / 1334) * 100) }],
      estimatedPayoutCents: 1334, source: 'snapshot',
    });
  });
  it('an engine answer (unpaid ticket) is labelled estimated; no authority ⇒ the block is null, never a guessed rate', async () => {
    const repo = new InMemoryCheckoutRepository();
    const comp = { snapshotPaidTicket: async () => ({ ok: true }), reverseForRefund: async () => ({ ok: true }), previewForTicket: async () => ({ source: 'engine' as const, byTechnician: [{ technicianId: null, cents: 500 }] }) };
    const d = await new CheckoutService(repo, undefined, undefined, undefined, undefined, undefined, comp as any).detail(ctx, TK);
    expect(d.commission).toMatchObject({ estimatedPayoutCents: 500, source: 'engine' });
    const none = await new CheckoutService(repo).detail(ctx, TK);
    expect(none.commission).toBeNull();
  });
});
