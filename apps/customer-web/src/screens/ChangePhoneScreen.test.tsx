// ChangePhoneScreen.test — the customer's own phone change (BUILD_PLAN Phase 3): password first, failures shown, a
// resend countdown, and the separate sign-in-number step.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('../api/customerApi', () => ({ customerApi: { phoneChangeStart: vi.fn(), phoneChangeSend: vi.fn(), phoneChangeVerify: vi.fn(), phoneChangeCancel: vi.fn(async () => ({})), changeLoginNumber: vi.fn(), phoneStatus: vi.fn() } }));
import { customerApi as api } from '../api/customerApi';
import { ChangePhoneScreen } from './ChangePhoneScreen';

const mount = () => { const onDone = vi.fn(); const onCancel = vi.fn(); render(<ChangePhoneScreen currentMasked="••••0101" onDone={onDone} onCancel={onCancel} />); return { onDone, onCancel }; };
const fillAndSend = async (pw = 'correct-horse') => {
  fireEvent.change(screen.getByLabelText('New phone number'), { target: { value: '856 555 0199' } });
  fireEvent.change(screen.getByLabelText('Your password'), { target: { value: pw } });
  fireEvent.click(screen.getByText('Send verification code'));
};
beforeEach(() => {
  for (const f of Object.values(api)) (f as any).mockReset?.();
  vi.mocked(api.phoneChangeStart).mockResolvedValue({ sessionId: 's1', state: 'pending_phone_saved', maskedPhone: '••••0199', duplicates: {} } as never);
  vi.mocked(api.phoneChangeSend).mockResolvedValue({ state: 'verification_sent', message: 'sent' } as never);
  vi.mocked(api.phoneChangeCancel).mockResolvedValue({} as never);
  vi.mocked(api.phoneStatus).mockRejectedValue(new Error('offline'));
});

describe('changing my number', () => {
  it('sends the password with the change, then the code; resend waits out a countdown', async () => {
    mount();
    await fillAndSend();
    await waitFor(() => expect(api.phoneChangeStart).toHaveBeenCalledWith('856 555 0199', 'correct-horse'));
    expect(await screen.findByText(/We sent a 6-digit code to/)).toHaveTextContent('••••0199');
    expect(screen.getByTestId('resend')).toBeDisabled();
    expect(screen.getByTestId('resend')).toHaveTextContent(/Resend code in \d+s/);
  });
  it('a missing or wrong password is explained', async () => {
    vi.mocked(api.phoneChangeStart).mockRejectedValue(Object.assign(new Error('x'), { code: 'reauth_required' }));
    mount();
    await fillAndSend('');
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter your password to change your phone number.');
  });
  it('a code that could not be sent is SHOWN (it used to be swallowed)', async () => {
    vi.mocked(api.phoneChangeSend).mockRejectedValue(Object.assign(new Error('x'), { code: 'no_provider' }));
    mount();
    await fillAndSend();
    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot send verification codes/);
  });
  it('after the change, using the number to sign in is a separate step with the password again', async () => {
    vi.mocked(api.phoneChangeVerify).mockResolvedValue({ state: 'customer_records_synchronized', activated: true, message: '' } as never);
    vi.mocked(api.changeLoginNumber).mockResolvedValue({ ok: true, maskedNew: '••••0199' } as never);
    mount();
    await fillAndSend();
    fireEvent.change(await screen.findByLabelText('Verification code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByText('Verify and change my number'));
    expect(await screen.findByTestId('phone-changed')).toBeTruthy();
    fireEvent.click(screen.getByText('Also use this number to sign in…'));
    expect(screen.getByTestId('login-number')).toHaveTextContent('signed out');
    fireEvent.change(screen.getByLabelText('Password for sign-in change'), { target: { value: 'correct-horse' } });
    fireEvent.click(screen.getByText('Change my sign-in number'));
    await waitFor(() => expect(api.changeLoginNumber).toHaveBeenCalledWith('856 555 0199', 'correct-horse'));
    expect(await screen.findByTestId('login-number-done')).toBeTruthy();
  });
});

describe('the number\u2019s state', () => {
  it('shows the real proof and a change already waiting for its code', async () => {
    vi.mocked(api.phoneStatus).mockResolvedValue({ customerId: 'c1', recordVersion: 2, sync: 'ok', lastChange: null,
      phone: { display: null, masked: '••••0101', status: 'active_unverified', verified: false, label: 'Not verified', verifiedAt: null, since: null },
      openChange: { sessionId: 's9', state: 'verification_sent', maskedPhone: '••••0177', expired: false, source: 'customer_app' } } as never);
    mount();
    expect(await screen.findByTestId('phone-proof')).toHaveTextContent('Not verified');
    expect(screen.getByTestId('open-change')).toHaveTextContent('••••0177');
  });
});
