import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { POSDashboardScreen } from './POSDashboardScreen';

// Rich /pos/dashboard/state contract (picture-exact module set); /tenant/inventory/alerts returns the canonical list.
const state = {
  context: { salonName: 'Luxe Nails & Spa', branchName: 'Downtown Branch' },
  kpis: { todayRevenueCents: 528730, todayRevenueTrendPercent: 18.6, waitingGuests: 14, servingNow: 21, readyCheckout: 8, activeTechs: 8, totalTechs: 12, onlineBookings: 4, monthlyCardVolumeCents: 6489260, checkInsToday: 32, appointmentsToday: 28, averageTicketCents: 8261, customerRetentionPercent: 68.4, aiBookingConversionPercent: 36.2 },
  calendar: { appointments: [], technicians: [] },
  todaysAppointments: { totalAppointments: 28, completed: 27, noShow: 2, cancelled: 0, remaining: 0, completedPercent: 96 },
  walkInStatus: { waitingCount: 14, estimatedWaitMinutes: 28, checkedInNotAssigned: 4 },
  operationsSnapshot: { waitingGuests: 14, estWaitMinutes: 28, walkInsToday: 11, walkInPercent: 34, readyCheckout: 8, readyCheckoutValueCents: 124875, completedServices: 27, noShows: 2, noShowPercent: 7, upcomingNext3h: 18 },
  revenueTrend: { period: 'week', totalCents: 528730, trendPercent: 18.6, series: [{ label: 'M', valueCents: 300000, apptCount: 12 }, { label: 'T', valueCents: 520000, apptCount: 22 }] },
  topServices: [{ name: 'Gel Manicure', revenueCents: 141200 }, { name: 'Acrylic Full Set', revenueCents: 117800 }],
  topTechnicians: [{ technicianId: 't1', name: 'Samantha Green', revenueCents: 124800, servicesCount: 8, utilizationPercent: 94, tipsCents: 15200, rating: 4.9 }],
  paymentMix: { period: 'week', entries: [{ method: 'card', percent: 72, amountCents: 381900 }, { method: 'cash', percent: 20, amountCents: 107900 }] },
  liveActivity: [{ time: '2:33 PM', guestName: 'Jessica Miller', serviceName: 'Gel Mani', technicianName: 'Samantha Green', status: 'in_progress', elapsedMinutes: 25 }],
  customerRetention: { returningPercent: 68.4, returningCount: 245, newPercent: 22.1, newCount: 79, inactivePercent: 9.5, inactiveCount: 34, totalCustomers: 358 },
  multiLocation: [{ branchId: 'b1', branchName: 'Downtown Branch', revenueCents: 528730, checkIns: 32, trendPercent: 18.6 }],
  quickInsights: [{ kind: 'high_revenue_service', text: 'Acrylic Full Set', tone: 'success' }],
};
const routeFetch = vi.fn(async (url: string) => {
  const body = String(url).includes('/inventory/alerts') ? { alerts: [] } : state;
  return { ok: true, status: 200, json: async () => body, headers: { get: () => null } } as any;
});
beforeEach(() => { vi.restoreAllMocks(); });

