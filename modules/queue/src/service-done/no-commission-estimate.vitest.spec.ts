// ONE-PAY F6 (Oct 13 2026): the Service Done and Serving boards used to stamp a hard-coded 15 % "estimated commission"
// on every ticket and KPI — a third commission formula beside payroll. Unpaid work has no commission until the
// compensation engine prices it (the checkout detail's authority preview); these boards now say null, never a guess.
import { describe, it, expect } from 'vitest';
import { InMemoryServiceDoneRepository } from './service-done.repository';
import { ServiceDoneService } from './service-done.service';
import { InMemoryServingRepository } from '../serving/serving.repository';
import { ServingService } from '../serving/serving.service';

const SD_PERMS = ['pos.service_done.view', 'pos.checkout.view', 'pos.reports.view'];
const SV_PERMS = ['pos.serving.view', 'pos.checkout.view', 'pos.reports.view'];
const ctx = (permissions: string[]) => ({ tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions } as any);

describe('no commission estimate on the Service Done / Serving boards (ONE-PAY F6)', () => {
  it('Service Done: rows, KPI and detail carry null — not 15 % of the subtotal', async () => {
    const svc = new ServiceDoneService(new InMemoryServiceDoneRepository());
    const st = await svc.getState(ctx(SD_PERMS));
    expect(st.tickets.items.length).toBeGreaterThan(0);
    expect(st.tickets.items.every((t: any) => t.estimatedCommissionCents === null)).toBe(true);
    expect(st.kpis.estimatedCommissionCents).toBeNull();
    const d: any = await svc.detail(ctx(SD_PERMS), st.tickets.items[0].ticketId);
    expect(d.estimatedCommissionCents ?? null).toBeNull();
  });
  it('Serving: rows and detail carry null', async () => {
    const svc = new ServingService(new InMemoryServingRepository());
    const st = await svc.getState(ctx(SV_PERMS));
    expect(st.tickets.items.length).toBeGreaterThan(0);
    expect(st.tickets.items.every((t: any) => t.estimatedCommissionCents === null)).toBe(true);
    const d: any = await svc.detail(ctx(SV_PERMS), st.tickets.items[0].ticketId);
    expect(d.estimatedCommissionCents ?? null).toBeNull();
  });
});
