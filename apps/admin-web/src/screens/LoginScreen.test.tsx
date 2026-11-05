// Super Admin Portal login — the two-column design driving the REAL POST /auth/login (portal 'super-admin').
// SUPER_ADMIN MFA is mandatory server-side, so the covered flow is: email/username + password → MFA_REQUIRED →
// "Verify Your Identity" (6-digit) → SUCCESS. Verifies the layout, the submit gate, that Remember Me reaches the
// backend, the mandatory MFA step (and that the code is relayed), a rejected code, and credential-failure surfacing.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { setPrincipal } = vi.hoisted(() => ({ setPrincipal: vi.fn() }));
const login = vi.hoisted(() => vi.fn(async (..._a: any[]): Promise<any> => ({ ok: true, outcome: 'SUCCESS', principal: { id: 'admin1', role: 'SUPER_ADMIN' } })));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ setPrincipal }) }));
vi.mock('../api/authApi', () => ({ authApi: { login: (...a: unknown[]) => login(...a) } }));

import { LoginScreen } from './LoginScreen';

const fill = (email = 'superadmin@aipowersalon.com', pw = 'secret') => {
  fireEvent.change(screen.getByLabelText('Email or Username'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: pw } });
};

beforeEach(() => { setPrincipal.mockClear(); login.mockClear(); login.mockResolvedValue({ ok: true, outcome: 'SUCCESS', principal: { id: 'admin1', role: 'SUPER_ADMIN' } }); });

describe('Super Admin LoginScreen', () => {
  it('renders the reference layout', () => {
    render(<LoginScreen />);
    expect(screen.getByText('SUPER ADMIN PORTAL')).toBeInTheDocument();
    expect(screen.getByText('Welcome Back')).toBeInTheDocument();
    expect(screen.getByText('Sign in to your Super Admin portal')).toBeInTheDocument();
    expect(screen.getByText('Platform Overview')).toBeInTheDocument();
    expect(screen.getByText('Tenant Management')).toBeInTheDocument();
    expect(screen.getByText('Payments & Revenue')).toBeInTheDocument();
    expect(screen.getByText('Secure super admin access only')).toBeInTheDocument();
  });

  it('disables Sign In until email/username and password are entered', () => {
    render(<LoginScreen />);
    const btn = screen.getByRole('button', { name: /sign in/i });
    expect(btn).toBeDisabled();
    fill();
    expect(btn).not.toBeDisabled();
  });

  it('signs in (no MFA) on the super-admin portal and stores the principal, sending rememberMe', async () => {
    render(<LoginScreen />);
    fill();
    fireEvent.click(screen.getByLabelText('Remember me'));
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await waitFor(() => expect(login).toHaveBeenCalledTimes(1));
    expect(login.mock.calls[0][0]).toMatchObject({ portal: 'super-admin', identifier: 'superadmin@aipowersalon.com', password: 'secret', rememberMe: true });
    await waitFor(() => expect(setPrincipal).toHaveBeenCalledWith({ id: 'admin1', role: 'SUPER_ADMIN' }));
  });

  it('enforces the mandatory MFA step, then verifies with the 6-digit code', async () => {
    login
      .mockResolvedValueOnce({ ok: false, outcome: 'MFA_REQUIRED', maskedPhone: '(***) ***-4829' })
      .mockResolvedValueOnce({ ok: true, outcome: 'SUCCESS', principal: { id: 'admin1' } });
    render(<LoginScreen />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText('Verify Your Identity')).toBeInTheDocument();
    expect(screen.getByText(/4829/)).toBeInTheDocument(); // masked phone from the server
    const code = screen.getByLabelText('6-digit verification code');
    expect(screen.getByRole('button', { name: 'Verify' })).toBeDisabled(); // empty code cannot submit
    fireEvent.change(code, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(login).toHaveBeenLastCalledWith(expect.objectContaining({ portal: 'super-admin', mfaCode: '123456' })));
    await waitFor(() => expect(setPrincipal).toHaveBeenCalled());
  });

  it('shows an invalid-code message when the code is rejected', async () => {
    login
      .mockResolvedValueOnce({ ok: false, outcome: 'MFA_REQUIRED' })
      .mockResolvedValueOnce({ ok: false, outcome: 'MFA_REQUIRED' });
    render(<LoginScreen />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    const code = await screen.findByLabelText('6-digit verification code');
    fireEvent.change(code, { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByText(/wasn't valid/i)).toBeInTheDocument();
  });

  it('surfaces a credential failure message', async () => {
    login.mockResolvedValueOnce({ ok: false, outcome: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' });
    render(<LoginScreen />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText('Invalid email or password.')).toBeInTheDocument();
  });
});
