import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { POSBookingScreen, calMinutes, calLabel, calRangeLabel, calGapText, calSnap, calHHMM, openTodayState, isArrivingSoon, ARRIVING_SOON_MINUTES, type GridColumn } from './POSBookingScreen';
import { runOnClassicBookingBoard } from './booking/boardMode.testkit';
// these tests pin the CLASSIC calendar (recoverable behind "Classic board" since the Booking Schedule Board merge, Nov 13 2026)
runOnClassicBookingBoard();

const state = {
  kpis: { totalBookingsToday: 0, confirmedBookings: 0, checkedInBookings: 0, waitingBookings: 0, inServiceBookings: 0, completedBookings: 0, cancelledBookings: 0, noShowBookings: 0, onlineBookings: 0, googleBookings: 0, aiBookings: 0, conflictCount: 0, depositsCollectedCents: 0 },
  dateRange: { from: '2026-06-07', to: '2026-06-07', timezone: 'America/New_York' },
  bookings: { items: [], pagination: { totalItems: 0 } },
  filters: { statuses: [], sources: [], technicians: [], services: [], serviceCategories: [], branches: [] },
  integrationStatus: { googleReserveConnected: false, aiPhoneEnabled: false, onlineBookingEnabled: false },
};
const mockFetch = (s: unknown) => vi.fn(async () => ({ ok: true, status: 200, json: async () => s, headers: { get: () => null } } as any));
beforeEach(() => { vi.restoreAllMocks(); });

describe('POSBookingScreen', () => {
  it('mounts and renders the booking board + empty state', async () => {
    globalThis.fetch = mockFetch(state) as any;
    render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
    expect(await screen.findByText('Booking')).toBeInTheDocument();
    expect(screen.getByText('No appointments match.')).toBeInTheDocument();
    // T04 added modules
    expect(screen.getByText(/Customer Preview/)).toBeInTheDocument();
    expect(screen.getByText(/Upcoming Appointments/)).toBeInTheDocument();
    expect(screen.getByText('confirmed rate')).toBeInTheDocument();
    expect(screen.getByText('Quick Actions')).toBeInTheDocument();
  });

  it('parses HH:MM and ISO times consistently', () => {
    expect(calMinutes('9:00')).toBe(540);
    expect(calMinutes('14:30')).toBe(870);
    expect(calMinutes('2026-06-07T09:15:00')).toBe(9 * 60 + 15);
    expect(calMinutes('')).toBeNull();
    expect(calLabel(540)).toBe('9:00a');
    expect(calLabel(870)).toBe('2:30p');
  });

  it('renders the calendar grid with a technician column and an appointment card', async () => {
    const withAppts = {
      ...state,
      kpis: { ...state.kpis, totalBookingsToday: 1 },
      bookings: { items: [{ appointmentId: 'a1', customerName: 'Grace Kim', isVip: true, technicianId: 't1', technicianName: 'Mia', services: [{ serviceName: 'Signature Manicure' }], source: 'online', startTime: '10:00', endTime: '10:45', durationMinutes: 45, status: 'confirmed' }], pagination: { totalItems: 1 } },
      filters: { ...state.filters, technicians: [{ technicianId: 't1', name: 'Mia' }] },
      settings: { openTime: '9:00', closeTime: '18:00' },
      aggregates: { walkInsToday: 0, bookedRevenueCents: 5500, bookedMinutes: 45, sourceCounts: [{ source: 'online', count: 1 }], serviceCounts: [{ name: 'Signature Manicure', count: 1 }] },
    };
    // 200-technician mandate §2: the board's technicians come from the paged GET /technicians (the state no longer ships the roster)
    const miaPage = { date: '2026-06-07', technicians: [{ technicianId: 't1', name: 'Mia', rosterNumber: 1, avatarUrl: null, available: true, workingToday: true, skills: [], rating: null, reviewCount: 0 }], total: 1, totalAll: 1, workingCount: 1, page: 1, pageSize: 12, totalPages: 1 };
    const urls: string[] = [];
    globalThis.fetch = vi.fn(async (url: any) => { const u = String(url); urls.push(u); return { ok: true, status: 200, headers: { get: () => null }, json: async () => (u.includes('/booking/technicians') ? miaPage : withAppts) } as any; }) as any;
    render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
    expect(await screen.findByText('Booking')).toBeInTheDocument();
    expect(screen.getByText(/by technician/)).toBeInTheDocument();
    expect((await screen.findAllByText('Mia')).length).toBeGreaterThanOrEqual(1);
    expect(urls.filter((u) => u.includes('/booking/state?')).length).toBeGreaterThan(0);
    expect(urls.filter((u) => u.includes('/booking/state?')).every((u) => u.includes('roster=none'))).toBe(true);
    // no 200-name <select> anywhere on the board (§57): technicians are chosen from the server-paged picker
    expect(Array.from(document.querySelectorAll('select option')).some((o) => o.textContent === 'Mia')).toBe(false);
    expect(screen.getAllByText(/Grace Kim/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Available Technicians/)).toBeInTheDocument();
    expect(screen.getByText(/Highest demand: Signature Manicure/)).toBeInTheDocument();
  });

  it('renders the Booking Assistant form and validates required customer name', async () => {
    const withCatalog = { ...state, filters: { ...state.filters, services: [{ serviceId: 'svc_mani', name: 'Signature Manicure' }], technicians: [{ technicianId: 't1', name: 'Mia' }] } };
    globalThis.fetch = mockFetch(withCatalog) as any;
    render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
    expect(await screen.findByText('Booking Assistant')).toBeInTheDocument();
    expect(screen.getByText('Book Appointment')).toBeInTheDocument();
    expect(screen.getAllByText('Signature Manicure').length).toBeGreaterThanOrEqual(1);
    fireEvent.click(screen.getByText('Book Appointment'));
    expect(await screen.findByText(/Customer name is required/)).toBeInTheDocument();
  });
});

describe('booking calendar upgrade — pure helpers', () => {
  it('formats ranges and HH:MM round-trips on the 15-minute grid', () => {
    expect(calRangeLabel(540, 585)).toBe('9:00a–9:45a');
    expect(calHHMM(675)).toBe('11:15');
    expect(calMinutes(calHHMM(825))).toBe(825);
  });
  it('gap text: exact minutes, and "Open until" for a trailing range', () => {
    expect(calGapText(45, 720, false)).toBe('45 min open');
    expect(calGapText(90, 930, true)).toBe('Open until 3:30p');
  });
  it('snaps drag positions to the nearest 15-minute slot', () => {
    expect(calSnap(547, 15)).toBe(540);
    expect(calSnap(548, 15)).toBe(555);
    expect(calSnap(600, 15)).toBe(600);
  });
  it('openTodayState reports honest states', () => {
    const base: GridColumn = { technicianId: 't', name: 'T', available: true, windows: [{ start: 540, end: 1080 }], blocked: [], openRanges: [{ start: 540, end: 600, minutes: 60 }], openMinutes: 60, openSlotCount: 2 };
    expect(openTodayState(base).kind).toBe('ranges');
    expect(openTodayState({ ...base, openRanges: [], openMinutes: 0, openSlotCount: 0 }).kind).toBe('full');
    expect(openTodayState({ ...base, windows: [] }).kind).toBe('off');
    expect(openTodayState({ ...base, available: false }).kind).toBe('unavailable');
    expect(openTodayState(undefined).kind).toBe('unavailable');
  });
});

