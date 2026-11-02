// QA for the Owner Salons console: lists owners with salon counts; opening an owner shows assigned salons + the
// assignable list; assigning and removing a salon send the exact backend calls. Mocked superAdminApi, real loader shapes.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api/superAdminApi', () => ({ superAdminApi: {
  owners: vi.fn(), owner: vi.fn(), ownerActivity: vi.fn(), assignOwnerBranch: vi.fn(), updateOwnerBranch: vi.fn(), removeOwnerBranch: vi.fn(), createOwnerSalon: vi.fn(), setOwnerBranchPin: vi.fn(), clearOwnerBranchPin: vi.fn(),
  // The screen now also loads the owner's salons ACROSS TENANTS (a salon is a tenant, so `detail` cannot supply them).
  ownerPortfolio: vi.fn(), createTenant: vi.fn(), inviteUser: vi.fn(),
} }));
import { superAdminApi } from '../api/superAdminApi';
import { SuperAdminOwnersScreen } from './SuperAdminOwnersScreen';

const ownerRow = (over: any = {}) => ({ ownerId: 'o1', tenantId: 't1', fullName: 'Kevin Dang', email: 'kevin@luxe.com', status: 'active', tenantName: 'Luxe Nails Group', assignedBranchCount: 1, ...over });
const detail = (over: any = {}) => ({
  ownerId: 'o1', tenantId: 't1', fullName: 'Kevin Dang', email: 'kevin@luxe.com', status: 'active', isMultiSalon: false,
  assignedBranches: [{ branchId: 'b1', branchName: 'Cherry Hill', accessLevel: 'owner', isPrimaryOwner: true, hasSwitchPin: false }],
  assignableBranches: [
    { branchId: 'b1', branchName: 'Cherry Hill', status: 'active' },
    { branchId: 'b2', branchName: 'Pennsauken', status: 'active' },
  ], ...over,
});
// A multi-salon owner (two assigned salons) — the only state in which switch-PIN controls render.
const multiDetail = (over: any = {}) => detail({
  isMultiSalon: true,
  assignedBranches: [
    { branchId: 'b1', branchName: 'Cherry Hill', accessLevel: 'owner', isPrimaryOwner: true, hasSwitchPin: false },
    { branchId: 'b2', branchName: 'Pennsauken', accessLevel: 'owner', isPrimaryOwner: false, hasSwitchPin: true },
  ], ...over,
});

beforeEach(() => { vi.clearAllMocks(); (superAdminApi.ownerActivity as any).mockResolvedValue([]); });

