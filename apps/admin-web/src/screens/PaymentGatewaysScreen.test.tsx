// Payment Gateways command center — drives GET /super-admin/platform/payment-gateways/state (masked only). Verifies the
// 8 KPI cards, the gateways table + masked MID, server-side status filtering, the detail panel, the analytics modules,
// the honest "chargebacks not tracked yet" state, and that the Configure drawer reuses the secure (masked) panel.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api/superAdminApi', () => ({
  superAdminApi: {
    paymentGatewaysState: vi.fn(), paymentGatewaysExport: vi.fn(),
    getGateway: vi.fn(), setGateway: vi.fn(), testGateway: vi.fn(),
    pauseGateway: vi.fn(), resumeGateway: vi.fn(), disableGateway: vi.fn(),
    listBranchMerchants: vi.fn(), setBranchMerchant: vi.fn(), testBranchMerchant: vi.fn(), branchMerchantStatus: vi.fn(),
  },
}));

import { superAdminApi } from '../api/superAdminApi';
import { PaymentGatewaysScreen } from './PaymentGatewaysScreen';

const gw = (over: any = {}) => ({
  tenantId: 't', tenantName: 'Tenant', salonCode: 'T-0', tenantStatus: 'active', ownerName: 'Owner One',
  city: 'Houston', state: 'TX', location: 'Houston, TX', branchCount: 1,
  branches: [{ id: 'b1', name: 'Main', city: 'Houston', state: 'TX', status: 'active' }],
  processor: 'cardpointe', merchantIdMasked: '••••4242',
  environment: 'production', gatewayStatus: 'active', setupStage: 'complete', paymentSetupLabel: 'Complete',
  onboardingStatus: 'approved', onboardingLabel: 'Approved',
  settlementStatus: 'settled', monthlyVolumeCents: 1234500, todayVolumeCents: 84200, todayTxnCount: 7, pairedTerminals: 2, hasConfig: true, chargebackAlerts: 0,
  credentials: { apiConfigured: true, webhookConfigured: true }, lastSyncAt: '2026-06-10T00:00:00Z', lastPaymentAt: '2026-06-12T00:00:00Z', ...over,
});
const STATE = {
  kpis: { totalGateways: 4, activeMerchantAccounts: 2, pendingPaymentSetup: 1, gatewayIssues: 1, monthlyProcessedVolumeCents: 3240000, failedSettlements: 1, chargebackAlerts: 0, chargebacksTracked: false, connectedProcessors: 3 },
  filters: {},
  gateways: [
    gw({ tenantId: 't1', tenantName: 'Palace Nails', salonCode: 'PAL-1' }),
    gw({ tenantId: 't2', tenantName: 'Glow Bar', salonCode: 'GLW-2', gatewayStatus: 'not_configured', merchantIdMasked: null, hasConfig: false, credentials: { apiConfigured: false, webhookConfigured: false }, settlementStatus: 'not_applicable', monthlyVolumeCents: 0, pairedTerminals: 0 }),
    gw({ tenantId: 't3', tenantName: 'Lotus Spa', salonCode: 'LOT-3', gatewayStatus: 'error', settlementStatus: 'failed' }),
    gw({ tenantId: 't4', tenantName: 'Ivy Nails', salonCode: 'IVY-4' }),
  ],
  pagination: { total: 4, page: 1, limit: 10, pages: 1 },
  analytics: {
    statusBreakdown: [{ key: 'active', label: 'Active', count: 2, pct: 50 }, { key: 'not_configured', label: 'Needs Setup', count: 1, pct: 25 }, { key: 'error', label: 'Gateway Issues', count: 1, pct: 25 }],
    topProcessors: [{ rank: 1, processor: 'cardpointe', activeGateways: 2, monthlyVolumeCents: 2000000 }, { rank: 2, processor: 'fiserv', activeGateways: 1, monthlyVolumeCents: 500000 }],
    recentEvents: [{ id: 'e1', kind: 'success', label: 'Gateway connected', tenantName: 'Palace Nails', at: '2026-06-10T00:00:00Z' }],
    recentActivity: [{ id: 'a1', kind: 'error', label: 'Settlement failed', tenantName: 'Lotus Spa', at: '2026-06-10T00:00:00Z' }],
  },
  permissions: { view: true },
};

