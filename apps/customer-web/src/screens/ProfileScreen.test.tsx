import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { logoutMock } = vi.hoisted(() => ({ logoutMock: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ principal: { userId: 'u1', tenantId: 't1', branchId: null, role: 'CUSTOMER', permissions: [], fullName: 'Jessica Smith' }, logout: logoutMock, loading: false, setPrincipal: vi.fn() }),
}));
vi.mock('../api/customerApi', () => ({ customerApi: { getProfile: vi.fn(), homeSalon: vi.fn(async () => null), setHomeSalon: vi.fn(), salonsNearby: vi.fn() } }));   // + My salon (Oct 3 2026)
import { customerApi } from '../api/customerApi';
import { ProfileScreen } from './ProfileScreen';

describe('ProfileScreen (menu)', () => {
  beforeEach(() => { vi.clearAllMocks(); (customerApi.getProfile as any).mockResolvedValue({ fullName: 'Jessica Smith', email: 'jessica@email.com', phone: '(832) 555-1234', smsOptIn: false, emailOptIn: false }); });
  it('shows identity (real email/phone) and the reference menu rows', async () => {
    render(<MemoryRouter><ProfileScreen /></MemoryRouter>);
    expect(screen.getByText('Jessica Smith')).toBeInTheDocument();
    expect(await screen.findByText('jessica@email.com')).toBeInTheDocument();
    expect(screen.getByText('(832) 555-1234')).toBeInTheDocument();
    for (const label of ['My Information', 'Payment Methods', 'My Addresses', 'Notifications', 'Settings', 'Help & Support'])
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
  });
  it('every section row is now a real screen (no coming-soon placeholder)', () => {
    render(<MemoryRouter><ProfileScreen /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Payment Methods' }));
    expect(screen.queryByText('This section is coming soon.')).not.toBeInTheDocument();
  });
  it('confirms before logging out and revokes the session', async () => {
    render(<MemoryRouter><ProfileScreen /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Log Out' })); // row opens the dialog
    const dialog = screen.getByRole('dialog');
    expect(logoutMock).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Log Out' }));
    await waitFor(() => expect(logoutMock).toHaveBeenCalledTimes(1));
  });
});
