// OwnerBranchEpochReload.test.tsx — regression guard for the salon↔branch bridge.
// Switching SALON goes through OwnerSalonContext (server switch + `epoch` bump). The branch context must then reload
// so branch-scoped screens see the NEW salon rather than the previous one's data. Both providers are real; both API
// layers are mocked. Without the fix, the branch list would stay on the first salon after a switch.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { OwnerSalonProvider, useOwnerSalon } from './OwnerSalonContext';
import { OwnerBranchProvider, useOwnerBranch } from './OwnerBranchContext';
import { ownerContextApi } from '../api/ownerApi';
import { api } from '../api/client';

vi.mock('../api/ownerApi', () => ({
  ownerContextApi: { context: vi.fn(), select: vi.fn().mockResolvedValue({ ok: true }) },
}));
vi.mock('../api/client', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

const ctx = (branchId: string, salonName: string) => ({
  allowedBranches: [{ branchId, tenantId: 't', salonName, branchName: 'Main', city: 'X', timezone: 'America/New_York', accessLevel: 'owner', isPrimaryOwner: true, hasSwitchPin: false }],
  canViewAllAssignedBranches: false, defaultBranchId: branchId,
});

function Probe() {
  const { branches } = useOwnerBranch();
  const { switchSalon } = useOwnerSalon();
  return (
    <div>
      <div data-testid="branch">{branches.map((b) => b.salonName).join(',') || 'none'}</div>
      <button onClick={() => { void switchSalon('salon-2'); }}>switch</button>
    </div>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  (api.get as any).mockImplementation((url: string) =>
    url === '/owner/portfolio' ? Promise.resolve({ salons: [] }) : Promise.resolve({ activeSalonId: 'salon-1' }));
  (api.post as any).mockResolvedValue({ activeSalonId: 'salon-2', salonName: 'Salon Two' });
});

describe('salon switch reloads the branch context', () => {
  it('re-fetches the branch set for the newly active salon when epoch bumps', async () => {
    (ownerContextApi.context as any)
      .mockResolvedValueOnce(ctx('b-salon1', 'Salon One'))
      .mockResolvedValueOnce(ctx('b-salon2', 'Salon Two'));

    render(<OwnerSalonProvider><OwnerBranchProvider><Probe /></OwnerBranchProvider></OwnerSalonProvider>);
    await waitFor(() => expect(screen.getByTestId('branch')).toHaveTextContent('Salon One'));
    const callsBefore = (ownerContextApi.context as any).mock.calls.length;

    fireEvent.click(screen.getByText('switch'));

    // The branch list flips to the new salon — proof the branch context reloaded on the salon-switch epoch.
    await waitFor(() => expect(screen.getByTestId('branch')).toHaveTextContent('Salon Two'));
    expect((ownerContextApi.context as any).mock.calls.length).toBeGreaterThan(callsBefore);
  });
});
