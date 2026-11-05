// ProfileSecurityScreen.test.tsx — Profile → Security: create/change password + active sessions.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const get = vi.fn();
const post = vi.fn();
vi.mock('../api/client', () => ({ api: { get: (p: string) => get(p), post: (p: string, b: any) => post(p, b) } }));

import { ProfileSecurityScreen } from './ProfileSecurityScreen';

const mockApi = (hasPassword: boolean, sessions: any[] = []) => {
  get.mockImplementation(async (p: string) => {
    if (p.endsWith('/status')) return { hasPassword };
    if (p.endsWith('/sessions')) return { sessions };
    return {};
  });
};

beforeEach(() => { get.mockReset(); post.mockReset(); });

describe('a customer with NO password (activated by SMS code)', () => {
  beforeEach(() => mockApi(false));

  it('is prompted to create one, and is NOT asked for a current password', async () => {
    render(<ProfileSecurityScreen />);
    await waitFor(() => expect(screen.getByText(/Create a password to make future sign-ins easier/i)).toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Create Password' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Current Password')).toBeNull();   // they have none — asking would be a dead end
  });

  it('creates the password', async () => {
    post.mockResolvedValue({ ok: true });
    render(<ProfileSecurityScreen />);
    await waitFor(() => screen.getByRole('heading', { name: 'Create Password' }));
    fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 'Str0ng-Passphrase!' } });
    fireEvent.change(screen.getByLabelText('Confirm New Password'), { target: { value: 'Str0ng-Passphrase!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Password' }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/customer/me/security/password/create',
      { newPassword: 'Str0ng-Passphrase!', confirmPassword: 'Str0ng-Passphrase!' }));
    expect(await screen.findByRole('status')).toHaveTextContent(/Password created/i);
  });

  it('refuses a mismatch client-side without calling the API', async () => {
    render(<ProfileSecurityScreen />);
    await waitFor(() => screen.getByRole('heading', { name: 'Create Password' }));
    fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 'aaaaaaaaA1!' } });
    fireEvent.change(screen.getByLabelText('Confirm New Password'), { target: { value: 'different' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Password' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/do not match/i);
    expect(post).not.toHaveBeenCalled();
  });
});

describe('a customer WITH a password', () => {
  beforeEach(() => mockApi(true));

  it('is asked for the current password and gets no create-prompt', async () => {
    render(<ProfileSecurityScreen />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Change Password' })).toBeInTheDocument());
    expect(screen.getByLabelText('Current Password')).toBeInTheDocument();
    expect(screen.queryByText(/Create a password to make future sign-ins easier/i)).toBeNull();
  });

  it('changing the password signs out other devices', async () => {
    post.mockResolvedValue({ ok: true, otherSessionsSignedOut: true });
    render(<ProfileSecurityScreen />);
    await waitFor(() => screen.getByRole('heading', { name: 'Change Password' }));
    fireEvent.change(screen.getByLabelText('Current Password'), { target: { value: 'old-Passphrase-1!' } });
    fireEvent.change(screen.getByLabelText('New Password'), { target: { value: 'New-Passphrase-2!' } });
    fireEvent.change(screen.getByLabelText('Confirm New Password'), { target: { value: 'New-Passphrase-2!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change Password' }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/customer/me/security/password/change', expect.objectContaining({
      currentPassword: 'old-Passphrase-1!', newPassword: 'New-Passphrase-2!',
    })));
    expect(await screen.findByRole('status')).toHaveTextContent(/signed out on other devices/i);
  });
});

describe('active sessions', () => {
  it('lists devices, marks the current one, and can sign the others out', async () => {
    mockApi(true, [
      { id: 's1', current: true, device: 'iPhone', createdAt: '' },
      { id: 's2', current: false, device: 'iPad', createdAt: '' },
    ]);
    post.mockResolvedValue({ ok: true });
    render(<ProfileSecurityScreen />);

    fireEvent.click(await screen.findByRole('button', { name: /Active Sessions/i }));
    await waitFor(() => expect(screen.getByText('iPad')).toBeInTheDocument());
    expect(screen.getByText(/This device/)).toBeInTheDocument();

    // the CURRENT session has no sign-out button — you can't kill the session you're using by accident
    expect(screen.getAllByRole('button', { name: 'Sign out' })).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/customer/me/security/sessions/s2/revoke', {}));
  });

  it('offers sign-out-of-all-other-devices only when there are others', async () => {
    mockApi(true, [{ id: 's1', current: true, device: 'iPhone', createdAt: '' }]);
    render(<ProfileSecurityScreen />);
    fireEvent.click(await screen.findByRole('button', { name: /Active Sessions/i }));
    await waitFor(() => screen.getByText('iPhone'));
    expect(screen.queryByRole('button', { name: /all other devices/i })).toBeNull();
  });
});
