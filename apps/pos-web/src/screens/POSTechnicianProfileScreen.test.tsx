// POSTechnicianProfileScreen — Technician Profile mandate §8/§9/§10/§141: the page shows the SIX separate statuses,
// compact overview cards, hides pay without technicians.view_pay, and opens the detailed modules on demand.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const h = vi.hoisted(() => ({
  detail: vi.fn(), techProfile: vi.fn(), employmentHistory: vi.fn(), state: vi.fn(), appointments: vi.fn(), queueState: vi.fn(), perms: ['pos.technicians.view', 'technicians.view_pay'] as string[],
}));
vi.mock('../api/posTechniciansApi', () => ({ posTechniciansApi: { detail: h.detail, techProfile: h.techProfile, employmentHistory: h.employmentHistory, permissions: vi.fn(async () => ({ matrix: [] })), appAccess: vi.fn(async () => ({})), skills: vi.fn(async () => ({ skillGroups: [] })), commission: vi.fn(async () => ({})), commissionHistory: vi.fn(async () => []), profileRatings: vi.fn(async () => ({ ratings: [] })) } }));
vi.mock('../api/posWorkforceApi', () => ({ posWorkforceApi: { state: h.state, timeOff: vi.fn(async () => []), certifications: vi.fn(async () => []) } }));
vi.mock('../api/posTechAppointmentsApi', () => ({ posTechAppointmentsApi: { appointments: h.appointments } }));
vi.mock('../api/posTechQueueApi', () => ({ posTechQueueApi: { state: h.queueState } }));
vi.mock('../realtime/useRealtime', () => ({ useRealtime: () => undefined }));
vi.mock('../components/usePermissions', () => ({ useCan: () => (p: string) => h.perms.includes(p) }));
import { POSTechnicianProfileScreen } from './POSTechnicianProfileScreen';

const detail = {
  technicianId: 't1', displayName: 'Lisa Tran', role: 'Senior Technician', status: 'active', branchId: 'b1', phone: '856-555-0101', email: 'lisa@x.com', techAppEnabled: true,
  skillGroups: ['Gel', 'Acrylic'], servicesCount: 6, todaySalesCents: 42000, todayTipsCents: 6500, rating: 4.8, createdAt: '2026-01-05T00:00:00Z',
  schedule: { weekly: { monday: { isWorking: true, startTime: '09:00', endTime: '17:00', lunchStart: '12:00', lunchEnd: '12:30' } }, unavailableDates: [] },
  shift: { shiftStatus: 'on_shift', onBreak: false }, skills: { skillGroups: ['Gel', 'Acrylic'] }, services: { serviceIds: ['s1'] },
  commission: { defaultPercent: 55, byService: [], byCategory: [], tipHandling: 'keep', payrollPeriod: 'weekly' },
  payroll: { periodLabel: 'This week', salesCents: 120000, tipsCents: 15000, commissionCents: 66000, estimatedTodayCents: 23100, closed: false },
  appAccess: { enabled: true, allowedBranches: ['b1', 'b2'] }, permissions: { matrix: [] },
  auditSummary: [{ lastAction: 'pos_technician_updated', lastActorRole: 'MANAGER', lastAt: '2026-10-01T10:00:00Z' }],
};
const wf = { tenantId: 'x', branchId: 'b1', technicianId: 't1', employment: 'active', clock: 'CLOCKED_IN', shift: 'ON_SHIFT', queue: 'SERVING', service: 'SERVING', presence: 'offline', currentTicketId: 'tk1', manualUnavailable: false, openShiftId: 'sh1', breakStartedAt: null, updatedAt: '', version: 3 };

const mount = () => render(<MemoryRouter initialEntries={['/technicians/t1']}><Routes><Route path="/technicians/:technicianId" element={<POSTechnicianProfileScreen />} /></Routes></MemoryRouter>);

