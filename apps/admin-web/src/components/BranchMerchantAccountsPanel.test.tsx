// BranchMerchantAccountsPanel — wave 3 PAYI §7/§10/§51: the Super Admin's per-location merchant accounts. Masked rows,
// write-only credentials, test / pause / disable through the real routes; a location without a row inherits the default.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('../api/superAdminApi', () => ({
  superAdminApi: { listBranchMerchants: vi.fn(), setBranchMerchant: vi.fn(), testBranchMerchant: vi.fn(), branchMerchantStatus: vi.fn() },
}));
import { superAdminApi } from '../api/superAdminApi';
import { BranchMerchantAccountsPanel } from './BranchMerchantAccountsPanel';

const row = (over: any = {}) => ({
  id: 'm1', tenantId: 't1', branchId: 'b2', branchName: 'Cherry Hill', processorType: 'fiserv', environment: 'production', displayName: null,
  merchantIdMasked: '••••1001', currency: 'USD', status: 'active', credentialsConfigured: true, terminalConfigured: true, terminalBaseUrl: 'https://bolt.example',
  webhookSecretConfigured: false, configVersion: 3, lastValidatedAt: null, lastValidationError: null, updatedAt: null, ...over,
});
const branches = [{ id: 'b1', name: 'Main' }, { id: 'b2', name: 'Cherry Hill' }];

beforeEach(() => { vi.clearAllMocks(); });

describe('BranchMerchantAccountsPanel', () => {
  it('honest empty state: no location has its own merchant — every location uses the salon gateway', async () => {
    (superAdminApi.listBranchMerchants as any).mockResolvedValue([]);
    render(<BranchMerchantAccountsPanel tenantId="t1" branches={branches} />);
    expect(await screen.findByText(/No location has its own merchant account/)).toBeInTheDocument();
    expect(superAdminApi.listBranchMerchants).toHaveBeenCalledWith('t1');
  });

  it('lists masked rows (never a credential) and tests through the real route', async () => {
    (superAdminApi.listBranchMerchants as any).mockResolvedValue([row()]);
    (superAdminApi.testBranchMerchant as any).mockResolvedValue({ ok: true, configured: true, status: 'active', tested: true, note: 'Merchant enabled on the gateway.', scope: 'branch' });
    render(<BranchMerchantAccountsPanel tenantId="t1" branches={branches} />);
    expect(await screen.findByText('••••1001')).toBeInTheDocument();
    expect(screen.getByText('Cherry Hill').tagName).toBe('TD');   // the row, not an "add" option (Cherry Hill already has one)
    expect(screen.getByText('Bolt key stored')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Test'));
    await waitFor(() => expect(superAdminApi.testBranchMerchant).toHaveBeenCalledWith('t1', 'b2'));
    expect(await screen.findByText(/Merchant enabled on the gateway/)).toBeInTheDocument();
  });

  it('adds a merchant account for a location that has none: write-only credentials go to the route, nothing is pre-filled', async () => {
    (superAdminApi.listBranchMerchants as any).mockResolvedValue([row()]);
    (superAdminApi.setBranchMerchant as any).mockResolvedValue(row({ branchId: 'b1', branchName: 'Main' }));
    render(<BranchMerchantAccountsPanel tenantId="t1" branches={branches} />);
    await screen.findByText('••••1001');
    const add = screen.getByLabelText('Add merchant account for location') as HTMLSelectElement;
    expect(Array.from(add.options).map((o) => o.textContent)).toEqual(['Add for location…', 'Main']);   // Cherry Hill already has one
    fireEvent.change(add, { target: { value: 'b1' } });
    fireEvent.change(screen.getByLabelText('Branch merchant ID'), { target: { value: 'MID-2002' } });
    fireEvent.change(screen.getByLabelText('Branch API username'), { target: { value: 'u' } });
    fireEvent.change(screen.getByLabelText('Branch API password'), { target: { value: 'p' } });
    fireEvent.click(screen.getByText('Save merchant account'));
    await waitFor(() => expect(superAdminApi.setBranchMerchant).toHaveBeenCalledWith('t1', 'b1', expect.objectContaining({ processorType: 'fiserv', environment: 'sandbox', status: 'pending', merchantId: 'MID-2002', apiUsername: 'u', apiPassword: 'p' })));
    expect(await screen.findByText(/Saved — credentials encrypted at rest/)).toBeInTheDocument();
  });

  it('disable asks an inline confirmation first (no browser dialog), then calls the status route', async () => {
    (superAdminApi.listBranchMerchants as any).mockResolvedValue([row()]);
    (superAdminApi.branchMerchantStatus as any).mockResolvedValue(row({ status: 'disabled' }));
    render(<BranchMerchantAccountsPanel tenantId="t1" branches={branches} />);
    await screen.findByText('••••1001');
    fireEvent.click(screen.getByText('Disable'));
    expect(superAdminApi.branchMerchantStatus).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Disable' }));
    await waitFor(() => expect(superAdminApi.branchMerchantStatus).toHaveBeenCalledWith('t1', 'b2', 'disable'));
  });
});
