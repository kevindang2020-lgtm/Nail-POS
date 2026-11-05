import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MoveAppointmentModal } from './MoveAppointmentModal';

// §14 dedicated Move Appointment workflow: suggestions come from the real /pos/booking/day-grid response,
// the submit goes through POST …/reschedule with reason + notifyCustomer, and a 409 is surfaced honestly.
const grid = {
  date: '2026-06-07', openTime: '09:00', closeTime: '18:00', slotIntervalMinutes: 15, bufferMinutes: 0,
  defaultServiceDurationMinutes: 30, totalOpenSlots: 8, appointments: [],
  columns: [
    { technicianId: 't1', name: 'Mia', available: true, avatarUrl: null, windows: [{ start: 540, end: 1080 }], blocked: [],
      openRanges: [{ start: 600, end: 660, minutes: 60 }, { start: 720, end: 750, minutes: 30 }], openMinutes: 90, openSlotCount: 8 },
    { technicianId: 't2', name: 'Lily', available: true, avatarUrl: null, windows: [{ start: 540, end: 1080 }], blocked: [],
      openRanges: [{ start: 900, end: 1020, minutes: 120 }], openMinutes: 120, openSlotCount: 6 },
  ],
};
const appt = {
  appointmentId: 'a1', customerName: 'Grace Kim', technicianId: 't1', technicianName: 'Mia',
  services: [{ serviceName: 'Signature Manicure' }], startTime: '2026-06-07T10:00:00', endTime: '2026-06-07T10:45:00',
  durationMinutes: 45, status: 'confirmed',
};
const techs = [{ technicianId: 't1', name: 'Mia' }, { technicianId: 't2', name: 'Lily' }];
const techPage = { date: '2026-06-07', technicians: techs.map((t, i) => ({ ...t, rosterNumber: i + 1, avatarUrl: null, available: true, workingToday: true, skills: [], rating: null, reviewCount: 0 })), total: 2, totalAll: 2, workingCount: 2, page: 1, pageSize: 12, totalPages: 1 };

const okFetch = () => vi.fn(async (url: any, _init?: any) => {
  const u = String(url);
  if (u.includes('/day-grid')) return { ok: true, status: 200, json: async () => grid, headers: { get: () => null } } as any;
  if (u.includes('/reschedule')) return { ok: true, status: 200, json: async () => ({ appointmentId: 'a1' }), headers: { get: () => null } } as any;
  if (u.includes('/booking/technicians')) return { ok: true, status: 200, json: async () => techPage, headers: { get: () => null } } as any;
  return { ok: true, status: 200, json: async () => ({}), headers: { get: () => null } } as any;
});

beforeEach(() => { vi.restoreAllMocks(); });

