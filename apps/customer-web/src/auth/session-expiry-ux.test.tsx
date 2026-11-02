// session-expiry-ux.test.tsx — a revoked/expired session must return the user to sign-in, not leave them in a
// shell that still LOOKS signed in while every screen errors. Session revocation is cross-app: signing out on
// one device (or an admin killing a compromised session) 401s every app the user has open.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from './AuthContext';

vi.mock('../api/authApi', () => ({
  authApi: {
    me: vi.fn(async () => ({ userId: 'u1', tenantId: 't1', branchId: null, role: 'CUSTOMER', permissions: [] })),
    logout: vi.fn(async () => ({ ok: true })),
    login: vi.fn(), branches: vi.fn(), selectBranch: vi.fn(),
  },
}));

function Probe() {
  const { principal, loading } = useAuth();
  if (loading) return <div>loading</div>;
  return <div>{principal ? 'SIGNED_IN' : 'SIGNED_OUT'}</div>;
}

describe('a revoked/expired session returns the user to sign-in', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('drops the principal when the API reports 401', async () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByText('SIGNED_IN')).toBeInTheDocument());
    window.dispatchEvent(new CustomEvent('aps:unauthorized'));
    await waitFor(() => expect(screen.getByText('SIGNED_OUT')).toBeInTheDocument());
  });

  it('does not sign out on unrelated events', async () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByText('SIGNED_IN')).toBeInTheDocument());
    window.dispatchEvent(new CustomEvent('aps:something-else'));
    expect(screen.getByText('SIGNED_IN')).toBeInTheDocument();
  });
});
