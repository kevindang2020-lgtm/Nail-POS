// Hardware Payments (money path): selecting a tenant loads its plan/invoices/ledger, and the money actions call the REAL
// hardware-payment routes with the EXACT body shapes the backend reads — including correct dollars->integer-cents
// conversion. This locks the wiring so future edits can't silently drift the money-path payloads.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api/superAdminApi', () => ({ superAdminApi: {
  state: vi.fn(), hwPlan: vi.fn(), hwTenantSettings: vi.fn(), hwInvoices: vi.fn(), hwLedger: vi.fn(),
  hwRunMonthly: vi.fn(), hwRecalc: vi.fn(), hwChargeShortfall: vi.fn(), hwImportVolume: vi.fn(),
  hwCreatePlan: vi.fn(), hwSetTenantSettings: vi.fn(), hwPause: vi.fn(), hwResume: vi.fn(),
} }));

import { superAdminApi as A } from '../api/superAdminApi';
import { HardwarePaymentsScreen } from './HardwarePaymentsScreen';

const month = new Date().toISOString().slice(0, 7);

beforeEach(() => {
  vi.clearAllMocks();
  (A.state as any).mockResolvedValue({ tenants: [{ id: 't1', name: 'Luxe Nails & Spa' }] });
  (A.hwPlan as any).mockResolvedValue({ plan: { id: 'plan1', status: 'active', monthlyPaymentCents: 25000, remainingBalanceCents: 275000, autoChargeShortfallEnabled: true } });
  (A.hwTenantSettings as any).mockResolvedValue({ effective: { pricingRateBps: 290, expenseRateBps: 50, platformSharePercent: 70, fiservSharePercent: 30, salonHardwareCreditPercentOfPlatformShare: 50 }, hasOverride: false });
  (A.hwInvoices as any).mockResolvedValue([{ id: 'inv1', billingMonth: '2026-05', cardVolumeCents: 5000000, netMarginCents: 120000, salonHardwareCreditCents: 25000, hardwareMonthlyDueCents: 25000, shortfallCents: 0, autoChargeAmountCents: 0, status: 'paid' }]);
  (A.hwLedger as any).mockResolvedValue([{ id: 'led1', entryType: 'charge', amountCents: 25000, description: 'Monthly payment' }]);
  for (const m of ['hwRunMonthly', 'hwRecalc', 'hwChargeShortfall', 'hwImportVolume', 'hwCreatePlan', 'hwSetTenantSettings', 'hwPause', 'hwResume'] as const) (A[m] as any).mockResolvedValue({});
});

const selectTenant = async () => {
  render(<MemoryRouter><HardwarePaymentsScreen /></MemoryRouter>);
  await waitFor(() => expect(screen.getByRole('option', { name: 'Luxe Nails & Spa' })).toBeInTheDocument());
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 't1' } });
};

describe('HardwarePaymentsScreen (money path)', () => {
  it('loads the selected tenant plan, invoices, and ledger', async () => {
    await selectTenant();
    expect(await screen.findByText('active')).toBeInTheDocument();           // plan status
    expect(screen.getByText('2026-05')).toBeInTheDocument();                  // invoice row
    expect(screen.getByText('Monthly payment')).toBeInTheDocument();         // ledger row
  });

  it('recalculates a month with the exact payload incl. dollars->cents', async () => {
    await selectTenant();
    await screen.findByText('active');
    fireEvent.click(screen.getByText('Recalculate month'));
    // default card-volume field is "50000" dollars -> 5,000,000 cents; planId + billingMonth must be included
    await waitFor(() => expect(A.hwRecalc).toHaveBeenCalledWith('t1', expect.objectContaining({ planId: 'plan1', billingMonth: month, cardVolumeCents: 5000000 })));
  });

  it('charges a shortfall with planId + billingMonth', async () => {
    await selectTenant();
    await screen.findByText('active');
    fireEvent.click(screen.getByText('Charge shortfall'));
    await waitFor(() => expect(A.hwChargeShortfall).toHaveBeenCalledWith('t1', expect.objectContaining({ planId: 'plan1', billingMonth: month })));
  });

  it('runs the monthly reconciliation for the chosen billing month', async () => {
    await selectTenant();
    await screen.findByText('active');
    fireEvent.click(screen.getByText(/Run Monthly/));
    await waitFor(() => expect(A.hwRunMonthly).toHaveBeenCalledWith(month));
  });

  it('pauses an active plan via the real route', async () => {
    await selectTenant();
    await screen.findByText('active');
    fireEvent.click(screen.getByText('Pause plan'));
    await waitFor(() => expect(A.hwPause).toHaveBeenCalledWith('t1', 'plan1'));
  });
});
