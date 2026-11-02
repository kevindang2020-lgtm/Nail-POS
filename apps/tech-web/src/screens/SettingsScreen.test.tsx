// SettingsScreen (technician): read-only view of the salon's capability set (On/Off), change-password via
// /auth/change-password, and sign out. Verifies the caps render with correct On/Off, the password-match gate, a successful
// change posting the right payload (and clearing the fields), the failure path, and sign out.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const nav = vi.hoisted(() => ({ back: vi.fn() }));
const auth = vi.hoisted(() => ({ logout: vi.fn() }));
vi.mock('../shell/nav', () => ({ useTechNav: () => nav }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../api/techApi', () => ({ techApi: { settings: vi.fn() } }));
vi.mock('../api/client', () => ({ api: { post: vi.fn() } }));

import { techApi } from '../api/techApi';
import { api } from '../api/client';
import { SettingsScreen } from './SettingsScreen';

const caps = { liveEditEnabled: true, allowServiceEditDuringServing: false, techCanAddService: true, techCanChangeService: true, techCanRemoveLine: false, requireApprovalForChangeService: true, requireApprovalForRemoveLine: false };

beforeEach(() => {
  vi.clearAllMocks();
  (techApi.settings as any).mockResolvedValue(caps);
  (api.post as any).mockResolvedValue({});
});

describe('SettingsScreen', () => {
  it('renders the salon capability set as On/Off', async () => {
    render(<SettingsScreen />);
    expect(await screen.findByText('Live ticket editing')).toBeInTheDocument();
    expect(screen.getByText('Manager approval to change')).toBeInTheDocument();
    expect(screen.getAllByText('On')).toHaveLength(4);    // 4 true caps
    expect(screen.getAllByText('Off')).toHaveLength(3);   // 3 false caps
  });

  it('keeps the update button disabled until the new passwords match', async () => {
    render(<SettingsScreen />);
    await screen.findByText('Live ticket editing');
    const btn = screen.getByText('Update Password') as HTMLButtonElement;
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('Current password'), { target: { value: 'old-pass' } });
    fireEvent.change(screen.getByPlaceholderText('New password'), { target: { value: 'Brand-New-9' } });
    fireEvent.change(screen.getByPlaceholderText('Confirm new password'), { target: { value: 'different' } });
    expect(btn).toBeDisabled();                            // mismatch
    fireEvent.change(screen.getByPlaceholderText('Confirm new password'), { target: { value: 'Brand-New-9' } });
    expect(btn).toBeEnabled();
  });

  it('changes the password with the right payload and clears the fields', async () => {
    render(<SettingsScreen />);
    await screen.findByText('Live ticket editing');
    fireEvent.change(screen.getByPlaceholderText('Current password'), { target: { value: 'old-pass' } });
    fireEvent.change(screen.getByPlaceholderText('New password'), { target: { value: 'Brand-New-9' } });
    fireEvent.change(screen.getByPlaceholderText('Confirm new password'), { target: { value: 'Brand-New-9' } });
    fireEvent.click(screen.getByText('Update Password'));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/auth/change-password', { currentPassword: 'old-pass', newPassword: 'Brand-New-9', confirmPassword: 'Brand-New-9' }));
    expect(await screen.findByText('Password updated.')).toBeInTheDocument();
    expect((screen.getByPlaceholderText('Current password') as HTMLInputElement).value).toBe('');
  });

  it('shows an error when the password change fails', async () => {
    (api.post as any).mockRejectedValue({ message: 'Current password is incorrect.' });
    render(<SettingsScreen />);
    await screen.findByText('Live ticket editing');
    fireEvent.change(screen.getByPlaceholderText('Current password'), { target: { value: 'wrong' } });
    fireEvent.change(screen.getByPlaceholderText('New password'), { target: { value: 'Brand-New-9' } });
    fireEvent.change(screen.getByPlaceholderText('Confirm new password'), { target: { value: 'Brand-New-9' } });
    fireEvent.click(screen.getByText('Update Password'));
    expect(await screen.findByText('Current password is incorrect.')).toBeInTheDocument();
  });

  it('signs out', async () => {
    render(<SettingsScreen />);
    await screen.findByText('Live ticket editing');
    fireEvent.click(screen.getByText('Sign Out'));
    expect(auth.logout).toHaveBeenCalled();
  });
});
