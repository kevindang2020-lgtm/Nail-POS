import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { mockPreview, mockRevoke } = vi.hoisted(() => ({ mockPreview: vi.fn(), mockRevoke: vi.fn() }));
vi.mock('../api/superAdminApi', () => ({ superAdminApi: {
  securitySessionRevokePreview: (b: any) => mockPreview(b),
  securitySessionRevoke: (b: any) => mockRevoke(b),
} }));
import { SecuritySessionRevokeModal } from './SecuritySessionRevokeModal';

beforeEach(() => {
  mockPreview.mockReset(); mockRevoke.mockReset();
  mockPreview.mockResolvedValue({ scope: 'user', target: 'u1', sessionsToRevoke: 2, alreadyRevoked: 0, refreshTokensToRevoke: 2, protectedSession: true, message: 'Will revoke 2 active sessions, 2 refresh tokens, your current session is preserved.' });
  mockRevoke.mockResolvedValue({ revokedSessions: 2, revokedRefreshTokens: 2, message: 'Revoked 2 session(s) and 2 refresh token(s).' });
});

describe('SecuritySessionRevokeModal', () => {
  it('for a broad scope, Preview is disabled until a reason is provided', async () => {
    render(<SecuritySessionRevokeModal onClose={() => {}} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'user' } });
    fireEvent.change(screen.getByPlaceholderText('target identifier'), { target: { value: 'u1' } });
    expect(screen.getByRole('button', { name: /Preview impact/ })).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/why these sessions/), { target: { value: 'compromised' } });
    expect(screen.getByRole('button', { name: /Preview impact/ })).not.toBeDisabled();
  });

  it('shows impact and the self-preservation guarantee, then revokes', async () => {
    render(<SecuritySessionRevokeModal onClose={() => {}} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'user' } });
    fireEvent.change(screen.getByPlaceholderText('target identifier'), { target: { value: 'u1' } });
    fireEvent.change(screen.getByPlaceholderText(/why these sessions/), { target: { value: 'compromised' } });
    fireEvent.click(screen.getByRole('button', { name: /Preview impact/ }));
    expect(await screen.findByText(/Your current session is preserved/)).toBeInTheDocument();
    expect(screen.getByText(/Sessions: 2 · Refresh tokens: 2/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Revoke 2 session/ }));
    await waitFor(() => expect(mockRevoke).toHaveBeenCalledWith(expect.objectContaining({ scope: 'user', target: 'u1', reason: 'compromised' })));
    expect(await screen.findByText(/Revoked 2 session\(s\) and 2 refresh token\(s\)/)).toBeInTheDocument();
  });

  it('for a single session scope no reason is required to preview', async () => {
    mockPreview.mockResolvedValue({ scope: 'session', target: 's1', sessionsToRevoke: 1, alreadyRevoked: 0, refreshTokensToRevoke: 1, protectedSession: false, message: 'Will revoke 1 active session, 1 refresh token.' });
    render(<SecuritySessionRevokeModal onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('target identifier'), { target: { value: 's1' } });
    expect(screen.getByRole('button', { name: /Preview impact/ })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Preview impact/ }));
    expect(await screen.findByText(/Will revoke 1 active session/)).toBeInTheDocument();
  });
});
