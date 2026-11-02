// OwnerForgotPasswordScreen.test.tsx — Security Deep Scan C1: completing a reset returns { ok, mustSignIn: true } and NO
// session; the screen says the password is set and sends the owner back to sign in with it.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('../api/authApi', () => ({ authApi: { requestPasswordReset: vi.fn(), tempLogin: vi.fn(), completePasswordReset: vi.fn() } }));
import { authApi } from '../api/authApi';
import { OwnerForgotPasswordScreen } from './OwnerForgotPasswordScreen';

describe('OwnerForgotPasswordScreen', () => {
  beforeEach(() => vi.clearAllMocks());
  it('request → code → new password → "sign in with it now" (no session is expected from the reset)', async () => {
    (authApi.requestPasswordReset as any).mockResolvedValue({ ok: true });
    (authApi.tempLogin as any).mockResolvedValue({ ok: true, resetSessionToken: 'tok-1' });
    (authApi.completePasswordReset as any).mockResolvedValue({ ok: true, mustSignIn: true, redirect: '/owner/login' });
    const onBack = vi.fn();
    render(<OwnerForgotPasswordScreen onBack={onBack} />);
    fireEvent.change(screen.getByPlaceholderText('Salon code'), { target: { value: 'PILOT03' } });
    fireEvent.change(screen.getByPlaceholderText('Mobile number'), { target: { value: '6095551234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send me a code' }));
    fireEvent.change(await screen.findByPlaceholderText('6-digit code'), { target: { value: '482913' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(authApi.tempLogin).toHaveBeenCalledWith('PILOT03', '6095551234', '482913'));
    const pw = await screen.findAllByPlaceholderText(/password/i);
    fireEvent.change(pw[0], { target: { value: 'a-new-password-1' } });
    fireEvent.change(pw[1], { target: { value: 'a-new-password-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }));
    await waitFor(() => expect(authApi.completePasswordReset).toHaveBeenCalledWith('tok-1', 'a-new-password-1', 'a-new-password-1'));
    expect(await screen.findByText(/Your password is set\. Sign in with it now\./)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /Back to sign in/ }).pop()!);
    expect(onBack).toHaveBeenCalled();
  });
});
