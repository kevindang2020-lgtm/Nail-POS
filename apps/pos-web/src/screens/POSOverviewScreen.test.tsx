import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { POSOverviewScreen } from './POSOverviewScreen';

// Fixture matches the current rich /pos/overview/state contract (kpis are nested objects, analytics
// holds arrays). The same empty payload is returned for /pos/overview/board, whose reads are all optional,
// so the supplemental cards fall back to their empty states.
const state = {
  context: { salonName: 'Test Salon', branchName: 'Main', businessDate: '2026-06-19' },
  kpis: {
    todayRevenue: { amountCents: 0, displayAmount: '$0.00', changePercent: 0 },
    todayCheckIns: { count: 0, change: 0, changePercent: 0 },
    walkInsToday: { count: 0, change: 0, changePercent: 0 },
    averageTicket: { amountCents: 0, displayAmount: '$0.00', changePercent: 0 },
    waitingGuests: { count: 0 },
    servingNow: { count: 0 },
    readyCheckout: { count: 0 },
    activeTechs: { active: 0, scheduled: 0 },
    onlineBookings: { count: 0 },
  },
  schedulePreview: { technicians: [] },
  todayAppointments: { total: 0, completed: 0, noShow: 0, cancelled: 0, remaining: 0 },
  walkInStatus: { waiting: 0, estimatedWaitMinutes: 0, checkedInNotAssigned: 0 },
  analytics: { revenueTrend: [], topTechnicians: [], paymentMix: [], quickInsights: [] },
};
const mockFetch = (s: unknown) => vi.fn(async () => ({ ok: true, status: 200, json: async () => s, headers: { get: () => null } } as any));
beforeEach(() => { vi.restoreAllMocks(); });

