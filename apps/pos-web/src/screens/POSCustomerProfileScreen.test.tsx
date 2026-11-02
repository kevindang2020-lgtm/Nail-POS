import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { searchMock, detailMock } = vi.hoisted(() => ({ searchMock: vi.fn(), detailMock: vi.fn() }));
const phoneStatusMock = vi.hoisted(() => vi.fn());
vi.mock('../api/posCustomersApi', () => ({ posCustomersApi: { quickSearch: searchMock, getDetail: detailMock, phoneStatus: phoneStatusMock } }));
import { POSCustomerProfileScreen } from './POSCustomerProfileScreen';
beforeEach(() => { searchMock.mockReset(); detailMock.mockReset(); phoneStatusMock.mockReset().mockRejectedValue(new Error('no status')); });

const cust = { customerId: 'c1', fullName: 'Ana Rivera', phone: '555-1234', visitsCount: 7 };
const detail = {
  displayName: 'Ana Rivera', firstName: 'Ana', phone: '555-1234', email: 'ana@x.com', status: 'active', isVip: true,
  visitCount: 7, lastVisitAt: '2026-07-01T00:00:00Z', totalSpendCents: 84000, averageSpendCents: 12000, loyaltyPoints: 320, loyaltyTier: 'Gold',
  loyalty: { points: 320, earned: 500, redeemed: 180, tier: 'Gold' },
  membership: { plan: 'VIP Monthly', status: 'active', renewalDate: '2026-08-01T00:00:00Z', benefits: ['10% off', 'Priority booking'] },
  giftCards: [{ giftCardId: 'g1', maskedCode: '••• 4321', balanceCents: 5000, status: 'active' }],
  recentVisits: [{ visitId: 'v1', date: '2026-07-01T00:00:00Z', serviceName: 'Gel Manicure', technicianName: 'Ben', totalCents: 6800, tipCents: 1000 }],
};

describe('POSCustomerProfileScreen', () => {
  it('searches, picks, and shows the consolidated profile', async () => {
    searchMock.mockResolvedValue({ items: [cust] }); detailMock.mockResolvedValue(detail);
    render(<POSCustomerProfileScreen />);
    fireEvent.change(screen.getByPlaceholderText(/Search by name/i), { target: { value: 'Ana' } });
    fireEvent.click(await screen.findByText('Ana Rivera'));
    await waitFor(() => expect(detailMock).toHaveBeenCalledWith('c1'));
    expect(await screen.findByText('$840.00')).toBeInTheDocument();   // lifetime spend
    expect(screen.getByText(/VIP MEMBER/)).toBeInTheDocument();   // Sep 2026 redesign: '★ VIP MEMBER' badge
    expect(screen.getByText('VIP Monthly')).toBeInTheDocument();      // membership
    expect(screen.getByText('••• 4321')).toBeInTheDocument();          // gift card
    expect(screen.getByText('Gel Manicure')).toBeInTheDocument();      // recent visit
  });
  it('handles a profile with no membership or gift cards', async () => {
    searchMock.mockResolvedValue({ items: [cust] });
    detailMock.mockResolvedValue({ ...detail, isVip: false, membership: { plan: '', status: 'none', benefits: [] }, giftCards: [] });
    render(<POSCustomerProfileScreen />);
    fireEvent.change(screen.getByPlaceholderText(/Search by name/i), { target: { value: 'Ana' } });
    fireEvent.click(await screen.findByText('Ana Rivera'));
    expect(await screen.findByText('No active membership plan on record.')).toBeInTheDocument();   // redesign wording
    expect(screen.getByText('No active gift cards associated with this profile.')).toBeInTheDocument();   // redesign wording
  });
});

describe('Phase 3: the phone\u2019s real proof', () => {
  it('a manually confirmed number says so — never a green Verified', async () => {
    searchMock.mockResolvedValue({ items: [cust] });
    detailMock.mockResolvedValue({ ...detail, isPhoneVerified: false });
    phoneStatusMock.mockResolvedValue({ customerId: 'c1', recordVersion: 3, sync: 'ok', lastChange: null, openChange: null,
      phone: { display: '555-1234', masked: '••••1234', status: 'active_unverified', verified: false, label: 'Manually confirmed — OTP not completed', verifiedAt: null, since: null } });
    render(<MemoryRouter><POSCustomerProfileScreen /></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText(/Search by name/i), { target: { value: 'Ana' } });
    fireEvent.click(await screen.findByText('Ana Rivera'));
    expect(await screen.findByTestId('phone-proof')).toHaveTextContent('Manually confirmed — OTP not completed');
    expect(screen.getByTestId('change-phone')).toBeTruthy();
  });
});
