import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api/superAdminGiftCardProgramsApi', () => ({
  giftCardProgramsApi: { state: vi.fn(), create: vi.fn(), update: vi.fn(), addMember: vi.fn(), setMemberStatus: vi.fn() },
}));
import { giftCardProgramsApi } from '../api/superAdminGiftCardProgramsApi';
import GiftCardProgramsScreen from './GiftCardProgramsScreen';

beforeEach(() => { vi.clearAllMocks(); });

describe('GiftCardProgramsScreen', () => {
  it('lists programs with scope and member count', async () => {
    (giftCardProgramsApi.state as any).mockResolvedValue({ programs: [
      { id: 'p1', name: 'Network A', ownerTenantId: 'o1', scope: 'network', status: 'active', sharedLiability: true, createdAt: '2026-07-01T00:00:00Z', members: [{ programId: 'p1', tenantId: 'tenant-x', status: 'active', joinedAt: '2026-07-01T00:00:00Z' }], memberCount: 1 },
    ] });
    render(<MemoryRouter><GiftCardProgramsScreen /></MemoryRouter>);
    expect(await screen.findByText('Network A')).toBeInTheDocument();
    expect(screen.getByText(/1 active member/)).toBeInTheDocument();
    expect(screen.getByText('tenant-x')).toBeInTheDocument();
  });

  it('creates a program', async () => {
    (giftCardProgramsApi.state as any).mockResolvedValue({ programs: [] });
    (giftCardProgramsApi.create as any).mockResolvedValue({});
    render(<MemoryRouter><GiftCardProgramsScreen /></MemoryRouter>);
    await screen.findByText(/No gift-card programs yet/);
    fireEvent.change(screen.getByLabelText('Program name'), { target: { value: 'New Net' } });
    fireEvent.change(screen.getByLabelText('Owner tenant ID'), { target: { value: 'owner1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(giftCardProgramsApi.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'New Net', ownerTenantId: 'owner1', scope: 'network' })));
  });

  it('adds a member tenant to a program', async () => {
    (giftCardProgramsApi.state as any).mockResolvedValue({ programs: [
      { id: 'p1', name: 'Network A', ownerTenantId: 'o1', scope: 'network', status: 'active', sharedLiability: false, createdAt: '2026-07-01T00:00:00Z', members: [], memberCount: 0 },
    ] });
    (giftCardProgramsApi.addMember as any).mockResolvedValue({ ok: true });
    render(<MemoryRouter><GiftCardProgramsScreen /></MemoryRouter>);
    fireEvent.change(await screen.findByLabelText('Add tenant to Network A'), { target: { value: 'tenant-y' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add tenant' }));
    await waitFor(() => expect(giftCardProgramsApi.addMember).toHaveBeenCalledWith('p1', 'tenant-y'));
  });
});
