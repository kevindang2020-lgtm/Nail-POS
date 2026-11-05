import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api/customerApi', () => ({ customerApi: { claimGiftCard: vi.fn() } }));
// A signed-in customer by default; individual tests set this to null to exercise the guest path.
let mockPrincipal: any = { role: 'CUSTOMER', customerId: 'c1' };
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ principal: mockPrincipal, loading: false, setPrincipal: () => {}, logout: async () => {} }) }));
vi.mock('../auth/guest', () => ({ exitGuestMode: vi.fn(), enterGuestMode: vi.fn(), isGuest: () => false }));
import { customerApi } from '../api/customerApi';
import { ClaimGiftCardScreen } from './ClaimGiftCardScreen';

const renderAt = (token: string) => render(
  <MemoryRouter initialEntries={[`/gift-cards/claim?token=${token}`]}><ClaimGiftCardScreen /></MemoryRouter>,
);

describe('ClaimGiftCardScreen', () => {
  beforeEach(() => { vi.clearAllMocks(); mockPrincipal = { role: 'CUSTOMER', customerId: 'c1' }; });

  it('claims a valid link and shows the card, sender, and message', async () => {
    (customerApi.claimGiftCard as any).mockResolvedValue({ ok: true, reference: 'GC-****-4827', balanceCents: 5000, senderName: 'Dana', message: 'Enjoy!' });
    renderAt('GOODTOKEN');
    expect(await screen.findByText(/Dana sent you a gift card/)).toBeInTheDocument();
    expect(screen.getByText('$50.00')).toBeInTheDocument();
    expect(screen.getByText(/Enjoy!/)).toBeInTheDocument();
    expect(customerApi.claimGiftCard).toHaveBeenCalledWith('GOODTOKEN');
  });

  it('explains an expired link without claiming anything', async () => {
    (customerApi.claimGiftCard as any).mockResolvedValue({ ok: false, reason: 'expired' });
    renderAt('OLDTOKEN');
    expect(await screen.findByText(/expired/)).toBeInTheDocument();
  });

  it('handles a link with no token', async () => {
    renderAt('');
    expect(await screen.findByText(/missing its code/)).toBeInTheDocument();
    expect(customerApi.claimGiftCard).not.toHaveBeenCalled();
  });

  it('invites a not-signed-in recipient to sign in instead of firing a 401', async () => {
    mockPrincipal = null;
    renderAt('GIFTTOKEN');
    expect(await screen.findByText(/Someone sent you a gift card/)).toBeInTheDocument();
    expect(screen.getByText('Sign in to claim')).toBeInTheDocument();
    expect(customerApi.claimGiftCard).not.toHaveBeenCalled();
  });
});
