// AcceptInviteScreen — invitee redeems a token and sets their own password. Verifies the missing-token guard,
// password rules (min length + confirm match gate the button), the exact accept payload, the success state, and
// that a server rejection (expired/used) surfaces its specific message.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api/publicApi', () => ({ publicApi: { acceptInvitation: vi.fn() } }));
import { publicApi } from '../api/publicApi';
import { AcceptInviteScreen } from './AcceptInviteScreen';

const renderAt = (entry: string) => render(<MemoryRouter initialEntries={[entry]}><AcceptInviteScreen /></MemoryRouter>);

beforeEach(() => { vi.clearAllMocks(); (publicApi.acceptInvitation as any).mockResolvedValue({ ok: true, userId: 'u1', email: 'newhire@glamourstudio.com', role: 'MANAGER' }); });

describe('AcceptInviteScreen', () => {
  it('shows an invalid-link state when no token is present', () => {
    renderAt('/accept-invite');
    expect(screen.getByText(/Invitation link invalid/i)).toBeInTheDocument();
  });

  it('gates the activate button on min length + matching confirmation', () => {
    renderAt('/accept-invite?token=tok-abc');
    const btn = screen.getByRole('button', { name: 'Activate account' });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/At least 10 characters/i), { target: { value: 'short' } });
    fireEvent.change(screen.getByPlaceholderText('Re-enter password'), { target: { value: 'short' } });
    expect(btn).toBeDisabled();                                   // too short
    fireEvent.change(screen.getByPlaceholderText(/At least 10 characters/i), { target: { value: 'CorrectHorse9!' } });
    fireEvent.change(screen.getByPlaceholderText('Re-enter password'), { target: { value: 'Mismatch9!' } });
    expect(screen.getByText(/don’t match/i)).toBeInTheDocument();
    expect(btn).toBeDisabled();                                   // mismatch
    fireEvent.change(screen.getByPlaceholderText('Re-enter password'), { target: { value: 'CorrectHorse9!' } });
    expect(btn).toBeEnabled();
  });

  it('posts the token + chosen password and shows the success state', async () => {
    renderAt('/accept-invite?token=tok-abc');
    fireEvent.change(screen.getByPlaceholderText('Your name'), { target: { value: 'New Hire' } });
    fireEvent.change(screen.getByPlaceholderText(/At least 10 characters/i), { target: { value: 'CorrectHorse9!' } });
    fireEvent.change(screen.getByPlaceholderText('Re-enter password'), { target: { value: 'CorrectHorse9!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Activate account' }));
    await waitFor(() => expect(publicApi.acceptInvitation as any).toHaveBeenCalledWith({ token: 'tok-abc', password: 'CorrectHorse9!', fullName: 'New Hire' }));
    expect(await screen.findByText(/You’re all set/i)).toBeInTheDocument();
    expect(screen.getByText(/newhire@glamourstudio\.com/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Go to sign in/i })).toBeInTheDocument();
  });

  it('surfaces the server’s specific rejection (expired / already used)', async () => {
    (publicApi.acceptInvitation as any).mockRejectedValue(new Error('This invitation has expired.'));
    renderAt('/accept-invite?token=tok-old');
    fireEvent.change(screen.getByPlaceholderText(/At least 10 characters/i), { target: { value: 'CorrectHorse9!' } });
    fireEvent.change(screen.getByPlaceholderText('Re-enter password'), { target: { value: 'CorrectHorse9!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Activate account' }));
    expect(await screen.findByText(/This invitation has expired\./i)).toBeInTheDocument();
  });
});
