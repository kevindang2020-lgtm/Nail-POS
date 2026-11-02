import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { POSCheckInScreen } from './POSCheckInScreen';

const checkInState = {
  kpis: { todayCheckIns: 0, todayCheckInsTrendPercent: 0, waitingGuests: 0, estimatedWaitMinutes: 0, walkInsToday: 0, appointmentsArrived: 0, appointmentArrivalPercent: 0, readyForTech: 0 },
  arrivals: [],
  appointmentCheckIn: { upcoming: [], arrived: [], noShow: [] },
  waiting: [],
  readyForAssignment: [],
};
const mockFetch = (state: unknown) => vi.fn(async () => ({ ok: true, status: 200, json: async () => state, headers: { get: () => null } } as any));

beforeEach(() => { vi.restoreAllMocks(); });

describe('POSCheckInScreen', () => {
  it('mounts past loading and renders the check-in board + empty states', async () => {
    globalThis.fetch = mockFetch(checkInState) as any;
    render(<MemoryRouter><POSCheckInScreen /></MemoryRouter>);
    expect(await screen.findByText('Live Check-In Queue')).toBeInTheDocument();
    expect(screen.getByText('No check-ins yet today.')).toBeInTheDocument();
    expect(screen.getByText('No upcoming appointments.')).toBeInTheDocument();
    // T03 Quick Check-In Panel + its tabs, and the Quick Actions bar
    expect(screen.getByText('Quick Check-In Panel')).toBeInTheDocument();
    expect(screen.getByText('Existing Customer')).toBeInTheDocument();
    expect(screen.getByText('New Customer')).toBeInTheDocument();
    expect(screen.getByText('Quick Actions')).toBeInTheDocument();
  });
});

// ── 2026-07-03 wiring-lock coverage: KPI strip bound to real state, live-queue row actions hit the correct
// endpoints, insights/quick-actions navigate, and error/empty states are honest. (Mirrors the Overview coverage.)
import { fireEvent, within } from '@testing-library/react';

const richCheckIn = {
  kpis: {
    todayCheckIns: 32, todayCheckInsTrendPercent: 14.3, waitingGuests: 14, estimatedWaitMinutes: 28,
    walkInsToday: 11, appointmentsArrived: 8, appointmentArrivalPercent: 34, readyForTech: 6,
    noShows: 2, techsAvailable: 5, customerReturnRate: 68,
  },
  arrivals: [
    { rowId: 'arr_arrived', customerId: 'c1', customerName: 'Jessica Miller', phone: '555-0001', services: ['Gel Mani'], technicianName: 'Any', source: 'appointment', arrivalStatus: 'arrived', timeLabel: '2:33 PM' },
    { rowId: 'arr_waiting', customerId: 'c2', customerName: 'Emma Wilson', phone: '555-0002', services: ['Gel X Full Set'], technicianName: 'Any', source: 'walk_in', arrivalStatus: 'waiting', timeLabel: '2:25 PM' },
    { rowId: 'arr_ready', customerId: 'c3', customerName: 'Grace Hall', phone: '555-0003', services: ['Pedicure'], technicianName: 'Mia', source: 'appointment', arrivalStatus: 'ready', timeLabel: '2:21 PM' },
    { rowId: 'arr_confirm', customerId: 'c4', customerName: 'Amy Chen', phone: '555-0004', services: ['Nail Art'], technicianName: 'Any', source: 'appointment', arrivalStatus: 'confirmed', timeLabel: '2:19 PM' },
  ],
  appointmentCheckIn: { upcoming: [{ appointmentId: 'up1', customerName: 'Mia Johnson' }], arrived: [], noShow: [] },
  waiting: [{ rowId: 'w1', customerName: 'Isabella Davis', arrivalStatus: 'waiting' }],
  readyForAssignment: [],
  availableTechnicians: [
    { technicianId: 't1', displayName: 'Samantha Green', status: 'available' },
    { technicianId: 't2', displayName: 'Lily Adams', status: 'available' },
  ],
  technicians: [{ technicianId: 't1', displayName: 'Samantha Green' }, { technicianId: 't2', displayName: 'Lily Adams' }],
  services: [{ serviceId: 'svc1', name: 'Gel Manicure', durationMinutes: 45 }],
  frontDeskInsights: [
    { id: 'i1', text: 'Missed call from a VIP customer. Call back to rebook.', severity: 'warn', route: '/messages' },
    { id: 'i2', text: 'Upsell opportunity: 3 guests eligible for add-on services.', severity: 'info' },
  ],
  customerType: { returnRatePct: 68, newPct: 32 },
  dailyPerformance: { noShowRatePct: 6 },
  arrivalTrend: [{ label: '10a', count: 3 }, { label: '11a', count: 5 }],
  sourceMix: [{ name: 'Walk-in', count: 11, pct: 34 }, { name: 'Appointment', count: 21, pct: 66 }],
};

// Records calls so action assertions can check the exact endpoint hit.
const recordFetch = (overrides: { state?: any; fail?: string } = {}) => {
  const calls: { url: string; method: string }[] = [];
  const fn = vi.fn(async (url: any, init?: any) => {
    const u = String(url); calls.push({ url: u, method: init?.method || 'GET' });
    if (overrides.fail && u.includes('/pos/check-in/state')) return { ok: false, status: 500, json: async () => ({ message: overrides.fail }), headers: { get: () => null } } as any;
    const body = u.includes('/pos/check-in/state') ? (overrides.state ?? richCheckIn) : {};
    return { ok: true, status: 200, json: async () => body, headers: { get: () => null } } as any;
  });
  (fn as any).calls = calls;
  return fn;
};

