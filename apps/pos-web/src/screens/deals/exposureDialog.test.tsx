import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const detail = { id: 'd1', code: 'FALL10', name: 'Fall', lifecycle: 'active', discountType: 'fixed', discountCents: 1000, discountPercent: null, used: 5, maxRedemptions: 25, remaining: 20,
  minPurchaseCents: 0, sampleSavingsCents: 1000, createdAt: '2026-10-01T00:00:00Z', overview: { salonWide: true }, eligibility: {}, services: [], history: [],
  limits: { maxRedemptions: 25, maxPerCustomer: null, maxDiscountCents: null, budgetCents: null, codes: 1, activeCodes: 1, walletCodes: 0 },
  usage: { confirmed: 5, uniqueCustomers: 5, savingsCents: 5000, pendingAtCheckout: 0, reversed: 0, lastRedeemedAt: null } };
vi.mock('../../api/posDiscountsApi', () => ({ posDiscountsApi: { detail: vi.fn(() => Promise.resolve(detail)), redemptions: vi.fn() } }));
import { DiscountDetailsDialog } from '../POSDiscountsScreen';

describe('Promotions · discount exposure meter', () => {
  it('Limits shows the estimated most the promotion could still give away, labelled as an estimate', async () => {
    render(<DiscountDetailsDialog id="d1" tick={0} onClose={() => {}} onCustomer={() => {}} />);
    fireEvent.click(await screen.findByTestId('dd-tab-limits'));
    const e = screen.getByTestId('dd-exposure').textContent ?? '';
    expect(e).toMatch(/200\.00/); expect(e).toMatch(/estimate/); expect(e).toMatch(/20 uses left/);
  });
});