describe('booking calendar upgrade — day-grid render', () => {
  const grid = {
    date: '2026-06-07', openTime: '09:00', closeTime: '18:00', slotIntervalMinutes: 15, bufferMinutes: 0, defaultServiceDurationMinutes: 30,
    totalOpenSlots: 7,
    columns: [
      { technicianId: 'tA', name: 'Mia Johnson', available: true, skills: [], avatarUrl: null,
        windows: [{ start: 540, end: 1080 }], blocked: [{ startTime: '14:00', endTime: '15:00', reason: 'training' }],
        openRanges: [{ start: 675, end: 720, minutes: 45 }], openMinutes: 45, openSlotCount: 3 },
      { technicianId: 'tB', name: 'Grace Hall', available: true, skills: [], avatarUrl: null,
        windows: [], blocked: [], openRanges: [], openMinutes: 0, openSlotCount: 0 },
    ],
    appointments: [],
  };
  const stateWithTechs = { ...state, filters: { ...state.filters, technicians: [{ technicianId: 'tA', name: 'Mia Johnson' }, { technicianId: 'tB', name: 'Grace Hall' }] } };
  const urlFetch = vi.fn(async (url: any) => ({
    ok: true, status: 200, headers: { get: () => null },
    json: async () => (String(url).includes('/day-grid') ? grid : stateWithTechs),
  } as any));

  it('renders Open Today chips, gap labels, honest off state, and the fullscreen button', async () => {
    globalThis.fetch = urlFetch as any;
    render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
    expect(await screen.findByText('View All Techs ⤢')).toBeInTheDocument();
    // gap-minute label inside the free range (45 min, not trailing — window runs to 18:00)
    expect(await screen.findByText(/\+ 45 min open/)).toBeInTheDocument();
    // Open Today chip for the same range — spec §6: start–end · total minutes, never bare slot times
    expect(screen.getByText(/11:15a–12:00p · 45 min/)).toBeInTheDocument();
    // honest off state for the tech with no windows
    expect(screen.getByText('Off today')).toBeInTheDocument();
    // blocked slice labeled with its reason
    expect(screen.getByText(/training/)).toBeInTheDocument();
    // real Open Slots KPI from the live grid
    expect(screen.getByText('from live schedule')).toBeInTheDocument();
  });

  it('clicking an Open Today chip prefills the Booking Assistant time', async () => {
    globalThis.fetch = urlFetch as any;
    render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
    const chip = await screen.findByText(/11:15a–12:00p · 45 min/);
    fireEvent.click(chip);
    expect(await screen.findByText(/Prefilled Mia Johnson · 11:15a/)).toBeInTheDocument();
  });

  it('opens and closes the single-technician fullscreen day view', async () => {
    globalThis.fetch = urlFetch as any;
    render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
    await screen.findAllByText('View day');   // the day grid (columns) has arrived — the team list also names Mia
    const mias = await screen.findAllByText('Mia Johnson');
    const colHeader = mias.find((el) => el.tagName !== 'OPTION') || mias[mias.length - 1];
    fireEvent.click(colHeader);
    expect(await screen.findByText(/min booked/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('✕ Close'));
    expect(await screen.findByText('View All Techs ⤢')).toBeInTheDocument();
  });
});

describe('booking calendar upgrade — date navigation', () => {
  it('next-day arrow requests the shifted date from both endpoints', async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (url: any) => { calls.push(String(url)); return { ok: true, status: 200, headers: { get: () => null }, json: async () => (String(url).includes('/day-grid') ? { date: '2026-06-07', openTime: '09:00', closeTime: '18:00', slotIntervalMinutes: 15, bufferMinutes: 0, defaultServiceDurationMinutes: 30, totalOpenSlots: 0, columns: [], appointments: [] } : state) } as any; }) as any;
    render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByLabelText('Next day'));
    await screen.findByText('Today'); // Today button appears once a date is chosen
    expect(calls.some((u) => u.includes('/day-grid?date=2026-06-08'))).toBe(true);
    expect(calls.some((u) => u.includes('/state?') && u.includes('date=2026-06-08'))).toBe(true);
  });
});

describe('booking dashboard wiring — waitlist, filters, source', () => {
  const gridEmpty = { date: '2026-06-07', openTime: '09:00', closeTime: '18:00', slotIntervalMinutes: 15, bufferMinutes: 0, defaultServiceDurationMinutes: 30, totalOpenSlots: 0, columns: [], appointments: [] };
  const queueState = { queue: { items: [
    { queueItemId: 'q1', customerName: 'Emily Davis', requestedServices: [{ serviceName: 'Acrylic Fill' }], actualWaitMinutes: 45, status: 'waiting' },
    { queueItemId: 'q2', customerName: 'Rachel Lee', requestedServices: [{ serviceName: 'Pedicure' }], quotedWaitMinutes: 60, status: 'waiting' },
  ], pagination: { page: 1, pageSize: 6, totalItems: 2, totalPages: 1 } } };
  const stateWithFilters = { ...state, filters: { ...state.filters, technicians: [{ technicianId: 'tA', name: 'Mia Johnson' }], serviceCategories: ['Manicure', 'Pedicure'] } };
  const techPageA = { date: '2026-06-07', technicians: [{ technicianId: 'tA', name: 'Mia Johnson', rosterNumber: 1, avatarUrl: null, available: true, workingToday: true, skills: [], rating: null, reviewCount: 0 }], total: 1, totalAll: 1, workingCount: 1, page: 1, pageSize: 12, totalPages: 1 };
  const routed = vi.fn(async (url: any) => ({ ok: true, status: 200, headers: { get: () => null },
    json: async () => { const u = String(url); return u.includes('/pos/queue/') ? queueState : u.includes('/day-grid') ? gridEmpty : u.includes('/booking/technicians') ? techPageA : stateWithFilters; } } as any));

  it('Waitlist / Standby lists real waiting queue guests with wait minutes', async () => {
    globalThis.fetch = routed as any;
    render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
    expect(await screen.findByText('Emily Davis')).toBeInTheDocument();
    expect(screen.getByText('45 min')).toBeInTheDocument();
    expect(screen.getByText('Rachel Lee')).toBeInTheDocument();
    expect(screen.getByText('View Full Waitlist')).toBeInTheDocument();
  });

  it('technician and service-category filters pass through to the state query', async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (url: any) => { calls.push(String(url)); return routed(url); }) as any;
    render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
    // §57: the list's technician filter is the server-paged picker (search + 12 a page), not a 200-option <select>
    const filterBtn = await screen.findByRole('button', { name: 'All technicians' });
    fireEvent.click(filterBtn);
    fireEvent.click(await within(filterBtn.parentElement as HTMLElement).findByRole('option', { name: /Mia Johnson/ }));
    await screen.findByText('Booking');
    await vi.waitFor(() => expect(calls.some((u) => u.includes('technicianId=tA'))).toBe(true));
  });

  // ── "More Filters" (design picture): three filters the API always implemented but no screen surfaced ──
  it('More Filters reveals branch / deposit / conflicts-only and passes them to the query', async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (url: any) => { calls.push(String(url)); return routed(url); }) as any;
    render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
    const more = await screen.findByRole('button', { name: /More Filters/ });
    expect(screen.queryByLabelText('Deposit filter')).toBeNull();      // collapsed by default
    fireEvent.click(more);
    fireEvent.change(screen.getByLabelText('Deposit filter'), { target: { value: 'required' } });
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.some((u) => u.includes('depositStatus=required'))).toBe(true);
    fireEvent.click(screen.getByRole('checkbox', { name: /Conflicts only/i }));
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.some((u) => u.includes('conflictOnly=true'))).toBe(true);
    // the button advertises how many extra filters are active, so a hidden filter can't silently skew the board
    expect((await screen.findByRole('button', { name: /More Filters \(2\)/ }))).toBeInTheDocument();
  });

  // ── "Arriving Soon" is DERIVED, never stored: pin the rule, not a label ──
  describe('isArrivingSoon', () => {
    it('is true only for a not-yet-arrived booking inside the window', () => {
      expect(isArrivingSoon('booked', 615, 600)).toBe(true);                       // 15 min out
      expect(isArrivingSoon('confirmed', 605, 600)).toBe(true);                    // 5 min out
      expect(isArrivingSoon('booked', 600, 600)).toBe(true);                       // due now
      expect(isArrivingSoon('booked', 600 + ARRIVING_SOON_MINUTES + 1, 600)).toBe(false); // outside the window
      expect(isArrivingSoon('booked', 595, 600)).toBe(false);                      // already late, not "soon"
    });
    it('never applies once the guest is here or the visit is over', () => {
      for (const st of ['checked_in', 'waiting', 'in_service', 'completed', 'cancelled', 'no_show'])
        expect(isArrivingSoon(st, 610, 600)).toBe(false);
    });
  });

  it('the Booking Assistant exposes a booking-source select including walk-in', async () => {
    globalThis.fetch = routed as any;
    render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
    const src = await screen.findByLabelText('Booking source');
    expect(src).toBeInTheDocument();
    fireEvent.change(src, { target: { value: 'walk_in' } });
    expect((src as HTMLSelectElement).value).toBe('walk_in');
  });

  it('queue failure renders the honest unavailable state, never fabricated names', async () => {
    globalThis.fetch = vi.fn(async (url: any) => String(url).includes('/pos/queue/')
      ? ({ ok: false, status: 500, headers: { get: () => null }, json: async () => ({ message: 'boom' }) } as any)
      : routed(url)) as any;
    render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
    expect(await screen.findByText('Queue unavailable right now.')).toBeInTheDocument();
  });
});

