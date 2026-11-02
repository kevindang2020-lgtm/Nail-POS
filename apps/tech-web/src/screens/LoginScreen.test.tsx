// LoginScreen.test.tsx — the technician login screen renders the reference layout and drives the REAL auth call.
// The smoke test already covers mount; this asserts the visible content and the "Remember Me" wiring fix (the flag
// is now actually sent to /auth/login, where the server turns it into the extended session TTL).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { TechNavProvider } from '../shell/nav';

const login = vi.fn(async (..._a: any[]): Promise<any> => ({
  ok: true, outcome: 'SUCCESS',
  principal: { userId: 'u1', tenantId: 't1', branchId: 'b1', role: 'TECHNICIAN', permissions: [] },
}));

vi.mock('../api/authApi', () => ({
  authApi: {
    login: (...a: unknown[]) => login(...a),
    me: async () => null,
    requestPasswordReset: async () => ({ ok: true }),
    branches: async () => ({ ok: true, branches: [] }),
    selectBranch: async () => ({ ok: true }),
    logout: async () => ({ ok: true }),
  },
}));
// No biometric hardware in the test environment → no Face ID button, which keeps these assertions focused.

import { LoginScreen } from '../screens/LoginScreen';

const renderLogin = () => render(<TechNavProvider><LoginScreen /></TechNavProvider>);
beforeEach(() => login.mockClear());

describe('Technician LoginScreen', () => {
  it('renders the reference layout', () => {
    renderLogin();
    expect(screen.getByAltText('AI PowerSalon')).toBeInTheDocument();
    expect(screen.getByText('TECHNICIAN APP')).toBeInTheDocument();
    expect(screen.getByText('Welcome Back')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Email or Mobile Number')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Password')).toBeInTheDocument();
    expect(screen.getByText('Remember Me')).toBeInTheDocument();
    expect(screen.getByText('Forgot Password?')).toBeInTheDocument();
    expect(screen.getByText(/Today.s Schedule/)).toBeInTheDocument();
    expect(screen.getByText('Client Queue')).toBeInTheDocument();
    expect(screen.getByText('Earnings')).toBeInTheDocument();
    expect(screen.getByText('Secure technician access only')).toBeInTheDocument();
  });

  it('toggles password visibility', () => {
    renderLogin();
    const pw = screen.getByLabelText('Password') as HTMLInputElement;
    expect(pw.type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: /show password/i }));
    expect(pw.type).toBe('text');
  });

  it('sends rememberMe=true and a trimmed identifier to the real login call', async () => {
    renderLogin();
    fireEvent.change(screen.getByLabelText('Salon code'), { target: { value: 'GLOW' } });
    fireEvent.change(screen.getByLabelText('Email or Mobile Number'), { target: { value: '  tech@salon.com  ' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw123456' } });
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    await waitFor(() => expect(login).toHaveBeenCalledTimes(1));
    expect(login).toHaveBeenCalledWith(expect.objectContaining({
      portal: 'tenant', salonCode: 'GLOW', identifier: 'tech@salon.com', rememberMe: true,
    }));
  });

  it('sends rememberMe=false when the box is unchecked', async () => {
    renderLogin();
    fireEvent.click(screen.getByLabelText('Remember Me')); // default true → false
    fireEvent.change(screen.getByLabelText('Salon code'), { target: { value: 'GLOW' } });
    fireEvent.change(screen.getByLabelText('Email or Mobile Number'), { target: { value: 'tech@salon.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw123456' } });
    fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    await waitFor(() => expect(login).toHaveBeenCalled());
    expect(login).toHaveBeenCalledWith(expect.objectContaining({ rememberMe: false }));
  });
});