describe('POSCheckInScreen — KPI strip bound to real state', () => {
  it('renders all 9 KPI values from /pos/check-in/state', async () => {
    globalThis.fetch = recordFetch() as any;
    render(<MemoryRouter><POSCheckInScreen /></MemoryRouter>);
    await screen.findByText('Check-Ins Today');
    const val = (label: string) => screen.getByText(label).closest('div')!.parentElement as HTMLElement;
    expect(within(val('Check-Ins Today')).getByText('32')).toBeInTheDocument();
    expect(within(val('Waiting Guests')).getByText('14')).toBeInTheDocument();
    expect(within(val('Walk-Ins')).getByText('11')).toBeInTheDocument();
    expect(within(val('Ready for Service')).getByText('6')).toBeInTheDocument();
    expect(screen.getByText(/Est. wait 28 min/)).toBeInTheDocument();
    expect(screen.getByText('No-Shows')).toBeInTheDocument();
    expect(screen.getByText('Techs Available')).toBeInTheDocument();
    expect(screen.getByText('Customer Return Rate')).toBeInTheDocument();
  });
});

describe('POSCheckInScreen — live-queue row actions hit the correct endpoints', () => {
  it('an "arrived" row Check In → POST move-to-queue', async () => {
    const f = recordFetch(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSCheckInScreen /></MemoryRouter>);
    const row = (await screen.findByText('Jessica Miller')).closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByText('Check In'));
    await vi.waitFor(() => {
      expect((f as any).calls.some((c: any) => c.url.includes('/pos/check-in/arr_arrived/move-to-queue') && c.method === 'POST')).toBe(true);
    });
  });
  it('a "ready" row Start → POST start-service', async () => {
    const f = recordFetch(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSCheckInScreen /></MemoryRouter>);
    const row = (await screen.findByText('Grace Hall')).closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByText('Start'));
    await vi.waitFor(() => {
      expect((f as any).calls.some((c: any) => c.url.includes('/pos/check-in/arr_ready/start-service') && c.method === 'POST')).toBe(true);
    });
  });
  it('a "confirmed" row Notify → POST update-wait-estimate', async () => {
    const f = recordFetch(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSCheckInScreen /></MemoryRouter>);
    const row = (await screen.findByText('Amy Chen')).closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByText('Notify'));
    await vi.waitFor(() => {
      expect((f as any).calls.some((c: any) => c.url.includes('/pos/check-in/arr_confirm/update-wait-estimate') && c.method === 'POST')).toBe(true);
    });
  });
});

describe('POSCheckInScreen — insights, quick actions, and error/empty states', () => {
  // Check-In 27-inch mandate §30 (Oct 28 2026): an insight's action is the server's `route` (it was matched on the English
  // text); an insight without a route is information only
  it('renders front-desk insights; the one with a server route has Open', async () => {
    globalThis.fetch = recordFetch() as any;
    render(<MemoryRouter><POSCheckInScreen /></MemoryRouter>);
    expect(await screen.findByText(/Missed call from a VIP/)).toBeInTheDocument();
    const card = screen.getByTestId('ci-insights');
    expect(within(card).getAllByRole('button', { name: 'Open' })).toHaveLength(1);
  });
  it('Quick Action Walk-In opens the Quick Check-In Walk-In tab on this page (it navigated to /check-in itself)', async () => {
    globalThis.fetch = recordFetch() as any;
    render(<MemoryRouter><POSCheckInScreen /></MemoryRouter>);
    await screen.findByText('Quick Actions');
    fireEvent.click(within(screen.getByTestId('check-in-quick-actions')).getByRole('button', { name: /Walk-In/ }));
    expect(await screen.findByPlaceholderText('Guest name')).toBeInTheDocument();
  });
  it('tapping a queue guest opens the visit detail without leaving Check-In', async () => {
    const f = recordFetch(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSCheckInScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByText('Jessica Miller'));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect((f as any).calls.some((c: any) => c.url.endsWith('/pos/check-in/arr_arrived'))).toBe(true);
  });
  it('renders the Quick Actions bar with its actions', async () => {
    globalThis.fetch = recordFetch() as any;
    render(<MemoryRouter><POSCheckInScreen /></MemoryRouter>);
    // Sep 2026 redesign: nine actions (New Check-In, New Booking, Walk-In, Assign Tech, Start Service, Take Payment, …);
    // 'Search Customer' moved out of this bar
    expect(await screen.findByText('New Check-In')).toBeInTheDocument();
    expect(screen.getByText('Take Payment')).toBeInTheDocument();
    expect(screen.getByText('Assign Tech')).toBeInTheDocument();
    expect(screen.getByText('Start Service')).toBeInTheDocument();
  });
  it('a failed /state shows the error card (not a blank page)', async () => {
    globalThis.fetch = recordFetch({ fail: 'Check-in unavailable' }) as any;
    render(<MemoryRouter><POSCheckInScreen /></MemoryRouter>);
    expect(await screen.findByText(/Check-in unavailable/)).toBeInTheDocument();
  });
});

// ── 2026-07-03 the Appointment Check-In table now has a per-row "Check In" button for UPCOMING appointments that
// hits POST /appointment/:appointmentId (appointmentCheckIn). Previously that handler existed but no button called
// it — you could see arriving appointments but not check them in from that table.
describe('POSCheckInScreen — appointment table Check In', () => {
  it('an upcoming appointment Check In → POST /appointment/:id', async () => {
    const f = recordFetch(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSCheckInScreen /></MemoryRouter>);
    // Mia Johnson is the upcoming appointment (up1) in the appointment check-in table
    const row = (await screen.findByText('Mia Johnson')).closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByText('Check In'));
    await vi.waitFor(() => {
      expect((f as any).calls.some((c: any) => c.url.includes('/pos/check-in/appointment/up1') && c.method === 'POST')).toBe(true);
    });
  });
});