// ── High-density booking upgrade (spec §4/§6/§8/§13/§14) ──
import { calColMinWidth, calFitsIn } from './POSBookingScreen';

describe('high-density upgrade — pure helpers', () => {
  it('calColMinWidth fits 20 compact columns on a 24" iMac viewport (1920px)', () => {
    const w = calColMinWidth(1920, 56, 20);
    expect(w).toBeGreaterThanOrEqual(88);
    expect(56 + 20 * w).toBeLessThanOrEqual(1920);      // 20 columns + time column fit the screen
  });
  it('calColMinWidth widens columns when fewer technicians exist and floors/caps sensibly', () => {
    expect(calColMinWidth(1920, 56, 8)).toBe(170);       // few techs → capped at the standard width
    expect(calColMinWidth(900, 56, 20)).toBe(88);        // small screens hit the readability floor → h-scroll
    expect(calColMinWidth(2560, 56, 20)).toBeGreaterThan(calColMinWidth(1920, 56, 20));
  });
  it('calColMinWidth never imposes a technician cap — 30 columns still get the 20-target width', () => {
    expect(calColMinWidth(1920, 56, 30)).toBe(calColMinWidth(1920, 56, 20));
  });
  it('calFitsIn: fits / no-fit / null when no service selected', () => {
    expect(calFitsIn(45, 30)).toBe('fits');
    expect(calFitsIn(45, 60)).toBe('no-fit');
    expect(calFitsIn(45, null)).toBeNull();
    expect(calFitsIn(45, 0)).toBeNull();
  });
});

describe('high-density upgrade — Open Today minutes, overflow, and fit hints', () => {
  const manyRanges = Array.from({ length: 6 }, (_, i) => ({ start: 540 + i * 60, end: 570 + i * 60, minutes: 30 }));
  const grid6 = {
    date: '2026-06-07', openTime: '09:00', closeTime: '18:00', slotIntervalMinutes: 15, bufferMinutes: 0, defaultServiceDurationMinutes: 30,
    totalOpenSlots: 6,
    columns: [{ technicianId: 'tA', name: 'Mia Johnson', available: true, skills: [], avatarUrl: null, windows: [{ start: 540, end: 1080 }], blocked: [], openRanges: manyRanges, openMinutes: 180, openSlotCount: 6 }],
    appointments: [],
  };
  const st = { ...state, filters: { ...state.filters, technicians: [{ technicianId: 'tA', name: 'Mia Johnson' }], services: [{ serviceId: 'svcL', name: 'Long Set', durationMinutes: 90, priceCents: 9000 }] } };
  const fetch6 = vi.fn(async (url: any) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => (String(url).includes('/day-grid') ? grid6 : st) } as any));

  it('shows the first ranges with minutes and folds the rest behind "+N more"', async () => {
    globalThis.fetch = fetch6 as any;
    render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
    expect(await screen.findByText(/9:00a–9:30a · 30 min/)).toBeInTheDocument();
    const more = screen.getByText('+3 more');
    fireEvent.click(more);
    expect(screen.getByText(/2:00p–2:30p · 30 min/)).toBeInTheDocument();   // 6th range now visible
    fireEvent.click(screen.getByText('less'));
    expect(screen.queryByText(/2:00p–2:30p/)).not.toBeInTheDocument();
  });

  it('marks ranges that cannot hold the selected service as "does not fit" (chips + gaps)', async () => {
    globalThis.fetch = fetch6 as any;
    render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
    await screen.findByText(/9:00a–9:30a · 30 min/);
    // select the 90-min service in the Booking Assistant → 30-min ranges cannot fit it
    fireEvent.change(screen.getAllByDisplayValue('Service *…')[0], { target: { value: 'svcL' } });
    const gap = await screen.findAllByText(/does not fit/);
    expect(gap.length).toBeGreaterThan(0);
    const chip = screen.getByText(/9:00a–9:30a · 30 min/).closest('button')!;
    expect(chip.getAttribute('title')).toMatch(/does not fit/);
  });
});

