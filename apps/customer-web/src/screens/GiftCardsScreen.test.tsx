import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api/customerApi', () => ({ customerApi: { giftCards: vi.fn(), sendGiftCard: vi.fn(), reportLostGiftCard: vi.fn() } }));
import { customerApi } from '../api/customerApi';
import { GiftCardsScreen } from './GiftCardsScreen';

describe('GiftCardsScreen', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows the customer gift cards with balances, bonus, and total', async () => {
    (customerApi.giftCards as any).mockResolvedValue({ totalBalanceCents: 7500, cards: [
      { id: 'g1', reference: 'GC-****-4827', cardNumberMasked: '•••• •••• •••• 8411', balanceCents: 5000, purchasedCents: 5000, promoCents: 0, status: 'active', createdAt: '2026-07-01T00:00:00Z', expiresAt: null },
      { id: 'g2', reference: 'GC-****-1199', cardNumberMasked: '•••• •••• •••• 1199', balanceCents: 2500, purchasedCents: 2000, promoCents: 500, status: 'partially_redeemed', createdAt: '2026-06-15T00:00:00Z', expiresAt: '2027-06-15T00:00:00Z' },
    ] });
    render(<MemoryRouter><GiftCardsScreen /></MemoryRouter>);
    expect(await screen.findByText('GC-****-4827')).toBeInTheDocument();
    expect(screen.getByText('GC-****-1199')).toBeInTheDocument();
    expect(screen.getByText('•••• •••• •••• 8411')).toBeInTheDocument();   // masked 16-digit number
    expect(screen.getByText('$75.00')).toBeInTheDocument();               // total balance
    expect(screen.getByText(/includes \$5\.00 bonus/)).toBeInTheDocument();
  });

  it('shows an honest empty state when there are no cards', async () => {
    (customerApi.giftCards as any).mockResolvedValue({ totalBalanceCents: 0, cards: [] });
    render(<MemoryRouter><GiftCardsScreen /></MemoryRouter>);
    expect(await screen.findByText(/No gift cards yet/)).toBeInTheDocument();
  });

  it('shows an error state when the load fails', async () => {
    (customerApi.giftCards as any).mockRejectedValue(new Error('nope'));
    render(<MemoryRouter><GiftCardsScreen /></MemoryRouter>);
    expect(await screen.findByText(/nope|Could not load your gift cards/)).toBeInTheDocument();
  });

  it('lets the customer create a shareable gift link for an active card', async () => {
    (customerApi.giftCards as any).mockResolvedValue({ totalBalanceCents: 5000, cards: [
      { id: 'g1', reference: 'GC-****-4827', cardNumberMasked: null, balanceCents: 5000, purchasedCents: 5000, promoCents: 0, status: 'active', createdAt: '2026-07-01T00:00:00Z', expiresAt: null },
    ] });
    (customerApi.sendGiftCard as any).mockResolvedValue({ claimToken: 'TESTTOKEN', expiresAt: '2026-08-01T00:00:00Z' });
    render(<MemoryRouter><GiftCardsScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByText(/Send to a friend/));
    fireEvent.change(screen.getByPlaceholderText('Their phone number'), { target: { value: '+15551234567' } });
    fireEvent.click(screen.getByText('Create gift link'));
    expect(await screen.findByDisplayValue(/claim\?token=TESTTOKEN/)).toBeInTheDocument();
    expect(customerApi.sendGiftCard).toHaveBeenCalledWith('g1', expect.objectContaining({ phone: '+15551234567' }));
  });

  it('confirms when the link was texted to the recipient', async () => {
    (customerApi.giftCards as any).mockResolvedValue({ totalBalanceCents: 5000, cards: [
      { id: 'g1', reference: 'GC-****-4827', cardNumberMasked: null, balanceCents: 5000, purchasedCents: 5000, promoCents: 0, status: 'active', createdAt: '2026-07-01T00:00:00Z', expiresAt: null },
    ] });
    (customerApi.sendGiftCard as any).mockResolvedValue({ claimToken: 'TOK2', expiresAt: '2026-08-01T00:00:00Z', claimUrl: 'https://app.example.com/gift-cards/claim?token=TOK2', delivery: { channel: 'sms', status: 'sent' } });
    render(<MemoryRouter><GiftCardsScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByText(/Send to a friend/));
    fireEvent.change(screen.getByPlaceholderText('Their phone number'), { target: { value: '+15551234567' } });
    fireEvent.click(screen.getByText('Create gift link'));
    expect(await screen.findByText('Gift sent!')).toBeInTheDocument();
    expect(screen.getByText(/We texted the link/)).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://app.example.com/gift-cards/claim?token=TOK2')).toBeInTheDocument();
  });

  it('reports a card lost, which freezes it and reloads', async () => {
    (customerApi.giftCards as any)
      .mockResolvedValueOnce({ totalBalanceCents: 5000, cards: [
        { id: 'g1', reference: 'GC-****-4827', cardNumberMasked: null, balanceCents: 5000, purchasedCents: 5000, promoCents: 0, status: 'active', createdAt: '2026-07-01T00:00:00Z', expiresAt: null },
      ] })
      .mockResolvedValueOnce({ totalBalanceCents: 0, cards: [
        { id: 'g1', reference: 'GC-****-4827', cardNumberMasked: null, balanceCents: 5000, purchasedCents: 5000, promoCents: 0, status: 'frozen', createdAt: '2026-07-01T00:00:00Z', expiresAt: null },
      ] });
    (customerApi.reportLostGiftCard as any).mockResolvedValue({ ok: true });
    const confirmSpy = vi.spyOn(window, 'confirm');
    render(<MemoryRouter><GiftCardsScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByText('Report lost'));
    fireEvent.click(await screen.findByRole('button', { name: 'Freeze this card' }));   // inline dialog
    await waitFor(() => expect(customerApi.reportLostGiftCard).toHaveBeenCalledWith('g1'));
    expect(confirmSpy).not.toHaveBeenCalled();
    // After freezing, the card is no longer active, so its actions disappear.
    await waitFor(() => expect(screen.queryByText('Report lost')).toBeNull());
    confirmSpy.mockRestore();
  });

  it('does not report lost when the dialog is cancelled', async () => {
    (customerApi.giftCards as any).mockResolvedValue({ totalBalanceCents: 5000, cards: [
      { id: 'g1', reference: 'GC-****-4827', cardNumberMasked: null, balanceCents: 5000, purchasedCents: 5000, promoCents: 0, status: 'active', createdAt: '2026-07-01T00:00:00Z', expiresAt: null },
    ] });
    render(<MemoryRouter><GiftCardsScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByText('Report lost'));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(customerApi.reportLostGiftCard).not.toHaveBeenCalled();
  });

  it('requires a recipient before creating a link', async () => {
    (customerApi.giftCards as any).mockResolvedValue({ totalBalanceCents: 5000, cards: [
      { id: 'g1', reference: 'GC-****-4827', cardNumberMasked: null, balanceCents: 5000, purchasedCents: 5000, promoCents: 0, status: 'active', createdAt: '2026-07-01T00:00:00Z', expiresAt: null },
    ] });
    render(<MemoryRouter><GiftCardsScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByText(/Send to a friend/));
    fireEvent.click(screen.getByText('Create gift link'));
    expect(await screen.findByText(/phone number or email/)).toBeInTheDocument();
    expect(customerApi.sendGiftCard).not.toHaveBeenCalled();
  });
});
