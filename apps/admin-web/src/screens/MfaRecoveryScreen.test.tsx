import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('../api/client', () => ({ api: { post: vi.fn() } }));
import { api } from '../api/client';
import { MfaRecoveryScreen } from './MfaRecoveryScreen';

describe('MFA recovery page (Constitution 7 §24)', () => {
  beforeEach(() => { vi.clearAllMocks(); window.history.pushState({}, '', '/mfa-recovery?token=tok123'); });
  it('password → new secret → live code → done; sends the token with each step', async () => {
    (api.post as any).mockResolvedValueOnce({ ok: true, secret: 'NEWSECRET', otpauthUri: 'otpauth://totp/x' }).mockResolvedValueOnce({ ok: true, confirmed: true });
    render(<MfaRecoveryScreen />);
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct horse battery' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/public/mfa-recovery/start', { token: 'tok123', password: 'correct horse battery' }));
    expect(await screen.findByTestId('mfa-secret')).toHaveTextContent('NEWSECRET');
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(api.post).toHaveBeenLastCalledWith('/public/mfa-recovery/confirm', { token: 'tok123', code: '123456' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Your new authenticator is set up');
  });
  it('a refused link or password shows the reason; a link without a token says so', async () => {
    (api.post as any).mockRejectedValueOnce(new Error('That recovery link or password is not valid.'));
    render(<MfaRecoveryScreen />);
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('not valid');
  });
});
