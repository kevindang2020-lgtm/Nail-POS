import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('../api/authApi', () => ({ authApi: { passwordResetRequest: vi.fn(), passwordResetTempLogin: vi.fn(), passwordResetComplete: vi.fn() } }));
import { authApi } from '../api/authApi';
import { ForgotPasswordScreen } from './ForgotPasswordScreen';

describe('ForgotPasswordScreen', () => {
  beforeEach(() => vi.clearAllMocks());
  it('runs request → temp-login → complete and confirms success', async () => {
    (authApi.passwordResetRequest as any).mockResolvedValue({ ok: true });
    (authApi.passwordResetTempLogin as any).mockResolvedValue({ ok: true, resetSessionToken: 'tok-123' });
    (authApi.passwordResetComplete as any).mockResolvedValue({ ok: true });
    render(<ForgotPasswordScreen onBack={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Salon code'), { target: { value: 'PILOT03' } });
    fireEvent.change(screen.getByPlaceholderText('Phone on file'), { target: { value: '6095551234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset code' }));
    await waitFor(() => expect(authApi.passwordResetRequest).toHaveBeenCalledWith({ salonCode: 'PILOT03', phone: '6095551234' }));
    fireEvent.change(await screen.findByPlaceholderText('Reset code'), { target: { value: '482913' } });
    fireEvent.change(screen.getByPlaceholderText('New password (8+ characters)'), { target: { value: 'newsecret1' } });
    fireEvent.change(screen.getByPlaceholderText('Confirm new password'), { target: { value: 'newsecret1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }));
    await waitFor(() => expect(authApi.passwordResetTempLogin).toHaveBeenCalledWith({ salonCode: 'PILOT03', emailOrPhone: '6095551234', password: '482913' }));
    await waitFor(() => expect(authApi.passwordResetComplete).toHaveBeenCalledWith({ resetSessionToken: 'tok-123', newPassword: 'newsecret1', confirmPassword: 'newsecret1' }));
    expect(await screen.findByText('Password updated')).toBeInTheDocument();
  });
  it('rejects mismatched passwords before calling the server', async () => {
    render(<ForgotPasswordScreen onBack={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Salon code'), { target: { value: 'PILOT03' } });
    fireEvent.change(screen.getByPlaceholderText('Phone on file'), { target: { value: '6095551234' } });
    (authApi.passwordResetRequest as any).mockResolvedValue({ ok: true });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset code' }));
    fireEvent.change(await screen.findByPlaceholderText('Reset code'), { target: { value: '482913' } });
    fireEvent.change(screen.getByPlaceholderText('New password (8+ characters)'), { target: { value: 'newsecret1' } });
    fireEvent.change(screen.getByPlaceholderText('Confirm new password'), { target: { value: 'different2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument();
    expect(authApi.passwordResetTempLogin).not.toHaveBeenCalled();
  });
});