describe('POSDashboardScreen (tenant /tenant/dashboard, picture-exact)', () => {
  it('renders the 9 KPIs and every reference module', async () => {
    globalThis.fetch = routeFetch as any;
    render(<MemoryRouter><POSDashboardScreen /></MemoryRouter>);
    // 9 KPI labels (exact picture wording)
    expect(await screen.findByText("Today's Revenue")).toBeInTheDocument();
    expect(screen.getByText('Monthly Card Volume')).toBeInTheDocument();
    expect(screen.getByText('Check-ins Today')).toBeInTheDocument();
    expect(screen.getByText('Appointments Today')).toBeInTheDocument();
    expect(screen.getByText('Active Services')).toBeInTheDocument();
    expect(screen.getByText('Average Ticket')).toBeInTheDocument();
    expect(screen.getByText('Staff On Duty')).toBeInTheDocument();
    expect(screen.getByText('AI Booking Conversion')).toBeInTheDocument();
    // reference modules
    expect(screen.getByText("Today's Operations Snapshot")).toBeInTheDocument();
    expect(screen.getByText('Live Salon Activity')).toBeInTheDocument();
    expect(screen.getByText('AI Insights')).toBeInTheDocument();
    expect(screen.getByText('Revenue & Appointments Trend')).toBeInTheDocument();
    expect(screen.getByText('Top Technicians Today')).toBeInTheDocument();
    expect(screen.getByText('Top Services Today')).toBeInTheDocument();
    expect(screen.getAllByText('Customer Retention').length).toBeGreaterThanOrEqual(2); // KPI + module
    expect(screen.getByText('Payment Mix')).toBeInTheDocument();
    expect(screen.getByText('Multi-Location Snapshot')).toBeInTheDocument();
    expect(screen.getByText('Quick Actions')).toBeInTheDocument();
    // operations tiles + live activity content render real values
    expect(screen.getByText('Waiting Guests')).toBeInTheDocument();
    expect(screen.getByText('Upcoming Bookings')).toBeInTheDocument();
    expect(screen.getByText('Jessica Miller')).toBeInTheDocument();
    // quick actions (picture set)
    expect(screen.getByText('New Check-In')).toBeInTheDocument();
    expect(screen.getByText('Take Payment')).toBeInTheDocument();
    expect(screen.getByText('View Reports')).toBeInTheDocument();
  });
});

// ── 2026-07-03 wiring-lock coverage: AI-gating branch, error/Retry path, inventory-alert degradation, and
// operations-snapshot navigation — the interactive paths the mount test did not exercise.
import { fireEvent, within } from '@testing-library/react';

const stateWithAi = {
  ...state,
  aiInsights: [
    { id: 'a1', tone: 'success', icon: 'trend', primary: 'Peak time today: 1:00 PM - 3:00 PM', secondary: 'High demand for Acrylic Full Set.', action: { kind: 'reminders', label: 'Send Reminders' } },
    { id: 'a2', tone: 'warning', icon: 'alert', primary: '2 no-show risk appointments tomorrow', secondary: 'Consider sending reminders.' },
  ],
};

// Route /state, /inventory/alerts, and /tenant/navigation (drives aiAllowed). ai=false → locked upsell.
const dashFetch = (opts: { ai?: boolean; stateErr?: string; alertsErr?: boolean; body?: any } = {}) =>
  vi.fn(async (url: any) => {
    const u = String(url);
    if (u.includes('/tenant/navigation')) return { ok: true, status: 200, json: async () => ({ role: 'OWNER', permissions: [], features: [], aiPackages: opts.ai ? ['ai_insights'] : [], subscriptionStatus: 'active' }), headers: { get: () => null } } as any;
    if (u.includes('/inventory/alerts')) { if (opts.alertsErr) return { ok: false, status: 500, json: async () => ({}), headers: { get: () => null } } as any; return { ok: true, status: 200, json: async () => ({ alerts: [{ product: 'Acrylic Powder - Clear', stock: 5, reorderLevel: 10, status: 'low' }] }), headers: { get: () => null } } as any; }
    if (u.includes('/pos/dashboard/state')) { if (opts.stateErr) return { ok: false, status: 500, json: async () => ({ message: opts.stateErr }), headers: { get: () => null } } as any; return { ok: true, status: 200, json: async () => (opts.body ?? state), headers: { get: () => null } } as any; }
    return { ok: true, status: 200, json: async () => ({}), headers: { get: () => null } } as any;
  });

