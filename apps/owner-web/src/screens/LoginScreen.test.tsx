// LoginScreen (owner sign-in) — matches the reference design and drives the REAL /auth/login on the OWNER portal.
// Owners have several salons and therefore no single salon code, so none is sent. Verifies the layout, the submit
// gate (email/phone + password required; Owner Access Code optional), that Remember Me and the Owner Access Code
// reach the backend, and that failures surface a message rather than failing silently.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const setPrincipal = vi.hoisted(() => vi.fn());
const login = vi.hoisted(() => vi.fn(async (..._args: any[]): Promise<any> => ({ ok: true, principal: { userId: 'u1', role: 'OWNER' } })));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ setPrincipal }) }));
vi.mock('../api/authApi', () => ({ authApi: { login: (...a: unknown[]) => login(...a), me: async () => null } }));
// no biometric hardware in the test environment → no Face ID button, keeping these assertions focused
// Face ID and the native token live in the shared package since the Sep 2026 merge
vi.mock('@aipowersalon/mobile-sdk', async (orig) => ({ ...(await orig<typeof import('@aipowersalon/mobile-sdk')>()), faceIdMode: async () => 'none', signInWithFaceId: async () => null, saveNativeToken: async () => {}, tokenFromResponse: () => null }));
vi.mock('../api/ownerPublicApi', () => ({ ownerPublicApi: { requestAccess: vi.fn(async () => ({ ok: true })) } }));

import { LoginScreen } from './LoginScreen';

const fill = () => {
  fireEvent.change(screen.getByLabelText('Email or Mobile Number'), { target: { value: '  kim@salon.com  ' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw123456' } });
};

beforeEach(() => { setPrincipal.mockClear(); login.mockClear(); login.mockResolvedValue({ ok: true, principal: { userId: 'u1', role: 'OWNER' } }); });

describe('Owner LoginScreen', () => {
  it('renders the reference layout', () => {
    render(<LoginScreen />);
    expect(screen.getByAltText('AI PowerSalon')).toBeInTheDocument();
    expect(screen.getByText('OWNER APP')).toBeInTheDocument();
    expect(screen.getByText('Welcome Back')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Email or Mobile Number')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Password')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Owner Access Code')).toBeInTheDocument();
    expect(screen.getByText('Remember Me')).toBeInTheDocument();
    expect(screen.getByText('Forgot Password?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /request access/i })).toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Bookings')).toBeInTheDocument();
    expect(screen.getByText('Reports')).toBeInTheDocument();
    expect(screen.getByText('Secure owner access only')).toBeInTheDocument();
  });

  it('disables Sign In until email/phone + password are filled (access code optional)', () => {
    render(<LoginScreen />);
    const btn = screen.getByRole('button', { name: 'Sign In' });
    expect(btn).toBeDisabled();
    fill();
    expect(btn).toBeEnabled();
  });

  it('logs in on the OWNER portal with rememberMe and a trimmed identifier — and no salon code', async () => {
    render(<LoginScreen />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    await waitFor(() => expect(login).toHaveBeenCalledTimes(1));
    const body: any = login.mock.calls[0][0];
    expect(body).toMatchObject({ portal: 'owner', identifier: 'kim@salon.com', password: 'pw123456', rememberMe: true });
    expect(body).not.toHaveProperty('salonCode');
    expect(setPrincipal).toHaveBeenCalledWith({ userId: 'u1', role: 'OWNER' });
  });

  it('sends the Owner Access Code when provided, and rememberMe=false when unchecked', async () => {
    render(<LoginScreen />);
    fill();
    fireEvent.change(screen.getByLabelText('Owner Access Code'), { target: { value: 'GOLD-7788' } });
    fireEvent.click(screen.getByLabelText('Remember Me')); // default true → false
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    await waitFor(() => expect(login).toHaveBeenCalled());
    expect(login.mock.calls[0][0]).toMatchObject({ ownerAccessCode: 'GOLD-7788', rememberMe: false });
  });

  it('shows the server message when login returns no principal', async () => {
    login.mockResolvedValueOnce({ ok: false, principal: null, message: 'Invalid credentials.' });
    render(<LoginScreen />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    expect(await screen.findByText('Invalid credentials.')).toBeInTheDocument();
    expect(setPrincipal).not.toHaveBeenCalled();
  });

  it('surfaces a fallback message when the request throws', async () => {
    login.mockRejectedValueOnce(new Error('Network down'));
    render(<LoginScreen />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    expect(await screen.findByText('Network down')).toBeInTheDocument();
  });
});
