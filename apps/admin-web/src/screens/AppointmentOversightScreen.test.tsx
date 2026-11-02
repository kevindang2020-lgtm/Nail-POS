import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../api/superAdminAppointmentOversightApi', () => ({
  fetchAppointmentOversight: vi.fn().mockResolvedValue({
  metadata: { generatedAt: '2026-05-06T00:00:00Z', generatedBy: 'sa' },
  scope: { tenantId: null, label: 'platform' },
  kpis: [
    { key: 'total', label: 'Total Appointments', available: true, value: 12846 },
    { key: 'confirmed', label: 'Confirmed', available: true, value: 8942 },
    { key: 'completed', label: 'Completed', available: true, value: 7264 },
    { key: 'cancelled', label: 'Cancelled', available: true, value: 1248, unfavorableUp: true },
    { key: 'no_shows', label: 'No-Shows', available: true, value: 614, unfavorableUp: true },
    { key: 'duplicates', label: 'Duplicate Appointments', available: true, value: 128, unfavorableUp: true },
    { key: 'overlaps', label: 'Overlapping Appointments', available: true, value: 96, unfavorableUp: true },
    { key: 'failed_bookings', label: 'Failed Bookings', available: false, value: null, unfavorableUp: true },
    { key: 'online_booking_failures', label: 'Online Booking Failures', available: false, value: null, unfavorableUp: true },
    { key: 'ai_created', label: 'AI-Created Appointments', available: true, value: 2146 },
    { key: 'staff_created', label: 'Staff-Created Appointments', available: true, value: 3782 },
    { key: 'rescheduled', label: 'Rescheduled Appointments', available: false, value: null },
    { key: 'sync_failures', label: 'Synchronization Failures', available: false, value: null, unfavorableUp: true },
    { key: 'missing_customer', label: 'Missing Customer Info', available: true, value: 156, unfavorableUp: true },
    { key: 'missing_service', label: 'Missing Service Info', available: false, value: null, unfavorableUp: true },
    { key: 'data_integrity', label: 'Data Integrity Issues', available: false, value: null, unfavorableUp: true },
    { key: 'external_errors', label: 'External Source Errors', available: false, value: null, unfavorableUp: true },
    { key: 'appointment_value', label: 'Total Appointment Value', available: false, value: null, financial: true },
  ],
  trend: { available: true, dates: ['Apr 30', 'May 1'], series: { total: [45, 55], completed: [40, 52], cancelled: [5, 0], noShows: [0, 3] } },
  statusDistribution: { available: true, total: 12846, slices: [{ label: 'Confirmed', value: 8942, pct: 69.6 }, { label: 'Completed', value: 7264, pct: 56.5 }, { label: 'Cancelled', value: 1248, pct: 9.7 }, { label: 'No-Shows', value: 614, pct: 4.8 }, { label: 'Other Issues', value: 418, pct: 3.3 }] },
  sourceDistribution: { available: true, total: 11742, bars: [{ label: 'Online Booking', value: 5642, pct: 48 }, { label: 'AI Receptionist', value: 2146, pct: 18.3 }, { label: 'Staff (Front Desk)', value: 3782, pct: 32.2 }, { label: 'Walk-In Added', value: 172, pct: 1.5 }] },
  recentIssues: { tabs: { all: 380, failedBookings: { available: false, reason: 'x' }, duplicates: { available: true, count: 128 }, overlapping: { available: true, count: 96 }, syncFailures: { available: false, reason: 'x' }, missingInfo: { available: true, count: 156 } }, rows: [] },
  platformSummary: {
    totalTenants: { available: true, value: 2418 }, activeBranches: { available: true, value: 3317 }, activeTechnicians: { available: true, value: 12746 },
    totalCustomers: { available: true, value: 1284741 }, todaysAppointments: { available: true, value: 1248 }, todaysRevenueCents: { available: true, value: 12876400, financial: true },
  },
}),
}));

import { AppointmentOversightScreen } from './AppointmentOversightScreen';

