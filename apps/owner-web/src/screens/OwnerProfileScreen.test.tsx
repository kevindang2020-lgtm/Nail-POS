// OwnerProfileScreen (owner): identity card (name, business, role, email, phone, tenant id), multi-location access
// (branch list with a Primary marker + non-owner access levels), and a settings menu of genuinely-wired rows. Verifies
// the identity + contact fields, the multi-location list with primary/manager badges, and that a settings row routes.
// Data is typed from /owner/profile + /owner/context.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const back = vi.fn(); const openAudit = vi.fn(); const openPrivacy = vi.fn(); const openTerms = vi.fn(); const openDeleteAccount = vi.fn(); const logout = vi.fn();
vi.mock('../shell/nav', () => ({ useOwnerNav: () => ({ back, openAudit, openPrivacy, openTerms, openDeleteAccount }) }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ logout }) }));
vi.mock('../api/ownerApi', () => ({
  ownerMoreApi: { profile: vi.fn() },
  ownerContextApi: { context: vi.fn() },
  ownerSecurityApi: {
    status: vi.fn(async () => ({ accessCodeConfigured: false })),
    setAccessCode: vi.fn(async () => ({ ok: true, configured: true })),
  },
}));

import { ownerSecurityApi } from '../api/ownerApi';

import { ownerMoreApi, ownerContextApi } from '../api/ownerApi';
import { OwnerProfileScreen } from './OwnerProfileScreen';

const profile = { userId: 'u1', fullName: 'Amanda Johnson', email: 'amanda@salon.com', phone: '+1 555 0100', role: 'OWNER', tenantId: 't_123', businessName: 'AI PowerSalon Group', timezone: 'America/New_York', currency: 'USD', branchCount: 2 };
const ctx = {
  ownerUserId: 'u1', tenantId: 't_123', canViewAllAssignedBranches: true, defaultBranchId: 'b1',
  allowedBranches: [
    { branchId: 'b1', tenantId: 't_123', salonName: 'Downtown Salon', branchName: 'Downtown Salon', city: 'Trenton', state: 'NJ', timezone: 'America/New_York', accessLevel: 'owner', isPrimaryOwner: true, hasSwitchPin: false },
    { branchId: 'b2', tenantId: 't_123', salonName: 'Uptown Lounge', branchName: 'Uptown Lounge', city: 'Newark', state: 'NJ', timezone: 'America/New_York', accessLevel: 'manager', isPrimaryOwner: false, hasSwitchPin: false },
  ],
};

beforeEach(() => { vi.clearAllMocks(); (ownerMoreApi.profile as any).mockResolvedValue(profile); (ownerContextApi.context as any).mockResolvedValue(ctx); });

describe('OwnerProfileScreen', () => {
  it('renders the owner identity, contact details, and tenant id', async () => {
    render(<OwnerProfileScreen />);
    await waitFor(() => expect(screen.getByText('Amanda Johnson')).toBeInTheDocument());
    expect(screen.getByText('AI PowerSalon Group')).toBeInTheDocument();
    expect(screen.getByText('amanda@salon.com')).toBeInTheDocument();
    expect(screen.getByText('+1 555 0100')).toBeInTheDocument();
    expect(screen.getByText('t_123')).toBeInTheDocument();
  });

  it('lists multi-location access, marking the primary branch and non-owner access levels', async () => {
    render(<OwnerProfileScreen />);
    await waitFor(() => expect(screen.getByText('Multi-Location Access')).toBeInTheDocument());
    expect(screen.getByText('Primary')).toBeInTheDocument();   // b1 = defaultBranchId
    expect(screen.getByText(/manager/i)).toBeInTheDocument();  // b2 non-owner access level (capitalized via CSS only)
  });

  it('wires a settings row to its destination', async () => {
    render(<OwnerProfileScreen />);
    await waitFor(() => expect(screen.getByText('Audit History')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Audit History'));
    expect(openAudit).toHaveBeenCalled();
  });

  it('sets an Owner Access Code through the security card (current password + new code → server)', async () => {
    render(<OwnerProfileScreen />);
    await waitFor(() => expect(screen.getByText('Owner Access Code')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Owner Access Code')); // open the editor
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'pw123456' } });
    fireEvent.change(screen.getByLabelText('New Owner Access Code'), { target: { value: 'GOLD-77' } });
    fireEvent.click(screen.getByRole('button', { name: /set code/i }));
    await waitFor(() => expect(ownerSecurityApi.setAccessCode).toHaveBeenCalledWith('pw123456', 'GOLD-77'));
  });

  it('shows a friendly error if the profile fails to load', async () => {
    (ownerMoreApi.profile as any).mockRejectedValue(new Error('Could not load your profile.'));
    render(<OwnerProfileScreen />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/could not load your profile/i));
  });
});
