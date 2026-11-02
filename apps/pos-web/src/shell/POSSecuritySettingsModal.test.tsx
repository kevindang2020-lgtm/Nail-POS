// POSSecuritySettingsModal — PIN change step-up (merge Oct 12 2026, AUTH's /auth/set-pin): the current password (or the
// current PIN) rides with the new PIN; Save stays disabled without it; STEP_UP_REQUIRED and 429 read as plain words.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const post = vi.fn(); const get = vi.fn();
vi.mock('../api/client', () => ({ api: { post: (...a: any[]) => post(...a), get: (...a: any[]) => get(...a) } }));
import { POSSecuritySettingsModal } from './POSSecuritySettingsModal';

const err = (status: number, code: string) => Object.assign(new Error('x'), { status, code });
beforeEach(() => { post.mockReset(); get.mockReset(); get.mockResolvedValue({}); try { localStorage.clear(); } catch { /* */ } });

const fillPins = () => {
  const [p1, p2] = screen.getAllByPlaceholderText('• • • •');
  fireEvent.change(p1, { target: { value: '2468' } });
  fireEvent.change(p2, { target: { value: '2468' } });
};

describe('POSSecuritySettingsModal — PIN step-up', () => {
  it('Save stays disabled until the current password is typed, then sends { pin, currentPassword }', async () => {
    post.mockResolvedValue({ success: true });
    render(<POSSecuritySettingsModal onClose={() => {}} />);
    fillPins();
    const save = screen.getByRole('button', { name: 'Save PIN' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Current password', { selector: 'input[type="password"]' }), { target: { value: 'hunter2!' } });
    expect(save).not.toBeDisabled();
    fireEvent.click(save);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/auth/set-pin', { pin: '2468', currentPassword: 'hunter2!' }));
    expect(await screen.findByText('PIN successfully updated!')).toBeInTheDocument();
  });

  it('can confirm with the current PIN instead (sends currentPin, never currentPassword)', async () => {
    post.mockResolvedValue({ success: true });
    render(<POSSecuritySettingsModal onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText('Current PIN', { selector: 'input[type="radio"]' }));
    fireEvent.change(screen.getByLabelText('Current PIN', { selector: 'input[type="password"]' }), { target: { value: '1357' } });
    fillPins();
    fireEvent.click(screen.getByRole('button', { name: 'Save PIN' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/auth/set-pin', { pin: '2468', currentPin: '1357' }));
  });

  it('STEP_UP_REQUIRED → "Current password is incorrect"; 429 → try again later', async () => {
    post.mockRejectedValueOnce(err(403, 'STEP_UP_REQUIRED')).mockRejectedValueOnce(err(429, 'too_many_attempts'));
    render(<POSSecuritySettingsModal onClose={() => {}} />);
    fillPins();
    fireEvent.change(screen.getByLabelText('Current password', { selector: 'input[type="password"]' }), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save PIN' }));
    expect(await screen.findByText('Current password is incorrect')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Current password', { selector: 'input[type="password"]' }), { target: { value: 'wrong again' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save PIN' }));
    expect(await screen.findByText(/Too many attempts/)).toBeInTheDocument();
  });
});