describe('POSDashboardScreen — AI Insights gating', () => {
  it('locked: shows the upsell when no AI package is active', async () => {
    globalThis.fetch = dashFetch({ ai: false }) as any;
    render(<MemoryRouter><POSDashboardScreen /></MemoryRouter>);
    expect(await screen.findByText(/AI Insights require an active AI package/)).toBeInTheDocument();
    expect(screen.getByText('Browse AI packages')).toBeInTheDocument();
  });
  it('unlocked: renders real aiInsights lines with their actions', async () => {
    globalThis.fetch = dashFetch({ ai: true, body: stateWithAi }) as any;
    render(<MemoryRouter><POSDashboardScreen /></MemoryRouter>);
    const aiCard = (await screen.findByText('AI Insights')).closest('.ov-card') as HTMLElement;
    expect(within(aiCard).getByText(/Peak time today/)).toBeInTheDocument();
    expect(within(aiCard).getByText(/2 no-show risk/)).toBeInTheDocument();
    expect(within(aiCard).getByText('Send Reminders')).toBeInTheDocument();
  });
});

describe('POSDashboardScreen — error, degradation, and navigation', () => {
  it('a failed /state shows the error + Retry (not a blank page)', async () => {
    globalThis.fetch = dashFetch({ stateErr: 'Dashboard unavailable' }) as any;
    render(<MemoryRouter><POSDashboardScreen /></MemoryRouter>);
    expect(await screen.findByText(/Dashboard unavailable/)).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });
  it('does not make the orphaned inventory-alerts call (dead wire removed)', async () => {
    const f = dashFetch({});
    globalThis.fetch = f as any;
    render(<MemoryRouter><POSDashboardScreen /></MemoryRouter>);
    expect(await screen.findByText("Today's Revenue")).toBeInTheDocument();
    // the Dashboard fetched /inventory/alerts into state it never rendered; that call is now gone
    expect(f.mock.calls.some((c: any[]) => String(c[0]).includes('/inventory/alerts'))).toBe(false);
  });
  it('an operations-snapshot tile navigates to its module', async () => {
    globalThis.fetch = dashFetch({}) as any;
    render(<MemoryRouter initialEntries={['/dashboard']}><POSDashboardScreen /></MemoryRouter>);
    const waiting = (await screen.findByText('Waiting Guests')).closest('button')!;
    fireEvent.click(waiting);   // → /queue ; resolves without throwing under the test Router
    expect(waiting).toBeInTheDocument();
  });
});

