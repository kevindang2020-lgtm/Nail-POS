// Hardware Payment Reports: renders monthly platform totals from GET /super-admin/hardware-payment/reports and computes
// the roll-up KPIs (card volume, hardware credit, shortfall, collected, overall collection rate) client-side. This test
// locks the aggregation math and the per-row rendering.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api/superAdminApi', () => ({ superAdminApi: { hwReports: vi.fn() } }));

import { superAdminApi as A } from '../api/superAdminApi';
import { HardwarePaymentReportsScreen } from './HardwarePaymentReportsScreen';

const REPORT = [
  { billingMonth: '2026-04', invoiceCount: 10, cardVolumeCents: 10000000, hardwareCreditCents: 200000, dueCents: 250000, shortfallCents: 50000, chargedCents: 40000, collectionRatePct: 80, paidCount: 8, failedCount: 2 },
  { billingMonth: '2026-05', invoiceCount: 12, cardVolumeCents: 12000000, hardwareCreditCents: 240000, dueCents: 300000, shortfallCents: 60000, chargedCents: 60000, collectionRatePct: 100, paidCount: 12, failedCount: 0 },
];

beforeEach(() => { vi.clearAllMocks(); (A.hwReports as any).mockResolvedValue(REPORT); });

const renderScreen = () => render(<MemoryRouter><HardwarePaymentReportsScreen /></MemoryRouter>);

describe('HardwarePaymentReportsScreen', () => {
  it('renders a row per month', async () => {
    renderScreen();
    expect(await screen.findByText('2026-04')).toBeInTheDocument();
    expect(screen.getByText('2026-05')).toBeInTheDocument();
  });

  it('aggregates the roll-up KPIs across months', async () => {
    renderScreen();
    await screen.findByText('2026-04');
    expect(screen.getByText('$220,000')).toBeInTheDocument();        // card volume: 100k + 120k (money0, rounded, no decimals)
    expect(screen.getByText('22 invoices')).toBeInTheDocument();     // invoice count: 10 + 12
    expect(screen.getByText('$4,400.00')).toBeInTheDocument();       // hardware credit: 2000 + 2400
    expect(screen.getByText('$1,100.00')).toBeInTheDocument();       // shortfall: 500 + 600
    expect(screen.getByText('$1,000.00')).toBeInTheDocument();       // collected: 400 + 600
    expect(screen.getByText('20 paid · 2 failed')).toBeInTheDocument();
  });

  it('computes the overall collection rate from totals (collected / shortfall)', async () => {
    renderScreen();
    await screen.findByText('2026-04');
    // 100000 / 110000 = 90.9% -> rounded 91%
    expect(screen.getByText('91%')).toBeInTheDocument();
  });

  it('enables CSV export when there are rows', async () => {
    renderScreen();
    await screen.findByText('2026-04');
    expect(screen.getByRole('button', { name: 'Export CSV' })).not.toBeDisabled();
  });
});
