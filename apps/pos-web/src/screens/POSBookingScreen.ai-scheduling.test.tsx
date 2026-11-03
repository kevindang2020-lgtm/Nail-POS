// POSBookingScreen.ai-scheduling.test.tsx — BUILD_PLAN Phase 7 (ai_scheduling_optimizer → complete), booking calendar:
//  • the LLM "Optimize schedule" AiAssistantPanel is GONE (it sent a free-text prompt with no schedule data to the
//    generic assistant — a parallel "optimizer" the spec forbids); a link to the real optimizer replaces it.
//  • indicators from GET /pos/ai-scheduling-optimizer/calendar?date=: gap strips per technician, a conflict badge,
//    a badge on appointments with an open recommendation (click → the optimizer's detail), a lock icon.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

const perms = { deny: new Set<string>() };
vi.mock('../components/usePermissions', () => ({ useCan: () => (p: string) => !perms.deny.has(p) }));

import { POSBookingScreen } from './POSBookingScreen';

const state = {
  kpis: { totalBookingsToday: 2, confirmedBookings: 2, checkedInBookings: 0, waitingBookings: 0, inServiceBookings: 0, completedBookings: 0, cancelledBookings: 0, noShowBookings: 0, onlineBookings: 0, googleBookings: 0, aiBookings: 0, conflictCount: 0, depositsCollectedCents: 0 },
  dateRange: { from: '2026-06-07', to: '2026-06-07', timezone: 'America/New_York' },
  bookings: { items: [
    { appointmentId: 'a1', customerName: 'Grace Kim', technicianId: 't1', technicianName: 'Mia', services: [{ serviceName: 'Signature Manicure' }], source: 'online', startTime: '10:00', endTime: '10:45', durationMinutes: 45, status: 'confirmed' },
    { appointmentId: 'a2', customerName: 'Ann Lee', technicianId: 't1', technicianName: 'Mia', services: [{ serviceName: 'Pedicure' }], source: 'walk_in', startTime: '12:00', endTime: '12:45', durationMinutes: 45, status: 'confirmed' },
  ], pagination: { totalItems: 2 } },
  filters: { statuses: [], sources: [], technicians: [{ technicianId: 't1', name: 'Mia' }], services: [], serviceCategories: [], branches: [] },
  integrationStatus: {}, settings: { openTime: '09:00', closeTime: '18:00' },
};
const grid = { date: '2026-06-07', openTime: '09:00', closeTime: '18:00', slotIntervalMinutes: 15, bufferMinutes: 0, defaultServiceDurationMinutes: 30, totalOpenSlots: 0, appointments: state.bookings.items as any[],
  columns: [{ technicianId: 't1', name: 'Mia', available: true, windows: [{ start: 540, end: 1080 }], blocked: [], openRanges: [], openMinutes: 0, openSlotCount: 0 }] };
const indicators = {
  date: '2026-06-07',
  gaps: [{ id: 'g1', technicianId: 't1', date: '2026-06-07', startTime: '10:45', endTime: '12:00', durationMin: 75, cause: null, servicesThatFit: ['Gel Manicure'] }],
  conflicts: [{ id: 'c1', type: 'double_booking', severity: 'critical', appointmentIds: ['a2'], technicianId: 't1', date: '2026-06-07', message: 'Mia is double-booked at noon', resolved: false }],
  appointments: { a1: { recommendationId: 'r1', status: 'review_required', type: 'move_appointment', locked: false }, a2: { recommendationId: 'r2', status: 'accepted', type: 'fill_gap', locked: true } },
  utilizationPct: 64,
};
let calls: string[];
const install = (opts: { pkgs?: boolean; calendarStatus?: number } = {}) => {
  calls = [];
  globalThis.fetch = vi.fn(async (url: any) => {
    const u = String(url); calls.push(u);
    const status = u.includes('/ai-scheduling-optimizer/calendar') ? (opts.calendarStatus ?? 200) : 200;
    const body = u.includes('/day-grid') ? grid
      : u.includes('/ai-scheduling-optimizer/calendar') ? (status === 200 ? indicators : { code: 'FORBIDDEN' })
        : u.includes('/tenant/ai/packages') ? { packages: opts.pkgs ? [{ code: 'ai_scheduling_optimizer', accessible: true }, { code: 'ai_booking_assistant', accessible: true }] : [] }
          : u.includes('/pos/queue') ? { queue: { items: [] } } : state;
    return { ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body), headers: { get: () => null } } as any;
  }) as any;
};
function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname + l.search}</div>; }
const renderIt = () => render(
  <MemoryRouter initialEntries={['/booking']}>
    <Routes>
      <Route path="/booking" element={<POSBookingScreen />} />
      <Route path="*" element={<Where />} />
    </Routes>
  </MemoryRouter>,
);