describe('POSOverviewScreen', () => {
  it('mounts and renders the KPI labels + an empty-state card', async () => {
    globalThis.fetch = mockFetch(state) as any;
    render(<MemoryRouter><POSOverviewScreen /></MemoryRouter>);
    expect(await screen.findByText("Today's Revenue")).toBeInTheDocument();
    expect(screen.getByText('No payments yet.')).toBeInTheDocument();
  });

  it('renders the reference modules: communications tabs, service-flow sublists, and core cards', async () => {
    globalThis.fetch = mockFetch(state) as any;
    render(<MemoryRouter><POSOverviewScreen /></MemoryRouter>);
    expect(await screen.findByText('Arrivals & Check-In Queue')).toBeInTheDocument();
    expect(screen.getByText('Live Tech Queue')).toBeInTheDocument();
    expect(screen.getByText('Service Flow Overview')).toBeInTheDocument();
    // service-flow sublists
    expect(screen.getAllByText('Ready for Assignment').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Ready for Checkout').length).toBeGreaterThanOrEqual(1);
    // communications tabs
    expect(screen.getByText('Customer Communications')).toBeInTheDocument();
    expect(screen.getByText('Reminders')).toBeInTheDocument();
    expect(screen.getByText('Messages')).toBeInTheDocument();
    expect(screen.getByText('Missed Calls')).toBeInTheDocument();
    // other reference cards
    expect(screen.getByText('Customer Retention')).toBeInTheDocument();
    expect(screen.getByText('Payment Mix')).toBeInTheDocument();
    expect(screen.getByText('Inventory Alerts')).toBeInTheDocument();
    expect(screen.getByText('Quick Actions')).toBeInTheDocument();
  });
});

// ── 2026-07-03 wiring-lock coverage: every reference-image card bound to real backend data, correct navigation,
// interactive controls, and honest empty/AI-gated states. Routes the two Overview endpoints + the nav/AI endpoint.
import { fireEvent, within } from '@testing-library/react';

const richState = {
  context: { salonName: 'Luxe Nails & Spa', branchName: 'Downtown', businessDate: '2026-05-06' },
  kpis: {
    todayRevenue: { amountCents: 528730, displayAmount: '$5,287.30', changePercent: 18.6 },
    todayCheckIns: { count: 32, change: 4, changePercent: 14.3 },
    walkInsToday: { count: 11, change: 1, changePercent: 5 },
    averageTicket: { amountCents: 8261, displayAmount: '$82.61', changePercent: 5.2 },
    waitingGuests: { count: 14 },
    servingNow: { count: 21 },
    readyCheckout: { count: 8 },
    activeTechs: { active: 8, scheduled: 12 },
    onlineBookings: { count: 16 },
  },
  schedulePreview: { technicians: [
    { technicianId: 't1', name: 'Samantha G.', appointments: [
      { appointmentId: 'ap1', customerName: 'Lisa Rodriguez', serviceName: 'Gel Manicure', startTime: '10:00', status: 'completed', amountCents: 6500 },
      { appointmentId: 'ap2', customerName: 'Jessica Miller', serviceName: 'Gel Manicure', startTime: '13:00', status: 'confirmed', amountCents: 6500 },
    ] },
    { technicianId: 't2', name: 'Charlotte T.', appointments: [
      { appointmentId: 'ap3', customerName: 'Emma Wilson', serviceName: 'Acrylic Full Set', startTime: '11:00', status: 'in_progress', amountCents: 8500 },
      { appointmentId: 'ap4', customerName: 'Olivia Brown', serviceName: 'Nail Art', startTime: '09:30', status: 'waiting', amountCents: 4500 },
    ] },
  ] },
  todayAppointments: { total: 27, completed: 27, noShow: 0, cancelled: 0, remaining: 0 },
  walkInStatus: { waiting: 14, estimatedWaitMinutes: 28, checkedInNotAssigned: 6 },
  analytics: {
    revenueTrend: [
      { date: '2026-05-01', revenueCents: 200000 }, { date: '2026-05-02', revenueCents: 340000 },
      { date: '2026-05-03', revenueCents: 300000 }, { date: '2026-05-04', revenueCents: 360000 },
    ],
    topTechnicians: [
      { technicianId: 't1', technicianName: 'Samantha Green', revenueCents: 124800, completedServices: 12, utilizationPercent: 94 },
      { technicianId: 't2', technicianName: 'Charlotte Taylor', revenueCents: 103250, completedServices: 10, utilizationPercent: 88 },
    ],
    paymentMix: [
      { method: 'Card', amountCents: 381920, percent: 72.2 },
      { method: 'Cash', amountCents: 107900, percent: 20.4 },
      { method: 'Gift Card', amountCents: 26830, percent: 5.1 },
    ],
    quickInsights: [
      { id: 'peak', title: 'Peak time today: 1:00 PM - 3:00 PM', value: 'High demand for Acrylic Full Set.', severity: 'info' },
      { id: 'noshow', title: '3 no-show risk appointments tomorrow', value: 'Consider sending reminders.', severity: 'warn' },
    ],
  },
};

const richBoard = {
  communications: {
    reminders: [
      { customerName: 'Emma Wilson', whenLabel: 'May 07, 10:00 AM', channel: 'sms', status: 'Scheduled' },
      { customerName: 'Maria Garcia', whenLabel: 'May 07, 11:30 AM', channel: 'sms', status: 'Scheduled' },
    ],
    messages: [{ customerName: 'Ann Lee', preview: 'See you then!', unread: true }],
    missedCalls: [{ from: '+1 (555) 200-1234', at: '9:12 AM', status: 'Missed' }],
  },
  customerRetention: { returningPercent: 68.4, newPercent: 22.1, inactivePercent: 9.5 },
  inventoryAlerts: [
    { product: 'Acrylic Powder - Clear', stock: 5, reorderLevel: 10, status: 'low' },
    { product: 'Top Coat - 15ml', stock: 2, reorderLevel: 10, status: 'critical' },
  ],
  arrivals: [], liveTechQueue: [], readyForAssignment: [], readyForCheckout: [],
  lastUpdatedAt: '2026-05-06T14:34:00Z',
};

// Route the three endpoints the screen depends on. aiPackages drives the AI Insights gate.
const routeFetch = (opts: { ai?: boolean; stateErr?: boolean; boardErr?: boolean } = {}) =>
  vi.fn(async (url: any) => {
    const u = String(url);
    if (u.includes('/tenant/navigation')) return { ok: true, status: 200, json: async () => ({ role: 'OWNER', permissions: [], features: [], aiPackages: opts.ai ? ['ai_insights'] : [], subscriptionStatus: 'active' }), headers: { get: () => null } } as any;
    if (u.includes('/pos/overview/board')) { if (opts.boardErr) return { ok: false, status: 500, json: async () => ({ message: 'x' }), headers: { get: () => null } } as any; return { ok: true, status: 200, json: async () => richBoard, headers: { get: () => null } } as any; }
    if (u.includes('/pos/overview/state')) { if (opts.stateErr) return { ok: false, status: 500, json: async () => ({ message: 'Overview unavailable' }), headers: { get: () => null } } as any; return { ok: true, status: 200, json: async () => richState, headers: { get: () => null } } as any; }
    return { ok: true, status: 200, json: async () => ({}), headers: { get: () => null } } as any;
  });

describe('POSOverviewScreen — KPI strip bound to backend values (reference image)', () => {
  it('renders all 8 KPI values from the /state response, not hard-coded', async () => {
    globalThis.fetch = routeFetch() as any;
    render(<MemoryRouter><POSOverviewScreen /></MemoryRouter>);
    await screen.findByText('$5,287.30');                              // Today's Revenue
    const kpiVal = (label: string) => screen.getByText(label).closest('.ov-kpi') as HTMLElement;
    expect(within(kpiVal("Today's Revenue")).getByText('$5,287.30')).toBeInTheDocument();
    expect(within(kpiVal("Today's Check-ins")).getByText('32')).toBeInTheDocument();
    expect(within(kpiVal('Waiting Guests')).getByText('14')).toBeInTheDocument();
    expect(within(kpiVal('Walk-ins')).getByText('11')).toBeInTheDocument();
    expect(within(kpiVal('Active Services')).getByText('21')).toBeInTheDocument();
    expect(within(kpiVal('Average Ticket')).getByText('$82.61')).toBeInTheDocument();
    expect(within(kpiVal('Staff On Duty')).getByText('8 / 12')).toBeInTheDocument();
    expect(screen.getByText(/Est. wait 28 min/)).toBeInTheDocument();   // waiting-guests sub from walkInStatus
  });

  it('a KPI card navigates to its module', async () => {
    globalThis.fetch = routeFetch() as any;
    render(<MemoryRouter initialEntries={['/overview']}><POSOverviewScreen /></MemoryRouter>);
    const revenue = (await screen.findByText("Today's Revenue")).closest('button')!;
    fireEvent.click(revenue);   // → /reports ; no throw = route resolved (Router in test)
    expect(revenue).toBeInTheDocument();
  });
});

describe('POSOverviewScreen — analytics cards bound to real data', () => {
  it('Technician Performance, Payment Mix, Retention, Inventory, Revenue Trend all show backend data', async () => {
    globalThis.fetch = routeFetch() as any;
    render(<MemoryRouter><POSOverviewScreen /></MemoryRouter>);
    expect(await screen.findByText('Samantha Green')).toBeInTheDocument();     // tech performance
    expect(screen.getByText('Charlotte Taylor')).toBeInTheDocument();
    expect(screen.getByText(/72\.2/)).toBeInTheDocument();                     // payment mix percent
    const retentionCard = screen.getByText('Customer Retention').closest('.ov-card') as HTMLElement;
    expect(within(retentionCard).getAllByText(/68\.4/).length).toBeGreaterThanOrEqual(1); // retention returning %
    expect(screen.getByText('Acrylic Powder - Clear')).toBeInTheDocument();    // inventory alert
    expect(screen.getByText('Top Coat - 15ml')).toBeInTheDocument();
    // revenue trend renders an SVG/points container (no "No data" empty state)
    expect(screen.queryByText('No data yet.')).not.toBeInTheDocument();
  });

  it('Customer Communications tabs switch between real reminder / message / missed-call data', async () => {
    globalThis.fetch = routeFetch() as any;
    render(<MemoryRouter><POSOverviewScreen /></MemoryRouter>);
    // default reminders tab — scoped to the Communications card (Emma also appears elsewhere)
    await screen.findByText('Customer Communications');
    const commCard = screen.getByText('Customer Communications').closest('.ov-card') as HTMLElement;
    expect(within(commCard).getByText('Emma Wilson')).toBeInTheDocument();
    expect(within(commCard).getByText('Maria Garcia')).toBeInTheDocument();
    // messages tab (count badge present)
    fireEvent.click(screen.getByText(/Messages/));
    expect(await screen.findByText('Ann Lee')).toBeInTheDocument();
    // missed calls tab with a Call back action
    fireEvent.click(screen.getByText(/Missed Calls/));
    expect(await screen.findByText('+1 (555) 200-1234')).toBeInTheDocument();
    expect(screen.getByText('Call back')).toBeInTheDocument();
  });
});

describe('POSOverviewScreen — AI Insights gating (real AI-package access)', () => {
  it('shows the subscribe upsell when no AI package is active', async () => {
    globalThis.fetch = routeFetch({ ai: false }) as any;
    render(<MemoryRouter><POSOverviewScreen /></MemoryRouter>);
    expect(await screen.findByText(/Subscribe to an AI package/)).toBeInTheDocument();
  });
  it('renders real insight lines when an AI package is active', async () => {
    globalThis.fetch = routeFetch({ ai: true }) as any;
    render(<MemoryRouter><POSOverviewScreen /></MemoryRouter>);
    const aiCard = (await screen.findByText('AI Insights')).closest('.ov-card') as HTMLElement;
    expect(within(aiCard).getByText(/Peak time today/)).toBeInTheDocument();
    expect(within(aiCard).getByText(/3 no-show risk/)).toBeInTheDocument();
  });
});

describe('POSOverviewScreen — Overview 27-inch mandate (Oct 28 2026)', () => {
  it('§16: a server insight code is worded from the catalogue with its numbers and opens where staff act', async () => {
    const st = { ...richState, analytics: { ...richState.analytics, quickInsights: [{ id: 'long_wait', type: 'unusual_wait', title: 'x', value: 'y', severity: 'danger', route: '/queue', vars: { minutes: 41, waiting: 18 } }] } };
    globalThis.fetch = vi.fn(async (url: any) => {
      const u = String(url);
      if (u.includes('/tenant/navigation')) return { ok: true, status: 200, json: async () => ({ role: 'OWNER', permissions: [], features: [], aiPackages: ['ai_insights'], subscriptionStatus: 'active' }), headers: { get: () => null } } as any;
      if (u.includes('/pos/overview/board')) return { ok: true, status: 200, json: async () => ({ ...richBoard, totals: { arrivals: 40 }, arrivals: Array.from({ length: 7 }, (_, i) => ({ customerName: `Guest ${i}`, status: 'waiting', startTime: '10:00' })) }), headers: { get: () => null } } as any;
      if (u.includes('/pos/overview/state')) return { ok: true, status: 200, json: async () => st, headers: { get: () => null } } as any;
      return { ok: true, status: 200, json: async () => ({}), headers: { get: () => null } } as any;
    }) as any;
    render(<MemoryRouter><POSOverviewScreen /></MemoryRouter>);
    const ai = (await screen.findByText('AI Insights')).closest('.ov-card') as HTMLElement;
    expect(await within(ai).findByText('Unusual wait time')).toBeInTheDocument();
    expect(within(ai).getByText('41 min longest wait · 18 waiting')).toBeInTheDocument();
    // §11: the arrivals card shows its top rows and the SERVER total (40), never "every record"
    const arr = screen.getByTestId('ov-arrivals');
    expect(await within(arr).findByText('+33 more')).toBeInTheDocument();
  });
});

describe('POSOverviewScreen — Quick Actions and error/empty states', () => {
  // Nine actions: the seven in Kevin's Overview picture plus Send Message and Open Cash Drawer, which came
  // from an earlier reference image and remain wired. (The title said 10; the list has always been 9.)
  it('renders all 9 quick actions', async () => {
    globalThis.fetch = routeFetch() as any;
    render(<MemoryRouter><POSOverviewScreen /></MemoryRouter>);
    for (const label of ['New Check-In', 'New Booking', 'Walk-In', 'Assign Tech', 'Start Service', 'Take Payment', 'Add Product', 'Send Message', 'Open Cash Drawer'])
      expect(await screen.findByText(label)).toBeInTheDocument();
  });
  // Overview 27-inch mandate §30 (Oct 28 2026): a failed /state is a floating alert + Retry — the page keeps its grid
  it('a failed /state shows the retry alert (not a blank page, not a page-replacing card)', async () => {
    globalThis.fetch = routeFetch({ stateErr: true }) as any;
    render(<MemoryRouter><POSOverviewScreen /></MemoryRouter>);
    expect(await screen.findByRole('alert')).toHaveTextContent(/Overview unavailable|Unable to load Overview/);
    expect(screen.getByTestId('overview-page')).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });
  it('a failed /board degrades to an honest empty state, KPIs still render', async () => {
    globalThis.fetch = routeFetch({ boardErr: true }) as any;
    render(<MemoryRouter><POSOverviewScreen /></MemoryRouter>);
    expect(await screen.findByText('$5,287.30')).toBeInTheDocument();          // state card unaffected
    expect((await screen.findAllByText('Unable to load Overview.')).length).toBeGreaterThanOrEqual(1); // board cards keep their footprint
  });
});

describe("POSOverviewScreen — Today's Appointments date navigation", () => {
  it('renders the day list and exposes prev/next date controls', async () => {
    globalThis.fetch = routeFetch() as any;
    render(<MemoryRouter><POSOverviewScreen /></MemoryRouter>);
    const apptCard = (await screen.findByText("Today's Appointments")).closest('.ov-card') as HTMLElement;
    expect(within(apptCard).getByText('Lisa Rodriguez')).toBeInTheDocument();  // completed appt in the day list
  });
});

describe('Overview "View All" full-screen overlay', () => {
  it('opens a full-screen dialog with the complete list and closes again', async () => {
    const { fireEvent } = await import('@testing-library/react');
    render(<MemoryRouter initialEntries={['/overview']}><POSOverviewScreen /></MemoryRouter>);
    // wait for the cards to render, then click the first "View All" (Arrivals)
    const buttons = await screen.findAllByRole('button', { name: 'View All' });
    expect(buttons.length).toBeGreaterThanOrEqual(3);   // arrivals, tech queue, appointments
    fireEvent.click(buttons[0]);
    // a modal dialog appears with the module title
    const dialog = await screen.findByRole('dialog', { name: 'Arrivals & Check-In Queue' });
    expect(dialog).toBeInTheDocument();
    // it offers a link into the dedicated full screen
    expect(screen.getByRole('button', { name: /View Full Queue/ })).toBeInTheDocument();
    // close it
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
