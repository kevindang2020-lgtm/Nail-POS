import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { POSTechAppointmentsScreen } from './POSTechAppointmentsScreen';
import { REALTIME_EVENT } from '../realtime/realtime-client';

const state = {
  kpis: { totalAppointmentsToday: 0, bookedAppointments: 0, checkedInAppointments: 0, inServiceAppointments: 0, completedAppointments: 0, cancelledAppointments: 0, noShowAppointments: 0, onlineBookings: 0, aiBookings: 0, googleBookings: 0, conflictCount: 0 },
  date: '2026-06-07', technicians: [], appointments: [],
  filters: { statuses: [], sources: [], serviceCategories: [], technicians: [], branches: [] },
};
const mockFetch = (s: unknown) => vi.fn(async () => ({ ok: true, status: 200, json: async () => s, headers: { get: () => null } } as any));
beforeEach(() => { vi.restoreAllMocks(); });

describe('POSTechAppointmentsScreen', () => {
  it('mounts and renders the tech-appointments board + empty state', async () => {
    globalThis.fetch = mockFetch(state) as any;
    render(<POSTechAppointmentsScreen />);
    expect(await screen.findByText('Tech Appointments')).toBeInTheDocument();
    expect(screen.getByText('No technicians scheduled.')).toBeInTheDocument();
  });
  // merge Oct 12 (other chat, Booking Concurrency §12/§15): assign / reschedule echo the row's version; a 409 shows the
  // race message (not the raw server text) and refetches so the board shows the server's truth.
  it('assign sends expectedVersion; a VERSION_CONFLICT shows the race message and reloads the board', async () => {
    const st = { ...state, technicians: [{ technicianId: 't1', displayName: 'Mia', workingStatus: 'available', appointmentCount: 1, scheduledMinutes: 60, availableMinutes: 420, serviceSkillGroups: [] }],
      appointments: [{ appointmentId: 'a1', technicianId: 't1', customerName: 'Grace', source: 'online', services: [{ serviceName: 'Gel' }], startTime: '2026-06-07T15:00:00Z', endTime: '2026-06-07T16:00:00Z', durationMinutes: 60, status: 'booked', version: 4 }],
      filters: { ...state.filters, technicians: [{ technicianId: 't2', name: 'Leo' }] } };
    const calls: { url: string; init?: any }[] = [];
    const page = { date: '2026-06-07', technicians: [{ technicianId: 't2', name: 'Leo', rosterNumber: 2, workingToday: true }], total: 1, totalAll: 2, workingCount: 2, page: 1, pageSize: 12, totalPages: 1 };
    globalThis.fetch = vi.fn(async (url: any, init?: any) => {
      calls.push({ url: String(url), init });
      if (String(url).includes('/assign-technician')) return { ok: false, status: 409, json: async () => ({ message: 'stale', code: 'VERSION_CONFLICT', currentVersion: 5 }), headers: { get: () => null } } as any;
      if (String(url).includes('/pos/booking/technicians')) return { ok: true, status: 200, json: async () => page, headers: { get: () => null } } as any;
      return { ok: true, status: 200, json: async () => st, headers: { get: () => null } } as any;
    }) as any;
    render(<POSTechAppointmentsScreen />);
    fireEvent.click(await screen.findByText('Manage'));
    // 200-technician §2: Assign picks through the server-paged picker (the board never loads the roster)
    fireEvent.click(screen.getByLabelText('Choose technician…'));
    fireEvent.click(await screen.findByRole('option', { name: /Leo/ }));
    fireEvent.click(screen.getByText('Assign'));
    await waitFor(() => expect(screen.getByText(/just booked or changed on another device/)).toBeInTheDocument());
    const assign = calls.find((c) => c.url.includes('/assign-technician'))!;
    expect(JSON.parse(assign.init.body)).toMatchObject({ technicianId: 't2', expectedVersion: 4 });
    expect(calls.filter((c) => c.url.includes('/state')).length).toBeGreaterThanOrEqual(2);   // refetched after the 409
  });
  // Wave 3 (Oct 13 2026, Smooth Refresh §17/§20): this board had NO sync hook — another device's booking reached it only on
  // a manual reload — and a failed background refresh replaced the whole board with the error.
  it('an appointment event on another device refetches the board in place; a failed refresh keeps the rows and the open drawer', async () => {
    const st = { ...state, technicians: [{ technicianId: 't1', displayName: 'Mia', workingStatus: 'available', appointmentCount: 1, scheduledMinutes: 60, availableMinutes: 420, serviceSkillGroups: [] }],
      appointments: [{ appointmentId: 'a1', technicianId: 't1', customerName: 'Grace', source: 'online', services: [{ serviceName: 'Gel' }], startTime: '2026-06-07T15:00:00Z', endTime: '2026-06-07T16:00:00Z', durationMinutes: 60, status: 'booked', version: 4 }],
      filters: { ...state.filters, technicians: [{ technicianId: 't2', name: 'Leo' }] } };
    let stateCalls = 0; let fail = false;
    globalThis.fetch = vi.fn(async (url: any) => {
      if (String(url).includes('/state')) { stateCalls++; if (fail) return { ok: false, status: 500, json: async () => ({ message: 'boom' }), headers: { get: () => null } } as any; }
      return { ok: true, status: 200, json: async () => st, headers: { get: () => null } } as any;
    }) as any;
    render(<POSTechAppointmentsScreen />);
    fireEvent.click(await screen.findByText('Manage'));
    expect(screen.getByText('Assign')).toBeInTheDocument();          // the drawer is open
    const before = stateCalls;
    await act(async () => { window.dispatchEvent(new CustomEvent(REALTIME_EVENT, { detail: { event: 'appointment_created', screens: ['tech-appointments'] } })); await new Promise((r) => setTimeout(r, 400)); });
    expect(stateCalls).toBeGreaterThan(before);                       // the event refetched
    fail = true;
    await act(async () => { window.dispatchEvent(new CustomEvent(REALTIME_EVENT, { detail: { event: 'appointment_updated', screens: ['tech-appointments'] } })); await new Promise((r) => setTimeout(r, 400)); });
    expect(screen.getByText('Grace')).toBeInTheDocument();            // rows survive the failed refresh
    expect(screen.getByText('Assign')).toBeInTheDocument();           // the drawer survives it
  });
  // developer merge (Oct 2026): the server keeps start_time as a time of day and RESCHEDULE takes HH:MM + date — the drawer
  // opens on the appointment's own date/time and sends HH:MM (it used to send an ISO instant the API's 16-char field refuses).
  it('reschedule opens on the appointment date/time and posts startTime as HH:MM with the date', async () => {
    const st = { ...state, technicians: [{ technicianId: 't1', displayName: 'Mia', workingStatus: 'available', appointmentCount: 1, scheduledMinutes: 60, availableMinutes: 420, serviceSkillGroups: [] }],
      appointments: [{ appointmentId: 'a1', technicianId: 't1', customerName: 'Grace', source: 'online', services: [{ serviceName: 'Gel' }], date: '2026-06-07', startTime: '15:00:00', endTime: '16:00:00', durationMinutes: 60, status: 'booked', version: 4 }] };
    const calls: { url: string; init?: any }[] = [];
    globalThis.fetch = vi.fn(async (url: any, init?: any) => { calls.push({ url: String(url), init }); return { ok: true, status: 200, json: async () => st, headers: { get: () => null } } as any; }) as any;
    const { container } = render(<POSTechAppointmentsScreen />);
    fireEvent.click(await screen.findByText('Manage'));
    const when = container.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    expect(when.value).toBe('2026-06-07T15:00');
    fireEvent.change(when, { target: { value: '2026-06-08T10:30' } });
    fireEvent.click(screen.getByText('Reschedule'));
    await waitFor(() => expect(calls.some((c) => c.url.includes('/reschedule'))).toBe(true));
    expect(JSON.parse(calls.find((c) => c.url.includes('/reschedule'))!.init.body)).toMatchObject({ startTime: '10:30', date: '2026-06-08', expectedVersion: 4 });
  });
});
