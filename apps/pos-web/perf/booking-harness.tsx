// booking-harness.tsx — REAL-BROWSER profiling of the Booking board (Smooth Refresh spec §53/§54). Not shipped: lives
// outside src/, built only by vite.perf.config.ts. Renders the real POSBookingScreen with production React + React's
// profiling build, against a fixture server (12 technicians, 60 appointments), and exposes window.__perf so the
// Playwright driver can fire background refreshes in which exactly ONE appointment changes and read back:
//   • React commit durations per refresh (<Profiler onRender>, actualDuration = render work, baseDuration = full tree)
//   • which technician columns had ANY DOM mutation (MutationObserver per [data-cal-col])
import React, { Profiler } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { POSBookingScreen } from '../src/screens/POSBookingScreen';
import { REALTIME_EVENT } from '../src/realtime/realtime-client';

const TECHS = Array.from({ length: 12 }, (_, i) => ({ technicianId: `t${i}`, name: `Technician ${String.fromCharCode(65 + i)}` }));
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
let revision = 0;
function appointments() {
  // 5 per technician, 45 min each from 09:00 with gaps; appointment 0 (tech A) moves 15 min each revision.
  return TECHS.flatMap((t, ti) => Array.from({ length: 5 }, (_, k) => {
    const idx = ti * 5 + k; const start = 540 + k * 90 + (idx === 0 ? (revision % 4) * 15 : 0);
    return { appointmentId: `ap${idx}`, customerName: `Guest ${idx}`, customerPhone: '', isVip: idx % 7 === 0, technicianId: t.technicianId, technicianName: t.name,
      services: [{ serviceName: 'Gel Manicure' }], source: 'manual', date: '2026-10-01', startTime: hhmm(start), endTime: hhmm(start + 45), durationMinutes: 45,
      status: 'booked', depositStatus: 'not_required', conflictStatus: 'none', createdAt: '', updatedAt: '', version: idx === 0 ? 1 + revision : 1 };
  }));
}
const state = () => ({
  kpis: { totalBookingsToday: 60, confirmedBookings: 0, checkedInBookings: 0, waitingBookings: 0, inServiceBookings: 0, completedBookings: 0, cancelledBookings: 0, noShowBookings: 0, onlineBookings: 0, walkInsToday: 0, conflictCount: 0 },
  dateRange: { from: '2026-10-01', to: '2026-10-01', timezone: 'America/New_York' },
  bookings: { items: appointments(), pagination: { totalItems: 60 } },
  filters: { statuses: [], sources: [], technicians: TECHS, services: [], serviceCategories: [], branches: [] },
  integrationStatus: { googleReserveConnected: false, aiPhoneEnabled: false, onlineBookingEnabled: false },
});
const grid = () => ({
  date: '2026-10-01', openTime: '09:00', closeTime: '19:00', slotIntervalMinutes: 15, bufferMinutes: 0, defaultServiceDurationMinutes: 45, totalOpenSlots: 0,
  columns: TECHS.map((t) => ({ ...t, available: true, skills: [], avatarUrl: null, windows: [{ start: 540, end: 1140 }], blocked: [], openRanges: [], openMinutes: 0, openSlotCount: 0 })),
  appointments: [],
});
const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
(window as any).fetch = async (url: string) => {
  const u = String(url);
  if (u.includes('/changes')) return json({ appointments: [], cursor: 'v1.x', serverTime: new Date().toISOString() });
  if (u.includes('/day-grid')) return json(grid());
  if (u.includes('/pos/booking')) return json(state());
  return json({});
};

const commits: { phase: string; actual: number; base: number }[] = [];
const onRender = (_id: string, phase: string, actual: number, base: number) => { commits.push({ phase, actual, base }); };

(window as any).__perf = {
  commits,
  /** Fire one background refresh exactly as the realtime client does, with appointment 0 moved; resolve after commit. */
  async refreshOnce(): Promise<{ commitsMs: number[]; columnsMutated: string[] }> {
    revision++;
    const cols = [...document.querySelectorAll('[data-cal-col]')] as HTMLElement[];
    const touched = new Set<string>();
    const obs = cols.map((el) => { const o = new MutationObserver(() => touched.add(el.getAttribute('data-cal-col')!)); o.observe(el, { subtree: true, childList: true, attributes: true, characterData: true }); return o; });
    const from = commits.length;
    window.dispatchEvent(new CustomEvent(REALTIME_EVENT, { detail: { event: 'appointment_updated', screens: ['booking'] } }));
    await new Promise((r) => setTimeout(r, 600));        // coalescing window (250 ms) + fetch + commit
    obs.forEach((o) => o.disconnect());
    return { commitsMs: commits.slice(from).map((c) => c.actual), columnsMutated: [...touched].sort() };
  },
  columnCount: () => document.querySelectorAll('[data-cal-col]').length,
  appointmentCards: () => document.querySelectorAll('[data-cal-col] button').length,
};

createRoot(document.getElementById('root')!).render(
  <Profiler id="booking" onRender={onRender}><MemoryRouter><POSBookingScreen /></MemoryRouter></Profiler>,
);
