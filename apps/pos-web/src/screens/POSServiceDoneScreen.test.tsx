import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { POSServiceDoneScreen } from './POSServiceDoneScreen';

const state = {
  kpis: { completedServicesToday: 0, ticketsReadyForReview: 0, ticketsReadyForCheckout: 0, qualityIssuesCount: 0, reopenedServicesToday: 0, averageServiceDurationMinutes: 0, estimatedSalesCents: 0, estimatedCommissionCents: 0, addOnRevenueCents: 0, averageTurnaroundSeconds: 0, customerSatisfactionAvg: 0, tipsCapturedCents: 0, rebookingRatePercent: 0 },
  tickets: { items: [], pagination: { totalItems: 0 } },
  filters: { statuses: [], technicians: [], serviceCategories: [], qualityStatuses: [], stations: [] },
};
const mockFetch = (s: unknown) => vi.fn(async () => ({ ok: true, status: 200, json: async () => s, headers: { get: () => null } } as any));
beforeEach(() => { vi.restoreAllMocks(); });

describe('POSServiceDoneScreen', () => {
  it('mounts and renders the service-done board + empty state', async () => {
    globalThis.fetch = mockFetch(state) as any;
    render(<MemoryRouter><POSServiceDoneScreen /></MemoryRouter>);
    expect(await screen.findByText('Service Done')).toBeInTheDocument();
    expect(screen.getByText('No completed services yet.')).toBeInTheDocument();
  });

  it('renders Service Done Board + AI insights + the server completion-accuracy KPI', async () => {
    const withTickets = {
      kpis: { completionAccuracyPercent: 90, completedServicesToday: 10, ticketsReadyForReview: 2, ticketsReadyForCheckout: 3, qualityIssuesCount: 1, reopenedServicesToday: 1, averageServiceDurationMinutes: 45, estimatedSalesCents: 50000, estimatedCommissionCents: 12000, addOnRevenueCents: 3500, averageTurnaroundSeconds: 360, customerSatisfactionAvg: 4.6, tipsCapturedCents: 4250, rebookingRatePercent: 67 },
      tickets: { items: [
        { ticketId: 't1', ticketNumber: 'A1', customerName: 'Jessica Miller', isVip: true, serviceCount: 1, serviceNames: ['Acrylic Full Set'], primaryTechnicianName: 'Mia', qualityStatus: 'ok', checkoutStatus: 'ready', status: 'completed', subtotalCents: 9500 },
        { ticketId: 't2', ticketNumber: 'A2', customerName: 'Olivia Brown', serviceCount: 1, serviceNames: ['Gel X'], primaryTechnicianName: 'Leo', qualityStatus: 'ok', checkoutStatus: 'ready', status: 'ready_for_checkout', subtotalCents: 6000 },
      ], pagination: { totalItems: 2 } },
      filters: { statuses: [], technicians: [], serviceCategories: [], qualityStatuses: [], stations: [] },
    };
    globalThis.fetch = mockFetch(withTickets) as any;
    render(<MemoryRouter><POSServiceDoneScreen /></MemoryRouter>);
    expect(await screen.findByText('Service Done')).toBeInTheDocument();
    expect(screen.getByText('Service Done Board')).toBeInTheDocument();
    expect(screen.getByText('AI Service Done Insights')).toBeInTheDocument();
    // T08 added modules
    expect(screen.getByText(/Technician Completion Performance/)).toBeInTheDocument();
    expect(screen.getByText('Guest Completion Details')).toBeInTheDocument();
    expect(screen.getByText('Service Mix')).toBeInTheDocument();
    expect(screen.getByText(/Completion Funnel/)).toBeInTheDocument();
    expect(screen.getByText('Potential Revenue Ready for Checkout')).toBeInTheDocument();
    expect(screen.getByText('Move to Checkout')).toBeInTheDocument();
    expect(screen.getByText('Completed Service Queue')).toBeInTheDocument();
    expect(screen.getByText('Completion Accuracy')).toBeInTheDocument();
    expect(screen.getByText('90%')).toBeInTheDocument();
    expect(screen.getByText('Just Finished')).toBeInTheDocument();
    expect(screen.getByText('Add-On Revenue Today')).toBeInTheDocument();
    expect(screen.getAllByText('$35.00').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Avg Turnaround to Checkout')).toBeInTheDocument();
    expect(screen.getByText('6 min')).toBeInTheDocument();
    expect(screen.getByText('Customer Satisfaction')).toBeInTheDocument();
    expect(screen.getByText('4.6 / 5')).toBeInTheDocument();
    expect(screen.getByText('Tips Captured')).toBeInTheDocument();
    expect(screen.getAllByText('$42.50').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Rebooking Rate')).toBeInTheDocument();
    expect(screen.getByText('67%')).toBeInTheDocument();
  });

  it('shows the P5 Service Done lock badge for a formally-locked ticket', async () => {
    const obj = {
      kpis: { completedServicesToday: 1, ticketsReadyForReview: 0, ticketsReadyForCheckout: 0, qualityIssuesCount: 0, reopenedServicesToday: 0, averageServiceDurationMinutes: 40, estimatedSalesCents: 6000, estimatedCommissionCents: 1200, addOnRevenueCents: 0, averageTurnaroundSeconds: 300, customerSatisfactionAvg: 0, tipsCapturedCents: 0, rebookingRatePercent: 0 },
      tickets: { items: [{ ticketId: 't1', ticketNumber: 'A1', customerName: 'Jessica Miller', isVip: false, serviceCount: 1, serviceNames: ['Gel X'], primaryTechnicianName: 'Mia', qualityStatus: 'ok', checkoutStatus: 'ready', status: 'completed', subtotalCents: 6000 }], pagination: { totalItems: 1 } },
      filters: { statuses: [], technicians: [], serviceCategories: [], qualityStatuses: [], stations: [] },
      // detail fields (same object is returned for the ticket-detail fetch):
      customer: { fullName: 'Jessica Miller', isVip: false }, services: [{ serviceLineId: 'l1', serviceName: 'Gel X', priceCents: 6000 }], subtotalCents: 6000, serviceDoneLocked: true,
    };
    globalThis.fetch = mockFetch(obj) as any;
    render(<MemoryRouter><POSServiceDoneScreen /></MemoryRouter>);
    expect(await screen.findByText('Locked')).toBeInTheDocument();
  });
});

// ── 2026-07-03 restored controls: header search/service/quality filters (dead/missing), the per-ticket Manage
// button that opens the quality-check/reopen drawer (drawer JSX existed but nothing opened it), and the Ready action
// (markReadyForCheckout was orphaned). Lock the wiring.
import { fireEvent, within, waitFor } from '@testing-library/react';

const dTicket = (over: any = {}) => ({ ticketId: 'd1', ticketNumber: 'D1', customerName: 'Jessica Miller', serviceCount: 1, serviceNames: ['Gel Manicure'], primaryTechnicianName: 'Mia', completedAt: new Date().toISOString(), subtotalCents: 6500, qualityStatus: 'pending', checkoutStatus: 'pending', status: 'completed', ...over });
const richDone = {
  kpis: { completedServicesToday: 1, ticketsReadyForReview: 1, ticketsReadyForCheckout: 0, qualityIssuesCount: 0, reopenedServicesToday: 0, averageServiceDurationMinutes: 30, estimatedSalesCents: 6500, estimatedCommissionCents: 0, addOnRevenueCents: 0, averageTurnaroundSeconds: 0, customerSatisfactionAvg: 4.8, tipsCapturedCents: 0, rebookingRatePercent: 0 },
  tickets: { items: [dTicket()], pagination: { totalItems: 1 } },
  filters: { statuses: ['completed', 'reopened'], technicians: ['Mia'], serviceCategories: ['Manicure', 'Pedicure'], qualityStatuses: ['pending', 'approved', 'needs_review'], stations: [] },
};

const recDone = () => {
  const calls: { url: string; method: string; body?: any }[] = [];
  const fn = vi.fn(async (url: any, init?: any) => {
    const u = String(url); const method = init?.method || 'GET';
    let body: any; try { body = init?.body ? JSON.parse(init.body) : undefined; } catch { /* */ }
    calls.push({ url: u, method, body });
    const ok = (j: any) => ({ ok: true, status: 200, json: async () => j, headers: { get: () => null } } as any);
    if (u.match(/\/pos\/service-done\/tickets\/[^/?]+$/) && method === 'GET') return ok({ ticketId: 'd1', customerName: 'Jessica Miller' });
    if (u.includes('/pos/service-done/state')) return ok(richDone);
    return ok({ ok: true });
  });
  (fn as any).calls = calls;
  return fn;
};

describe('POSServiceDoneScreen — header filters (were dead/missing)', () => {
  it('service filter populates from facets and refetches with serviceCategory=', async () => {
    const f = recDone(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSServiceDoneScreen /></MemoryRouter>);
    await screen.findByText('Service Done');
    const sel = screen.getByLabelText('Service filter') as HTMLSelectElement;
    expect(within(sel).getByText('Pedicure')).toBeInTheDocument();
    fireEvent.change(sel, { target: { value: 'Pedicure' } });
    await waitFor(() => expect((f as any).calls.some((c: any) => c.url.includes('/pos/service-done/state') && c.url.includes('serviceCategory=Pedicure'))).toBe(true));
  });

  it('quality filter refetches with qualityStatus=', async () => {
    const f = recDone(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSServiceDoneScreen /></MemoryRouter>);
    await screen.findByText('Service Done');
    fireEvent.change(screen.getByLabelText('Quality filter'), { target: { value: 'needs_review' } });
    await waitFor(() => expect((f as any).calls.some((c: any) => c.url.includes('/pos/service-done/state') && c.url.includes('qualityStatus=needs_review'))).toBe(true));
  });

  it('search box refetches with search=', async () => {
    const f = recDone(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSServiceDoneScreen /></MemoryRouter>);
    await screen.findByText('Service Done');
    fireEvent.change(screen.getByLabelText('Search completed'), { target: { value: 'Mia' } });
    await waitFor(() => expect((f as any).calls.some((c: any) => c.url.includes('/pos/service-done/state') && c.url.includes('search=Mia'))).toBe(true));
  });
});

describe('POSServiceDoneScreen — per-ticket Manage drawer + Ready (were orphaned)', () => {
  it('Manage opens the quality/reopen drawer and Approve hits the quality-check endpoint', async () => {
    const f = recDone(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSServiceDoneScreen /></MemoryRouter>);
    await screen.findByText('Service Done');
    fireEvent.click(await screen.findByText('Manage'));
    // drawer surfaces quality + reopen actions
    expect(await screen.findByRole('button', { name: 'Needs Review' })).toBeInTheDocument();
    expect(screen.getByText('Reopen')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Approve'));
    await waitFor(() => {
      const call = (f as any).calls.find((c: any) => c.url.includes('/pos/service-done/tickets/d1/quality-check') && c.method === 'POST');
      expect(call).toBeTruthy();
      expect(call.body).toMatchObject({ result: 'approved' });
    });
  });

  it('Reopen requires a reason before hitting the endpoint', async () => {
    const f = recDone(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSServiceDoneScreen /></MemoryRouter>);
    await screen.findByText('Service Done');
    fireEvent.click(await screen.findByText('Manage'));
    fireEvent.click(await screen.findByText('Reopen'));
    expect(await screen.findByText(/Reopening requires a reason/)).toBeInTheDocument();
  });

  it('the Ready action calls markReadyForCheckout', async () => {
    const f = recDone(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSServiceDoneScreen /></MemoryRouter>);
    await screen.findByText('Service Done');
    fireEvent.click(await screen.findByText('Ready'));
    await waitFor(() => {
      expect((f as any).calls.some((c: any) => c.url.includes('/pos/service-done/tickets/d1/mark-ready-for-checkout') && c.method === 'POST')).toBe(true);
    });
  });
});

describe('POSServiceDoneScreen — optimistic send-to-checkout', () => {
  const recFailSend = () => {
    const calls: { url: string; method: string }[] = [];
    const fn = vi.fn(async (url: any, init?: any) => {
      const u = String(url); const method = init?.method || 'GET';
      calls.push({ url: u, method });
      const ok = (j: any) => ({ ok: true, status: 200, json: async () => j, headers: { get: () => null } } as any);
      if (u.includes('/send-to-checkout')) return { ok: false, status: 409, json: async () => ({ message: 'Already sent to checkout.' }), headers: { get: () => null } } as any;
      if (u.match(/\/pos\/service-done\/tickets\/[^/?]+$/) && method === 'GET') return ok({ ticketId: 'd1', customerName: 'Jessica Miller' });
      if (u.includes('/pos/service-done/state')) return ok(richDone);
      return ok({ ok: true });
    });
    (fn as any).calls = calls; return fn;
  };

  it('rolls the ticket back into the list when send-to-checkout fails', async () => {
    const f = recFailSend(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSServiceDoneScreen /></MemoryRouter>);
    await screen.findByText('Service Done');
    await screen.findAllByText('Jessica Miller');
    fireEvent.click(screen.getAllByText('Move to Checkout')[0]);
    await waitFor(() => expect((f as any).calls.some((c: any) => c.url.includes('/send-to-checkout') && c.method === 'POST')).toBe(true));
    // the send failed → the ticket is rolled back into the list, not left optimistically removed
    await waitFor(() => expect(screen.getAllByText('Jessica Miller').length).toBeGreaterThan(0));
  });
});