describe('MoveAppointmentModal', () => {
  it('shows the original slot and only backend ranges long enough for the appointment duration', async () => {
    globalThis.fetch = okFetch() as any;
    render(<MoveAppointmentModal appt={appt as any} technicians={techs} onClose={() => {}} onMoved={() => {}} />);
    expect(await screen.findByText(/Grace Kim/)).toBeInTheDocument();
    // 45-min appointment: the 60-min range is suggested, the 30-min range is not (comes from day-grid, not invented)
    expect(await screen.findByText(/10:00a–11:00a · 60 min/)).toBeInTheDocument();
    expect(screen.queryByText(/12:00p–12:30p · 30 min/)).not.toBeInTheDocument();
  });

  it('clicking a suggested range prefills the time; submit sends reason + notifyCustomer through reschedule', async () => {
    const f = okFetch();
    globalThis.fetch = f as any;
    const onMoved = vi.fn();
    render(<MoveAppointmentModal appt={appt as any} technicians={techs} onClose={() => {}} onMoved={onMoved} />);
    fireEvent.click(await screen.findByText(/10:00a–11:00a · 60 min/));
    fireEvent.change(screen.getByLabelText(/Reason for move/), { target: { value: 'customer request' } });
    fireEvent.click(screen.getByText('Move appointment'));
    await vi.waitFor(() => {
      const call = f.mock.calls.find(([u, init]: any[]) => String(u).includes('/appointments/a1/reschedule') && init?.method === 'POST');
      expect(call).toBeTruthy();
      const body = JSON.parse((call as any)[1].body);
      expect(body).toMatchObject({ startTime: '10:00', reason: 'customer request', notifyCustomer: true });
      expect(onMoved).toHaveBeenCalled();
    });
  });

  it('switching technician re-suggests from that technician\'s real ranges and sends technicianId', async () => {
    const f = okFetch();
    globalThis.fetch = f as any;
    render(<MoveAppointmentModal appt={appt as any} technicians={techs} onClose={() => {}} onMoved={() => {}} />);
    await screen.findByText(/10:00a–11:00a · 60 min/);
    // 200-technician mandate §57: the technician comes from the server-paged picker, not a 200-option <select>
    expect(document.querySelector('select')).toBeNull();
    fireEvent.click(screen.getByTestId('technician-picker-button'));
    fireEvent.click(await screen.findByRole('option', { name: /Lily/ }));
    fireEvent.click(await screen.findByText(/3:00p–5:00p · 120 min/));
    expect(f.mock.calls.some(([u]: any[]) => String(u).includes('/day-grid') && String(u).includes('technicianIds=t2'))).toBe(true);
    fireEvent.click(screen.getByText('Move appointment'));
    await vi.waitFor(() => {
      const call = f.mock.calls.find(([u, init]: any[]) => String(u).includes('/reschedule') && init?.method === 'POST');
      const body = JSON.parse((call as any)[1].body);
      expect(body).toMatchObject({ startTime: '15:00', technicianId: 't2' });
    });
  });

  it('surfaces a 409 conflict from the server instead of pretending the move worked', async () => {
    globalThis.fetch = vi.fn(async (url: any, _init?: any) => {
      const u = String(url);
      if (u.includes('/day-grid')) return { ok: true, status: 200, json: async () => grid, headers: { get: () => null } } as any;
      if (u.includes('/reschedule')) return { ok: false, status: 409, json: async () => ({ message: 'Technician is double-booked at that time' }), headers: { get: () => null } } as any;
      return { ok: true, status: 200, json: async () => ({}), headers: { get: () => null } } as any;
    }) as any;
    render(<MoveAppointmentModal appt={appt as any} technicians={techs} onClose={() => {}} onMoved={() => {}} />);
    fireEvent.click(await screen.findByText(/10:00a–11:00a · 60 min/));
    fireEvent.click(screen.getByText('Move appointment'));
    expect(await screen.findByText(/double-booked/)).toBeInTheDocument();
  });

  // ---- Smooth Refresh / Booking Concurrency spec §11, §12, §14–§16 ----
  const seq = (responses: { status: number; body: any }[]) => {
    const calls: any[] = [];
    const f = vi.fn(async (url: any, init?: any) => {
      const u = String(url);
      if (u.includes('/day-grid')) return { ok: true, status: 200, json: async () => grid, headers: { get: () => null } } as any;
      if (u.includes('/reschedule')) {
        calls.push(JSON.parse(init.body));
        const r = responses[Math.min(calls.length - 1, responses.length - 1)];
        return { ok: r.status < 400, status: r.status, json: async () => r.body, headers: { get: () => null } } as any;
      }
      return { ok: true, status: 200, json: async () => ({}), headers: { get: () => null } } as any;
    });
    return { f, calls };
  };

  it('§14–§16: sends the version it was opened with; a VERSION_CONFLICT shows the spec message and refreshes the schedule behind it', async () => {
    const { f, calls } = seq([{ status: 409, body: { code: 'VERSION_CONFLICT', message: 'changed elsewhere', currentVersion: 4 } }]);
    globalThis.fetch = f as any;
    const onMoved = vi.fn(); const onClose = vi.fn();
    render(<MoveAppointmentModal appt={{ ...appt, version: 3 } as any} technicians={techs} onClose={onClose} onMoved={onMoved} />);
    fireEvent.click(await screen.findByText(/10:00a–11:00a · 60 min/));
    fireEvent.click(screen.getByText('Move appointment'));
    expect(await screen.findByText(/just booked or changed on another device\. The schedule has been refreshed\./)).toBeInTheDocument();
    expect(calls[0]).toMatchObject({ startTime: '10:00', expectedVersion: 3 });
    expect(onMoved).toHaveBeenCalled();          // board refetched to the server's truth
    expect(onClose).not.toHaveBeenCalled();      // the modal stays open with the message (spec §52)
  });

  it('§11: OVERBOOK_CONFIRMATION_REQUIRED asks for a reason; pressing Move again sends the confirmation WITH the reason', async () => {
    const { f, calls } = seq([
      { status: 409, body: { code: 'OVERBOOK_CONFIRMATION_REQUIRED', message: 'Technician is double-booked at that time.' } },
      { status: 200, body: { appointmentId: 'a1' } },
    ]);
    globalThis.fetch = f as any;
    const onClose = vi.fn();
    render(<MoveAppointmentModal appt={appt as any} technicians={techs} onClose={onClose} onMoved={() => {}} />);
    fireEvent.click(await screen.findByText(/10:00a–11:00a · 60 min/));
    fireEvent.click(screen.getByText('Move appointment'));
    expect(await screen.findByText(/Enter the reason below and press Move again to double-book/)).toBeInTheDocument();
    expect(calls[0].overbookConfirmed).toBeUndefined();
    fireEvent.change(screen.getByLabelText(/Reason for move/), { target: { value: 'VIP asked for Mia' } });
    fireEvent.click(screen.getByText('Move appointment'));
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls[1]).toMatchObject({ overbookConfirmed: true, overbookReason: 'VIP asked for Mia' });
  });
});

