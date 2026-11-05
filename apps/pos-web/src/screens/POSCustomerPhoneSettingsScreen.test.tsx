// POSCustomerPhoneSettingsScreen.test — Phase 3: the policy toggles that were stored and never shown, and one branch's
// own policy (audit E10: overrides were unreachable).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('../api/client', () => ({ api: { get: vi.fn(), patch: vi.fn(), del: vi.fn() } }));
vi.mock('../api/authApi', () => ({ authApi: { branches: vi.fn() } }));
import { api } from '../api/client';
import { authApi } from '../api/authApi';
import { POSCustomerPhoneSettingsScreen } from './POSCustomerPhoneSettingsScreen';

const base = { allowReceptionistUpdates: true, requireSmsVerification: true, allowPendingUnverified: true, allowSharedFamilyPhones: true, customerAppSelfService: true, notifyOldNumber: true, allowManualConfirmation: false, requireManagerApproval: false, requireReauthentication: true };
beforeEach(() => {
  vi.mocked(api.get).mockReset().mockImplementation(async (p: string) => (p.includes('/branches/') ? { ...base, branchOverride: p.endsWith('b-own') } : base) as never);
  vi.mocked(api.patch).mockReset().mockImplementation(async (_p: string, body: any) => ({ ...base, ...body }) as never);
  vi.mocked(api.del).mockReset().mockResolvedValue({ ok: true, removed: true } as never);
  vi.mocked(authApi.branches).mockReset().mockResolvedValue({ ok: true, branches: [{ id: 'b-main', name: 'Main', isActive: true }, { id: 'b-own', name: 'Downtown', isActive: true }] } as never);
});

describe('phone policy settings', () => {
  it('shows and saves "manager must approve" and "re-enter password"', async () => {
    render(<POSCustomerPhoneSettingsScreen />);
    fireEvent.click(await screen.findByLabelText(/A manager must approve a receptionist/));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/pos/settings/customer-phone', { requireManagerApproval: true }));
    fireEvent.click(screen.getByLabelText(/re-enter their password/));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/pos/settings/customer-phone', { requireReauthentication: false }));
  });
  it('a branch’s own policy is read and saved on the branch route, and can be removed', async () => {
    render(<POSCustomerPhoneSettingsScreen />);
    fireEvent.change(await screen.findByLabelText('Policy scope'), { target: { value: 'b-own' } });
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/pos/settings/customer-phone/branches/b-own'));
    expect(await screen.findByText('This branch has its own policy.')).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/A manager must approve a receptionist/));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/pos/settings/customer-phone/branches/b-own', { requireManagerApproval: true }));
    fireEvent.click(screen.getByText('Use the salon-wide policy'));
    await waitFor(() => expect(api.del).toHaveBeenCalledWith('/pos/settings/customer-phone/branches/b-own'));
  });
  it('a failed load shows the error, never the safe defaults', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('500'));
    render(<POSCustomerPhoneSettingsScreen />);
    expect(await screen.findByRole('alert')).toHaveTextContent('500');
    expect(screen.queryByLabelText(/A manager must approve/)).toBeNull();
  });
});
