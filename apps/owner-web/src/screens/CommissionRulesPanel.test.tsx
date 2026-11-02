import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CommissionRulesPanel } from './CommissionRulesPanel';
import { ownerCompensationApi } from '../api/ownerApi';

vi.mock('../api/ownerApi', () => ({ ownerCompensationApi: { listRules: vi.fn(), createRule: vi.fn(), seedDefault: vi.fn(), addRuleVersion: vi.fn(), approveVersion: vi.fn(), activateVersion: vi.fn(), cancelVersion: vi.fn() } }));

const policy = () => ({
  id: 'pol1', scope: { branchId: null, technicianId: null, serviceId: null, serviceCategory: null, ticketId: null },
  label: 'Salon default', createdAt: '2026-01-01',
  versions: [{ id: 'v1', version: 1, commissionType: 'percent', commissionValue: 60, supplyMethod: 'none', supplyValue: 0, discountFunding: 'proportional', effectiveStart: '2026-01-01T00:00:00Z', effectiveEnd: null, status: 'draft', approved: false, createdAt: '2026-01-01' }],
});

beforeEach(() => {
  vi.clearAllMocks();
  (ownerCompensationApi.listRules as any).mockResolvedValue([policy()]);
  (ownerCompensationApi.createRule as any).mockResolvedValue(policy());
  (ownerCompensationApi.activateVersion as any).mockResolvedValue({});
  (ownerCompensationApi.seedDefault as any).mockResolvedValue(policy());
});

describe('CommissionRulesPanel', () => {
  it('lists existing rules with scope, rate and status', async () => {
    render(<CommissionRulesPanel />);
    await waitFor(() => expect(screen.getByText('Salon default')).toBeInTheDocument());
    expect(screen.getByText('60%')).toBeInTheDocument();
    expect(screen.getByText(/draft/)).toBeInTheDocument();
  });

  it('creates a salon-default rule from the form with the entered rate', async () => {
    render(<CommissionRulesPanel />);
    await waitFor(() => expect(screen.getByText('Salon default')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Rate'), { target: { value: '55' } });
    fireEvent.click(screen.getByText('Add rule'));
    await waitFor(() => expect(ownerCompensationApi.createRule).toHaveBeenCalled());
    const arg = (ownerCompensationApi.createRule as any).mock.calls[0][0];
    expect(arg.version).toMatchObject({ commissionType: 'percent', commissionValue: 55 });
    expect(arg.scope).toEqual({}); // salon default
  });

  it('includes a fixed supply charge (in cents) and shows a base-reduction warning', async () => {
    render(<CommissionRulesPanel />);
    await waitFor(() => expect(screen.getByText('Salon default')).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Supply method'), { target: { value: 'fixed' } });
    expect(screen.getByRole('note')).toBeInTheDocument(); // warning that supply reduces commission
    fireEvent.change(screen.getByLabelText('Supply value'), { target: { value: '5' } }); // $5
    fireEvent.click(screen.getByText('Add rule'));
    await waitFor(() => expect(ownerCompensationApi.createRule).toHaveBeenCalled());
    const arg = (ownerCompensationApi.createRule as any).mock.calls[0][0];
    expect(arg.version).toMatchObject({ supplyMethod: 'fixed', supplyValue: 500 }); // $5 → 500 cents
  });

  it('activates a version only with the admin authorization code (the server refuses without it)', async () => {
    render(<CommissionRulesPanel />);
    await waitFor(() => expect(screen.getByText('Salon default')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Activate'));
    expect(ownerCompensationApi.activateVersion).not.toHaveBeenCalled();             // asks for the code first
    expect(screen.getByText('Confirm activate')).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Admin authorization code'), { target: { value: ' 482913 ' } });
    fireEvent.click(screen.getByText('Confirm activate'));
    await waitFor(() => expect(ownerCompensationApi.activateVersion).toHaveBeenCalledWith('v1', '482913'));
  });

  it('adds a new version to an existing rule using the form fields', async () => {
    (ownerCompensationApi.addRuleVersion as any).mockResolvedValue({});
    render(<CommissionRulesPanel />);
    await waitFor(() => expect(screen.getByText('Salon default')).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Add version/));
    await waitFor(() => expect(ownerCompensationApi.addRuleVersion).toHaveBeenCalledWith('pol1', expect.objectContaining({ commissionType: 'percent', commissionValue: 60 })));
  });

  it('shows an empty state when there are no rules', async () => {
    (ownerCompensationApi.listRules as any).mockResolvedValue([]);
    render(<CommissionRulesPanel />);
    await waitFor(() => expect(screen.getByText(/No commission rules yet/)).toBeInTheDocument());
  });

  it('offers the 60/40 seed when no salon default is active and seeds on confirm (§3)', async () => {
    render(<CommissionRulesPanel />);   // default fixture version is draft → not active
    await waitFor(() => expect(screen.getByText(/Set up the standard 60\/40 split/)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Set up the standard 60\/40 split/));
    expect(ownerCompensationApi.seedDefault).not.toHaveBeenCalled();       // the tap opens the dialog only
    fireEvent.click(await screen.findByRole('button', { name: 'Set 60/40 default' }));
    await waitFor(() => expect(ownerCompensationApi.seedDefault).toHaveBeenCalledWith(60));
  });

  it('hides the seed prompt when a salon default is already active', async () => {
    const active = policy(); active.versions[0].status = 'active';
    (ownerCompensationApi.listRules as any).mockResolvedValue([active]);
    render(<CommissionRulesPanel />);
    await waitFor(() => expect(screen.getByText('60%')).toBeInTheDocument());
    expect(screen.queryByText(/Set up the standard 60\/40 split/)).not.toBeInTheDocument();
  });
});
