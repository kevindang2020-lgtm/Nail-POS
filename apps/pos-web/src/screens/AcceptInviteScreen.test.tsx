// AcceptInviteScreen (pos-web) — cross-app host of the invitee accept flow. Same contract as the admin-web page:
// missing-token guard, password rules (min length + confirm match), exact accept payload (no user id), success, and
// the server's specific rejection message.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api/posPublicApi', () => ({ posPublicApi: { acceptInvitation: vi.fn() } }));
import { posPublicApi } from '../api/posPublicApi';
import { AcceptInviteScreen } from './AcceptInviteScreen';

const renderAt = (entry: string) => render(<MemoryRouter initialEntries={[entry]}><AcceptInviteScreen /></MemoryRouter>);

beforeEach(() => { vi.clearAllMocks(); (posPublicApi.acceptInvitation as any).mockResolvedValue({ ok: true, userId: 'u1', email: 'tech@luxenails.com', role: 'TECHNICIAN' }); });

describe('AcceptInviteScreen (pos-web)', () => {
  it('shows an invalid-link state when no token is present', () => {
    renderAt('/accept-invite');
    expect(screen.getByText(/Invitation link invalid/i)).toBeInTheDocument();
  });

  it('gates activation on min length + matching confirmation', () => {
    renderAt('/accept-invite?token=tok-abc');
    const btn = screen.getByRole('button', { name: 'Activate account' });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/At least 10 characters/i), { target: { value: 'CorrectHorse9!' } });
    fireEvent.change(screen.getByPlaceholderText('Re-enter password'), { target: { value: 'Mismatch9!' } });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('Re-enter password'), { target: { value: 'CorrectHorse9!' } });
    expect(btn).toBeEnabled();
  });

  it('posts the token + chosen password (no user id) and shows success', async () => {
    renderAt('/accept-invite?token=tok-abc');
    fireEvent.change(screen.getByPlaceholderText(/At least 10 characters/i), { target: { value: 'CorrectHorse9!' } });
    fireEvent.change(screen.getByPlaceholderText('Re-enter password'), { target: { value: 'CorrectHorse9!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Activate account' }));
    await waitFor(() => expect(posPublicApi.acceptInvitation as any).toHaveBeenCalledWith({ token: 'tok-abc', password: 'CorrectHorse9!' }));
    expect(await screen.findByText(/You’re all set/i)).toBeInTheDocument();
    expect(screen.getByText(/tech@luxenails\.com/)).toBeInTheDocument();
  });

  it('surfaces the server’s specific rejection (expired / already used)', async () => {
    (posPublicApi.acceptInvitation as any).mockRejectedValue(new Error('This invitation was already used.'));
    renderAt('/accept-invite?token=tok-old');
    fireEvent.change(screen.getByPlaceholderText(/At least 10 characters/i), { target: { value: 'CorrectHorse9!' } });
    fireEvent.change(screen.getByPlaceholderText('Re-enter password'), { target: { value: 'CorrectHorse9!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Activate account' }));
    expect(await screen.findByText(/already used/i)).toBeInTheDocument();
  });
});
