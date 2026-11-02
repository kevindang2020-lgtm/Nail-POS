// CheckoutTicketInner.vi.test — English + Vietnamese POS mandate §34 (build plan WP-D2): the ticket full view's money
// breakdown, payment method and receipt channels read in Vietnamese; the amounts are the same in both languages (§45, §48).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { setLanguage } from '@aipowersalon/mobile-sdk/i18n';
import '../i18n';

const detail = vi.fn();
vi.mock('../api/posCheckoutApi', () => ({ posCheckoutApi: { detail: (...a: any[]) => detail(...a), technicianSplit: () => Promise.resolve({ participantCount: 0, technicians: [] }) } }));

import { CheckoutTicketInner } from './CheckoutTicketInner';

const ticket = {
  ticketId: 't1', ticketNumber: '1042',
  customer: { fullName: 'Nguyễn Thị Hương', isVip: false, phone: '(555) 111-2222' },
  completedServices: [{ serviceLineId: 'l1', serviceName: 'Gel Manicure', technicianName: 'Mia', priceCents: 4500 }],
  promotion: { code: 'SAVE10', amountCents: 500 },
  technicians: { primary: { name: 'Mia Johnson' }, helpers: [] },
  totals: { subtotalCents: 4500, taxCents: 300, tipCents: 900, surchargeCents: 150, totalDueCents: 5350, paymentMethod: 'gift_card' },
  receiptDeliveryOptions: { sms: true, email: false, app: true, print: false },
};

beforeEach(() => { detail.mockReset(); detail.mockResolvedValue(ticket); });
afterEach(async () => { await setLanguage('en'); });

describe('CheckoutTicketInner in Vietnamese', () => {
  it('totals labels, payment method and receipt channels are Vietnamese; amounts unchanged', async () => {
    await setLanguage('vi');
    render(<CheckoutTicketInner ticketId="t1" />);
    await waitFor(() => expect(screen.getByText('Nguyễn Thị Hương')).toBeTruthy());
    for (const label of ['Tạm tính', 'Giảm giá (SAVE10)', 'Thuế', 'Tiền tip', 'Phụ phí thẻ', 'Tổng phải trả']) expect(screen.getByText(label), label).toBeTruthy();
    expect(screen.getByText('Thẻ quà tặng')).toBeTruthy();                       // payment method gift_card → glossary term
    expect(screen.getByText('SMS ✓')).toBeTruthy();
    expect(screen.getByText('ỨNG DỤNG ✓')).toBeTruthy();
    expect(screen.getByText('$53.50')).toBeTruthy();                             // the amount is the same in both languages
    for (const en of ['Subtotal', 'Tax', 'Tip', 'Total Due', 'Card surcharge', 'Gift Card']) expect(screen.queryByText(en), en).toBeNull();
  });
  it('the same view in English keeps its English labels', async () => {
    render(<CheckoutTicketInner ticketId="t1" />);
    await waitFor(() => expect(screen.getByText('Total Due')).toBeTruthy());
    for (const label of ['Subtotal', 'Discount (SAVE10)', 'Tax', 'Tip', 'Card surcharge', 'Gift Card', 'APP ✓']) expect(screen.getByText(label), label).toBeTruthy();
  });
});