beforeEach(() => {
  h.perms = ['pos.technicians.view', 'technicians.view_pay'];
  h.detail.mockReset().mockResolvedValue(detail);
  h.techProfile.mockReset().mockResolvedValue({ hasProfile: true, membershipHereStatus: 'active', profile: { displayName: 'Lisa Tran', title: 'Nail Artist', overallRating: 4.8, ratingCount: 31, completionPercent: 90, publicProfileStatus: 'PUBLIC' }, photos: [] });
  h.employmentHistory.mockReset().mockResolvedValue({ technicianId: 't1', events: [{ id: 'e1', type: 'hired', label: 'Hired', occurredAt: '2026-01-05T00:00:00Z', endsAt: null, branchId: 'b1', branchName: 'Main', from: null, to: 'Technician', reason: null, actorName: 'Kim' }] });
  h.state.mockReset().mockResolvedValue(wf);
  h.appointments.mockReset().mockResolvedValue([{ appointmentId: 'a1', startTime: '2099-01-01T15:00:00Z', endTime: '2099-01-01T16:00:00Z', customerName: 'Sophia', services: [{ serviceName: 'Gel Manicure' }], status: 'confirmed' }]);
  h.queueState.mockReset().mockResolvedValue({ technicianRows: [{ technicianId: 't1', technicianName: 'Lisa Tran', status: 'in_service', currentServiceName: 'Gel Manicure', currentServiceCustomer: 'Sophia', nextAvailableLabel: '3:45 PM', utilizationPercent: 72, tipsTodayCents: 0, revenueTodayCents: 0 }] });
});

describe('POSTechnicianProfileScreen', () => {
  it('shows the six statuses separately (§10) and the overview cards (§9)', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: 'Lisa Tran' })).toBeInTheDocument();
    const status = await screen.findByLabelText('Operational status');
    for (const t of ['Active', 'Clocked in', 'On shift', 'Serving', 'App offline']) expect(status).toHaveTextContent(t);
    expect(status.querySelectorAll('.pill').length).toBe(6);
    const overview = screen.getByLabelText('Overview');
    expect(overview).toHaveTextContent('Sophia');           // current customer
    expect(overview).toHaveTextContent('Gel Manicure');
    expect(overview).toHaveTextContent('4.8★');
    expect(overview).toHaveTextContent('$420.00');          // today's revenue (view_pay held)
    expect(overview).toHaveTextContent('$65.00');
  });

  it('hides pay cards and the pay section without technicians.view_pay (§72/§122)', async () => {
    h.perms = ['pos.technicians.view'];
    mount();
    await screen.findByRole('heading', { name: 'Lisa Tran' });
    expect(screen.queryByText("Today's revenue")).toBeNull();
    expect(screen.queryByText('Commission · Tips · Earnings')).toBeNull();
    expect(screen.getByRole('button', { name: /Employment$/ })).toBeInTheDocument();
  });

  it('opens the Employment section with this salon\'s history (§128) and the appointments module', async () => {
    mount();
    await screen.findByRole('heading', { name: 'Lisa Tran' });
    fireEvent.click(screen.getByRole('button', { name: /Employment$/ }));
    expect(await screen.findByText('Hired')).toBeInTheDocument();
    expect(screen.getByText(/as Technician/)).toBeInTheDocument();
    await waitFor(() => expect(h.employmentHistory).toHaveBeenCalledWith('t1'));
    fireEvent.click(screen.getByRole('button', { name: /Appointments today \(1\)/ }));
    expect(await screen.findByText('Confirmed')).toBeInTheDocument();   // the status label (ns/status), not the raw code
  });

  it('shows an honest error when the technician cannot be loaded', async () => {
    h.detail.mockRejectedValue(new Error('Technician not found'));
    mount();
    expect(await screen.findByText('Technician not found')).toBeInTheDocument();
    expect(screen.getByText('Back to technicians')).toBeInTheDocument();
  });
});
