import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { POSTeamScreen } from './POSTeamScreen';

const pagination = (totalItems: number) => ({ page: 1, pageSize: 8, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / 8)) });
const emptyState = {
  kpis: { totalMembers: 0, activeToday: 0, onShiftNow: 0, avgPerformance: 0, totalServices: 0, totalCommissionCents: 0, pendingApprovals: 0, openPositions: 0 },
  rows: { items: [], pagination: pagination(0) },
  tabs: [{ id: '', label: 'All Members', count: 0 }, { id: 'managers', label: 'Managers', count: 0 }],
  facets: { roles: [], statuses: ['on_shift', 'on_break'], shifts: ['scheduled', 'unscheduled'], departments: [] },
  attendance: [], performance: { overall: 0, distribution: [] }, topPerformers: [], birthdays: [],
  shiftOverview: [], productivity: { servicesCompleted: 0, revenueCents: 0, commissionCents: 0 },
  approvals: [], training: { certificationsExpiring: 0, trainingInProgress: 0, newTrainings: 0 },
  trends: { members: null, performance: null, services: null, commission: null, prodServices: null, prodRevenue: null, prodCommission: null },
};
const mockFetch = (s: unknown) => vi.fn(async () => ({ ok: true, status: 200, json: async () => s, headers: { get: () => null } } as any));
beforeEach(() => { vi.restoreAllMocks(); });