describe('high-density upgrade — unified pointer drag (mouse + touch long-press)', () => {
  // jsdom has no PointerEvent — this MouseEvent subclass lets fireEvent.pointer* carry coords + pointer props.
  class PEPoly extends MouseEvent { pointerId: number; pointerType: string; constructor(t: string, i: any = {}) { super(t, i); this.pointerId = i.pointerId ?? 1; this.pointerType = i.pointerType ?? 'mouse'; } }
  beforeEach(() => { (window as any).PointerEvent = PEPoly; });
  const gridD = {
    date: '2026-06-07', openTime: '09:00', closeTime: '18:00', slotIntervalMinutes: 15, bufferMinutes: 0, defaultServiceDurationMinutes: 30,
    totalOpenSlots: 3,
    columns: [
      { technicianId: 'tA', name: 'Mia Johnson', available: true, skills: [], avatarUrl: null, windows: [{ start: 540, end: 1080 }], blocked: [], openRanges: [], openMinutes: 0, openSlotCount: 0 },
      { technicianId: 'tB', name: 'Grace Hall', available: true, skills: [], avatarUrl: null, windows: [{ start: 540, end: 1080 }], blocked: [], openRanges: [], openMinutes: 0, openSlotCount: 0 },
    ],
    appointments: [] as any[],
  };
  const appt = { appointmentId: 'apX', customerName: 'Drag Me', customerPhone: '', isVip: false, technicianId: 'tA', technicianName: 'Mia Johnson', services: [{ serviceName: 'Mani' }], source: 'manual', startTime: '10:00', endTime: '10:45', durationMinutes: 45, status: 'confirmed' };
  gridD.appointments = [appt as any];   // the board draws the WHOLE day from the day grid (200-technician mandate)
  const stD = { ...state, bookings: { items: [appt] }, filters: { ...state.filters, technicians: [{ technicianId: 'tA', name: 'Mia Johnson' }, { technicianId: 'tB', name: 'Grace Hall' }] } };
  const calls: string[] = [];
  const fetchD = vi.fn(async (url: any, init?: any) => {
    const u = String(url);
    if (init?.method === 'POST' && u.includes('/reschedule')) { calls.push(u + '::' + init.body); return { ok: true, status: 200, headers: { get: () => null }, json: async () => appt } as any; }
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => (u.includes('/day-grid') ? gridD : stD) } as any;
  });

  beforeEach(() => { calls.length = 0; });

  const mockCols = () => {
    // jsdom has no layout: give each technician column a deterministic rect so drop math is real.
    document.querySelectorAll('[data-cal-col]').forEach((el, i) => {
      (el as HTMLElement).getBoundingClientRect = () => ({ top: 0, left: 100 + i * 200, right: 300 + i * 200, bottom: 800, width: 200, height: 800, x: 100 + i * 200, y: 0, toJSON: () => ({}) } as any);
    });
    const target = document.querySelectorAll('[data-cal-col]')[1] as HTMLElement;
    const orig = document.elementFromPoint;
    (document as any).elementFromPoint = () => target;   // pointer is over the second column
    return () => { (document as any).elementFromPoint = orig; };
  };

  it('mouse: press, move past the threshold, release → reschedule posts the snapped time + new technician', async () => {
    globalThis.fetch = fetchD as any;
    render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
    await screen.findAllByText('View day');   // calendar cards come from the day grid
    const card = (await screen.findAllByText('Drag Me')).map((el) => el.closest('button')!).find((b) => b?.closest('[data-cal-col]'))!;
    const restore = mockCols();
    fireEvent.pointerDown(card, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 150, clientY: 100 });
    // 11:30 on the 0.85 px/min grid: (11.5h − 9h) × 60 × 0.85 ≈ 127.5px below the column top
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 350, clientY: 128 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 350, clientY: 128 });
    restore();
    expect(calls.length).toBe(1);
    expect(calls[0]).toContain('/appointments/apX/reschedule');
    expect(calls[0]).toContain('"startTime":"11:30"');
    expect(calls[0]).toContain('"technicianId":"tB"');
  });

  it('touch: a long-press activates the drag; an early move cancels it (native scroll wins)', async () => {
    vi.useFakeTimers();
    try {
      globalThis.fetch = fetchD as any;
      render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
      await vi.waitFor(() => { if (!screen.queryAllByText('Drag Me').length) throw new Error('pending'); });
      const card = screen.getAllByText('Drag Me')[0].closest('button')!;
      // early move before the 350 ms long-press → drag never starts
      fireEvent.pointerDown(card, { pointerId: 2, pointerType: 'touch', clientX: 150, clientY: 100 });
      fireEvent.pointerMove(window, { pointerId: 2, clientX: 150, clientY: 140 });
      vi.advanceTimersByTime(400);
      fireEvent.pointerUp(window, { pointerId: 2, clientX: 150, clientY: 140 });
      expect(calls.length).toBe(0);
      // hold still for 350 ms → drag activates, then move + release commits
      const restore = mockCols();
      fireEvent.pointerDown(card, { pointerId: 3, pointerType: 'touch', clientX: 150, clientY: 100 });
      vi.advanceTimersByTime(400);
      fireEvent.pointerMove(window, { pointerId: 3, clientX: 350, clientY: 128 });
      fireEvent.pointerUp(window, { pointerId: 3, clientX: 350, clientY: 128 });
      restore();
      expect(calls.length).toBe(1);
      expect(calls[0]).toContain('"technicianId":"tB"');
    } finally { vi.useRealTimers(); }
  });

  it('Escape during an active drag cancels it — no reschedule call', async () => {
    globalThis.fetch = fetchD as any;
    render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
    const card = (await screen.findAllByText('Drag Me'))[0].closest('button')!;
    const restore = mockCols();
    fireEvent.pointerDown(card, { pointerId: 4, pointerType: 'mouse', button: 0, clientX: 150, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 4, clientX: 350, clientY: 128 });
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.pointerUp(window, { pointerId: 4, clientX: 350, clientY: 128 });
    restore();
    expect(calls.length).toBe(0);
  });
});

describe('high-density upgrade — Move Appointment modal (§14)', () => {
  const gridM = {
    date: '2026-06-07', openTime: '09:00', closeTime: '18:00', slotIntervalMinutes: 15, bufferMinutes: 0, defaultServiceDurationMinutes: 30,
    totalOpenSlots: 2,
    columns: [{ technicianId: 'tA', name: 'Mia Johnson', available: true, skills: [], avatarUrl: null, windows: [{ start: 540, end: 1080 }], blocked: [], openRanges: [{ start: 675, end: 765, minutes: 90 }, { start: 900, end: 930, minutes: 30 }], openMinutes: 120, openSlotCount: 2 }],
    appointments: [] as any[],
  };
  const appt = { appointmentId: 'apM', customerName: 'Move Me', customerPhone: '', isVip: false, technicianId: 'tA', technicianName: 'Mia Johnson', services: [{ serviceName: 'Pedi' }], source: 'manual', startTime: '2026-06-07T10:00:00', endTime: '2026-06-07T10:45:00', durationMinutes: 45, status: 'confirmed' };
  gridM.appointments = [appt as any];
  const stM = { ...state, bookings: { items: [appt] }, filters: { ...state.filters, technicians: [{ technicianId: 'tA', name: 'Mia Johnson' }] } };
  const posts: string[] = [];
  const fetchM = vi.fn(async (url: any, init?: any) => {
    const u = String(url);
    if (init?.method === 'POST' && u.includes('/reschedule')) { posts.push(String(init.body)); return { ok: true, status: 200, headers: { get: () => null }, json: async () => appt } as any; }
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => (u.includes('/day-grid') ? gridM : stM) } as any;
  });

  it('opens from Manage → Move…, suggests only ranges that fit, and submits reason + notify through reschedule', async () => {
    posts.length = 0;
    globalThis.fetch = fetchM as any;
    render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
    fireEvent.click((await screen.findAllByText('Manage'))[0]);
    fireEvent.click(await screen.findByText('Move…'));
    const dlg = (await screen.findByRole('heading', { name: 'Move Appointment' })).closest('[role="dialog"]') as HTMLElement;
    expect(dlg).toBeTruthy();
    // the 90-min range fits the 45-min appointment; the 30-min range must NOT be suggested
    const sug = await within(dlg).findByText(/11:15a–12:45p · 90 min/);
    expect(within(dlg).queryByText(/3:00p–3:30p/)).not.toBeInTheDocument();
    fireEvent.click(sug);
    fireEvent.change(screen.getByPlaceholderText(/Customer requested/), { target: { value: 'tech out sick' } });
    fireEvent.click(screen.getByText('Move appointment'));
    await screen.findByText('Appointment moved.').catch(() => null as any);
    expect(posts.length).toBe(1);
    expect(posts[0]).toContain('"startTime":"11:15"');
    expect(posts[0]).toContain('"reason":"tech out sick"');
    expect(posts[0]).toContain('"notifyCustomer":true');
  });
});