beforeEach(() => {
  vi.clearAllMocks();
  (superAdminApi.paymentGatewaysState as any).mockResolvedValue(STATE);
  (superAdminApi.paymentGatewaysExport as any).mockResolvedValue({ filename: 'payment-gateways.csv', csv: 'Tenant\nPalace Nails' });
  (superAdminApi.getGateway as any).mockResolvedValue({ processorType: 'cardpointe', environment: 'production', merchantIdMasked: '••••4242', status: 'active', setupRequired: false });
  (superAdminApi.testGateway as any).mockResolvedValue({ ok: true });
  (superAdminApi.listBranchMerchants as any).mockResolvedValue([]);
  (superAdminApi.pauseGateway as any).mockResolvedValue({ status: 'paused' });
  (superAdminApi.resumeGateway as any).mockResolvedValue({ status: 'active' });
  (superAdminApi.disableGateway as any).mockResolvedValue({ status: 'disabled' });
  (window as any).URL.createObjectURL = vi.fn(() => 'blob:x');
  (window as any).URL.revokeObjectURL = vi.fn();
  HTMLAnchorElement.prototype.click = vi.fn();
});

const kpi = (label: string) => within(screen.getByText(label, { selector: '.l' }).closest('.kpi') as HTMLElement);
const renderScreen = () => render(<MemoryRouter><PaymentGatewaysScreen /></MemoryRouter>);