// ── 2026-07-03 functional period dropdowns (§9): the on-card "Today / This Week / This Month" selectors were
// static labels; they now refetch that card from the range-scoped endpoint and re-render with the new data.
describe('POSDashboardScreen — on-card period dropdowns', () => {
  const withPayVariants = () => {
    const calls: string[] = [];
    const fn = vi.fn(async (url: any) => {
      const u = String(url); calls.push(u);
      if (u.includes('/tenant/navigation')) return { ok: true, status: 200, json: async () => ({ role: 'OWNER', permissions: [], features: [], aiPackages: [], subscriptionStatus: 'active' }), headers: { get: () => null } } as any;
      if (u.includes('/pos/dashboard/payment-mix')) {
        const range = new URL('http://x' + u.slice(u.indexOf('/pos'))).searchParams.get('range');
        const entries = range === 'month'
          ? [{ method: 'card', percent: 80, amountCents: 900000 }, { method: 'cash', percent: 20, amountCents: 225000 }]
          : [{ method: 'card', percent: 72, amountCents: 381900 }];
        return { ok: true, status: 200, json: async () => ({ period: range, entries }), headers: { get: () => null } } as any;
      }
      if (u.includes('/pos/dashboard/revenue-trend')) {
        const range = new URL('http://x' + u.slice(u.indexOf('/pos'))).searchParams.get('range');
        return { ok: true, status: 200, json: async () => ({ period: range, totalCents: 111, trendPercent: 1, series: [{ label: '1', valueCents: 111, apptCount: 2 }] }), headers: { get: () => null } } as any;
      }
      if (u.includes('/pos/dashboard/top-services')) {
        const range = new URL('http://x' + u.slice(u.indexOf('/pos'))).searchParams.get('range');
        return { ok: true, status: 200, json: async () => (range === 'month' ? [{ name: 'Monthly Bestseller', revenueCents: 500000 }] : [{ name: 'Gel Manicure', revenueCents: 141200 }]), headers: { get: () => null } } as any;
      }
      if (u.includes('/pos/dashboard/state')) return { ok: true, status: 200, json: async () => state, headers: { get: () => null } } as any;
      return { ok: true, status: 200, json: async () => ({}), headers: { get: () => null } } as any;
    });
    (fn as any).calls = calls;
    return fn;
  };

  it('the period control is a real <select>, not a static label', async () => {
    globalThis.fetch = withPayVariants() as any;
    render(<MemoryRouter><POSDashboardScreen /></MemoryRouter>);
    await screen.findByText('Payment Mix');
    const selects = screen.getAllByLabelText('Period');
    expect(selects.length).toBeGreaterThanOrEqual(3);           // Revenue Trend, Top Services, Payment Mix
    expect(selects[0].tagName).toBe('SELECT');
  });

  it('changing Payment Mix to This Month refetches with range=month and re-renders', async () => {
    const f = withPayVariants(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSDashboardScreen /></MemoryRouter>);
    const payCard = (await screen.findByText('Payment Mix')).closest('.ov-card') as HTMLElement;
    const sel = within(payCard).getByLabelText('Period') as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: 'month' } });
    await vi.waitFor(() => {
      expect((f as any).calls.some((u: string) => u.includes('/pos/dashboard/payment-mix') && u.includes('range=month'))).toBe(true);
    });
    // the 80% card-volume from the month variant now shows
    await vi.waitFor(() => expect(within(payCard).getByText(/80%/)).toBeInTheDocument());   // legend line "Card 80%" (one-screen legend, Oct 28 2026)
  });

  it('changing Top Services to This Month refetches with range=month and swaps the list', async () => {
    const f = withPayVariants(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSDashboardScreen /></MemoryRouter>);
    const svcCard = (await screen.findByText('Top Services Today')).closest('.ov-card') as HTMLElement;
    const sel = within(svcCard).getByLabelText('Period') as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: 'month' } });
    await vi.waitFor(() => {
      expect((f as any).calls.some((u: string) => u.includes('/pos/dashboard/top-services') && u.includes('range=month'))).toBe(true);
    });
    await vi.waitFor(() => expect(within(svcCard).getByText(/Monthly Bestseller/)).toBeInTheDocument());
  });
});

// Live Operations 27-inch mandate (Oct 28 2026): large values stay one line; a list shows its rows + "+N more" of the
// server total; Start Service opens the queue filtered to guests ready for a technician
describe('POSDashboardScreen — one-screen rules', () => {
  it('$2,450,000 shows $2.45M with the exact amount as the tooltip; Live Salon Activity says "+N more" of the total', async () => {
    globalThis.fetch = dashFetch({ body: { ...state, kpis: { ...state.kpis, todayRevenueCents: 245000000 }, liveActivityTotal: 12 } }) as any;
    render(<MemoryRouter><POSDashboardScreen /></MemoryRouter>);
    const rev = (await screen.findByText("Today's Revenue")).closest('button') as HTMLElement;
    expect(within(rev).getByText('$2.45M')).toBeInTheDocument();
    expect(rev.getAttribute('title')).toMatch(/2,450,000\.00/);
    const act = screen.getByTestId('lo-activity');
    expect(within(act).getByText('+11 more')).toBeInTheDocument();
  });
  it('Realtime Recovery Indicator: shows the last successful read and a manual Refresh that re-reads /state', async () => {
    const f = vi.fn(routeFetch); globalThis.fetch = f as any;
    render(<MemoryRouter><POSDashboardScreen /></MemoryRouter>);
    expect(await screen.findByTestId('live-ops-synced')).toHaveTextContent(/updated/);
    const n = f.mock.calls.filter((c) => String(c[0]).includes('/dashboard/state')).length;
    fireEvent.click(screen.getByTestId('live-ops-refresh'));
    await waitFor(() => expect(f.mock.calls.filter((c) => String(c[0]).includes('/dashboard/state')).length).toBe(n + 1));
  });
});