describe('high-density upgrade — block time + fs assistant (§9/§10)', () => {
  const gridB = {
    date: '2026-06-07', openTime: '09:00', closeTime: '18:00', slotIntervalMinutes: 15, bufferMinutes: 0, defaultServiceDurationMinutes: 30,
    totalOpenSlots: 1,
    columns: [{ technicianId: 'tA', name: 'Mia Johnson', available: true, skills: [], avatarUrl: null, windows: [{ start: 540, end: 1080 }], blocked: [{ blockId: 'blk1', startTime: '14:00', endTime: '15:00', reason: 'training' }], openRanges: [{ start: 540, end: 600, minutes: 60 }], openMinutes: 60, openSlotCount: 1 }],
    appointments: [],
  };
  const stB = { ...state, filters: { ...state.filters, technicians: [{ technicianId: 'tA', name: 'Mia Johnson' }] } };
  const reqs: string[] = [];
  const fetchB = vi.fn(async (url: any, init?: any) => {
    const u = String(url);
    if (init?.method === 'POST' && u.includes('/blocked-times')) { reqs.push('POST::' + init.body); return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ blockId: 'blk2' }) } as any; }
    if (init?.method === 'DELETE' && u.includes('/blocked-times/')) { reqs.push('DELETE::' + u); return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ removed: true }) } as any; }
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => (u.includes('/day-grid') ? gridB : stB) } as any;
  });

  it('single-tech fullscreen: Block time form posts, blocked slice ✕ deletes; fs-all shows the Assistant slide-over', async () => {
    reqs.length = 0;
    globalThis.fetch = fetchB as any;
    render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
    // open single-technician fullscreen from the header
    await screen.findAllByText('View day');
    const miasB = await screen.findAllByText('Mia Johnson');
    fireEvent.click(miasB.find((el) => el.tagName !== 'OPTION') || miasB[miasB.length - 1]);
    fireEvent.click(await screen.findByText('Block time'));
    fireEvent.change(screen.getByLabelText('Block start'), { target: { value: '12:00' } });
    fireEvent.change(screen.getByLabelText('Block end'), { target: { value: '12:30' } });
    fireEvent.change(screen.getByLabelText('Block reason'), { target: { value: 'lunch run' } });
    fireEvent.click(screen.getByText('Save block'));
    await vi.waitFor(() => { if (!reqs.some((r) => r.startsWith('POST::'))) throw new Error('pending'); });
    expect(reqs.find((r) => r.startsWith('POST::'))).toContain('"reason":"lunch run"');
    // remove the pre-existing block via its ✕
    fireEvent.click(screen.getByLabelText('Remove block training'));
    await vi.waitFor(() => { if (!reqs.some((r) => r.startsWith('DELETE::'))) throw new Error('pending'); });
    expect(reqs.find((r) => r.startsWith('DELETE::'))).toContain('/blocked-times/blk1');
    // close, open View-All fullscreen → Booking Assistant slide-over is reachable
    fireEvent.click(screen.getByText('✕ Close'));
    fireEvent.click(await screen.findByText('View All Techs ⤢'));
    fireEvent.click(await screen.findByRole('button', { name: 'Booking Assistant' }));
    expect((await screen.findAllByPlaceholderText('Customer name *')).length).toBeGreaterThan(1);  // panel + slide-over
    fireEvent.click(screen.getByLabelText('Close Booking Assistant'));
  });
});

// ── 2026-07-03 upgrade: density, minute-labeled Open Today chips, fit hints, pointer drag, Move workflow ──
// (calColMinWidth / calFitsIn already imported by the high-density helper block above)

describe('§4.2 responsive density — calColMinWidth', () => {
  it('fits 20 technicians on the 1920px desktop POS viewport without dropping below the 88px floor', () => {
    const w = calColMinWidth(1920, 56, 20);
    expect(w).toBeGreaterThanOrEqual(88);
    expect(56 + 20 * w).toBeLessThanOrEqual(1920);      // 20 columns + sticky time column fit the screen
  });
  it('gives fewer technicians wider columns, capped at the standard 170px', () => {
    expect(calColMinWidth(1920, 56, 6)).toBe(170);
    expect(calColMinWidth(1920, 56, 12)).toBeGreaterThan(calColMinWidth(1920, 56, 20));
  });
  it('enforces the 88px readability floor on narrow viewports and never hard-codes a technician limit', () => {
    expect(calColMinWidth(900, 56, 20)).toBe(88);        // >20 techs simply scroll horizontally
    expect(calColMinWidth(900, 56, 40)).toBe(88);        // target caps the divisor, not the tenant
  });
});

describe('§6/§8 fit hints — calFitsIn', () => {
  it('null when no service is selected; fits/no-fit otherwise', () => {
    expect(calFitsIn(45, null)).toBeNull();
    expect(calFitsIn(45, undefined)).toBeNull();
    expect(calFitsIn(45, 0)).toBeNull();
    expect(calFitsIn(45, 45)).toBe('fits');
    expect(calFitsIn(45, 60)).toBe('no-fit');
  });
});

const gridState = {
  ...state,
  bookings: { items: [{ appointmentId: 'a1', customerName: 'Grace Kim', technicianId: 't1', technicianName: 'Mia', services: [{ serviceName: 'Signature Manicure' }], source: 'online', startTime: '10:00', endTime: '10:45', durationMinutes: 45, status: 'confirmed' }], pagination: { totalItems: 1 } },
  filters: { ...state.filters, technicians: [{ technicianId: 't1', name: 'Mia' }], services: [{ serviceId: 'svc_mani', name: 'Signature Manicure', durationMinutes: 45 }] },
  settings: { openTime: '09:00', closeTime: '18:00' },
};
const grid = {
  date: '2026-06-07', openTime: '09:00', closeTime: '18:00', slotIntervalMinutes: 15, bufferMinutes: 0, defaultServiceDurationMinutes: 30,
  totalOpenSlots: 12, appointments: gridState.bookings.items as any[],
  columns: [{ technicianId: 't1', name: 'Mia', available: true, avatarUrl: null,
    windows: [{ start: 540, end: 1080 }],
    blocked: [{ blockId: 'blk1', startTime: '13:00', endTime: '13:30', reason: 'training' }],
    openRanges: [
      { start: 540, end: 600, minutes: 60 }, { start: 645, end: 690, minutes: 45 },
      { start: 750, end: 780, minutes: 30 }, { start: 900, end: 960, minutes: 60 }, { start: 990, end: 1080, minutes: 90 },
    ],
    openMinutes: 285, openSlotCount: 12 }],
};
// state + day-grid + queue fetch router (same-origin client hits /pos/booking/* and /pos/queue/*)
const routedFetch = () => vi.fn(async (url: any) => {
  const u = String(url);
  const body = u.includes('/day-grid') ? grid : u.includes('/pos/queue') ? { queue: { items: [] } } : gridState;
  return { ok: true, status: 200, json: async () => body, headers: { get: () => null } } as any;
});