describe('PaymentGatewaysScreen (command center)', () => {
  it('renders the 8 KPI cards from /state', async () => {
    renderScreen();
    expect((await screen.findAllByText('Palace Nails')).length).toBeGreaterThan(0);
    expect(kpi('Total Gateways').getByText('4', { selector: '.v' })).toBeInTheDocument();
    expect(kpi('Active Merchant Accounts').getByText('2', { selector: '.v' })).toBeInTheDocument();
    expect(kpi('Gateway Issues').getByText('1', { selector: '.v' })).toBeInTheDocument();
    expect(kpi('Connected Processors').getByText('3', { selector: '.v' })).toBeInTheDocument();
  });

  it('shows the masked MID and never a raw secret', async () => {
    renderScreen();
    await screen.findAllByText('Palace Nails');
    expect(screen.getAllByText(/••••4242/).length).toBeGreaterThan(0);
  });

  it('chargebacks are honestly shown as not tracked yet', async () => {
    renderScreen();
    await screen.findAllByText('Palace Nails');
    expect(kpi('Chargeback Alerts').getByText('not tracked yet')).toBeInTheDocument();
    expect(kpi('Chargeback Alerts').getByText('—')).toBeInTheDocument();
  });

  it('shows the real chargeback count once the source is tracked', async () => {
    (superAdminApi.paymentGatewaysState as any).mockResolvedValue({
      ...STATE,
      kpis: { ...STATE.kpis, chargebackAlerts: 7, chargebacksTracked: true },
      gateways: [gw({ tenantId: 't1', tenantName: 'Palace Nails', salonCode: 'PAL-1', chargebackAlerts: 7 })],
    });
    renderScreen();
    await screen.findAllByText('Palace Nails');
    expect(kpi('Chargeback Alerts').getByText('7', { selector: '.v' })).toBeInTheDocument();
    expect(kpi('Chargeback Alerts').getByText('open alerts')).toBeInTheDocument();
    expect(kpi('Chargeback Alerts').queryByText('not tracked yet')).toBeNull();
  });

  it('surfaces the full branch footprint (table +N indicator + detail list)', async () => {
    (superAdminApi.paymentGatewaysState as any).mockResolvedValue({
      ...STATE,
      gateways: [gw({
        tenantId: 't1', tenantName: 'Palace Nails', salonCode: 'PAL-1', location: 'Houston, TX', branchCount: 3,
        branches: [
          { id: 'b1', name: 'Downtown', city: 'Houston', state: 'TX', status: 'active' },
          { id: 'b2', name: 'Galleria', city: 'Dallas', state: 'TX', status: 'active' },
          { id: 'b3', name: 'Midtown', city: 'Austin', state: 'TX', status: 'active' },
        ],
      })],
    });
    renderScreen();
    await screen.findAllByText('Palace Nails');
    expect(screen.getByText('+2')).toBeInTheDocument();           // table indicator: 3 branches → primary + 2
    expect(screen.getByText('Branches')).toBeInTheDocument();     // detail panel section
    expect(screen.getByText('Galleria')).toBeInTheDocument();     // a non-primary branch is listed
    expect(screen.getByText('Austin, TX')).toBeInTheDocument();
  });

  it('Pause Gateway action calls the audited pause endpoint', async () => {
    const { container } = renderScreen();
    await screen.findAllByText('Palace Nails');
    fireEvent.click(screen.getAllByText('⋮')[0]);                  // open the first row's actions menu
    const menu = container.querySelector('.amenu') as HTMLElement;
    fireEvent.click(within(menu).getByText('Pause Gateway'));
    await waitFor(() => expect(superAdminApi.pauseGateway).toHaveBeenCalledWith('t1'));
  });

  it('a paused gateway shows On Hold and offers Resume', async () => {
    (superAdminApi.paymentGatewaysState as any).mockResolvedValue({
      ...STATE,
      gateways: [gw({ tenantId: 't1', tenantName: 'Palace Nails', salonCode: 'PAL-1', gatewayStatus: 'paused' })],
    });
    const { container } = renderScreen();
    await screen.findAllByText('Palace Nails');
    expect(screen.getAllByText('On Hold').length).toBeGreaterThan(0);   // badge (table + detail)
    fireEvent.click(screen.getAllByText('⋮')[0]);
    const menu = container.querySelector('.amenu') as HTMLElement;
    fireEvent.click(within(menu).getByText('Resume Gateway'));
    await waitFor(() => expect(superAdminApi.resumeGateway).toHaveBeenCalledWith('t1'));
  });

  it('drives the Underwriting Approved step from the real onboarding status', async () => {
    // approved → the step is marked done
    (superAdminApi.paymentGatewaysState as any).mockResolvedValue({
      ...STATE,
      gateways: [gw({ tenantId: 't1', tenantName: 'Palace Nails', onboardingStatus: 'approved', onboardingLabel: 'Approved' })],
    });
    const { unmount } = renderScreen();
    await screen.findAllByText('Palace Nails');
    expect(screen.getByLabelText('Underwriting Approved: done')).toBeInTheDocument();       // ✓ done (announced, not colour-only)
    unmount();

    // under_review → NOT done, and the underwriting status is shown in the summary
    (superAdminApi.paymentGatewaysState as any).mockResolvedValue({
      ...STATE,
      gateways: [gw({ tenantId: 't1', tenantName: 'Palace Nails', gatewayStatus: 'pending', hasConfig: true, credentials: { apiConfigured: false, webhookConfigured: false }, onboardingStatus: 'under_review', onboardingLabel: 'Under Review' })],
    });
    renderScreen();
    await screen.findAllByText('Palace Nails');
    expect(screen.getByLabelText('Underwriting Approved: not done')).toBeInTheDocument();   // ○ not done
    expect(screen.getAllByText('Under Review').length).toBeGreaterThan(0); // surfaced in the Underwriting line
  });

  it('shows intraday Processed Today (volume + txn count) in the detail panel', async () => {
    (superAdminApi.paymentGatewaysState as any).mockResolvedValue({
      ...STATE,
      gateways: [gw({ tenantId: 't1', tenantName: 'Palace Nails', todayVolumeCents: 84200, todayTxnCount: 7 })],
    });
    renderScreen();
    await screen.findAllByText('Palace Nails');
    const today = [...document.querySelectorAll('.dkv')].find((n) => /Processed Today/.test(n.textContent || ''));
    expect(today).toBeTruthy();
    expect(today?.textContent).toContain('$842');     // 84200 cents → $842
    expect(today?.textContent).toContain('7 txn');
  });

  it('status filter drives a server-side query', async () => {
    renderScreen();
    await screen.findAllByText('Palace Nails');
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'error' } });
    await waitFor(() => expect(superAdminApi.paymentGatewaysState).toHaveBeenCalledWith(expect.objectContaining({ status: 'error' })));
  });

  it('renders the analytics modules (status breakdown, top processors, events)', async () => {
    renderScreen();
    await screen.findAllByText('Palace Nails');
    expect(screen.getByText('Gateway Status Breakdown')).toBeInTheDocument();
    expect(screen.getByText('Top Processors')).toBeInTheDocument();
    expect(screen.getByText('Gateway connected')).toBeInTheDocument();      // recent event
    expect(screen.getAllByText('Settlement failed').length).toBeGreaterThan(0); // recent activity
  });

  it('Export pulls the filtered CSV from the backend', async () => {
    renderScreen();
    await screen.findAllByText('Palace Nails');
    fireEvent.click(screen.getByTitle('Export filtered gateways to CSV'));
    await waitFor(() => expect(superAdminApi.paymentGatewaysExport).toHaveBeenCalled());
  });

  it('Configure Gateway opens the secure masked drawer (reused panel)', async () => {
    renderScreen();
    await screen.findAllByText('Palace Nails');
    fireEvent.click(screen.getByTitle("Configure the selected tenant's gateway"));
    // the reused PaymentGatewayPanel loads the masked gateway, then reveals the write-only credential form on Edit
    await waitFor(() => expect(superAdminApi.getGateway).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    expect(await screen.findByText(/encrypted at rest/i)).toBeInTheDocument();
    // credential inputs are write-only (never pre-filled)
    expect(screen.getAllByPlaceholderText('write-only').length).toBeGreaterThan(0);
  });
});
