// PortfolioOverviewScreen.test.tsx — the "All Salons" dashboard.
//
// The rule this screen is built around: **never fabricate a dashboard value.**
//
//   • Every number comes from `GET /owner/portfolio/summary` — nothing is hard-coded.
//   • A failed load shows an ERROR, not zeros. A dashboard reporting "$0 revenue" when it merely failed to load is
//     worse than one that says it could not load — the first is confidently wrong, and someone will act on it.
//   • Salons the owner cannot report on are declared as EXCLUDED, not silently added as zero.
//   • "AI Receptionist" is never a flat "Online". It distinguishes live / partial / never-set-up.
//   • The reference image's change percentages (↑18.6%) are NOT rendered: period-over-period comparison is not
//     modelled on the backend, and inventing one would be exactly the fabrication this forbids.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const get = vi.fn();
const post = vi.fn();
vi.mock('../api/client', () => ({ api: { get: (p: string) => get(p), post: (p: string, b: any) => post(p, b) } }));

import { OwnerSalonProvider } from '../shell/OwnerSalonContext';
import { PortfolioOverviewScreen } from './PortfolioOverviewScreen';

const SUMMARY = {
  totalSalons: 4, activeSalons: 4, totalBranches: 7,
  appointmentsToday: 128, checkedIn: 86, customersWaiting: 31,
  servicesInProgress: 18, readyForCheckout: 14,
  techniciansWorking: 24, newClientsToday: 23,
  revenueTodayCents: 12_586_00, revenueMonthCents: 240_000_00, tipsTodayCents: 1_258_00,
  aiReceptionist: 'live' as const,
  salonsWithheldForPermission: 0,
};

const TOP = [
  { rank: 1, tenantId: 'a', salonName: 'Luxe Downtown', revenueTodayCents: 562_000 },
  { rank: 2, tenantId: 'b', salonName: 'Belle Cherry Hill', revenueTodayCents: 348_000 },
];
const SERIES = [
  { hour: 9, revenueCents: 120_000 },
  { hour: 10, revenueCents: 260_000 },
  { hour: 11, revenueCents: 182_000 },
];

const mock = (summary: any = SUMMARY, topSalons: any = TOP, points: any = SERIES) => {
  get.mockImplementation(async (p: string) => {
    if (p === '/owner/portfolio/summary') return { summary, topSalons };
    if (p === '/owner/portfolio/revenue-series') return { points };
    if (p === '/owner/portfolio') return { salons: [] };
    if (p === '/owner/context') return { activeSalonId: null };
    return {};
  });
};

const ui = () => render(<OwnerSalonProvider><PortfolioOverviewScreen /></OwnerSalonProvider>);

beforeEach(() => { get.mockReset(); post.mockReset(); mock(); });

