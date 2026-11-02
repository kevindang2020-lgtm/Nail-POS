import { describe, it, expect } from 'vitest';
import { mapMobileTicketDetail } from './mobile-checkout-ticket';
import type { CheckoutTicketDetail } from '../checkout/checkout.dto';

const detail = (over: Partial<CheckoutTicketDetail> = {}): CheckoutTicketDetail => ({
  ticketId: 't1', ticketNumber: '#1028',
  customer: { customerId: 'c1', fullName: 'Jessica Martinez', initials: 'JM', phone: '(555) 123-4567', email: 'jessica@email.com', isVip: true, loyaltyTier: 'Gold', loyaltyPoints: 420, visitCount: 12, preferredTechName: 'Mia' },
  stationLabel: 'Station 3',
  completedServices: [
    { serviceLineId: 's1', serviceName: 'Gel Manicure', category: 'Nails', technicianId: 'm1', technicianName: 'Mia', priceCents: 4500, qty: 1, status: 'done' },
    { serviceLineId: 's2', serviceName: 'Brow Wax', technicianName: 'Ana', priceCents: 4000, status: 'done' },
  ],
  promotion: { code: 'SPRING10', amountCents: 500 },
  commission: null,
  technicians: { primary: { technicianId: 'm1', name: 'Mia' }, helpers: [] },
  finishedAt: '2026-06-28T09:15:00Z',
  qualitySummary: { serviceCompleted: true, customerReady: true, qualityChecked: true, noOpenIssues: true, approved: true },
  serviceNotes: 'Customer prefers matte topcoat.',
  totals: { subtotalCents: 8500, tipCents: 1275, taxCents: 0, surchargeCents: 0, totalDueCents: 9775 },
  receiptDeliveryOptions: { sms: true, email: true, app: true, print: false },
  ...over,
});

describe('mobile ticket-detail projection', () => {
  it('projects services, totals, and customer; masks the phone; surfaces discount from promotion', () => {
    const m = mapMobileTicketDetail(detail());
    expect(m.ticketNumber).toBe('#1028');
    expect(m.services.map((s) => s.serviceName)).toEqual(['Gel Manicure', 'Brow Wax']);
    expect(m.services[0].priceCents).toBe(4500);
    expect(m.services[1].qty).toBe(1); // defaulted when absent
    expect(m.totals.totalDueCents).toBe(9775);
    expect(m.totals.discountCents).toBe(500);
    expect(m.discount).toEqual({ code: 'SPRING10', amountCents: 500 });
    expect(m.customer.phoneMasked).toBe('(•••) •••-4567');
    expect(m.customer.isVip).toBe(true);
    expect(m.customer.loyaltyTier).toBe('Gold');
    expect(m.primaryTechnicianName).toBe('Mia');
  });

  it('does not leak the raw phone or email', () => {
    const m = mapMobileTicketDetail(detail());
    const blob = JSON.stringify(m);
    expect(blob).not.toContain('123-4567');
    expect(blob).not.toContain('jessica@email.com');
  });

  it('handles no promotion (discount null, 0 cents)', () => {
    const m = mapMobileTicketDetail(detail({ promotion: null }));
    expect(m.discount).toBeNull();
    expect(m.totals.discountCents).toBe(0);
  });
});
