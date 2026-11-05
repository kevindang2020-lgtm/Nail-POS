// POSQueueScreen.vi.test — English + Vietnamese POS mandate (WP-C1): the queue group reads in Vietnamese — Customer Queue
// (KPI lines, the flow board, status / source / priority chips from their codes, AI insights from id + vars) and Tech Queue
// (lanes, workload, insights) — with no English left. Names and services the salon typed stay as typed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setLanguage, useLanguage } from '@aipowersalon/mobile-sdk/i18n';
import { leftoverEnglish } from './viScan.testkit';
import { POSQueueScreen } from './POSQueueScreen';
import { POSTechQueueScreen } from './POSTechQueueScreen';

vi.mock('../realtime/useRealtime', () => ({ useRealtime: () => {} }));
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body), headers: { get: () => null } } as any);
const byUrl = (map: Record<string, unknown>) => vi.fn(async (url: any) => { const u = String(url); for (const k of Object.keys(map)) if (u.includes(k)) return ok(map[k]); return ok({}); });
const NAMES = ['Gel', 'Nguyễn Thị Hương', 'Mai Pham', 'Trần Mỹ Linh', 'Lan Vo', 'Gel Manicure', 'NT', 'MP', 'TM', 'LV', 'TL'];

const queue = {
  kpis: { waitingGuests: 2, averageWaitMinutes: 14, longestWaitMinutes: 25, vipWaiting: 1, appointmentsWaiting: 1, walkInsWaiting: 1, readyForTech: 1, readyForAssignment: 1, readyForService: 1, noShowRisk: 0, estQueueRevenueCents: 9000, assignedTechnicians: 1, delayedQueueItems: 0, returnRatePercent: 60 },
  queue: { items: [
    { queueItemId: 'q1', customerName: 'Nguyễn Thị Hương', isVip: true, source: 'walk_in', requestedServices: [{ serviceName: 'Gel Manicure' }], serviceCount: 1, priority: 'vip', status: 'waiting', quotedWaitMinutes: 12, checkedInAt: '2026-10-27T14:00:00Z', actualWaitMinutes: 9 },
    { queueItemId: 'q2', customerName: 'Mai Pham', source: 'online', requestedServices: [{ serviceName: 'Gel Manicure' }], serviceCount: 1, priority: 'normal', status: 'ready_for_tech', quotedWaitMinutes: 6, checkedInAt: '2026-10-27T14:05:00Z', actualWaitMinutes: 4 },
  ], pagination: { page: 1, pageSize: 25, totalItems: 2, totalPages: 1 } },
  filters: { statuses: [], sources: [], technicians: [], serviceCategories: [], priorityLevels: [], stations: [] },
};
const lanes = {
  kpis: { assignedTickets: 2, waitingForAcceptance: 1, acceptedTickets: 1, readyToStart: 0, delayedTickets: 1, activeTechnicians: 1, availableTechnicians: 1, scheduledTechnicians: 2, servicesInProgress: 1, waitingForAssignment: 1, avgTurnTimeMinutes: 35, averageAssignedWaitMinutes: 12, laborRevenueTodayCents: 84050, utilizationTodayPercent: 72, upsellCapturePercent: 40 },
  technicianLanes: [
    { technicianId: 't1', technicianName: 'Trần Mỹ Linh', workingStatus: 'available', activeTicketCount: 0, acceptedTicketCount: 0, delayedTicketCount: 0, estimatedWorkloadMinutes: 0, tickets: [] },
    { technicianId: 't2', technicianName: 'Lan Vo', workingStatus: 'in_service', activeTicketCount: 3, acceptedTicketCount: 1, delayedTicketCount: 1, estimatedWorkloadMinutes: 120, tickets: [] },
  ],
  technicianRows: [
    { rotationPosition: 1, technicianId: 't1', technicianName: 'Trần Mỹ Linh', specialties: ['Gel'], status: 'available', guests: 0, nextAvailable: 'now', nextAvailableLabel: 'Now' },
    { rotationPosition: 2, technicianId: 't2', technicianName: 'Lan Vo', specialties: ['Gel'], status: 'in_service', guests: 1, currentServiceName: 'Gel Manicure', currentServiceCustomer: 'Mai Pham', nextAvailable: 'soon', nextAvailableLabel: 'Soon' },
  ],
  lanes: { page: 1, pageSize: 12, total: 2, totalPages: 1, totalAll: 2 },
  tickets: { items: [], pagination: { totalItems: 0 } },
  // analytics: the assignment-source mix carries the slice code (Oct 27 2026)
  analytics: { utilizationTrend: [], serviceMixByTechnician: [], serviceCategories: [], assignmentSource: [{ source: 'Appointments', code: 'appointment', count: 1, percent: 50 }, { source: 'Walk-ins', code: 'walk_in', count: 1, percent: 50 }], assignmentSourceTotal: 2 },
};

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(async () => { await act(async () => { await setLanguage('en'); }); });

describe('Queue group in Vietnamese (WP-C1)', () => {
  it('Customer Queue: no English left; a switch back re-labels in place', async () => {
    await setLanguage('vi');
    globalThis.fetch = byUrl({ '/pos/queue/state': queue, '/pos/technicians/state': { rows: { items: [] } } }) as any;
    function Live() { useLanguage(); return <POSQueueScreen />; }
    const { container } = render(<MemoryRouter><Live /></MemoryRouter>);
    await screen.findAllByText(/Nguyễn Thị Hương/);
    expect(leftoverEnglish(container, NAMES).join(' | ')).toBe('');
    await act(async () => { await setLanguage('en'); });
    expect(screen.getByText('Customer Queue')).toBeInTheDocument();
  });

  it('Tech Queue: lanes, workload and KPI lines are Vietnamese', async () => {
    await setLanguage('vi');
    globalThis.fetch = vi.fn(async () => ok(lanes)) as any;
    const { container } = render(<MemoryRouter><POSTechQueueScreen /></MemoryRouter>);
    await screen.findAllByText(/Trần Mỹ Linh/);
    expect(screen.queryByText('Tech Queue')).toBeNull();
    expect((await screen.findAllByText('Khách vãng lai')).length).toBeGreaterThan(0);   // source mix from the slice code
    expect(screen.queryByText(/Walk.ins/)).toBeNull();
    expect(leftoverEnglish(container, NAMES).join(' | ')).toBe('');
  });
});
