import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({ giftCardLookup: vi.fn(), payGiftCard: vi.fn() }));
vi.mock('../../api/posCheckoutApi', () => ({ posCheckoutApi: api }));
import { GiftReadinessBox } from './GiftReadinessBox';

describe('GiftReadinessBox (Gift Cards · 03)', () => {
  beforeEach(() => { api.giftCardLookup.mockReset(); api.payGiftCard.mockReset(); });

  it('checks the card on tap and shows balance, due, split effect — without paying', async () => {
    api.giftCardLookup.mockResolvedValue({ found: true, balanceCents: 3500, status: 'active', redeemableHere: true });
    render(<GiftReadinessBox code=" GC-ABCD-1234 " ticketId="t1" dueCents={8000} />);
    expect(api.giftCardLookup).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('gift-ready-check'));
    await waitFor(() => expect(screen.getByTestId('gift-ready-result')).toBeTruthy());
    expect(api.giftCardLookup).toHaveBeenCalledWith('GC-ABCD-1234');
    expect(screen.getByTestId('gift-ready-balance').textContent).toContain('35.00');
    expect(screen.getByTestId('gift-ready-due').textContent).toContain('80.00');
    expect(screen.getByTestId('gift-ready-applied').textContent).toContain('35.00');
    expect(screen.getByTestId('gift-ready-remaining').textContent).toContain('45.00');
    expect(screen.queryByTestId(/gift-ready-blocker-/)).toBeNull();
    expect(api.payGiftCard).not.toHaveBeenCalled();
  });

  it('shows blockers and hides the applied amount when the card cannot be used', async () => {
    api.giftCardLookup.mockResolvedValue({ found: true, balanceCents: 2000, status: 'active', redeemableHere: false });
    render(<GiftReadinessBox code="GC-ABCD-1234" ticketId="t1" dueCents={5000} offline />);
    fireEvent.click(screen.getByTestId('gift-ready-check'));
    await waitFor(() => expect(screen.getByTestId('gift-ready-blocker-not_here')).toBeTruthy());
    expect(screen.getByTestId('gift-ready-blocker-offline')).toBeTruthy();
    expect(screen.queryByTestId('gift-ready-applied')).toBeNull();
  });

  it('a short code cannot be checked and a not-found card shows an unknown balance', async () => {
    const { rerender } = render(<GiftReadinessBox code="12" ticketId="t1" dueCents={5000} />);
    expect((screen.getByTestId('gift-ready-check') as HTMLButtonElement).disabled).toBe(true);
    api.giftCardLookup.mockResolvedValue({ found: false });
    rerender(<GiftReadinessBox code="9999888877776666" ticketId="t1" dueCents={5000} />);
    fireEvent.click(screen.getByTestId('gift-ready-check'));
    await waitFor(() => expect(screen.getByTestId('gift-ready-blocker-not_found')).toBeTruthy());
    expect(screen.getByTestId('gift-ready-balance').textContent).toContain('—');
    rerender(<GiftReadinessBox code="9999888877776667" ticketId="t1" dueCents={5000} />);
    expect(screen.queryByTestId('gift-ready-result')).toBeNull();
  });
});