describe('POSTeamScreen', () => {
  // SCAN (Oct 12): "+ Add Team Member" had no handler. It opens Technicians, where a member is created or invited.
  it('"+ Add Team Member" opens the Technicians screen that creates / invites a member', async () => {
    globalThis.fetch = mockFetch(emptyState) as any;
    const { Routes, Route } = await import('react-router-dom');
    render(<MemoryRouter initialEntries={['/tenant/team/members']}><Routes><Route path="/tenant/team/members" element={<POSTeamScreen />} /><Route path="/technicians" element={<div>TECHNICIANS SCREEN</div>} /></Routes></MemoryRouter>);
    fireEvent.click(await screen.findByText('+ Add Team Member'));
    expect(await screen.findByText('TECHNICIANS SCREEN')).toBeInTheDocument();
  });
  it('renders the reference shell: 8 KPIs, header, toolbar, tabs, empty table + pagination', async () => {
    globalThis.fetch = mockFetch(emptyState) as any;
    render(<MemoryRouter><POSTeamScreen /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Team Management', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('Total Team Members')).toBeInTheDocument();
    expect(screen.getByText('Avg. Performance Score')).toBeInTheDocument();
    expect(screen.getByText('Open Positions')).toBeInTheDocument();
    expect(screen.getByText('+ Add Team Member')).toBeInTheDocument();
    expect(screen.getByText('All Members')).toBeInTheDocument();
    expect(screen.getByText('No matching team members.')).toBeInTheDocument();
    expect(screen.getByText(/Showing 0 to 0 of 0 team members/)).toBeInTheDocument();
  });

  it('renders every reference module wired from state (table, attendance, performance, top performers, shift overview, approvals, training)', async () => {
    const row = (employeeId: string, name: string, role: string, dept: string, status: string, perf: number, label: string, svc: number, rev: number, comm: number, provider: boolean) =>
      ({ employeeId, userId: employeeId.toLowerCase(), technicianId: provider ? 't-'+employeeId : null, name, email: `${name.split(' ')[0].toLowerCase()}@luxe.com`, phone: '(555) 123-4567', avatarUrl: null, role, roleLevel: 'Level 2', department: dept, shift: '9:00 AM - 6:00 PM', status, performanceScore: perf, performanceLabel: label, servicesCount: svc, revenueCents: rev, commissionCents: comm, isProvider: provider });
    const state = {
      ...emptyState,
      kpis: { totalMembers: 28, activeToday: 18, onShiftNow: 12, avgPerformance: 4.6, totalServices: 1248, totalCommissionCents: 1284600, pendingApprovals: 4, openPositions: 3 },
      rows: { items: [row('EMP-1001', 'Samantha Green', 'Nail Technician', 'Nail Services', 'on_shift', 4.8, 'Excellent', 48, 124875, 18731, true), row('EMP-1007', 'Mia Johnson', 'Receptionist', 'Front Desk', 'on_shift', 4.7, 'Excellent', 0, 0, 0, false)], pagination: pagination(28) },
      attendance: [{ status: 'Present', count: 18 }, { status: 'On Break', count: 3 }, { status: 'Absent', count: 4 }, { status: 'Off', count: 3 }],
      performance: { overall: 4.6, distribution: [{ label: 'Excellent (4.5 - 5.0)', count: 14 }, { label: 'Very Good (3.5 - 4.4)', count: 9 }] },
      topPerformers: [{ employeeId: 'EMP-1001', name: 'Samantha Green', avatarUrl: null, score: 4.9 }],
      shiftOverview: [{ label: 'Morning Shift', time: '9 AM - 2 PM', members: 8, present: 7, presentLabel: '7 Present' }],
      productivity: { servicesCompleted: 1248, revenueCents: 874200, commissionCents: 124800 },
      approvals: [{ type: 'leave', label: 'Leave Requests', count: 2 }],
      training: { certificationsExpiring: 8, trainingInProgress: 12, newTrainings: 5 },
    };
    globalThis.fetch = mockFetch(state) as any;
    render(<MemoryRouter><POSTeamScreen /></MemoryRouter>);
    expect(await screen.findByRole('heading', { name: 'Team Management', level: 1 })).toBeInTheDocument();
    expect(screen.getAllByText('Samantha Green').length).toBeGreaterThan(0);
    expect(screen.getByText('ID: EMP-1001 · samantha@luxe.com')).toBeInTheDocument();
    expect(screen.getByText('Front Desk')).toBeInTheDocument();
    expect(screen.getByText('Team Attendance Today')).toBeInTheDocument();
    expect(screen.getByText('Performance Overview')).toBeInTheDocument();
    expect(screen.getByText('Top Performers')).toBeInTheDocument();
    expect(screen.getByText('Upcoming Birthdays')).toBeInTheDocument();
    expect(screen.getByText("Today's Shift Overview")).toBeInTheDocument();
    expect(screen.getByText('Team Productivity')).toBeInTheDocument();
    expect(screen.getAllByText('Pending Approvals').length).toBeGreaterThan(0);
    expect(screen.getByText('Training & Certifications')).toBeInTheDocument();
    expect(screen.getByText(/Showing 1 to 8 of 28 team members/)).toBeInTheDocument();
  });

  it('opens the employee profile drawer when a member name is clicked', async () => {
    const row = (employeeId: string, name: string, role: string, dept: string, status: string, perf: number, label: string, svc: number, rev: number, comm: number, provider: boolean) =>
      ({ employeeId, userId: employeeId.toLowerCase(), technicianId: provider ? 't-' + employeeId : null, name, email: `${name.split(' ')[0].toLowerCase()}@luxe.com`, phone: '(555) 123-4567', avatarUrl: null, role, roleLevel: 'Level 2', department: dept, shift: '9:00 AM - 6:00 PM', status, performanceScore: perf, performanceLabel: label, servicesCount: svc, revenueCents: rev, commissionCents: comm, isProvider: provider });
    const state = { ...emptyState, kpis: { ...emptyState.kpis, totalMembers: 1 }, rows: { items: [row('EMP-1001', 'Samantha Green', 'Nail Technician', 'Nail Services', 'on_shift', 4.8, 'Excellent', 48, 124875, 18731, true)], pagination: pagination(1) } };
    globalThis.fetch = mockFetch(state) as any;
    render(<MemoryRouter><POSTeamScreen /></MemoryRouter>);
    const name = await screen.findByTitle('Open profile');
    fireEvent.click(name);
    // Sep 2026 redesign: the drawer re-renders once the member detail arrives, replacing its nodes — re-query after it settles
    await waitFor(() => expect(screen.getByText('EMPLOYMENT')).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText('Loading profile…')).toBeNull());
    expect(screen.getByText('EMPLOYMENT')).toBeInTheDocument();
    expect(screen.getByText('CONTACT')).toBeInTheDocument();
    expect(screen.getByText(/THIS PERIOD/)).toBeInTheDocument();
    expect(screen.getByText('Hire date')).toBeInTheDocument();
  });
});
