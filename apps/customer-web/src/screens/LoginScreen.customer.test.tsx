import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const login = vi.fn();
const me = vi.fn();
vi.mock('../api/authApi', () => ({ authApi: { login: (b: any) => login(b), me: () => me(), logout: vi.fn(), branches: vi.fn(), selectBranch: vi.fn() } }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ principal: null, loading: false, setPrincipal: () => {}, logout: async () => {} }) }));
vi.mock('../auth/faceid', () => ({
  faceIdMode: async () => 'web',
  // a cancelled prompt must NOT surface as an authentication failure
  signInWithFaceId: vi.fn(async () => { throw Object.assign(new Error('Face ID was cancelled.'), { reason: 'cancelled' }); }),
  enrollFaceId: vi.fn(),
  clearFaceId: vi.fn(),
}));

import { LoginScreen } from './LoginScreen';
import { isGuestAllowed, SIGN_IN_PROMPT } from '../auth/guest';

beforeEach(() => { login.mockReset(); me.mockReset(); });
afterEach(() => { cleanup(); });

const fill = () => {
  fireEvent.change(screen.getByLabelText('Phone or Email'), { target: { value: 'sam@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
};

describe('the screen matches the reference', () => {
  it('renders the logo, app badge, title and subtitle', () => {
    render(<LoginScreen />);
    expect(screen.getByAltText('AI PowerSalon')).toBeInTheDocument();
    // The tagline now lives in the logo artwork; the text badge names the app.
    expect(screen.getByText('CUSTOMER APP')).toBeInTheDocument();
    expect(screen.getByText('Welcome Back')).toBeInTheDocument();
    expect(screen.getByText(/Sign in to book appointments/i)).toBeInTheDocument();
  });

  it('renders both fields, Remember me, Forgot password, Sign In, OR and Create Account', () => {
    render(<LoginScreen />);
    expect(screen.getByPlaceholderText('Phone or Email')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Password')).toBeInTheDocument();
    expect(screen.getByLabelText(/Remember me/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Forgot password?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
    expect(screen.getByText('OR')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create Account' })).toBeInTheDocument();
  });

  it('renders the Face ID card, Guest card, quick shortcuts and footer', () => {
    render(<LoginScreen />);
    expect(screen.getByText('Face ID')).toBeInTheDocument();
    expect(screen.getByText('Biometric Login')).toBeInTheDocument();
    expect(screen.getByText('Continue as Guest')).toBeInTheDocument();
    expect(screen.getByText('Browse Services')).toBeInTheDocument();
    expect(screen.getByText('Quick Shortcuts')).toBeInTheDocument();
    expect(screen.getByText('Appointment')).toBeInTheDocument();
    expect(screen.getByText('Deals')).toBeInTheDocument();
    expect(screen.getByText('Wallet')).toBeInTheDocument();
    expect(screen.getByText('Secure access. Your data is protected.')).toBeInTheDocument();
  });

  it('toggles password visibility with an accessible control', () => {
    render(<LoginScreen />);
    expect((screen.getByLabelText('Password') as HTMLInputElement).type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: /show password/i }));
    expect((screen.getByLabelText('Password') as HTMLInputElement).type).toBe('text');
  });
});

describe('sign in', () => {
  it('posts portal "customer" with NO salon code — customers do not have one', async () => {
    login.mockResolvedValue({ outcome: 'SUCCESS', principal: { role: 'CUSTOMER' } });
    render(<LoginScreen />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    await waitFor(() => expect(login).toHaveBeenCalled());
    const body = login.mock.calls[0][0];
    expect(body.portal).toBe('customer');
    expect(body).not.toHaveProperty('salonCode');
    // and never a client-chosen identity
    expect(body).not.toHaveProperty('tenantId');
    expect(body).not.toHaveProperty('role');
  });

  it('validates empty fields without calling the API', () => {
    render(<LoginScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    expect(screen.getByRole('alert').textContent).toMatch(/phone number or email/i);
    expect(login).not.toHaveBeenCalled();
  });

  it('shows a safe error that does not confirm whether the account exists', async () => {
    login.mockResolvedValue({ outcome: 'INVALID_CREDENTIALS', message: 'The login information is incorrect. Please try again.' });
    render(<LoginScreen />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/incorrect/i);
    expect(alert.textContent).not.toMatch(/no account|not found|unknown|no such/i);
  });

  it('shows the network message and a loading state', async () => {
    login.mockRejectedValue(new Error('Failed to fetch'));
    render(<LoginScreen />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Unable to connect to AI PowerSalon/i);
  });
});

describe('Face ID', () => {
  it('a CANCELLED prompt is not treated as an authentication failure', async () => {
    render(<LoginScreen />);
    fireEvent.click(screen.getByRole('button', { name: /^Sign in with Face ID/i }));
    // the mocked signInWithFaceId throws "cancelled" — no error banner should appear
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('clicking a Quick Shortcut sets the target route and triggers Face ID', async () => {
    const { signInWithFaceId } = await import('../auth/faceid');
    render(<LoginScreen />);
    fireEvent.click(screen.getByRole('button', { name: /Book Appointment with Face ID/i }));
    expect(sessionStorage.getItem('aps_customer_target_route')).toBe('/book');
    expect(signInWithFaceId).toHaveBeenCalled();
  });
});

describe('guest mode — private data is unreachable', () => {
  it('public browsing routes ARE allowed', () => {
    expect(isGuestAllowed('/customer/salons/nearby')).toBe(true);
    expect(isGuestAllowed('/customer/salons/abc')).toBe(true);
    expect(isGuestAllowed('/customer/salons/abc/services')).toBe(true);
    expect(isGuestAllowed('/customer/salons/abc/technicians')).toBe(true);
  });

  it('EVERY private customer route is refused', () => {
    for (const p of [
      '/customer/home', '/customer/appointments', '/customer/loyalty', '/customer/rewards',
      '/customer/receipts', '/customer/membership', '/customer/addresses', '/customer/deals',
      '/auth/me', '/customer/me/security/sessions', '/customer/me/favorite-salons',
    ]) {
      expect(isGuestAllowed(p), `${p} must be refused for a guest`).toBe(false);
    }
  });

  it('a protected action prompts sign-in rather than failing silently', () => {
    expect(SIGN_IN_PROMPT.rewards).toMatch(/sign in/i);
    expect(SIGN_IN_PROMPT.book).toMatch(/sign in/i);
    expect(SIGN_IN_PROMPT.payment).toMatch(/sign in/i);
  });
});

describe('the salon background', () => {
  it('is DECORATIVE — empty alt, aria-hidden, no accessible name', () => {
    render(<LoginScreen />);
    const img = screen.getByTestId('salon-bg');
    expect(img).toHaveAttribute('alt', '');
    expect(img.closest('[aria-hidden="true"]')).toBeTruthy();
    expect(img.getAttribute('aria-label')).toBeNull();
  });

  it('serves responsive WebP with a JPEG fallback — a phone never downloads the 1080 asset', () => {
    render(<LoginScreen />);
    const img = screen.getByTestId('salon-bg');
    const webp = img.closest('picture')!.querySelector('source[type="image/webp"]')!;

    expect(webp.getAttribute('srcset')).toMatch(/salon-bg-480\.webp 480w/);
    expect(webp.getAttribute('srcset')).toMatch(/salon-bg-1080\.webp 1080w/);
    expect(img.getAttribute('srcset')).toMatch(/salon-bg-760\.jpg 760w/);
    expect(webp.getAttribute('sizes')).toBe('100vw');   // full-bleed background
  });

  it('a MISSING file leaves no broken image — the marble/gold composition stands', () => {
    render(<LoginScreen />);
    const img = screen.getByTestId('salon-bg') as HTMLImageElement;
    fireEvent.error(img);
    expect(img.style.opacity).toBe('0');
  });
});