describe('SuperAdminOwnersScreen', () => {
  // SCAN (Oct 12): the browser run logged React's "Each child in a list should have a unique key" on /owner-salons for
  // every role — the key sat on the inner <button>, not on the mapped wrapper <div>.
  it('renders the owner list without a React key warning', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    (superAdminApi.owners as any).mockResolvedValue({ owners: [ownerRow()] });
    try {
      render(<MemoryRouter><SuperAdminOwnersScreen /></MemoryRouter>);
      await screen.findByText('Kevin Dang');
      expect(err.mock.calls.some((c) => String(c[0]).includes('unique "key"'))).toBe(false);
    } finally { err.mockRestore(); }
  });
  it('lists owners with salon counts and opens an owner to show assigned + assignable salons', async () => {
    (superAdminApi.owners as any).mockResolvedValue({ owners: [ownerRow()] });
    (superAdminApi.owner as any).mockResolvedValue(detail());
    render(<MemoryRouter><SuperAdminOwnersScreen /></MemoryRouter>);

    fireEvent.click(await screen.findByText('Kevin Dang'));
    await waitFor(() => expect(superAdminApi.owner).toHaveBeenCalledWith('o1'));
    // Assigned salon shown with its Primary pill; only the not-yet-assigned salon is offered in the assign dropdown.
    const assignedRow = (await screen.findByText('Cherry Hill')).closest('.row') as HTMLElement;
    expect(within(assignedRow).getByText('Primary')).toBeInTheDocument();
    const assignSelect = screen.getByLabelText('Salon to assign') as HTMLSelectElement;
    expect(within(assignSelect).getByRole('option', { name: 'Pennsauken' })).toBeInTheDocument();
    expect(within(assignSelect).queryByRole('option', { name: 'Cherry Hill' })).not.toBeInTheDocument();
  });

  it('assigns a salon with the chosen access level + primary flag', async () => {
    (superAdminApi.owners as any).mockResolvedValue({ owners: [ownerRow()] });
    (superAdminApi.owner as any).mockResolvedValue(detail());
    (superAdminApi.assignOwnerBranch as any).mockResolvedValue(detail({
      assignedBranches: [
        { branchId: 'b1', branchName: 'Cherry Hill', accessLevel: 'owner', isPrimaryOwner: true },
        { branchId: 'b2', branchName: 'Pennsauken', accessLevel: 'manager', isPrimaryOwner: false },
      ],
    }));
    render(<MemoryRouter><SuperAdminOwnersScreen /></MemoryRouter>);

    fireEvent.click(await screen.findByText('Kevin Dang'));
    await screen.findByText('Cherry Hill');
    fireEvent.change(screen.getByLabelText('Salon to assign'), { target: { value: 'b2' } });
    fireEvent.change(screen.getByLabelText('Access level'), { target: { value: 'manager' } });
    fireEvent.click(screen.getByRole('button', { name: 'Assign salon' }));

    await waitFor(() => expect(superAdminApi.assignOwnerBranch).toHaveBeenCalledWith('o1', { branchId: 'b2', accessLevel: 'manager', isPrimaryOwner: false }));
    expect(await screen.findByText('Pennsauken')).toBeInTheDocument();
  });

  it('shows the owner activity timeline with friendly labels and an admin marker', async () => {
    (superAdminApi.owners as any).mockResolvedValue({ owners: [ownerRow()] });
    (superAdminApi.owner as any).mockResolvedValue(detail());
    (superAdminApi.ownerActivity as any).mockResolvedValue([
      { action: 'super_admin_owner_salon_created', branchId: 'b2', entityType: 'owner', entityId: 'o1', role: 'SUPER_ADMIN', metadata: {}, createdAt: new Date(Date.now() - 3_600_000).toISOString() },
      { action: 'owner_dashboard_viewed', branchId: 'b1', entityType: null, entityId: null, role: 'OWNER', metadata: {}, createdAt: new Date(Date.now() - 120_000).toISOString() },
      { action: 'owner_unauthorized_branch_access_blocked', branchId: 'b9', entityType: 'branch', entityId: 'b9', role: 'OWNER', metadata: {}, createdAt: new Date(Date.now() - 60_000).toISOString() },
    ]);
    render(<MemoryRouter><SuperAdminOwnersScreen /></MemoryRouter>);

    fireEvent.click(await screen.findByText('Kevin Dang'));
    await waitFor(() => expect(superAdminApi.ownerActivity).toHaveBeenCalledWith('o1'));
    const timeline = (await screen.findByLabelText('Owner activity timeline'));
    expect(within(timeline).getByText('New salon created')).toBeInTheDocument();
    expect(within(timeline).getByText('Viewed dashboard')).toBeInTheDocument();
    expect(within(timeline).getByText('Blocked: unassigned salon')).toBeInTheDocument();
    // The super-admin action carries a "by admin" marker; the owner's own action does not.
    const adminRow = within(timeline).getByText('New salon created').closest('.arow') as HTMLElement;
    expect(within(adminRow).getByText('by admin')).toBeInTheDocument();
    const ownerRowEl = within(timeline).getByText('Viewed dashboard').closest('.arow') as HTMLElement;
    expect(within(ownerRowEl).queryByText('by admin')).not.toBeInTheDocument();
  });

  it('creates a brand-new salon for the owner (no cap on salon count)', async () => {
    (superAdminApi.owners as any).mockResolvedValue({ owners: [ownerRow()] });
    (superAdminApi.owner as any).mockResolvedValue(detail());
    (superAdminApi.createOwnerSalon as any).mockResolvedValue(detail({
      assignedBranches: [
        { branchId: 'b1', branchName: 'Cherry Hill', accessLevel: 'owner', isPrimaryOwner: true },
        { branchId: 'b9', branchName: 'Voorhees', accessLevel: 'owner', isPrimaryOwner: false },
      ],
    }));
    render(<MemoryRouter><SuperAdminOwnersScreen /></MemoryRouter>);

    fireEvent.click(await screen.findByText('Kevin Dang'));
    await screen.findByText('Cherry Hill');
    fireEvent.change(screen.getByLabelText('New salon name'), { target: { value: 'Voorhees' } });
    fireEvent.change(screen.getByLabelText('New salon city'), { target: { value: 'Voorhees' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create & assign salon' }));

    await waitFor(() => expect(superAdminApi.createOwnerSalon).toHaveBeenCalledWith('o1', { name: 'Voorhees', city: 'Voorhees', state: undefined }));
    expect(await screen.findByText('Voorhees')).toBeInTheDocument();
  });

  it('removes an assigned salon via the backend', async () => {
    (superAdminApi.owners as any).mockResolvedValue({ owners: [ownerRow()] });
    (superAdminApi.owner as any).mockResolvedValue(detail());
    (superAdminApi.removeOwnerBranch as any).mockResolvedValue({ ok: true, removed: true });
    render(<MemoryRouter><SuperAdminOwnersScreen /></MemoryRouter>);

    fireEvent.click(await screen.findByText('Kevin Dang'));
    const row = (await screen.findByText('Cherry Hill')).closest('.row') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(superAdminApi.removeOwnerBranch).toHaveBeenCalledWith('o1', 'b1'));
  });

  it('sets a salon’s 6-digit switch PIN for a multi-salon owner', async () => {
    (superAdminApi.owners as any).mockResolvedValue({ owners: [ownerRow({ assignedBranchCount: 2 })] });
    (superAdminApi.owner as any).mockResolvedValue(multiDetail());
    (superAdminApi.setOwnerBranchPin as any).mockResolvedValue(multiDetail({
      assignedBranches: [
        { branchId: 'b1', branchName: 'Cherry Hill', accessLevel: 'owner', isPrimaryOwner: true, hasSwitchPin: true },
        { branchId: 'b2', branchName: 'Pennsauken', accessLevel: 'owner', isPrimaryOwner: false, hasSwitchPin: true },
      ],
    }));
    render(<MemoryRouter><SuperAdminOwnersScreen /></MemoryRouter>);

    fireEvent.click(await screen.findByText('Kevin Dang'));
    await screen.findByText('Cherry Hill');
    // PIN controls + the multi-salon hint render ONLY for multi-salon owners.
    expect(screen.getByText(/6-digit PIN to switch into it/)).toBeInTheDocument();
    // Cherry Hill has no PIN yet → "Set PIN". Open the inline editor, type a 6-digit PIN, save.
    fireEvent.click(screen.getByRole('button', { name: 'Set PIN' }));
    fireEvent.change(screen.getByLabelText('Switch PIN for Cherry Hill'), { target: { value: '430271' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save PIN' }));
    await waitFor(() => expect(superAdminApi.setOwnerBranchPin).toHaveBeenCalledWith('o1', 'b1', '430271'));
  });

  it('does not render switch-PIN controls for a single-salon owner', async () => {
    (superAdminApi.owners as any).mockResolvedValue({ owners: [ownerRow()] });
    (superAdminApi.owner as any).mockResolvedValue(detail());
    render(<MemoryRouter><SuperAdminOwnersScreen /></MemoryRouter>);

    fireEvent.click(await screen.findByText('Kevin Dang'));
    await screen.findByText('Cherry Hill');
    expect(screen.queryByText(/6-digit PIN to switch into it/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Set PIN' })).not.toBeInTheDocument();
  });
});
