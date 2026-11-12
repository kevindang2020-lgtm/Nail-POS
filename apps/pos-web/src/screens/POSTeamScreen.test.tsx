// POSTeamScreen.test — Team Management (/tenant/team/members) on its server read model (30 Oct 2026). The api modules are
// mocked: the screen must show the server's figures with their definitions (Commission is EARNED, "Paid" only from payouts,
// Open Positions "Not configured"), every original module, server search, the lazy profile overlay (Close keeps the
// search), the KPI error state (never a verified zero) and the audited server export.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const dash = (over: Record<string, unknown> = {}) => ({
  period: { preset: 'month', from: '2026-10-01', to: '2026-10-30', tz: 'America/New_York', today: '2026-10-30' }, today: '2026-10-30', tz: 'America/New_York', asOf: '2026-10-30T15:00:00Z', errors: [], canPay: true,
  kpis: { totalMembers: 8, activeAccounts: 8, inactiveAccounts: 0, providers: 6, activeToday: 2, scheduledToday: 1, clockedToday: 2, onShiftNow: 1, clockedInNow: 1, avgRating: 5, ratingCount: 1, ratedMembers: 1,
    servicesCompleted: 16, commissionEarnedCents: 25880, commissionPaidCents: 0, pendingApprovals: 1, approvals: { skills: 1, timeOff: 0, profile: 0, membership: 0 }, openPositions: null, openPositionsReason: 'not_configured', missingServiceMapping: 2 },
  tabs: [], attendance: { available: 1, inService: 0, assigned: 0, onBreak: 1, onShift: 0, timeOff: 0, off: 4, notTracked: 2, scheduledToday: 1, clockedToday: 2 },
  bands: { excellent: 1, veryGood: 0, good: 0, needs: 0, unrated: 5, providers: 6 }, topPerformers: [{ memberId: 'u-v', technicianId: 't-v', name: 'Vishal verma', avatarUrl: null, rating: 5, ratingCount: 1, lowSample: true }],
  shiftOverview: { scheduled: 1, onShiftNow: 1, clockedToday: 2, items: [{ memberId: 't-k', name: 'Kevin Dang', shift: '12:00–20:00', source: 'published', clockedIn: false, live: 'off' }] },
  productivity: { servicesCompleted: 16, revenueCents: 188100, commissionEarnedCents: 25880, previous: null }, approvals: [{ type: 'skills', count: 1 }, { type: 'time_off', count: 0 }, { type: 'profile', count: 0 }, { type: 'membership', count: 0 }],
  certifications: { valid: 1, expiringSoon: 1, expired: 0, verified: 1, addedInPeriod: 0 }, training: { configured: false }, birthdays: { recorded: false }, ...over,
});
const row = (memberId: string, name: string, roles: string[], over: Record<string, unknown> = {}) => ({ memberId, kind: 'user', userId: memberId, technicianId: roles.includes('nail_technician') ? 't-' + memberId : null, code: 'EMP-' + memberId.toUpperCase(),
  name, avatarUrl: null, roles, roleLabel: null, accountRole: null, department: roles.includes('owner') ? 'management' : 'nail_services', departmentDerived: true, branchName: 'Main', email: null, phone: '••• 7001', contactMasked: true,
  account: 'active', live: 'available', liveSince: null, shift: '09:00–17:00', shiftSource: 'weekly', scheduledToday: true, clockedToday: true, isProvider: roles.includes('nail_technician'), rating: 5, ratingCount: 1, band: 'excellent',
  qualifiedServices: 2, missingMapping: false, servicesCompleted: 15, revenueCents: 183100, commissionEarnedCents: 23880, matchedVia: null, matchedServices: [], createdAt: '2026-10-29T00:00:00Z', ...over });
const page = (items: any[], total = items.length) => ({ period: dash().period, basis: 'service', account: 'current', sort: 'newest',
  tabs: [{ id: 'all', count: total }, { id: 'stylists', count: 0 }, { id: 'nail_technicians', count: 6 }, { id: 'receptionists', count: 1 }, { id: 'assistants', count: 1 }, { id: 'managers', count: 1 }],
  items, page: 1, pageSize: 10, totalItems: total, totalPages: Math.max(1, Math.ceil(total / 10)) });

