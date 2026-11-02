// wave 4 UI sweep: "Ready" on the Completed Service Queue posted mark-ready-for-checkout for tickets whose quality check
// was still pending and got 400 "Quality must be approved…" — the salon's workflow (requireQualityCheckBeforeCheckout,
// sent with the state) was never read. The button now says why it cannot be used yet, and does not send.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { POSServiceDoneScreen } from './POSServiceDoneScreen';

const kpis = { completedServicesToday: 2, ticketsReadyForReview: 2, ticketsReadyForCheckout: 0, qualityIssuesCount: 0, reopenedServicesToday: 0, averageServiceDurationMinutes: 30, estimatedSalesCents: 0, estimatedCommissionCents: null, addOnRevenueCents: 0, averageTurnaroundSeconds: 0, customerSatisfactionAvg: 0, tipsCapturedCents: 0, rebookingRatePercent: 0 };
const ticket = (id: string, name: string, qualityStatus: string) => ({ ticketId: id, ticketNumber: id, customerName: name, serviceCount: 1, serviceNames: ['Gel Manicure'], primaryTechnicianName: 'Mia', qualityStatus, checkoutStatus: 'not_ready', status: 'service_done', totalCents: 4000 });
const stateWith = (requireQc: boolean) => ({ kpis, tickets: { items: [ticket('t1', 'Pending Pat', 'pending'), ticket('t2', 'Approved Amy', 'approved')], pagination: { totalItems: 2 } },
  filters: { statuses: [], technicians: [], serviceCategories: [], qualityStatuses: [], stations: [] },
  workflowSettings: { requireQualityCheckBeforeCheckout: requireQc } });
beforeEach(() => { vi.restoreAllMocks(); });
const mount = (s: unknown) => { globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => s, headers: { get: () => null } } as any)) as any; render(<MemoryRouter><POSServiceDoneScreen /></MemoryRouter>); };
const readyButtons = () => screen.getAllByRole('button').filter((b) => b.textContent === 'Ready');

describe('Service Done "Ready" respects the salon\'s quality-check rule', () => {
  it('the salon requires QC: Ready is disabled (with the reason) until quality is approved', async () => {
    mount(stateWith(true));
    await screen.findAllByText('Pending Pat');
    const [pending, approved] = readyButtons();
    expect(pending).toBeDisabled();
    expect(pending.getAttribute('title')).toMatch(/quality/i);
    expect(approved).not.toBeDisabled();
  });
  it('the salon does not require QC: Ready works for every finished ticket', async () => {
    mount(stateWith(false));
    await screen.findAllByText('Pending Pat');
    for (const b of readyButtons()) expect(b).not.toBeDisabled();
  });
});
