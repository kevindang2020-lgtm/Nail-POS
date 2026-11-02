// OwnerBranchSelector.test.tsx — spec frontend checks for the multi-salon switcher:
//  • owner with multiple salons sees the selector; the dropdown lists ONLY assigned salons
//  • "All My Salons" appears only when more than one salon is assigned
//  • selecting a salon switches the active label (drives effectiveBranchId → screen reloads)
//  • owner with one salon gets a static label and NO dropdown / no "All My Salons"
// The selector is mounted inside the real OwnerBranchProvider with the typed API client mocked, so this exercises the
// genuine context-loading + fallback logic against canned GET /owner/context responses.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { OwnerBranchProvider } from './OwnerBranchContext';
import { OwnerBranchSelector } from './OwnerBranchSelector';
import { ownerContextApi } from '../api/ownerApi';

vi.mock('../api/ownerApi', () => ({
  ownerContextApi: { context: vi.fn(), select: vi.fn().mockResolvedValue({ ok: true }) },
}));

const branch = (over: any = {}) => ({
  branchId: 'b1', tenantId: 't1', salonName: 'Luxe Nails — Cherry Hill', branchName: 'Cherry Hill',
  city: 'Cherry Hill', timezone: 'America/New_York', accessLevel: 'owner', isPrimaryOwner: true, hasSwitchPin: false, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear(); // selection persists per browser; isolate each test
});

const renderSelector = () =>
  render(<OwnerBranchProvider><OwnerBranchSelector /></OwnerBranchProvider>);

describe('OwnerBranchSelector', () => {
  it('multiple salons: lists only assigned salons + "All My Salons", and switches selection', async () => {
    (ownerContextApi.context as any).mockResolvedValue({
      ownerUserId: 'u1', tenantId: 't1', canViewAllAssignedBranches: true, defaultBranchId: 'b1',
      allowedBranches: [
        branch(),
        branch({ branchId: 'b2', salonName: 'Luxe Nails — Pennsauken', branchName: 'Pennsauken', city: 'Pennsauken', isPrimaryOwner: false }),
      ],
    });
    renderSelector();

    // Default for multiple assigned salons is the combined view.
    const toggle = await screen.findByRole('button', { name: /all my salons/i });
    fireEvent.click(toggle);

    const list = await screen.findByRole('listbox');
    expect(within(list).getByText('All My Salons')).toBeInTheDocument();
    expect(within(list).getByText('Luxe Nails — Cherry Hill')).toBeInTheDocument();
    expect(within(list).getByText('Luxe Nails — Pennsauken')).toBeInTheDocument();
    // Only assigned salons appear — a non-owned salon is never present.
    expect(within(list).queryByText('Luxe Nails — Marlton')).not.toBeInTheDocument();

    fireEvent.click(within(list).getByText('Luxe Nails — Pennsauken'));
    // Label now reflects the chosen salon; menu closed; the switch is recorded for audit.
    await waitFor(() => expect(screen.getByRole('button', { name: /pennsauken/i })).toBeInTheDocument());
    expect(ownerContextApi.select).toHaveBeenCalledWith('single', 'b2');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('single salon: static label, no dropdown, no "All My Salons"', async () => {
    (ownerContextApi.context as any).mockResolvedValue({
      ownerUserId: 'u1', tenantId: 't1', canViewAllAssignedBranches: false, defaultBranchId: 'b1',
      allowedBranches: [branch()],
    });
    renderSelector();

    await waitFor(() => expect(screen.getByText('Luxe Nails — Cherry Hill')).toBeInTheDocument());
    // No switcher button and no combined option when only one salon is assigned.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText('All My Salons')).not.toBeInTheDocument();
  });

  it('PIN-protected salon: tapping prompts for the 6-digit PIN; only an accepted PIN switches', async () => {
    (ownerContextApi.context as any).mockResolvedValue({
      ownerUserId: 'u1', tenantId: 't1', canViewAllAssignedBranches: true, defaultBranchId: 'b1',
      allowedBranches: [
        branch(),
        branch({ branchId: 'b2', salonName: 'Luxe Nails — Pennsauken', branchName: 'Pennsauken', city: 'Pennsauken', isPrimaryOwner: false, hasSwitchPin: true }),
      ],
    });
    // The server accepts only the correct PIN; a wrong PIN is rejected (mirrors the backend gate).
    (ownerContextApi.select as any).mockImplementation((_mode: string, _branchId?: string, pin?: string) =>
      pin === '430271' ? Promise.resolve({ ok: true }) : Promise.reject(Object.assign(new Error('PIN required'), { status: 403 })),
    );
    const type = (code: string) => code.split('').forEach((d, i) => fireEvent.change(screen.getByLabelText(`PIN digit ${i + 1}`), { target: { value: d } }));
    renderSelector();

    fireEvent.click(await screen.findByRole('button', { name: /all my salons/i }));
    const list = await screen.findByRole('listbox');
    const opt = within(list).getByText('Luxe Nails — Pennsauken').closest('button') as HTMLElement;
    expect(within(opt).getByText('PIN')).toBeInTheDocument(); // the lock badge marks a PIN-gated salon

    // Tapping a PIN-gated salon opens the pad and does NOT switch yet.
    fireEvent.click(opt);
    const pad = await screen.findByRole('dialog', { name: /switch PIN for Luxe Nails — Pennsauken/i });
    expect(pad).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    // Wrong PIN → rejected, pad stays open, no switch.
    type('000000');
    await waitFor(() => expect(ownerContextApi.select).toHaveBeenCalledWith('single', 'b2', '000000'));
    await waitFor(() => expect(within(pad).getByText(/didn’t match/i)).toBeInTheDocument());
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Correct PIN → switch commits, pad closes, label updates.
    type('430271');
    await waitFor(() => expect(ownerContextApi.select).toHaveBeenCalledWith('single', 'b2', '430271'));
    await waitFor(() => expect(screen.getByRole('button', { name: /pennsauken/i })).toBeInTheDocument());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

// C6 §99 (Phase 13 E): choosing a branch makes its time zone the one owner screens format business dates in.
import { businessTimeZone, setBusinessTimeZone } from '@aipowersalon/mobile-sdk';
describe('branch time zone (C6 §99)', () => {
  it('the first branch zone in "all" mode, the selected branch zone once one is chosen', async () => {
    setBusinessTimeZone(null);
    (ownerContextApi.context as any).mockResolvedValue({
      ownerUserId: 'u1', tenantId: 't1', canViewAllAssignedBranches: true, defaultBranchId: 'b1',
      allowedBranches: [branch(), branch({ branchId: 'b2', salonName: 'Luxe Nails — Phoenix', branchName: 'Phoenix', timezone: 'America/Phoenix', isPrimaryOwner: false })],
    });
    renderSelector();
    await waitFor(() => expect(businessTimeZone()).toBe('America/New_York'));
    fireEvent.click(await screen.findByRole('button', { name: /all my salons/i }));
    fireEvent.click(await screen.findByText('Luxe Nails — Phoenix'));
    await waitFor(() => expect(businessTimeZone()).toBe('America/Phoenix'));
  });
});