beforeEach(() => { perms.deny = new Set(); });

describe('Booking calendar — the LLM "Optimize schedule" button is replaced by the real optimizer', () => {
  it('no LLM panel (neither the optimizer nor "Booking help", Nov 3 audit) even when the packages are active; a link to the optimizer instead', async () => {
    install({ pkgs: true });
    renderIt();
    await screen.findByText('Booking');
    await screen.findByRole('link', { name: /AI Scheduling Optimizer/ });
    expect(screen.queryByTestId('ai-panel-ai_booking_assistant')).toBeNull();   // asked the model for slots with no schedule data
    expect(screen.queryByTestId('ai-panel-ai_scheduling_optimizer')).toBeNull();
    expect(screen.queryByText('Optimize schedule')).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: /AI Scheduling Optimizer/ }));
    expect(screen.getByTestId('where').textContent).toBe('/tenant/ai/scheduling-optimizer');
  });
});

describe('Booking calendar — optimizer indicators (GET calendar?date=)', () => {
  it('asks for the shown date, draws gap strips, a conflict badge, recommendation badges and a lock icon', async () => {
    install();
    const { container } = renderIt();
    await screen.findAllByText('Grace Kim');
    await waitFor(() => expect(calls.some((u) => u.includes('/pos/ai-scheduling-optimizer/calendar?date=2026-06-07'))).toBe(true));
    await waitFor(() => expect(container.querySelector('[data-sched-gap="g1"]')).not.toBeNull());
    expect(container.querySelector('[data-sched-gap="g1"]')!.getAttribute('title')).toMatch(/75 min unused.*Gel Manicure/);
    expect(screen.getByTestId('sched-conflict-badge').textContent).toMatch(/1 conflict/);
    expect(screen.getByTestId('sched-rec-badge-a1')).toBeInTheDocument();
    expect(screen.getByTestId('sched-rec-badge-a2')).toBeInTheDocument();
    expect(screen.getByTestId('sched-lock-a2')).toBeInTheDocument();
    expect(screen.queryByTestId('sched-lock-a1')).toBeNull();
    expect(container.querySelector('[data-appt="a2"]')!.getAttribute('data-sched-conflict')).toBe('critical');
  });

  it('a recommendation badge opens that recommendation in the optimizer', async () => {
    install();
    renderIt();
    fireEvent.click(await screen.findByTestId('sched-rec-badge-a1'));
    expect(screen.getByTestId('where').textContent).toBe('/tenant/ai/scheduling-optimizer?rec=r1');
  });

  it('without ai_scheduling.view no indicators are requested; a refused request draws nothing', async () => {
    perms.deny = new Set(['ai_scheduling.view']);
    install();
    renderIt();
    await screen.findAllByText('Grace Kim');
    expect(calls.some((u) => u.includes('/ai-scheduling-optimizer/calendar'))).toBe(false);
    perms.deny = new Set();
  });

  it('a 403 / 402 from the calendar route leaves the board untouched', async () => {
    install({ calendarStatus: 402 });
    renderIt();
    await screen.findAllByText('Grace Kim');
    await waitFor(() => expect(calls.some((u) => u.includes('/ai-scheduling-optimizer/calendar'))).toBe(true));
    expect(screen.queryByTestId('sched-rec-badge-a1')).toBeNull();
    expect(screen.queryByTestId('sched-conflict-badge')).toBeNull();
  });
});
