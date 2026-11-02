import { describe, it, expect } from 'vitest';
import { SuperAdminTicketsService, SuperAdminTicketsError, type SuperAdminTicketsRepo, type AdminCtx } from './super-admin-tickets.service';

const ctx: AdminCtx = { userId: 'sa', email: 'sa@x.com' };

const makeRepo = (over: Partial<SuperAdminTicketsRepo> = {}): SuperAdminTicketsRepo => ({
  list: async (f) => ({ tickets: [], page: f.page, pageSize: f.pageSize, total: 0 }),
  ticket: async () => null,
  lines: async () => [],
  revisions: async () => [],
  ...over,
});

describe('SuperAdminTicketsService — read-only platform ticket oversight (epic Req §10)', () => {
  it('clamps pagination and forwards tenant/status/search filters', async () => {
    let captured: any = null;
    const svc = new SuperAdminTicketsService(makeRepo({ list: async (f) => { captured = f; return { tickets: [], page: f.page, pageSize: f.pageSize, total: 0 }; } }));
    await svc.listTickets(ctx, { page: 0, pageSize: 9999, tenantId: 'T9', status: 'paid', search: '  Mia  ' });
    expect(captured.page).toBe(1);          // clamped up from 0
    expect(captured.pageSize).toBe(100);    // clamped down from 9999
    expect(captured.tenantId).toBe('T9');
    expect(captured.status).toBe('paid');
    expect(captured.search).toBe('Mia');    // trimmed
  });

  it('resolves the tenant timezone for created-date bounds (UTC across all tenants)', async () => {
    let captured: any = null;
    const repo = makeRepo({ list: async (f) => { captured = f; return { tickets: [], page: f.page, pageSize: f.pageSize, total: 0 }; }, tenantTimezone: async () => 'America/Los_Angeles' });
    const svc = new SuperAdminTicketsService(repo);
    await svc.listTickets(ctx, { tenantId: 'T9', dateFrom: '2026-06-01' });
    expect(captured.tz).toBe('America/Los_Angeles');     // single tenant → its local day
    await svc.listTickets(ctx, { dateFrom: '2026-06-01' });
    expect(captured.tz).toBe('UTC');                      // spanning all tenants → UTC
    await svc.listTickets(ctx, {});
    expect(captured.tz).toBeUndefined();                 // no dates → no tz lookup
  });

  it('assembles a cross-tenant ticket history (snapshot + lines + revisions)', async () => {
    const ticket = {
      ticketId: 'tk1', ticketNumber: '#3041', tenantId: 'T9', tenantName: 'Luxe Nails', status: 'paid', customerName: 'Grace', technicianName: 'Mia',
      totalCents: 8000, version: 3, serviceDoneLocked: true, lockedAt: '2026-06-01T01:00:00.000Z', createdAt: '2026-06-01T00:00:00.000Z', paidAt: '2026-06-01T01:05:00.000Z',
      subtotalCents: 7000, taxCents: 0, discountCents: 0, tipCents: 1000, servingStartedAt: null, serviceDoneAt: '2026-06-01T01:00:00.000Z', lockedByUserId: 'u_mgr', lockedTotalCents: 7000,
    };
    const svc = new SuperAdminTicketsService(makeRepo({
      ticket: async () => ticket,
      lines: async () => [{ serviceName: 'Manicure', priceCents: 5500, lineTotalCents: 5500, technicianName: 'Mia', status: 'completed', isAddOn: false }],
      revisions: async () => [{ version: 1, action: 'service_added', serviceLineId: 'l1', actorUserId: 'u', actorRole: 'TECH', before: null, after: {}, summary: 'Added', createdAt: '2026-06-01T00:30:00.000Z' }],
    }));
    const out = await svc.ticketHistory(ctx, 'tk1');
    expect(out.ticket.tenantName).toBe('Luxe Nails');       // tenant is labeled across the platform
    expect(out.ticket.serviceDoneLocked).toBe(true);
    expect(out.lines.length).toBe(1);
    expect(out.revisions[0].action).toBe('service_added');
  });

  it('rejects a blank ticket id and a missing ticket', async () => {
    const svc = new SuperAdminTicketsService(makeRepo());
    await expect(svc.ticketHistory(ctx, '  ')).rejects.toThrow(SuperAdminTicketsError);
    await expect(svc.ticketHistory(ctx, 'nope')).rejects.toThrow(/not found/i);
  });
});
