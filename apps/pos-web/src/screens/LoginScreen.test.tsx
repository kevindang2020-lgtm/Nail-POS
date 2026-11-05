import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ principal: null, loading: false, setPrincipal: () => {}, logout: async () => {} }) }));
const login = vi.fn();
vi.mock('../api/authApi', () => ({ authApi: { login: (b: any) => login(b), branches: vi.fn(), selectBranch: vi.fn() } }));

import { LoginScreen, outcomeToState } from './LoginScreen';

beforeEach(() => { login.mockReset(); });

describe('POS LoginScreen', () => {
  it('renders the official logo, brand name and tagline', () => {
    render(<LoginScreen />);
    expect(screen.getAllByAltText('AI PowerSalon').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/SMARTER SALON\. STRONGER BUSINESS\./i).length).toBeGreaterThan(0);
    expect(screen.getByText('Welcome Back')).toBeInTheDocument();
    expect(screen.getByText('Sign in to your POS system')).toBeInTheDocument();
  });

  it('renders all three platform benefits', () => {
    render(<LoginScreen />);
    expect(screen.getByText('Fast Check-In')).toBeInTheDocument();
    expect(screen.getByText('Smart Booking')).toBeInTheDocument();
    expect(screen.getByText('Seamless Checkout')).toBeInTheDocument();
  });

  it('renders the three labelled fields (labels, not just placeholders)', () => {
    render(<LoginScreen />);
    expect(screen.getByLabelText('Email or Phone Number')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByLabelText('Store Code')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter your email or phone number')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter your password')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter store code')).toBeInTheDocument();
  });

  it('renders remember me, forgot password, support and the security message', () => {
    render(<LoginScreen />);
    expect(screen.getByLabelText(/Remember me/i)).toBeInTheDocument();
    expect(screen.getByText('Forgot password?')).toHaveAttribute('href', '/forgot-password');
    expect(screen.getByText(/Need Help\? Contact Support/i).closest('a')).toHaveAttribute('href', 'https://aipowersalon.com/support');
    expect(screen.getByText('Secure access for authorized staff only')).toBeInTheDocument();
  });

  it('toggles password visibility with an accessible control', () => {
    render(<LoginScreen />);
    const pw = screen.getByLabelText('Password') as HTMLInputElement;
    expect(pw.type).toBe('password');
    fireEvent.click(screen.getByRole('button', { name: /show password/i }));
    expect((screen.getByLabelText('Password') as HTMLInputElement).type).toBe('text');
    fireEvent.click(screen.getByRole('button', { name: /hide password/i }));
    expect((screen.getByLabelText('Password') as HTMLInputElement).type).toBe('password');
  });

  it('shows field-level validation and does NOT call the API when empty', () => {
    render(<LoginScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    expect(screen.getByText('Enter your email or phone number.')).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    expect(screen.getByText('Enter your store code.')).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it('submits store code as salonCode with portal tenant, trimmed, and never sends tenantId/role', async () => {
    login.mockResolvedValue({ outcome: 'SUCCESS', principal: { id: 'u1' } });
    render(<LoginScreen />);
    fireEvent.change(screen.getByLabelText('Email or Phone Number'), { target: { value: ' staff@salon.com ' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.change(screen.getByLabelText('Store Code'), { target: { value: ' MERCH01 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    await waitFor(() => expect(login).toHaveBeenCalled());
    const body = login.mock.calls[0][0];
    expect(body).toMatchObject({ portal: 'tenant', salonCode: 'MERCH01', identifier: 'staff@salon.com', password: 'pw', rememberMe: true });
    expect(body).not.toHaveProperty('tenantId');   // tenant/branch/role are SERVER-derived
    expect(body).not.toHaveProperty('branchId');
    expect(body).not.toHaveProperty('role');
  });

  it('Enter submits the form', async () => {
    login.mockResolvedValue({ outcome: 'SUCCESS', principal: { id: 'u1' } });
    const { container } = render(<LoginScreen />);
    fireEvent.change(screen.getByLabelText('Email or Phone Number'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.change(screen.getByLabelText('Store Code'), { target: { value: 'S1' } });
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(login).toHaveBeenCalled());
  });

  it('shows a safe generic error that does not confirm account existence', async () => {
    login.mockResolvedValue({ outcome: 'INVALID', message: 'The login information is incorrect or you do not have access to this store.' });
    render(<LoginScreen />);
    fireEvent.change(screen.getByLabelText('Email or Phone Number'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'bad' } });
    fireEvent.change(screen.getByLabelText('Store Code'), { target: { value: 'S1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/incorrect or you do not have access/i);
    expect(alert.textContent).not.toMatch(/no such user|user not found|wrong password|store does not exist/i);
  });

  it('shows the network-failure message', async () => {
    login.mockRejectedValue(new Error('Failed to fetch'));
    render(<LoginScreen />);
    fireEvent.change(screen.getByLabelText('Email or Phone Number'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.change(screen.getByLabelText('Store Code'), { target: { value: 'S1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Unable to connect to AI PowerSalon/i);
  });

  it('surfaces the MFA step when the backend requires it', async () => {
    login.mockResolvedValue({ outcome: 'MFA_REQUIRED' });
    render(<LoginScreen />);
    fireEvent.change(screen.getByLabelText('Email or Phone Number'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.change(screen.getByLabelText('Store Code'), { target: { value: 'S1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    expect(await screen.findByLabelText('Verification Code')).toBeInTheDocument();
  });

  it('disables the button and shows a loading state while signing in', async () => {
    let resolve: any;
    login.mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<LoginScreen />);
    fireEvent.change(screen.getByLabelText('Email or Phone Number'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.change(screen.getByLabelText('Store Code'), { target: { value: 'S1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    const btn = await screen.findByRole('button', { name: 'Signing in…' });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);                                  // duplicate submit blocked
    expect(login).toHaveBeenCalledTimes(1);
    resolve({ outcome: 'SUCCESS', principal: { id: 'u1' } });
  });

  it('never puts the password in browser storage', async () => {
    login.mockResolvedValue({ outcome: 'SUCCESS', principal: { id: 'u1' } });
    render(<LoginScreen />);
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'sup3rsecret' } });
    fireEvent.change(screen.getByLabelText('Email or Phone Number'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText('Store Code'), { target: { value: 'S1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    await waitFor(() => expect(login).toHaveBeenCalled());
    expect(JSON.stringify(localStorage)).not.toContain('sup3rsecret');
    expect(JSON.stringify(sessionStorage)).not.toContain('sup3rsecret');
  });

  const fill = () => {
    fireEvent.change(screen.getByLabelText('Email or Phone Number'), { target: { value: 'a@b.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.change(screen.getByLabelText('Store Code'), { target: { value: 'S1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
  };

  it('SECURITY: a nonexistent store code is indistinguishable from a wrong password', () => {
    const a = outcomeToState('INVALID_CREDENTIALS', 'bad password');
    const b = outcomeToState('TENANT_NOT_FOUND', 'no such salon');
    expect(a).toEqual(b);                                  // identical state AND identical text
    expect(a.message).toBe('The login information is incorrect or you do not have access to this store.');
    expect(a.message).not.toMatch(/store|salon|user|password/i.test('') ? /x/ : /no such|not found|disabled/i);
  });

  it('shows the account-locked state with reset and support paths', async () => {
    login.mockResolvedValue({ outcome: 'RATE_LIMITED', message: 'Too many sign-in attempts. Try again in about 5 minutes.' });
    render(<LoginScreen />);
    fill();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/Too many sign-in attempts/i);
    expect(alert.querySelector('a[href="/forgot-password"]')).toBeTruthy();
    expect(alert.querySelector('a[href="https://aipowersalon.com/support"]')).toBeTruthy();
  });

  it('shows a safe account-access state for a suspended tenant, with a support path', async () => {
    login.mockResolvedValue({ outcome: 'TENANT_SUSPENDED', message: 'This salon account is currently suspended. Please contact AIPowerSalon support.' });
    render(<LoginScreen />);
    fill();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/suspended/i);
    expect(alert.querySelector('a[href="https://aipowersalon.com/support"]')).toBeTruthy();
  });

  it('shows the account-access state for a disabled user', async () => {
    login.mockResolvedValue({ outcome: 'USER_DISABLED', message: 'Your user account is currently disabled. Please contact your salon owner or manager.' });
    render(<LoginScreen />);
    fill();
    expect((await screen.findByRole('alert')).textContent).toMatch(/disabled/i);
  });

  it('maps every account outcome to the account state, and unknown outcomes to the generic error', () => {
    for (const o of ['TENANT_SUSPENDED', 'TENANT_CANCELLED', 'USER_DISABLED', 'SUBSCRIPTION_BLOCKED']) {
      expect(outcomeToState(o, 'msg').kind).toBe('account');
    }
    expect(outcomeToState('RATE_LIMITED', 'm').kind).toBe('locked');
    expect(outcomeToState('SOMETHING_NEW', 'leaky internal detail').kind).toBe('error');
    expect(outcomeToState('SOMETHING_NEW', 'leaky internal detail').message).not.toContain('leaky');
  });

  it('falls back to the CSS marble scene when no licensed salon photo is present', () => {
    render(<LoginScreen />);
    const photo = screen.getByTestId('salon-photo') as HTMLImageElement;
    // no /brand/salon-interior.jpg ships in the repo → the probe is transparent and the CSS scene shows through
    expect(photo.style.opacity).toBe('0');
    fireEvent.error(photo);
    expect(photo.style.opacity).toBe('0');
  });

  it('uses the licensed salon photo automatically once one is dropped in', () => {
    render(<LoginScreen />);
    const photo = screen.getByTestId('salon-photo') as HTMLImageElement;
    expect(photo.getAttribute('src')).toBe('/brand/salon-interior.jpg');
    fireEvent.load(photo);                       // simulates the asset existing
    expect(photo.style.opacity).toBe('1');
  });

  it('the decorative scene is hidden from screen readers', () => {
    const { container } = render(<LoginScreen />);
    const scene = container.querySelector('[aria-hidden]');
    expect(scene).toBeTruthy();
    expect(screen.getByTestId('salon-photo').getAttribute('alt')).toBe('');
  });

  it('an inactive branch shows the account-access state with a support path (not a wrong-password error)', async () => {
    login.mockResolvedValue({ outcome: 'BRANCH_INACTIVE', message: 'This salon location is not currently active. Please contact your salon owner or manager.' });
    render(<LoginScreen />);
    fill();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/not currently active/i);
    expect(alert.querySelector('a[href="https://aipowersalon.com/support"]')).toBeTruthy();
    expect(outcomeToState('BRANCH_INACTIVE', 'x').kind).toBe('account');
  });

  it('accepts a PHONE NUMBER as the login identifier (phone is the username)', async () => {
    login.mockResolvedValue({ outcome: 'SUCCESS', principal: { id: 'u1' } });
    render(<LoginScreen />);
    fireEvent.change(screen.getByLabelText('Email or Phone Number'), { target: { value: '(856) 555-1234' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'pw' } });
    fireEvent.change(screen.getByLabelText('Store Code'), { target: { value: 'S1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    await waitFor(() => expect(login).toHaveBeenCalled());
    // the raw phone is passed through as the identifier; the BACKEND normalizes it to E.164
    expect(login.mock.calls[0][0].identifier).toBe('(856) 555-1234');
  });

  it('the identifier field carries the correct autocomplete semantics for a password manager', () => {
    render(<LoginScreen />);
    expect(screen.getByLabelText('Email or Phone Number')).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password');
  });

  it('the salon photo is DECORATIVE — empty alt, and never announced to a screen reader', () => {
    render(<LoginScreen />);
    const img = screen.getByTestId('salon-photo');
    expect(img).toHaveAttribute('alt', '');            // decorative: it carries no information
    expect(img.closest('[aria-hidden="true"]')).toBeTruthy();
    // it has NO accessible name, so assistive tech skips it entirely. (Note the LOGO legitimately does have
    // one — "AI PowerSalon" — which is why this asserts the element's own properties rather than searching by
    // name.)
    expect(img.getAttribute('aria-label')).toBeNull();
    expect(img.getAttribute('title')).toBeNull();
  });

  it('serves responsive WebP with a JPEG fallback — a laptop never pulls the 2x asset', () => {
    render(<LoginScreen />);
    const img = screen.getByTestId('salon-photo');
    const picture = img.closest('picture')!;
    const webp = picture.querySelector('source[type="image/webp"]')!;

    expect(webp.getAttribute('srcset')).toMatch(/salon-interior-700\.webp 700w/);
    expect(webp.getAttribute('srcset')).toMatch(/salon-interior-1400\.webp 1400w/);
    expect(img.getAttribute('srcset')).toMatch(/salon-interior-1000\.jpg 1000w/);
    // the photo is the backdrop of the whole sign-in page (developer redesign, Oct 2026)
    expect(webp.getAttribute('sizes')).toBe('100vw');
    expect(img).toHaveAttribute('src');                 // and a plain src for anything without srcset support
  });

  it('a MISSING photo leaves no broken image — the marble/gold scene simply stands', () => {
    render(<LoginScreen />);
    const img = screen.getByTestId('salon-photo') as HTMLImageElement;
    fireEvent.error(img);
    expect(img.style.opacity).toBe('0');                // invisible, not a broken-image icon
  });
});
