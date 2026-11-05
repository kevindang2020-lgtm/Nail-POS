// session-expiry-ux.test.tsx — closes the loop on server-side session revocation.
//
// Revocation is only useful if the user actually lands somewhere sensible. The API now returns 401 for a revoked
// session (the user hit "sign out other devices", or an admin killed a compromised session). Without global
// handling the app would keep rendering the POS shell and every screen would just throw errors — a half-dead app
// that still LOOKS signed in. These tests assert the 401 puts the user back on the login page.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthContext';

vi.mock('../api/authApi', () => ({
  authApi: {
    me: vi.fn(async () => ({ userId: 'u1', tenantId: 't1', branchId: null, role: 'RECEPTIONIST', permissions: [] })),
    logout: vi.fn(async () => ({ ok: true })),
    login: vi.fn(),
    branches: vi.fn(),
    selectBranch: vi.fn(),
  },
}));

function Probe() {
  const { principal, loading } = useAuth();
  if (loading) return <div>loading</div>;
  return <div>{principal ? 'SIGNED_IN' : 'SIGNED_OUT'}</div>;
}

describe('a revoked/expired session returns the user to login', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('drops the principal when the API reports 401 (aps:unauthorized)', async () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByText('SIGNED_IN')).toBeInTheDocument());

    // the session is revoked server-side; the next API call 401s and the client announces it
    window.dispatchEvent(new CustomEvent('aps:unauthorized'));

    await waitFor(() => expect(screen.getByText('SIGNED_OUT')).toBeInTheDocument());
  });

  it('stays signed in when no 401 occurs (no spurious sign-outs)', async () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByText('SIGNED_IN')).toBeInTheDocument());
    window.dispatchEvent(new CustomEvent('aps:something-else'));
    expect(screen.getByText('SIGNED_IN')).toBeInTheDocument();
  });
});