const api = vi.hoisted(() => ({
  dashboard: vi.fn(), directory: vi.fn(), exportCsv: vi.fn(), live: vi.fn(), profile: vi.fn(), access: vi.fn(), schedule: vi.fn(), attendance: vi.fn(), skills: vi.fn(), work: vi.fn(),
  performance: vi.fn(), earnings: vi.fn(), training: vi.fn(), history: vi.fn(), alerts: vi.fn(),
}));
vi.mock('../api/posTeamScreensApi', () => ({
  posTeamMembersScreenApi: { dashboard: api.dashboard, directory: api.directory, exportCsv: api.exportCsv, live: api.live, profile: api.profile, access: api.access, schedule: api.schedule, attendance: api.attendance,
    skills: api.skills, work: api.work, performance: api.performance, earnings: api.earnings, training: api.training, history: api.history },
  posTeamDataAlertsApi: { list: api.alerts, detail: vi.fn(), assignees: vi.fn(), runCheck: vi.fn(), assign: vi.fn(), investigate: vi.fn(), note: vi.fn(), resolve: vi.fn(), dismiss: vi.fn(), reopen: vi.fn() },
  posTeamPerformanceScreenApi: { composite: vi.fn(async () => ({ available: false, score: null })) },
  posShiftOverrideApi: { editor: vi.fn(), preview: vi.fn(), save: vi.fn() },
  posTechniciansScreenApi: {},
}));
// round 2 (TM-06 / TM-08 / TM-09): onboarding, birthdays, training
const staff = vi.hoisted(() => ({ options: vi.fn(), createStaff: vi.fn(), upcoming: vi.fn(), bdGet: vi.fn(), bdSet: vi.fn(), summary: vi.fn(), courses: vi.fn(), member: vi.fn(), techCreate: vi.fn(), techUpdate: vi.fn() }));
vi.mock('../api/posTeamStaffApi', () => ({
  posTeamOnboardingApi: { options: staff.options, createStaff: staff.createStaff },
  posTeamBirthdaysApi: { upcoming: staff.upcoming, get: staff.bdGet, set: staff.bdSet },
  posTeamTrainingApi: { summary: staff.summary, courses: staff.courses, createCourse: vi.fn(), archiveCourse: vi.fn(), member: staff.member, assign: vi.fn(), start: vi.fn(), complete: vi.fn(), cancel: vi.fn(), addCertification: vi.fn(), verifyCertification: vi.fn() },
}));
vi.mock('../api/posTechniciansApi', () => ({ posTechniciansApi: { create: staff.techCreate, update: staff.techUpdate } }));
vi.mock('../api/posWorkforceApi', () => ({ posWorkforceApi: { verifyCertification: vi.fn() } }));
vi.mock('../components/usePermissions', () => ({ useCan: () => () => true }));
import { POSTeamScreen } from './POSTeamScreen';

const mount = () => render(<MemoryRouter initialEntries={['/tenant/team/members']}><Routes><Route path="/tenant/team/members" element={<POSTeamScreen />} /><Route path="/technicians" element={<div>TECHNICIANS SCREEN</div>} /></Routes></MemoryRouter>);
beforeEach(() => {
  vi.clearAllMocks();
  api.dashboard.mockResolvedValue(dash());
  api.directory.mockResolvedValue(page([row('u-p', 'Pat Owner', ['owner']), row('u-v', 'Vishal verma', ['nail_technician'])], 8));
  api.alerts.mockResolvedValue({ counts: { OPEN: 2, ASSIGNED: 0, INVESTIGATING: 0, RESOLVED: 0, DISMISSED: 0 }, lastRun: null, canReview: true, items: [], page: 1, pageSize: 1, totalItems: 2, totalPages: 2 });
  staff.options.mockResolvedValue({ canOnboard: true, sessionBranchId: 'b1', anyBranch: false, branches: [{ id: 'b1', name: 'Main' }], roles: [
    { key: 'receptionist', label: 'Receptionist', base: 'RECEPTION', provider: false, custom: false, allowed: true, reason: null, flow: 'staff' },
    { key: 'manager', label: 'Manager', base: 'MANAGER', provider: false, custom: false, allowed: false, reason: 'ROLE_ABOVE_YOURS', flow: 'staff' },
    { key: 'nail_technician', label: 'Nail Technician', base: 'TECHNICIAN', provider: true, custom: false, allowed: true, reason: null, flow: 'technician' }] });
  staff.upcoming.mockResolvedValue({ recorded: false, today: '2026-10-30', days: 30, items: [], canManage: true });
  staff.bdGet.mockResolvedValue({ memberId: 'u-v', month: null, day: null, private: true, canManage: false });   // the profile overview reads the member's birthday
  staff.member.mockResolvedValue({ configured: false, canManage: false, assignments: [], certifications: [] });
  staff.summary.mockResolvedValue({ configured: false, today: '2026-10-30', expiringWindowDays: 30, courses: { active: 0, total: 0 }, assignments: { assigned: 0, inProgress: 0, completed: 0, expiringSoon: 0, expired: 0, canceled: 0, overdue: 0 }, staffCertifications: { verified: 0, unverified: 0, expiringSoon: 0 }, canManage: true });
});

