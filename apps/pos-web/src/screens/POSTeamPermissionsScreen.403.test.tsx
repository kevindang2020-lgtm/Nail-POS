// The roster answers a 403 with a permission message, never a blank page or a crash.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
vi.mock('../components/usePermissions', () => ({ useCan: () => () => true }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ principal: { userId: 'u9', role: 'TECHNICIAN', permissions: [] } }) }));
import { install } from './access/accessTestKit';
import { POSTeamPermissionsScreen } from './POSTeamPermissionsScreen';
beforeEach(() => install({ 'GET /pos/access/members': { status: 403, body: { code: 'PERMISSION_DENIED', reason: 'missing_permission', permission: 'roles.view' } }, 'GET /pos/team': { status: 403, body: {} } }));
describe('Roles & Permissions gating', () => {
  it('shows a permission message on 403', async () => {
    render(<MemoryRouter><POSTeamPermissionsScreen /></MemoryRouter>);
    expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument();
  });
});
