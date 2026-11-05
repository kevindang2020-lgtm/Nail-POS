import { describe, it, expect } from 'vitest';
import { mapMobileQueue, mapTicketStatus, maskPhone } from './mobile-checkout-queue';
import type { POSCheckoutTicketRow } from '../checkout/checkout.dto';

const row = (over: Partial<POSCheckoutTicketRow>): POSCheckoutTicketRow => ({
  ticketId: 't1', ticketNumber: '#1028', tenantId: 'T1', branchId: 'B1', customerId: 'c1',
  customerName: 'Jessica Martinez', customerPhone: '(555) 123-4567', isVip: false, station: undefined,
  serviceCount: 2, completedAt: '2026-06-28T09:15:00Z', finishedAt: '2026-06-28T09:15:00Z',
  subtotalCents: 8500, totalDueCents: 8500, status: 'ready_for_payment',
  servicesLabel: 'Gel Manicure, Brow Wax', primaryTechnicianName: 'Mia', ...over,
});

describe('mobile queue mapper', () => {
  it('maps the canonical row, masking phone and surfacing real service names + total', () => {
    const r = mapMobileQueue([row({})]);
    expect(r.count).toBe(1);
    const item = r.items[0];
    expect(item.ticketNumber).toBe('#1028');
    expect(item.totalDueCents).toBe(8500);
    expect(item.serviceCount).toBe(2);
    expect(item.servicesLabel).toBe('Gel Manicure, Brow Wax');
    expect(item.technicianName).toBe('Mia');
    expect(item.status).toBe('ready_for_payment');
    expect(item.customerPhoneMasked).toBe('(•••) •••-4567');
    expect(item.customerPhoneMasked).not.toContain('123');
  });

  it('maps ticket statuses honestly', () => {
    expect(mapTicketStatus('ready_for_payment')).toBe('ready_for_payment');
    expect(mapTicketStatus('payment_in_progress')).toBe('payment_in_progress');
    expect(mapTicketStatus('sent_to_customer_display')).toBe('payment_in_progress');
    expect(mapTicketStatus('failed')).toBe('payment_failed');
    expect(mapTicketStatus('paid')).toBe('paid');
    expect(mapTicketStatus('reopened')).toBe('ready_for_payment');
  });

  it('excludes paid from the active queue by default; "paid" filter shows only paid', () => {
    const rows = [row({ ticketId: 'a', status: 'ready_for_payment' }), row({ ticketId: 'b', status: 'paid' })];
    expect(mapMobileQueue(rows).items.map((i) => i.ticketId)).toEqual(['a']);
    expect(mapMobileQueue(rows, { status: 'paid' }).items.map((i) => i.ticketId)).toEqual(['b']);
  });

  it('filters by status', () => {
    const rows = [row({ ticketId: 'a', status: 'ready_for_payment' }), row({ ticketId: 'b', status: 'failed' })];
    expect(mapMobileQueue(rows, { status: 'failed' }).items.map((i) => i.ticketId)).toEqual(['b']);
    expect(mapMobileQueue(rows, { status: 'ready' }).items.map((i) => i.ticketId)).toEqual(['a']);
  });

  it('searches by ticket/customer/tech/services and sorts', () => {
    const rows = [
      row({ ticketId: 'a', customerName: 'Olivia Johnson', totalDueCents: 18500, finishedAt: '2026-06-28T09:05:00Z' }),
      row({ ticketId: 'b', customerName: 'Jessica Martinez', totalDueCents: 8500, finishedAt: '2026-06-28T09:15:00Z' }),
    ];
    expect(mapMobileQueue(rows, { search: 'olivia' }).items.map((i) => i.ticketId)).toEqual(['a']);
    expect(mapMobileQueue(rows, { search: 'gel manicure' }).count).toBe(2);
    expect(mapMobileQueue(rows, { sort: 'amount_desc' }).items.map((i) => i.ticketId)).toEqual(['a', 'b']);
    expect(mapMobileQueue(rows, { sort: 'oldest' }).items.map((i) => i.ticketId)).toEqual(['a', 'b']);
    expect(mapMobileQueue(rows, { sort: 'newest' }).items.map((i) => i.ticketId)).toEqual(['b', 'a']);
  });

  it('maskPhone never returns the full number', () => {
    expect(maskPhone('(555) 123-4567')).toBe('(•••) •••-4567');
    expect(maskPhone(undefined)).toBeUndefined();
    expect(maskPhone('12')).toBe('•••');
  });
});
