import { describe, it, expect } from 'vitest';
import { ServingService } from './serving.service';
import { InMemoryServingRepository, ServingContext } from './serving.repository';
import { EVENTS } from '@aipowersalon/realtime-contracts';

// Owner context (has pos.serving.view to read the recomputed detail). techAddService takes the technicianId explicitly
// and gates on the salon settings + ticket status, mirroring how the Tech App calls through to this shared bridge.
const ctx = (over: Partial<ServingContext> = {}): ServingContext =>
  ({ tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: ['pos.serving.view'], ...over });

describe('Tech live-ticket edit recomputes the ticket total (build doc §5–§12, §31)', () => {
  it('adding a service line increases the backend-computed subtotal and emits ticketTotalRecalculated', async () => {
    const events: Array<{ scope: string; event: string; ticketId?: string }> = [];
    const realtime = {
      toTenant: (_c: any, e: any, p: any) => events.push({ scope: 'tenant', event: e, ticketId: p?.ticketId }),
      toTicket: (id: string, e: any, p: any) => events.push({ scope: 'ticket', event: e, ticketId: p?.ticketId ?? id }),
    };
    const repo = new InMemoryServingRepository();
    const svc = new ServingService(repo, realtime as any);

    // sv_4001 (tech_mia, in_service) starts with svc_mani 5500 + svc_gel 1500 = 7000
    const before = await svc.detail(ctx(), 'sv_4001');
    expect(before.subtotalCents).toBe(7000);

    // Tech adds a Spa Pedicure (6500) to the LIVE ticket
    const res = await svc.techAddService(ctx(), 'sv_4001', { serviceId: 'svc_pedi' }, 'tech_mia');
    expect(res.ok).toBe(true);
    expect(res.priceCents).toBe(6500);

    // Backend recomputed the total from the line snapshots — not the phone
    const after = await svc.detail(ctx(), 'sv_4001');
    expect(after.subtotalCents).toBe(13500);                       // 7000 + 6500
    expect(after.services.length).toBe(before.services.length + 1);

    // §12 realtime fan-out: total-recalculated reaches the tenant room (POS Serving/Checkout/Display refetch) + ticket room (Customer App)
    const recalc = events.filter((e) => e.event === EVENTS.ticketTotalRecalculated && e.ticketId === 'sv_4001');
    expect(recalc.some((e) => e.scope === 'tenant')).toBe(true);
    expect(events.some((e) => e.event === EVENTS.ticketServiceLineAdded)).toBe(true);
  });

  it('a service not in the catalog is rejected — no silent total change', async () => {
    const repo = new InMemoryServingRepository();
    const svc = new ServingService(repo);
    const before = await svc.detail(ctx(), 'sv_4001');
    await expect(svc.techAddService(ctx(), 'sv_4001', { serviceId: 'svc_nope' }, 'tech_mia')).rejects.toThrow(/inactive/i);
    const after = await svc.detail(ctx(), 'sv_4001');
    expect(after.subtotalCents).toBe(before.subtotalCents);         // unchanged
  });
});