describe('every KPI card in the reference image, from real data', () => {
  it('renders all twelve cards with the values the backend returned', async () => {
    ui();

    expect(await screen.findByText('4')).toBeInTheDocument();          // Total Salons
    expect(screen.getByText('Active: 4')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();                 // Total Branches
    expect(screen.getByText('128')).toBeInTheDocument();               // Appointments
    expect(screen.getByText('86')).toBeInTheDocument();                // Checked In
    expect(screen.getByText('$12,586')).toBeInTheDocument();           // Revenue Today
    expect(screen.getByText('$1,258')).toBeInTheDocument();            // Tips Today
    expect(screen.getByText('24')).toBeInTheDocument();                // Technicians Working
    expect(screen.getByText('31')).toBeInTheDocument();                // Clients Waiting
    expect(screen.getByText('18')).toBeInTheDocument();                // Services In Progress
    expect(screen.getByText('14')).toBeInTheDocument();                // Ready For Checkout
    expect(screen.getByText('23')).toBeInTheDocument();                // New Clients Today
  });

  it('money is formatted from INTEGER CENTS — no float drift across salons', async () => {
    mock({ ...SUMMARY, revenueTodayCents: 12_586_45 });
    ui();
    // 1258645 cents → $12,586 (rounded for display; the underlying value stays an integer)
    expect(await screen.findByText('$12,586')).toBeInTheDocument();
  });

  it('does NOT render change percentages — they are not modelled, and inventing one is fabrication', async () => {
    ui();
    await screen.findByText('128');
    expect(screen.queryByText(/18\.6%/)).toBeNull();
    expect(screen.queryByText(/↑/)).toBeNull();
  });
});

describe('AI Receptionist is reported HONESTLY', () => {
  it('"Online" only when every configured salon is live', async () => {
    ui();
    expect(await screen.findByText('Online')).toBeInTheDocument();
  });

  it('"Partial" when some salons are live and some are not — never a flat Online', async () => {
    mock({ ...SUMMARY, aiReceptionist: 'degraded' });
    ui();
    expect(await screen.findByText('Partial')).toBeInTheDocument();
    expect(screen.queryByText('Online')).toBeNull();
  });

  it('"Not set up" — NOT "Offline" — when no salon has one', async () => {
    // Offline implies something is broken. These salons simply never configured one.
    mock({ ...SUMMARY, aiReceptionist: 'none' });
    ui();
    expect(await screen.findByText('Not set up')).toBeInTheDocument();
    expect(screen.queryByText(/offline/i)).toBeNull();
  });
});

describe('honest states — no fabricated numbers', () => {
  it('a FAILED load shows an error, NOT zeros', async () => {
    get.mockImplementation(async (p: string) => {
      if (p === '/owner/portfolio/summary') throw new Error('network');
      return p === '/owner/portfolio' ? { salons: [] } : { activeSalonId: null };
    });
    ui();

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    // A dashboard reporting $0 when it merely failed to load is confidently wrong — and someone will act on it.
    expect(screen.queryByText('$0')).toBeNull();
    expect(screen.queryByText('128')).toBeNull();
  });

  it('salons the owner cannot report on are DECLARED, not silently counted as zero', async () => {
    mock({ ...SUMMARY, salonsWithheldForPermission: 2 });
    ui();
    expect(await screen.findByText(/2 salons not included/i)).toBeInTheDocument();
    expect(screen.getByText(/role there doesn’t include reporting/i)).toBeInTheDocument();
  });

  it('an owner with no salons is told so plainly', async () => {
    mock({ ...SUMMARY, totalSalons: 0 });
    ui();
    expect(await screen.findByText(/No salons are assigned to your account yet/i)).toBeInTheDocument();
  });

  it('shows a loading state rather than an empty dashboard', () => {
    get.mockImplementation(() => new Promise(() => {}));   // never resolves
    ui();
    expect(screen.getByRole('status')).toHaveTextContent(/loading/i);
  });
});

// ── Revenue Overview + Top Performing Salons (the two panels from the reference image) ──────────────────────
describe('Revenue Overview', () => {
  it('draws the real hourly series returned by the server', async () => {
    mock();
    ui();
    // The chart is an SVG polyline, not a chart library — one dependency-free line.
    await waitFor(() => expect(document.querySelector('svg[aria-label="Revenue by hour, today"]')).toBeTruthy());
    expect(document.querySelector('polyline')).toBeTruthy();
  });

  it('says so when there is no revenue yet — it does NOT draw a flat zero line', async () => {
    // A flat line at zero reads as a confident "you took nothing today". Nothing was measured; say that.
    mock(SUMMARY, TOP, []);
    ui();
    expect(await screen.findByText(/No revenue recorded yet today/i)).toBeTruthy();
    expect(document.querySelector('polyline')).toBeNull();
  });
});

describe('Top Performing Salons', () => {
  it('renders the ranked salons the server authorized', async () => {
    mock();
    ui();
    expect(await screen.findByText('Luxe Downtown')).toBeTruthy();
    expect(await screen.findByText('Belle Cherry Hill')).toBeTruthy();
  });

  it('never renders a salon the server did not return — the client cannot add one', async () => {
    mock(SUMMARY, [], SERIES);
    ui();
    expect(await screen.findByText(/No salon revenue to rank yet today/i)).toBeTruthy();
  });

  it('tapping a salon performs the server-verified switch, not a client-side jump', async () => {
    mock();
    ui();
    const row = await screen.findByText('Luxe Downtown');
    fireEvent.click(row);
    // The switch goes to the backend, which re-verifies membership and re-mints the session. The client never
    // decides it succeeded.
    await waitFor(() => expect(post).toHaveBeenCalledWith('/owner/context/switch', expect.objectContaining({ salonId: 'a' })));
  });
});
