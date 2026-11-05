import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { POSLiveTechnicianScheduleScreen } from './POSLiveTechnicianScheduleScreen';

const empty = {
  kpis: { workingToday: 0, availableNow: 0, inService: 0, onBreakOrLunch: 0, bookedHours: 0, utilizationPercent: 0 },
  schedule: { date: '2026-06-08', timeRange: { startTime: '09:00', endTime: '19:00', slotMinutes: 30 }, technicians: [] },
  filters: { statuses: [{ label: 'Available', value: 'available' }], skills: [], technicians: [] },
};
const withTech = {
  ...empty,
  kpis: { workingToday: 1, availableNow: 0, inService: 1, onBreakOrLunch: 0, bookedHours: 1, utilizationPercent: 13 },
  schedule: { date: '2026-06-08', timeRange: { startTime: '09:00', endTime: '19:00', slotMinutes: 30 }, technicians: [
    { technicianId: 't1', fullName: 'Tina Tran', initials: 'TT', roleLabel: 'Senior Technician', status: 'in_service', shift: { startTime: '09:00', endTime: '17:00' }, skills: ['Manicure'], appointments: [{ appointmentId: 'a1', customerName: 'Sophia Nguyen', customerInitials: 'SN', serviceSummary: 'Gel Manicure', startTime: '10:00', endTime: '11:00', status: 'in_service', source: 'walk_in' }], openSlots: [{ slotId: 't1:660', startTime: '11:00', endTime: '12:00', durationMinutes: 60, reason: 'schedule_open' }], bookedHours: 1, utilizationPercent: 13 },
  ] },
};
const mockFetch = (s: unknown) => vi.fn(async () => ({ ok: true, status: 200, json: async () => s, headers: { get: () => null } } as any));
beforeEach(() => { vi.restoreAllMocks(); });

import { MemoryRouter } from 'react-router-dom';

describe('POSLiveTechnicianScheduleScreen', () => {
  it('mounts + renders the empty state when no technicians', async () => {
    globalThis.fetch = mockFetch(empty) as any;
    render(<MemoryRouter><POSLiveTechnicianScheduleScreen /></MemoryRouter>);
    expect(await screen.findByText('Live Technician Schedule')).toBeInTheDocument();
    expect(await screen.findByText('No technicians scheduled today')).toBeInTheDocument();
  });
  it('renders KPI values + a technician column from backend data', async () => {
    globalThis.fetch = mockFetch(withTech) as any;
    render(<MemoryRouter><POSLiveTechnicianScheduleScreen /></MemoryRouter>);
    expect(await screen.findByText('Tina Tran')).toBeInTheDocument();
    expect(await screen.findByText('Sophia Nguyen')).toBeInTheDocument();
    expect(screen.getAllByText('In Service').length).toBeGreaterThan(0); // KPI label + status badge
  });
  // merge Oct 12 (other chat): the Week toggle is live — GET /live-schedule/week, technicians × 7 days; a day opens Day view
  it('Week view: loads the week, shows shift / Off per day, and a day header opens that day', async () => {
    const day = (date: string, onShift: boolean) => ({ date, board: { date, branchId: 'b', timeRange: withTech.schedule.timeRange, technicians: [{ ...withTech.schedule.technicians[0], shift: onShift ? { startTime: '09:00', endTime: '17:00' } : undefined }] } });
    const urls: string[] = [];
    globalThis.fetch = vi.fn(async (url: any) => {
      urls.push(String(url));
      const body = String(url).includes('/live-schedule/week') ? { weekStart: '2026-06-08', days: ['2026-06-08', '2026-06-09', '2026-06-10', '2026-06-11', '2026-06-12', '2026-06-13', '2026-06-14'].map((d, i) => day(d, i < 5)) } : withTech;
      return { ok: true, status: 200, json: async () => body, headers: { get: () => null } } as any;
    }) as any;
    render(<MemoryRouter><POSLiveTechnicianScheduleScreen /></MemoryRouter>);
    await screen.findByText('Sophia Nguyen');
    expect(urls.some((u) => u.includes('/live-schedule/week'))).toBe(false);   // Day view never asks for the week
    fireEvent.click(screen.getByRole('button', { name: 'Week' }));
    expect(await screen.findByLabelText('Week schedule')).toBeInTheDocument();
    expect(urls.some((u) => u.includes('/live-schedule/week'))).toBe(true);
    expect(screen.getAllByText('Off')).toHaveLength(2);           // Sat + Sun
    expect(screen.getAllByText('9:00 AM–5:00 PM')).toHaveLength(5);
    fireEvent.click(screen.getByText('Wed, 6/10'));
    await waitFor(() => expect(screen.queryByLabelText('Week schedule')).toBeNull());
    await waitFor(() => expect(urls.some((u) => u.includes('/live-schedule/state') && u.includes('date=2026-06-10'))).toBe(true));
  });
});