describe('AppointmentOversightScreen — Overview (reference 1:1)', () => {
  it('renders title, subtitle, primary actions, filters, 18 KPIs, charts, issues tabs, quick actions and 6 summary cards', async () => {
    render(<MemoryRouter><AppointmentOversightScreen /></MemoryRouter>);
    expect(await screen.findByText('Appointment Oversight')).toBeInTheDocument();
    expect(screen.getByText('Monitor and support appointments across all tenants and branches.')).toBeInTheDocument();
    expect(screen.getByLabelText('Export Report')).toBeInTheDocument();
    expect(screen.getByLabelText('Add Widget')).toBeInTheDocument();
    // 8 primary filter controls
    for (const f of ['Date Range', 'Branch', 'Tenant', 'Service', 'Technician', 'Source']) expect(screen.getAllByText(f).length).toBeGreaterThan(0);
    expect(screen.getByLabelText('More Filters')).toBeInTheDocument();
    expect(screen.getByLabelText('Refresh')).toBeInTheDocument();
    // 18 KPI labels
    for (const l of ['Total Appointments', 'Confirmed', 'Completed', 'Cancelled', 'No-Shows', 'Duplicate Appointments', 'Overlapping Appointments', 'Failed Bookings', 'Online Booking Failures', 'AI-Created Appointments', 'Staff-Created Appointments', 'Rescheduled Appointments', 'Synchronization Failures', 'Missing Customer Info', 'Missing Service Info', 'Data Integrity Issues', 'External Source Errors', 'Total Appointment Value']) {
      expect(screen.getAllByText(l).length).toBeGreaterThan(0);
    }
    // live values + honest gaps
    expect(screen.getByText('12,846')).toBeInTheDocument();
    expect(screen.getByText('2,146')).toBeInTheDocument();
    // charts
    expect(screen.getByText('Appointments Trend')).toBeInTheDocument();
    expect(screen.getByText('Appointment Status Distribution')).toBeInTheDocument();
    expect(screen.getByText('Appointments by Source')).toBeInTheDocument();
    // issue tabs
    for (const tab of ['All Issues', 'Duplicates', 'Overlapping', 'Sync Failures', 'Missing Info']) expect(screen.getByText(tab)).toBeInTheDocument();
    // quick actions
    for (const qa of ['Search Appointment', 'Review Booking History', 'Identify Duplicates', 'Retry Failed Synchronization', 'Escalate to Tenant Support', 'Export Appointment Report']) expect(screen.getByText(qa)).toBeInTheDocument();
    // 6 platform summary cards
    for (const s of ['Total Tenants', 'Active Branches', 'Active Technicians', 'Total Customers', "Today's Appointments", "Today's Revenue"]) expect(screen.getByText(s)).toBeInTheDocument();
  });

  it('switches issue tabs and shows an honest not-connected state for failed/sync tabs', async () => {
    render(<MemoryRouter><AppointmentOversightScreen /></MemoryRouter>);
    await screen.findByText('Appointment Oversight');
    const fb = screen.getAllByText('Failed Bookings'); fireEvent.click(fb[fb.length - 1]);
    expect(await screen.findByText(/Failed-booking event source not instrumented/)).toBeInTheDocument();
  });

  it('does NOT expose any ordinary salon POS mutation actions', async () => {
    render(<MemoryRouter><AppointmentOversightScreen /></MemoryRouter>);
    await screen.findByText('Appointment Oversight');
    for (const forbidden of ['Check In', 'Assign Technician', 'Start Service', 'Complete Service', 'Checkout', 'Capture Payment', 'Add to Queue']) {
      expect(screen.queryByText(forbidden)).toBeNull();
    }
  });

  // SCAN (Oct 12): "+ Add Widget" only re-fetched, the six filter pills had no handler (one showed a frozen mockup date
  // "Apr 30, 2026 - May 06, 20"), "Retry Failed Synchronization" / "Escalate to Tenant Support" / "Review Booking
  // History" only switched a tab, and the row's ⋮ did nothing. Each now does what it says, or says it is not available.
  it('quick actions open the submodule that does the work; unbuilt controls are disabled with a reason', async () => {
    const { Routes, Route, useLocation } = await import('react-router-dom');
    let at = '';
    const Where = () => { const l = useLocation(); at = l.pathname + l.search; return null; };
    const mount = () => render(<MemoryRouter initialEntries={['/appointment-oversight']}><Routes><Route path="/appointment-oversight" element={<AppointmentOversightScreen />} /><Route path="*" element={<Where />} /></Routes></MemoryRouter>);
    let view = mount();
    await screen.findByText('Appointment Oversight');
    expect(screen.getByLabelText('Add Widget')).toBeDisabled();
    for (const f of ['Branch', 'Tenant', 'Service', 'Technician', 'Source']) expect(screen.getByLabelText(new RegExp('^' + f + ':'))).toBeDisabled();
    expect(screen.queryByText(/May 06, 20/)).toBeNull();
    expect(screen.getByLabelText(/^Date Range: Apr 30 – May 1$/)).toBeDisabled();
    expect(screen.queryByLabelText('More actions')).toBeNull();
    const cases: [string, string][] = [['Search Appointment', '/appointment-oversight/search'], ['Review Booking History', '/appointment-oversight/change-history'], ['Identify Duplicates', '/appointment-oversight/duplicates'], ['Retry Failed Synchronization', '/appointment-oversight/sync-failures'], ['Escalate to Tenant Support', '/support-access']];
    for (const [label, to] of cases) {
      fireEvent.click(screen.getByText(label));
      expect(at).toBe(to);
      at = ''; view.unmount(); view = mount(); await screen.findByText('Appointment Oversight');
    }
  });

  // SCAN (Oct 12): ?fixture=1 swapped every live number for the mockup's reference values in ANY build — a URL could make
  // the production console show fabricated appointment figures. It is a dev-server aid only now.
  it('?fixture=1 is ignored outside the dev server (live numbers, never the mockup values)', async () => {
    vi.stubEnv('DEV', false);
    try {
      render(<MemoryRouter initialEntries={['/appointment-oversight?fixture=1']}><AppointmentOversightScreen /></MemoryRouter>);
      await screen.findByText('Appointment Oversight');
      expect(screen.getByText('12,846')).toBeInTheDocument();          // the API's value, not the fixture's
      expect(screen.queryByText('APT-250506-00125')).toBeNull();        // a fixture-only issue row
    } finally { vi.unstubAllEnvs(); }
  });
});
