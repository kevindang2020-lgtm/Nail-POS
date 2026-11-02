// wave 4 UI sweep: with a guest already in "Ready for Service Done" selected, the quick actions "Mark Ready" / "Move
// Stage" posted mark-service-done again and got 400 NOT_IN_SERVICE. They now say where the ticket went, and post nothing.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { POSServingScreen } from './POSServingScreen';

const kpis = { servingNow: 0, activeTickets: 1, delayedServices: 0, nearingCompletion: 0, averageServiceDurationMinutes: 0, totalInServiceSalesCents: 0, techniciansInService: 0, servicesCompletedToday: 1, addOnAttachRatePercent: 0, addOnRevenueCents: 0, customerSatisfactionAvg: 0, onTimeCompletionPercent: 0 };
const state = { kpis, tickets: { items: [{ ticketId: 'tdone', ticketNumber: 'D1', customerName: 'Done Dana', serviceNames: ['Gel Manicure'], primaryTechnicianName: 'Mia', elapsedMinutes: 50, estimatedDurationMinutes: 45, subtotalCents: 4000, status: 'completed' }], pagination: { totalItems: 1 } },
  filters: { statuses: [], technicians: [], serviceCategories: [], stations: [], delayStatuses: [] } };
const calls: string[] = [];
beforeEach(() => { vi.restoreAllMocks(); calls.length = 0; });

describe('Serving quick actions on a ticket that is already done', () => {
  it('"Mark Ready" says it is waiting in Service Done and does not post', async () => {
    globalThis.fetch = vi.fn(async (url: any, init?: any) => {
      const u = String(url); if ((init?.method || 'GET') !== 'GET') calls.push(`${init.method} ${u}`);
      const body = u.includes('/pos/serving') ? state : u.includes('/pos/technicians/state') ? { rows: { items: [] } } : {};
      return { ok: true, status: 200, json: async () => body, headers: { get: () => null } } as any;
    }) as any;
    render(<MemoryRouter><POSServingScreen /></MemoryRouter>);
    fireEvent.click((await screen.findAllByText('Done Dana'))[0]);
    fireEvent.click(screen.getAllByText('Mark Ready')[0]);
    await waitFor(() => expect(screen.getByText(/already done — it is waiting in Service Done/)).toBeInTheDocument());
    expect(calls.filter((c) => c.includes('mark-service-done'))).toEqual([]);
  });
});