describe('§6 Open Today summaries — combined ranges with total minutes and an overflow control', () => {
  it('shows start–end · total minutes (never per-15-minute slots) and hides overflow behind +N more', async () => {
    globalThis.fetch = routedFetch() as any;
    render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
    expect(await screen.findByText(/9:00a–10:00a · 60 min/)).toBeInTheDocument();
    expect(screen.getByText(/10:45a–11:30a · 45 min/)).toBeInTheDocument();
    expect(screen.getByText(/12:30p–1:00p · 30 min/)).toBeInTheDocument();
    // 5 ranges, chip limit 3 → the last two are collapsed
    expect(screen.queryByText(/4:30p–6:00p · 90 min/)).not.toBeInTheDocument();
    const more = screen.getByText('+2 more');
    fireEvent.click(more);
    expect(screen.getByText(/4:30p–6:00p · 90 min/)).toBeInTheDocument();
    expect(screen.getByText('less')).toBeInTheDocument();
  });

  it('marks ranges too short for the selected service as does-not-fit (assistant-driven)', async () => {
    globalThis.fetch = routedFetch() as any;
    render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
    await screen.findByText(/9:00a–10:00a · 60 min/);
    // select the 45-minute service in the Booking Assistant → 30-min range no longer fits.
    // Target the assistant's service picker specifically (the calendar header now has its own filter comboboxes).
    const svcSelect = screen.getAllByRole('combobox').find((el) => within(el).queryByText('Service *…'))!;
    fireEvent.change(svcSelect, { target: { value: 'svc_mani' } });
    const short = await screen.findByText(/12:30p–1:00p · 30 min/);
    expect(short.closest('button')!.title).toMatch(/does not fit/);
    const fitting = screen.getByText(/9:00a–10:00a · 60 min ✓/);
    expect(fitting).toBeInTheDocument();
  });
});

describe('§9 blocked time — remove control on blocked slices', () => {
  it('renders the blocked slice with reason and its ✕ triggers the DELETE endpoint', async () => {
    const f = routedFetch();
    globalThis.fetch = f as any;
    render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
    const slice = await screen.findByTitle('Blocked · training');
    const remove = within(slice).getByLabelText('Remove block training');
    fireEvent.click(remove);
    await vi.waitFor(() => {
      expect(f.mock.calls.some(([u, init]: any[]) => String(u).includes('/pos/booking/blocked-times/blk1') && init?.method === 'DELETE')).toBe(true);
    });
  });
});

describe('§13 pointer drag-and-drop — mouse move commits a snapped reschedule; Escape cancels', () => {
  const rectFor = (top: number) => ({ top, left: 100, right: 260, bottom: top + 900, width: 160, height: 900, x: 100, y: top, toJSON: () => ({}) }) as DOMRect;
  it('drags an appointment down 60 minutes and calls POST reschedule with the snapped HH:MM', async () => {
    const f = routedFetch();
    globalThis.fetch = f as any;
    render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
    const card = (await screen.findAllByLabelText(/Grace Kim, Signature Manicure/))[0];
    const col = card.closest('[data-cal-col]') as HTMLElement;
    vi.spyOn(col, 'getBoundingClientRect').mockReturnValue(rectFor(0));
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(col);
    // grid: 09:00 open, PX=0.85 → 11:00 is y = 120*0.85 = 102
    fireEvent.pointerDown(card, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 150, clientY: 51 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 150, clientY: 102 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 150, clientY: 102 });
    await vi.waitFor(() => {
      const call = f.mock.calls.find(([u, init]: any[]) => String(u).includes('/appointments/a1/reschedule') && init?.method === 'POST');
      expect(call).toBeTruthy();
      expect(JSON.parse((call as any)[1].body).startTime).toBe('11:00');
    });
  });
  it('Escape during a drag cancels — no reschedule call is made', async () => {
    const f = routedFetch();
    globalThis.fetch = f as any;
    render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
    const card = (await screen.findAllByLabelText(/Grace Kim, Signature Manicure/))[0];
    const col = card.closest('[data-cal-col]') as HTMLElement;
    vi.spyOn(col, 'getBoundingClientRect').mockReturnValue(rectFor(0));
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(col);
    fireEvent.pointerDown(card, { pointerId: 2, pointerType: 'mouse', button: 0, clientX: 150, clientY: 51 });
    fireEvent.pointerMove(window, { pointerId: 2, clientX: 150, clientY: 102 });
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.pointerUp(window, { pointerId: 2, clientX: 150, clientY: 102 });
    expect(f.mock.calls.some(([u]: any[]) => String(u).includes('/reschedule'))).toBe(false);
  });
  it('touch: a long press activates the drag; a quick swipe before the timer scrolls instead', async () => {
    vi.useFakeTimers();
    try {
      const f = routedFetch();
      globalThis.fetch = f as any;
      render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
      await vi.waitFor(async () => { expect(document.querySelector('[data-appt="a1"]')).toBeTruthy(); });
      const card = document.querySelector('[data-appt="a1"]') as HTMLElement;
      const col = card.closest('[data-cal-col]') as HTMLElement;
      vi.spyOn(col, 'getBoundingClientRect').mockReturnValue(rectFor(0));
      vi.spyOn(document, 'elementFromPoint').mockReturnValue(col);
      // swipe before long-press → cancelled (native scroll wins)
      fireEvent.pointerDown(card, { pointerId: 3, pointerType: 'touch', clientX: 150, clientY: 51 });
      fireEvent.pointerMove(window, { pointerId: 3, clientX: 150, clientY: 80 });
      vi.advanceTimersByTime(400);
      fireEvent.pointerUp(window, { pointerId: 3, clientX: 150, clientY: 80 });
      expect(f.mock.calls.some(([u]: any[]) => String(u).includes('/reschedule'))).toBe(false);
      // hold 350ms → drag activates → move → commit
      fireEvent.pointerDown(card, { pointerId: 4, pointerType: 'touch', clientX: 150, clientY: 51 });
      vi.advanceTimersByTime(360);
      fireEvent.pointerMove(window, { pointerId: 4, clientX: 150, clientY: 102 });
      fireEvent.pointerUp(window, { pointerId: 4, clientX: 150, clientY: 102 });
      expect(f.mock.calls.some(([u, init]: any[]) => String(u).includes('/appointments/a1/reschedule') && init?.method === 'POST')).toBe(true);
    } finally { vi.useRealTimers(); }
  });
});

