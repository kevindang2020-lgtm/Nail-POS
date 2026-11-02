// AcceptInviteScreen (tech-web) — cross-app host of the invitee accept flow. Same contract as the other apps.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api/techPublicApi', () => ({ techPublicApi: { acceptInvitation: vi.fn() } }));
import { techPublicApi } from '../api/techPublicApi';
import { AcceptInviteScreen } from './AcceptInviteScreen';

const renderAt = (entry: string) => render(<MemoryRouter initialEntries={[entry]}><AcceptInviteScreen /></MemoryRouter>);

beforeEach(() => { vi.clearAllMocks(); (techPublicApi.acceptInvitation as any).mockResolvedValue({ ok: true, userId: 'u1', email: 'tech@luxenails.com', role: "TECHNICIAN" }); });

describe('AcceptInviteScreen (tech-web)', () => {
  it('shows an invalid-link state when no token is present', () => {
    renderAt('/accept-invite');
    expect(screen.getByText(/Invitation link invalid/i)).toBeInTheDocument();
  });

  it('gates activation on min length + matching confirmation', () => {
    renderAt('/accept-invite?token=tok-abc');
    const btn = screen.getByRole('button', { name: 'Activate account' });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/At least 10 characters/i), { target: { value: 'CorrectHorse9!' } });
    fireEvent.change(screen.getByPlaceholderText('Re-enter password'), { target: { value: 'CorrectHorse9!' } });
    expect(btn).toBeEnabled();
  });

  it('posts the token + chosen password (no user id) and shows success', async () => {
    renderAt('/accept-invite?token=tok-abc');
    fireEvent.change(screen.getByPlaceholderText(/At least 10 characters/i), { target: { value: 'CorrectHorse9!' } });
    fireEvent.change(screen.getByPlaceholderText('Re-enter password'), { target: { value: 'CorrectHorse9!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Activate account' }));
    await waitFor(() => expect(techPublicApi.acceptInvitation as any).toHaveBeenCalledWith({ token: 'tok-abc', password: 'CorrectHorse9!' }));
    expect(await screen.findByText(/You’re all set/i)).toBeInTheDocument();
    expect(screen.getByText(/tech@luxenails\.com/)).toBeInTheDocument();
  });

  it('surfaces the server’s specific rejection', async () => {
    (techPublicApi.acceptInvitation as any).mockRejectedValue(new Error('This invitation has expired.'));
    renderAt('/accept-invite?token=tok-old');
    fireEvent.change(screen.getByPlaceholderText(/At least 10 characters/i), { target: { value: 'CorrectHorse9!' } });
    fireEvent.change(screen.getByPlaceholderText('Re-enter password'), { target: { value: 'CorrectHorse9!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Activate account' }));
    expect(await screen.findByText(/has expired/i)).toBeInTheDocument();
  });
});