describe('POSTeamScreen (Team Management)', () => {
  it('"+ Add Team Member" onboards a receptionist with NO technician fields, then returns to the list with ?created', async () => {
    staff.createStaff.mockResolvedValue({ memberId: 'u-rita', userId: 'u-rita', role: 'receptionist', status: 'invited', replayed: false, technicianRecord: false, invite: { deliveryStatus: 'not_connected', acceptUrl: 'https://pos.test/accept-invite?token=x' } });
    mount();
    fireEvent.click(await screen.findByText('+ Add Team Member'));
    expect(await screen.findByTestId('add-staff-fields')).toBeInTheDocument();
    expect(screen.queryByTestId('add-tech-fields')).toBeNull();
    expect(screen.getByRole('option', { name: /Manager — not below your role/ })).toBeDisabled();
    fireEvent.change(screen.getByTestId('add-name'), { target: { value: 'Rita Reception' } });
    fireEvent.change(screen.getByTestId('add-email'), { target: { value: 'rita@pilot.test' } });
    fireEvent.click(screen.getByTestId('add-submit'));
    await waitFor(() => expect(staff.createStaff).toHaveBeenCalledWith(expect.objectContaining({ role: 'receptionist', fullName: 'Rita Reception', email: 'rita@pilot.test', branchIds: ['b1'], idempotencyKey: expect.any(String) })));
    expect(await screen.findByTestId('add-done')).toBeInTheDocument();
    expect(screen.getByTestId('add-invite-link')).toHaveValue('https://pos.test/accept-invite?token=x');
    fireEvent.click(screen.getByTestId('add-show-in-list'));
    await waitFor(() => expect(screen.queryByTestId('dlg-add-member')).toBeNull());
  });

  it('a nail technician gets the technician fields and the existing technician hire', async () => {
    staff.techCreate.mockResolvedValue({ technicianId: 't-new', userId: null, invite: null });
    mount();
    fireEvent.click(await screen.findByText('+ Add Team Member'));
    fireEvent.change(await screen.findByTestId('add-role'), { target: { value: 'nail_technician' } });
    expect(await screen.findByTestId('add-tech-fields')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('add-first'), { target: { value: 'Lan' } }); fireEvent.change(screen.getByTestId('add-last'), { target: { value: 'Vo' } });
    fireEvent.click(screen.getByTestId('add-submit'));
    await waitFor(() => expect(staff.techCreate).toHaveBeenCalledWith(expect.objectContaining({ firstName: 'Lan', lastName: 'Vo', status: 'active' }), expect.any(String)));
    expect(staff.createStaff).not.toHaveBeenCalled();
  });

  it('Birthdays and Training read their own endpoints: "Not recorded" / "Not configured" only when absent', async () => {
    mount();
    expect(await screen.findByText('Birthdays are not recorded')).toBeInTheDocument();
    expect(staff.summary).toHaveBeenCalled();
    staff.upcoming.mockResolvedValue({ recorded: true, today: '2026-10-30', days: 30, canManage: true, items: [{ memberId: 'u-rita', name: 'Rita Reception', month: 11, day: 4, date: '2026-11-04', inDays: 5, shownOnFeb28: false, private: true }] });
    staff.summary.mockResolvedValue({ configured: true, today: '2026-10-30', expiringWindowDays: 30, courses: { active: 1, total: 1 }, assignments: { assigned: 1, inProgress: 2, completed: 3, expiringSoon: 1, expired: 0, canceled: 0, overdue: 0 }, staffCertifications: { verified: 0, unverified: 1, expiringSoon: 0 }, canManage: true });
    fireEvent.click(screen.getByTestId('refresh'));
    expect(await screen.findByTestId('birthday-row')).toHaveTextContent('Rita Reception');
    expect(screen.getByTestId('birthday-row')).toHaveTextContent('in 5 days');
    expect(await screen.findByTestId('ring-completed')).toHaveTextContent('3');
    expect(screen.getByTestId('ring-progress')).toHaveTextContent('2');
  });

  it('the eight KPIs are the server\'s, with honest labels: Commission EARNED (Paid from payouts), Open Positions not configured', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: 'Team Management', level: 1 })).toBeInTheDocument();
    for (const l of ['Total Team Members', 'Active Today', 'On Shift Now', 'Avg. Performance Score', 'Total Services Completed', 'Commission Earned', 'Pending Approvals', 'Open Positions']) expect(screen.getAllByText(l).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByTestId('kpi-team')).toHaveTextContent('8'));
    expect(screen.getByTestId('kpi-rating')).toHaveTextContent('5.0 / 5');
    expect(screen.getByTestId('kpi-commission')).toHaveTextContent('$258.80');
    expect(screen.getByTestId('kpi-commission')).toHaveTextContent(/Paid \$0\.00 \(payroll payouts\)/);
    expect(screen.getByTestId('kpi-positions')).toHaveTextContent('Not configured');
    expect(screen.queryByText('Total Commission Paid')).toBeNull();
  });

  it('a failed KPI source says so — never a verified zero', async () => {
    api.dashboard.mockResolvedValue(dash({ errors: ['sales'], kpis: { ...dash().kpis, servicesCompleted: null } }));
    mount();
    await waitFor(() => expect(screen.getByTestId('kpi-services')).toHaveTextContent('Could not load — not a verified zero'));
    expect(screen.getByTestId('kpi-services')).not.toHaveTextContent(/^0/);
  });

  it('keeps every original module: role tabs with unique counts, the 10 columns, all eight report panels', async () => {
    mount();
    await screen.findAllByTestId('member-row');
    expect(screen.getByTestId('tab-all')).toHaveTextContent('All Members 8');
    expect(screen.getByTestId('tab-nail_technicians')).toHaveTextContent('Nail Technicians 6');
    for (const h of ['Team Member', 'Role', 'Department', 'Shift', 'Status', 'Performance', 'Services', 'Revenue', 'Commission earned', 'Actions']) expect(screen.getAllByText(h).length).toBeGreaterThan(0);
    for (const p of ['Team Attendance Today', 'Performance Overview', 'Top Performers', "Today's Shift Overview", 'Team Productivity', 'Upcoming Birthdays', 'Training & Certifications']) expect(screen.getByText(p)).toBeInTheDocument();
    expect(screen.getByText('Birthdays are not recorded')).toBeInTheDocument();
    expect(await screen.findByTestId('training')).toHaveTextContent('Not configured');   // no rings when the catalog is not configured
  });

  it('extras TM-08: the header has the read-only team health check (training, certificates, waiting approvals)', async () => {
    mount();
    await screen.findAllByTestId('member-row');
    expect(screen.getByTestId('syschk-team')).toHaveTextContent('Check system');
  });

  it('search goes to the server (the whole salon, not the page) and resets to page 1', async () => {
    mount(); await screen.findAllByTestId('member-row');
    fireEvent.change(screen.getByTestId('search'), { target: { value: '(856) 555-7001' } });
    await waitFor(() => expect(api.directory).toHaveBeenCalledWith(expect.objectContaining({ q: '(856) 555-7001', page: 1 })));
  });

  it('the profile overlay opens by id, loads tabs lazily, and Close keeps the search', async () => {
    api.profile.mockResolvedValue({ ...row('u-v', 'Vishal verma', ['nail_technician']), today: '2026-10-30', tz: 'America/New_York', employmentStart: { at: '2026-10-27T00:00:00Z', source: 'record_created' }, lastUpdate: null,
      access: null, bio: null, can: { contact: false, pay: true, access: false, editSchedule: true, editMember: false } });
    api.earnings.mockResolvedValue({ provider: true, earnedCents: 23880, tipsCents: 32300, adjustmentsCents: 0, payableCents: 56180, paidCents: 0, pendingPayoutCents: 0, payouts: [] });
    mount(); await screen.findAllByTestId('member-row');
    fireEvent.change(screen.getByTestId('search'), { target: { value: 'vishal' } });
    fireEvent.click(screen.getAllByTestId('row-name')[1]);
    expect(await screen.findByTestId('dlg-member-profile')).toBeInTheDocument();
    await waitFor(() => expect(api.profile).toHaveBeenCalledWith('u-v'));
    expect(api.earnings).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByTestId('mt-earnings'));
    expect(await screen.findByTestId('earnings-body')).toHaveTextContent('$238.80');
    expect(screen.queryByTestId('mt-access')).toBeNull();   // no roles.view → no Roles & Access tab
    fireEvent.click(screen.getByTestId('profile-close'));
    await waitFor(() => expect(screen.queryByTestId('dlg-member-profile')).toBeNull());
    expect(screen.getByTestId('search')).toHaveValue('vishal');
  });

  it('Export asks the server for the audited CSV with the current filters', async () => {
    api.exportCsv.mockResolvedValue('﻿Employee ID,Name\r\nEMP-1,Pat');
    (globalThis as any).URL.createObjectURL = vi.fn(() => 'blob:x'); (globalThis as any).URL.revokeObjectURL = vi.fn();
    mount(); await screen.findAllByTestId('member-row');
    fireEvent.click(screen.getByTestId('export'));
    await waitFor(() => expect(api.exportCsv).toHaveBeenCalledWith(expect.objectContaining({ preset: 'month', lang: 'en' })));
    expect(await screen.findByTestId('note')).toHaveTextContent(/Export ready/);
  });

  it('Data Accuracy Alerts shows its open count in the header', async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId('open-alerts')).toHaveTextContent('2'));
  });
});