describe('§10 full-screen View All Techs — assistant slide-over and close/restore', () => {
  it('opens full screen, exposes the Booking Assistant slide-over, and Escape closes back', async () => {
    globalThis.fetch = routedFetch() as any;
    render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByText('View All Techs ⤢'));
    expect(screen.getByLabelText('Close full-screen calendar')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Booking Assistant', { selector: 'button' }));
    expect(screen.getByRole('dialog', { name: 'Booking Assistant' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByLabelText('Close full-screen calendar')).not.toBeInTheDocument();
    expect(screen.getByText('View All Techs ⤢')).toBeInTheDocument();   // standard mode restored
  });
});

describe('§9 single-technician full screen — Block time workflow', () => {
  it('header click opens the tech day; Block time form POSTs to /blocked-times', async () => {
    const f = routedFetch();
    globalThis.fetch = f as any;
    render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByTitle("Open Mia's full day"));
    expect(await screen.findByLabelText("Full-day schedule for Mia")).toBeInTheDocument();
    fireEvent.click(screen.getByText('Block time'));
    fireEvent.change(screen.getByLabelText('Block start'), { target: { value: '14:00' } });
    fireEvent.change(screen.getByLabelText('Block end'), { target: { value: '15:00' } });
    fireEvent.change(screen.getByLabelText('Block reason'), { target: { value: 'training' } });
    fireEvent.click(screen.getByText('Save block'));
    await vi.waitFor(() => {
      const call = f.mock.calls.find(([u, init]: any[]) => String(u).includes('/pos/booking/blocked-times') && init?.method === 'POST');
      expect(call).toBeTruthy();
      const body = JSON.parse((call as any)[1].body);
      expect(body).toMatchObject({ technicianId: 't1', startTime: '14:00', endTime: '15:00', reason: 'training' });
    });
  });
});

// ── 2026-07-03 View-All KPI fix + live open-gap recalculation (spec §1–§9) ──
import { calRecomputeOpenRanges, type CalBusy } from './POSBookingScreen';

describe('§3–§9 calRecomputeOpenRanges (frontend mirror of backend open-range math)', () => {
  const win = [{ start: 540, end: 1080 }]; // 9:00–18:00
  const busy = (s: string, e: string, status = 'booked'): CalBusy => ({ startTime: s, endTime: e, status });
  it('B at 12:00–13:00 → open 11:00–12:00 · 60 min between A(10-11) and B', () => {
    const r = calRecomputeOpenRanges(win, 0, [busy('10:00', '11:00'), busy('12:00', '13:00')]);
    expect(r).toContainEqual({ start: 660, end: 720, minutes: 60 }); // 11:00–12:00
  });
  it('B moved to 11:30 → the gap shrinks to 11:00–11:30 · 30 min', () => {
    const r = calRecomputeOpenRanges(win, 0, [busy('10:00', '11:00'), busy('11:30', '12:30')]);
    expect(r).toContainEqual({ start: 660, end: 690, minutes: 30 }); // 11:00–11:30
  });
  it('B moved to 13:00 → the gap grows to 11:00–13:00 · 120 min', () => {
    const r = calRecomputeOpenRanges(win, 0, [busy('10:00', '11:00'), busy('13:00', '14:00')]);
    expect(r).toContainEqual({ start: 660, end: 780, minutes: 120 }); // 11:00–13:00
  });
  it('vacated period merges with an adjacent open range', () => {
    // one appointment 10:00–11:00; removing it (source tech after a cross-tech move) → one continuous 9–18 range
    expect(calRecomputeOpenRanges(win, 0, [])).toEqual([{ start: 540, end: 1080, minutes: 540 }]);
  });
  it('buffer reduces the open minutes on both sides of an appointment', () => {
    const r = calRecomputeOpenRanges(win, 10, [busy('12:00', '13:00')]);
    expect(r).toContainEqual({ start: 540, end: 710, minutes: 170 }); // 9:00–11:50 (12:00 − 10 buffer)
    expect(r).toContainEqual({ start: 790, end: 1080, minutes: 290 }); // 13:10–18:00
  });
  it('cancelled/no-show appointments do not block (excluded by status)', () => {
    const r = calRecomputeOpenRanges(win, 0, [busy('10:00', '12:00', 'cancelled'), busy('13:00', '15:00', 'no_show')]);
    expect(r).toEqual([{ start: 540, end: 1080, minutes: 540 }]);
  });
  it('same-day past time is clamped out via notBeforeMinute', () => {
    const r = calRecomputeOpenRanges(win, 0, [], 600); // now 10:00
    expect(r).toEqual([{ start: 600, end: 1080, minutes: 480 }]);
  });
});

describe('§1 View All Techs hides the KPI cards (removed from flow, not just visually)', () => {
  it('shows KPI cards on the normal page and removes them in View All Techs', async () => {
    globalThis.fetch = routedFetch() as any;
    render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
    // normal page: KPI labels present
    expect(await screen.findByText('Appointments Today')).toBeInTheDocument();
    expect(screen.getByText('Tech Utilization')).toBeInTheDocument();
    // enter View All Techs
    fireEvent.click(screen.getByText('View All Techs ⤢'));
    // the KPI card labels are gone from the DOM (not merely hidden)
    expect(screen.queryByText('Appointments Today')).not.toBeInTheDocument();
    expect(screen.queryByText('Tech Utilization')).not.toBeInTheDocument();
    // scheduling controls remain available in full screen
    expect(screen.getByLabelText('Technician search')).toBeInTheDocument();
    expect(screen.getByText('Working Today')).toBeInTheDocument();
    expect(screen.getByLabelText('Close full-screen calendar')).toBeInTheDocument();
    // close restores the normal page (KPI cards back)
    fireEvent.click(screen.getByLabelText('Close full-screen calendar'));
    expect(screen.getByText('Appointments Today')).toBeInTheDocument();
  });

  it('the View-All KPI section leaves no empty band (no .kpis element while full screen)', async () => {
    const { container } = render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
    globalThis.fetch = routedFetch() as any;
    await screen.findByText('Booking');
    expect(container.querySelector('.kpis')).toBeTruthy();        // present on the normal page
    fireEvent.click(screen.getByText('View All Techs ⤢'));
    expect(container.querySelector('.kpis')).toBeNull();          // removed entirely in View All Techs
  });
});

describe('§2 View All Techs technician search + Working Today filter the columns', () => {
  it('search narrows the technician columns; Working Today hides off-schedule techs', async () => {
    // grid with two techs: Mia (working) and Zoe (no windows today)
    const g2 = { ...grid, columns: [
      ...grid.columns,
      { technicianId: 't2', name: 'Zoe', available: true, avatarUrl: null, windows: [], blocked: [], openRanges: [], openMinutes: 0, openSlotCount: 0 },
    ] };
    const f2 = { ...gridState, filters: { ...gridState.filters, technicians: [{ technicianId: 't1', name: 'Mia' }, { technicianId: 't2', name: 'Zoe' }] } };
    globalThis.fetch = vi.fn(async (url: any) => {
      const u = String(url);
      const body = u.includes('/day-grid') ? g2 : u.includes('/pos/queue') ? { queue: { items: [] } } : f2;
      return { ok: true, status: 200, json: async () => body, headers: { get: () => null } } as any;
    }) as any;
    render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByText('View All Techs ⤢'));
    // both techs visible in the header initially (avatar+name buttons)
    expect(await screen.findByTitle("Open Mia's full day")).toBeInTheDocument();
    expect(screen.getByTitle("Open Zoe's full day")).toBeInTheDocument();
    // Working Today hides Zoe (no windows)
    fireEvent.click(screen.getByText('Working Today'));
    expect(screen.queryByTitle("Open Zoe's full day")).not.toBeInTheDocument();
    expect(screen.getByTitle("Open Mia's full day")).toBeInTheDocument();
    // clear Working Today, then search "zoe" → only Zoe
    fireEvent.click(screen.getByText('Working Today'));
    fireEvent.change(screen.getByLabelText('Technician search'), { target: { value: 'zoe' } });
    expect(screen.getByTitle("Open Zoe's full day")).toBeInTheDocument();
    expect(screen.queryByTitle("Open Mia's full day")).not.toBeInTheDocument();
  });
});

