import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
vi.mock('../api/client', () => ({ api: { post: vi.fn() } }));
import { api } from '../api/client';
import { stepUpHandler } from '../api/step-up';
import { StepUpHost } from './StepUpHost';

describe('StepUpHost (Constitution 7 §8)', () => {
  it('opens when the client asks, re-confirms password + code for this session, and tells the client to retry', async () => {
    (api.post as any).mockResolvedValue({ ok: true, validForSeconds: 300 });
    render(<StepUpHost />);
    expect(screen.queryByTestId('step-up')).toBeNull();
    let result: Promise<boolean> | undefined;
    act(() => { result = stepUpHandler()!(); });
    expect(await screen.findByTestId('step-up')).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Confirm' });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct horse battery' } });
    fireEvent.change(screen.getByLabelText('Authenticator code'), { target: { value: '12 34 56' } });
    fireEvent.click(confirm);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/auth/step-up', { password: 'correct horse battery', code: '123456' }));
    await expect(result).resolves.toBe(true);
    expect(screen.queryByTestId('step-up')).toBeNull();
  });
  it('a wrong password keeps the prompt open with the reason; Cancel resolves false', async () => {
    (api.post as any).mockRejectedValue(new Error('Password or code is not correct.'));
    render(<StepUpHost />);
    let result: Promise<boolean> | undefined;
    act(() => { result = stepUpHandler()!(); });
    fireEvent.change(await screen.findByLabelText('Password'), { target: { value: 'nope' } });
    fireEvent.change(screen.getByLabelText('Authenticator code'), { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Password or code is not correct.');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await expect(result).resolves.toBe(false);
  });
});
