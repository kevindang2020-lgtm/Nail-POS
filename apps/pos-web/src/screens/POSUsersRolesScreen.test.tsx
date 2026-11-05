import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { POSUsersRolesScreen } from './POSUsersRolesScreen';

vi.mock('../api/posTeamApi', () => ({ posTeamApi: { list: vi.fn().mockResolvedValue({
  users: [
    { id: 'u1', name: 'Sophia Nguyen', email: 's@x.com', role: 'OWNER', status: 'active', branchId: 'b1', lastLoginAt: '2026-05-06T14:21:00Z', mfaEnabled: true, createdAt: '2024-01-12T00:00:00Z', isYou: true },
    { id: 'u2', name: 'Mai Tran', email: 'm@x.com', role: 'MANAGER', status: 'active', branchId: 'b1', lastLoginAt: null, mfaEnabled: false, createdAt: '2024-03-01T00:00:00Z', isYou: false },
    { id: 'u3', name: 'Dee Park', email: 'd@x.com', role: 'TECHNICIAN', status: 'suspended', branchId: 'b2', lastLoginAt: null, mfaEnabled: false, createdAt: '2024-06-01T00:00:00Z', isYou: false },
  ],
  roles: [
    { role: 'OWNER', permissionCount: 120, userCount: 1 },
    { role: 'MANAGER', permissionCount: 80, userCount: 1 },
    { role: 'FRONT_DESK', permissionCount: 20, userCount: 0 },
    { role: 'RECEPTION', permissionCount: 20, userCount: 0 },
    { role: 'TECHNICIAN', permissionCount: 25, userCount: 1 },
  ],
  summary: { total: 3, active: 2, admins: 2 },
}) } }));
vi.mock('../api/posLocationsApi', () => ({ posLocationsApi: { list: vi.fn().mockResolvedValue({ locations: [{ id: 'b1', name: 'Downtown Branch' }, { id: 'b2', name: 'Uptown Branch' }], summary: { total: 2, active: 2 } }) } }));

describe('POSUsersRolesScreen', () => {
  it('renders the real roster, resolves branch names, flags you, and shows role permission counts', async () => {
    render(<MemoryRouter><POSUsersRolesScreen /></MemoryRouter>);
    expect(screen.getByText('Users & Roles')).toBeInTheDocument();
    expect(await screen.findByText('Sophia Nguyen')).toBeInTheDocument();
    expect(screen.getByText('You')).toBeInTheDocument();           // current user flagged
    expect(screen.getByText('Mai Tran')).toBeInTheDocument();
    expect(await screen.findByText('Uptown Branch')).toBeInTheDocument(); // branch id resolved via locations
    expect(screen.getByText('120 permissions')).toBeInTheDocument(); // role summary from RBAC catalog
  });
});