// ── 2026-07-03 the reference shows the filter row (services/technicians/statuses/sources) at the top of the day
// calendar. Those filters were wired to state but only surfaced in the fullscreen controls / list panel — now
// they're in the main day-view header too. Verify they drive the real state refetch.
describe('POSBookingScreen — calendar header filters drive the state refetch', () => {
  const withFacets = {
    ...state,
    filters: { ...state.filters, statuses: ['confirmed', 'arriving_soon'], sources: ['online', 'walk_in'], technicians: [{ technicianId: 'tA', name: 'Mia Johnson' }], serviceCategories: ['Manicure', 'Pedicure'] },
  };
  const recFetch = () => {
    const calls: string[] = [];
    const fn = vi.fn(async (url: any) => {
      const u = String(url); calls.push(u);
      const ok = (j: any) => ({ ok: true, status: 200, json: async () => j, headers: { get: () => null } } as any);
      if (u.includes('/day-grid')) return ok({ date: '2026-05-06', columns: [], interval: 15 });
      if (u.includes('/pos/queue/state')) return ok({ queue: { items: [] } });
      return ok(withFacets);
    });
    (fn as any).calls = calls;
    return fn;
  };

  it('the calendar status filter refetches state with status=', async () => {
    const f = recFetch(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
    await screen.findByText('Booking');
    fireEvent.change(screen.getByLabelText('Calendar status filter'), { target: { value: 'confirmed' } });
    await vi.waitFor(() => expect((f as any).calls.some((u: string) => u.includes('/pos/booking/state') && u.includes('status=confirmed'))).toBe(true));
  });

  it('the calendar service filter refetches state with serviceCategory=', async () => {
    const f = recFetch(); globalThis.fetch = f as any;
    render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
    await screen.findByText('Booking');
    const sel = screen.getByLabelText('Calendar service filter') as HTMLSelectElement;
    expect(within(sel).getByText('Pedicure')).toBeInTheDocument();
    fireEvent.change(sel, { target: { value: 'Pedicure' } });
    await vi.waitFor(() => expect((f as any).calls.some((u: string) => u.includes('/pos/booking/state') && u.includes('serviceCategory=Pedicure'))).toBe(true));
  });
});

// ── 2026-07-03 the reference shows "New Booking | Walk-in" tabs atop the Booking Assistant. The walk-in tab sets the
// source to walk_in and defaults the date to today, reusing the same wired create form.
describe('POSBookingScreen — Booking Assistant New Booking / Walk-in tabs', () => {
  it('renders both tabs and switching to Walk-in keeps the assistant usable', async () => {
    globalThis.fetch = mockFetch({ ...state, filters: { ...state.filters, technicians: [{ technicianId: 'tA', name: 'Mia Johnson' }], services: [{ serviceId: 'svc1', name: 'Gel', durationMinutes: 45, priceCents: 4500 }] } }) as any;
    render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
    await screen.findByText('Booking');
    const tabs = screen.getAllByRole('tab');
    const newTab = tabs.find((t) => /New Booking/.test(t.textContent || ''))!;
    const walkTab = tabs.find((t) => /Walk-in/i.test(t.textContent || ''))!;
    expect(newTab).toBeTruthy();
    expect(walkTab).toBeTruthy();
    // New Booking is selected by default
    expect(newTab.getAttribute('aria-selected')).toBe('true');
    // switch to Walk-in
    fireEvent.click(walkTab);
    expect(walkTab.getAttribute('aria-selected')).toBe('true');
    // the create form (customer name) is still present in walk-in mode
    expect(screen.getByPlaceholderText('Customer name *')).toBeInTheDocument();
  });

  it('Smooth Refresh spec §24/§25: a quiet 15 s safety tick asks only the change feed; a change reloads the board; RESYNC_REQUIRED reloads it too', async () => {
    vi.useFakeTimers();
    const rand = vi.spyOn(Math, 'random').mockReturnValue(0.5);   // exactly 15 s
    let feed: any = { appointments: [], cursor: 'v1.c0', serverTime: '2026-06-07T10:00:00Z' };
    let feedStatus = 200;
    const urls: string[] = [];
    globalThis.fetch = vi.fn(async (u: any) => {
      const url = String(u); urls.push(url);
      if (url.includes('/pos/booking/changes')) {
        if (feedStatus === 409) return { ok: false, status: 409, json: async () => ({ code: 'RESYNC_REQUIRED', message: 'reload' }), headers: { get: () => null } } as any;
        return { ok: true, status: 200, json: async () => feed, headers: { get: () => null } } as any;
      }
      return { ok: true, status: 200, json: async () => state, headers: { get: () => null } } as any;
    }) as any;
    const { syncStatus } = await import('../realtime/useRealtime');
    syncStatus.reset();
    render(<MemoryRouter><POSBookingScreen /></MemoryRouter>);
    const tick = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(15_000); }); };
    const stateCalls = () => urls.filter((x) => x.includes('/pos/booking/state')).length;
    await tick();                                     // first tick: full reload + baseline cursor
    const afterBaseline = stateCalls();
    expect(urls.some((x) => x.includes('/pos/booking/changes'))).toBe(true);
    await tick();                                     // quiet tick: feed only
    expect(stateCalls()).toBe(afterBaseline);
    expect(urls.filter((x) => x.includes('/changes?since=')).length).toBeGreaterThanOrEqual(1);
    feed = { appointments: [{ appointmentId: 'a1' }], cursor: 'v1.c1', serverTime: '2026-06-07T10:00:30Z' };
    await tick();                                     // something changed → board reloads
    expect(stateCalls()).toBe(afterBaseline + 1);
    feed = { appointments: [], cursor: 'v1.c2', serverTime: '2026-06-07T10:00:45Z' }; feedStatus = 409;
    await tick();                                     // RESYNC_REQUIRED → snapshot again (no page reload)
    expect(stateCalls()).toBe(afterBaseline + 2);
    // §100: every feed tick reported what it downloaded and how many records had changed; the resync was counted.
    const pay = syncStatus.snapshot().payload;
    expect(pay.samples).toBeGreaterThanOrEqual(2);
    expect(pay.recordsChangedTotal).toBe(1);                 // the one tick where a1 changed
    expect(pay.emptyTicks).toBeGreaterThanOrEqual(1);         // the quiet tick
    expect(pay.bytesMax).toBeGreaterThan(pay.bytesP50 > 0 ? 0 : -1);
    expect(pay.bytesTotal).toBeGreaterThan(0);
    expect(pay.resyncs).toBe(1);
    rand.mockRestore(); vi.useRealTimers();
  });
});
