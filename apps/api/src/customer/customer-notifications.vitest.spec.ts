import { describe, it, expect } from 'vitest';
import { CustomerService } from './customer.service';
import type { CustomerDataPort } from './customer.repository';

const ctx = { tenantId: 'T', branchId: 'B', userId: 'U', role: 'CUSTOMER', permissions: [] };
const make = (over: Record<string, any>) => new CustomerService({ serviceProgressEnabled: async () => true, resolveCustomerId: async () => 'c1', ...over } as unknown as CustomerDataPort);

describe('CustomerService — notifications + cancel', () => {
  it('computes unread count from real items', async () => {
    const svc = make({ notifications: async () => [
      { id: 'n1', type: 'appointment', title: 'A', body: null, reference: null, readAt: null, createdAt: 'x' },
      { id: 'n2', type: 'general', title: 'B', body: null, reference: null, readAt: '2026-01-01', createdAt: 'y' },
    ] });
    const r = await svc.getNotifications(ctx);
    expect(r.unreadCount).toBe(1);
    expect(r.items).toHaveLength(2);
  });
  it('returns an empty feed for a non-customer session', async () => {
    const svc = make({ serviceProgressEnabled: async () => true, resolveCustomerId: async () => null, notifications: async () => [{ id: 'x' } as any] });
    expect(await svc.getNotifications(ctx)).toEqual({ unreadCount: 0, items: [] });
  });
  it('cancels only when the repo reports a row was cancelled', async () => {
    expect(await make({ cancelAppointment: async () => true }).cancelAppointment(ctx, 'a1')).toEqual({ ok: true });
    expect(await make({ cancelAppointment: async () => false }).cancelAppointment(ctx, 'a1')).toEqual({ ok: false });
    expect(await make({ serviceProgressEnabled: async () => true, resolveCustomerId: async () => null }).cancelAppointment(ctx, 'a1')).toEqual({ ok: false });
  });
});
