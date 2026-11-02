// ActivateAccountScreen.test.tsx — the first-time activation UI: phone → six-digit code → (salon choice) → in.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const post = vi.fn();
const get = vi.fn();
vi.mock('../api/client', () => ({ api: { post: (p: string, b: any) => post(p, b), get: (p: string) => get(p) } }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ principal: null, loading: false, setPrincipal: () => {}, logout: async () => {} }) }));

import { ActivateAccountScreen } from './ActivateAccountScreen';

beforeEach(() => { post.mockReset(); get.mockReset(); });

const fillPhone = () => fireEvent.change(screen.getByLabelText('Mobile Phone Number'), { target: { value: '(856) 555-1234' } });

describe('step 1 — phone only', () => {
  it('asks ONLY for the phone number (no password, no email, no salon code)', () => {
    render(<ActivateAccountScreen onBack={() => {}} onFindSalon={() => {}} />);
    expect(screen.getByText('Create Your Account')).toBeInTheDocument();
    expect(screen.getByText(/Enter the phone number connected to your salon profile/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Mobile Phone Number')).toBeInTheDocument();
    expect(screen.queryByLabelText(/password/i)).toBeNull();
    expect(screen.queryByLabelText(/email/i)).toBeNull();
    expect(screen.queryByLabelText(/salon code/i)).toBeNull();
  });

  it('validates an empty phone without calling the API', () => {
    render(<ActivateAccountScreen onBack={() => {}} onFindSalon={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send Verification Code' }));
    expect(screen.getByRole('alert').textContent).toMatch(/enter your mobile phone number/i);
    expect(post).not.toHaveBeenCalled();
  });

  it('sends the code and moves to the verify step, showing only the MASKED number', async () => {
    post.mockResolvedValue({ ok: true, message: 'If this phone number is eligible, a verification code will be sent shortly.', maskedPhone: '••••1234' });
    render(<ActivateAccountScreen onBack={() => {}} onFindSalon={() => {}} />);
    fillPhone();
    fireEvent.click(screen.getByRole('button', { name: 'Send Verification Code' }));
    await waitFor(() => expect(screen.getByText('Verify Your Phone')).toBeInTheDocument());
    expect(screen.getByText(/ending in ••••1234/)).toBeInTheDocument();
    expect(screen.queryByText(/8565551234/)).toBeNull();          // the full number is never shown back
    expect(post.mock.calls[0][0]).toBe('/customer/auth/activation/request-code');
  });

  it('reports an SMS outage honestly — it never claims a code was sent', async () => {
    post.mockRejectedValue(Object.assign(new Error('We could not send a verification code right now. Please try again or contact support.'), { code: 'sms_unavailable' }));
    render(<ActivateAccountScreen onBack={() => {}} onFindSalon={() => {}} />);
    fillPhone();
    fireEvent.click(screen.getByRole('button', { name: 'Send Verification Code' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/could not send a verification code/i);
    expect(screen.queryByText('Verify Your Phone')).toBeNull();   // does NOT advance
  });

  it('shows the network-failure message', async () => {
    post.mockRejectedValue(new Error('Failed to fetch'));
    render(<ActivateAccountScreen onBack={() => {}} onFindSalon={() => {}} />);
    fillPhone();
    fireEvent.click(screen.getByRole('button', { name: 'Send Verification Code' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Unable to connect to AI PowerSalon/i);
  });
});

describe('step 2 — six-digit code', () => {
  const toCodeStep = async () => {
    post.mockResolvedValueOnce({ ok: true, maskedPhone: '••••1234' });
    render(<ActivateAccountScreen onBack={() => {}} onFindSalon={() => {}} />);
    fillPhone();
    fireEvent.click(screen.getByRole('button', { name: 'Send Verification Code' }));
    await waitFor(() => expect(screen.getByText('Verify Your Phone')).toBeInTheDocument());
  };

  it('accepts only digits and caps at six (paste / SMS autofill land here)', async () => {
    await toCodeStep();
    const input = screen.getByLabelText('Verification Code') as HTMLInputElement;
    expect(input.getAttribute('autocomplete')).toBe('one-time-code');   // iOS SMS autofill
    fireEvent.change(input, { target: { value: 'ab12-34 5678' } });
    expect(input.value).toBe('123456');
  });

  it('refuses a short code without calling the API', async () => {
    await toCodeStep();
    fireEvent.change(screen.getByLabelText('Verification Code'), { target: { value: '123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify and Continue' }));
    expect(screen.getByRole('alert').textContent).toMatch(/six-digit code/i);
    expect(post).toHaveBeenCalledTimes(1);                          // only the request-code call
  });

  it('a correct code lands on Phone Verified', async () => {
    await toCodeStep();
    post.mockResolvedValueOnce({ ok: true, outcome: 'SUCCESS', salonName: 'Polished' });
    fireEvent.change(screen.getByLabelText('Verification Code'), { target: { value: '482731' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify and Continue' }));
    await waitFor(() => expect(screen.getByText('Phone Verified')).toBeInTheDocument());
    expect(screen.getByText('Your AI PowerSalon account is ready.')).toBeInTheDocument();
  });

  it('an incorrect code shows a safe error and stays on the step', async () => {
    await toCodeStep();
    post.mockResolvedValueOnce({ ok: false, outcome: 'FAILED', message: 'The verification code is incorrect.' });
    fireEvent.change(screen.getByLabelText('Verification Code'), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify and Continue' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('The verification code is incorrect.');
    expect(alert.textContent).not.toMatch(/customer|profile|tenant|salon id/i);   // nothing leaked
    expect(screen.getByText('Verify Your Phone')).toBeInTheDocument();
  });

  it('resend is disabled during the countdown, and change-phone returns to step 1', async () => {
    await toCodeStep();
    expect(screen.getByRole('button', { name: /Resend in \d+s/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Change phone number' }));
    expect(screen.getByText('Create Your Account')).toBeInTheDocument();
  });
});

describe('multi-salon — the customer chooses', () => {
  it('offers the salons by NAME only, and picking one activates it', async () => {
    post.mockResolvedValueOnce({ ok: true, maskedPhone: '••••1234' });
    render(<ActivateAccountScreen onBack={() => {}} onFindSalon={() => {}} />);
    fillPhone();
    fireEvent.click(screen.getByRole('button', { name: 'Send Verification Code' }));
    await waitFor(() => screen.getByText('Verify Your Phone'));

    post.mockResolvedValueOnce({
      ok: true, outcome: 'SALON_SELECTION_REQUIRED', ticket: 'tkt-1',
      choices: [{ choiceId: '0', salonName: 'Polished' }, { choiceId: '1', salonName: 'Luxe Nails' }],
    });
    fireEvent.change(screen.getByLabelText('Verification Code'), { target: { value: '482731' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify and Continue' }));

    await waitFor(() => expect(screen.getByText('Choose Your Salon')).toBeInTheDocument());
    expect(screen.getByText('Polished')).toBeInTheDocument();
    expect(screen.getByText('Luxe Nails')).toBeInTheDocument();

    post.mockResolvedValueOnce({ ok: true, outcome: 'SUCCESS', salonName: 'Luxe Nails' });
    fireEvent.click(screen.getByText('Luxe Nails'));
    await waitFor(() => expect(screen.getByText('Phone Verified')).toBeInTheDocument());
    // the selection call carries the ticket, never a tenant/customer id
    const call = post.mock.calls.find((c) => c[0] === '/customer/auth/activation/select-salon')!;
    expect(call[1]).toEqual({ ticket: 'tkt-1', choiceId: '1' });
  });
});

describe('a verified phone with NO salon profile is not dead-ended', () => {
  it('offers a way forward (find a salon) instead of a Continue that would 401', async () => {
    const onFindSalon = vi.fn();
    post.mockResolvedValueOnce({ ok: true, maskedPhone: '••••1234' });
    render(<ActivateAccountScreen onBack={() => {}} onFindSalon={onFindSalon} />);
    fireEvent.change(screen.getByLabelText('Mobile Phone Number'), { target: { value: '(856) 555-1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send Verification Code' }));
    await waitFor(() => screen.getByText('Verify Your Phone'));

    // verified, but no salon profile exists → NO session was created by the backend
    post.mockResolvedValueOnce({ ok: true, outcome: 'NEW_CUSTOMER', ticket: 'tkt-9' });
    fireEvent.change(screen.getByLabelText('Verification Code'), { target: { value: '482731' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify and Continue' }));

    await waitFor(() => expect(screen.getByText(/don’t have a salon profile linked to this number yet/i)).toBeInTheDocument());
    // there must be NO 'Continue' button — it would call /auth/me, 401, and bounce them to sign-in
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Find Your Salon' }));
    expect(onFindSalon).toHaveBeenCalled();
  });
});
