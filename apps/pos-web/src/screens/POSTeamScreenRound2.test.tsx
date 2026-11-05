// POSTeamScreenRound2.test — Team Management round 2A (30 Oct 2026), api modules mocked, a FAKE realtime stream (the window
// events the shared client dispatches):
//   TM-02 the URL restores role / size / page; a filter change returns to page 1; the search text never enters the URL
//   TM-01 Customer mode asks /customer-links (never the staff directory with the customer's text) and shows why each matched
//   TM-03 ?created=<id> → page 1, newest first, the row highlighted; filters that hide her → View new employee / Clear filters
//   TM-05 an event for a team screen refreshes in place (filters / page kept); the indicator is Live only while CONNECTED;
//         a slower, OLDER answer never replaces a newer one
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { REALTIME_EVENT, REALTIME_STATUS } from '../realtime/realtime-client';
import { readTeamUrl, teamQuery, nextTeamUrl, teamCreatedPath } from './teamUrlState';
import { liveModeOf, isStale } from './teamLive';

const dash = () => ({ period: { preset: 'month', from: '2026-10-01', to: '2026-10-30', tz: 'America/New_York', today: '2026-10-30' }, today: '2026-10-30', tz: 'America/New_York', asOf: '2026-10-30T15:00:00Z', errors: [], canPay: true,
  kpis: { totalMembers: 2, activeAccounts: 2, inactiveAccounts: 0, providers: 1, activeToday: 1, scheduledToday: 1, clockedToday: 1, onShiftNow: 1, clockedInNow: 1, avgRating: null, ratingCount: 0, ratedMembers: 0,
    servicesCompleted: 0, commissionEarnedCents: 0, commissionPaidCents: 0, pendingApprovals: 0, approvals: { skills: 0, timeOff: 0, profile: 0, membership: 0 }, openPositions: null, openPositionsReason: 'not_configured', missingServiceMapping: 0 },
  tabs: [], attendance: null, bands: null, topPerformers: [], shiftOverview: null, productivity: null, approvals: [], certifications: null, training: { configured: false }, birthdays: { recorded: false } });
const row = (memberId: string, name: string, live = 'available') => ({ memberId, kind: 'technician', userId: null, technicianId: memberId, code: 'EMP-' + memberId, name, avatarUrl: null, roles: ['nail_technician'], roleLabel: null, accountRole: null,
  department: 'nail_services', departmentDerived: true, branchName: null, email: null, phone: null, contactMasked: true, account: 'active', live, liveSince: null, shift: null, shiftSource: null, scheduledToday: false, clockedToday: false,
  isProvider: true, rating: null, ratingCount: 0, band: 'unrated', qualifiedServices: 1, missingMapping: false, servicesCompleted: 0, revenueCents: 0, commissionEarnedCents: 0, matchedVia: null, matchedServices: [], createdAt: '2026-10-30T12:00:00Z' });
const page = (items: any[], over: Record<string, unknown> = {}) => ({ period: dash().period, basis: 'service', account: 'current', sort: 'newest', tabs: [{ id: 'all', count: 30 }], items, page: 1, pageSize: 10, totalItems: 30, totalPages: 3,
  asOf: '2026-10-30T15:00:00Z', ...over });

const api = vi.hoisted(() => ({ dashboard: vi.fn(), directory: vi.fn(), profile: vi.fn(), customerLinks: vi.fn(), alerts: vi.fn() }));
vi.mock('../api/posTeamScreensApi', () => ({
  posTeamMembersScreenApi: { dashboard: api.dashboard, directory: api.directory, profile: api.profile, customerLinks: api.customerLinks, exportCsv: vi.fn(), live: vi.fn(), access: vi.fn(), schedule: vi.fn(), attendance: vi.fn(),
    skills: vi.fn(), work: vi.fn(), performance: vi.fn(), earnings: vi.fn(), training: vi.fn(), history: vi.fn(), preferredCheck: vi.fn() },
  posTeamDataAlertsApi: { list: api.alerts, detail: vi.fn(), assignees: vi.fn(), runCheck: vi.fn(), assign: vi.fn(), investigate: vi.fn(), note: vi.fn(), resolve: vi.fn(), dismiss: vi.fn(), reopen: vi.fn() },
  posTeamPerformanceScreenApi: { composite: vi.fn() }, posShiftOverrideApi: { editor: vi.fn(), preview: vi.fn(), save: vi.fn() }, posTechniciansScreenApi: {},
}));
vi.mock('../components/usePermissions', () => ({ useCan: () => () => true }));
import { POSTeamScreen } from './POSTeamScreen';

let seen = '';
function Where() { const l = useLocation(); seen = l.search; return null; }
const mount = (url = '/tenant/team/members') => render(<MemoryRouter initialEntries={[url]}><Routes><Route path="/tenant/team/members" element={<><POSTeamScreen /><Where /></>} /></Routes></MemoryRouter>);
const lastDir = () => api.directory.mock.calls[api.directory.mock.calls.length - 1][0];
beforeEach(() => {
  vi.clearAllMocks(); seen = '';
  api.dashboard.mockResolvedValue(dash());
  api.directory.mockResolvedValue(page([row('t-v', 'Vishal verma'), row('t-k', 'Kevin Dang')]));
  api.alerts.mockResolvedValue({ counts: { OPEN: 0 }, items: [], page: 1, pageSize: 1, totalItems: 0, totalPages: 1 });
  api.profile.mockResolvedValue({ name: 'Nora Quinn' });
});

describe('TM-02 URL state (pure)', () => {
  it('reads through allowlists, leaves defaults and the search out, and a filter change resets the page', () => {
    const s = readTeamUrl(new URLSearchParams('role=manager&size=20&page=3&sort=evil&size2=1&q=8565551201'));
    expect(s).toMatchObject({ role: 'manager', size: 20, page: 3, sort: 'newest' });
    expect(teamQuery(s).toString()).toBe('role=manager&page=3&size=20');
    expect(teamQuery(s).toString()).not.toContain('8565551201');
    expect(nextTeamUrl(s, { status: 'on_break' }).page).toBe(1); expect(nextTeamUrl(s, { page: 2 }).page).toBe(2);
    expect(readTeamUrl(new URLSearchParams('size=7&page=-2')).size).toBe(10); expect(readTeamUrl(new URLSearchParams('page=abc')).page).toBe(1);
    expect(teamCreatedPath('11111111-2222-4333-8444-555555555555', 'role=receptionist&page=4&sort=name')).toBe('/tenant/team/members?role=receptionist&created=11111111-2222-4333-8444-555555555555');
  });
});

describe('POSTeamScreen round 2A', () => {
  it('TM-02: role / size / page come from the URL; changing a filter goes back to page 1; typed search stays out of the URL', async () => {
    mount('/tenant/team/members?role=manager&size=20&page=2');
    await waitFor(() => expect(api.directory).toHaveBeenCalled());
    expect(lastDir()).toMatchObject({ role: 'manager', pageSize: 20, page: 2 });
    fireEvent.change(await screen.findByTestId('status'), { target: { value: 'on_break' } });
    await waitFor(() => expect(lastDir()).toMatchObject({ status: 'on_break', page: 1, role: 'manager', pageSize: 20 }));
    expect(seen).toContain('status=on_break'); expect(seen).not.toContain('page=');
    fireEvent.change(screen.getByTestId('page-size'), { target: { value: '50' } });
    await waitFor(() => expect(lastDir()).toMatchObject({ pageSize: 50, page: 1 }));
    fireEvent.change(screen.getByTestId('search'), { target: { value: '(856) 555-7001' } });
    await waitFor(() => expect(lastDir().q).toBe('(856) 555-7001'));
    expect(seen).not.toMatch(/555|7001/);
  });

  it('TM-01: Customer mode searches customer links (with why) and never sends the customer text to the staff directory', async () => {
    api.customerLinks.mockResolvedValue({ query: { kind: 'phone' }, matchedCustomers: 1, customers: [{ customerId: 'c1', name: 'Hanh Pham', phone: '••• 9901' }], page: 1, pageSize: 10, totalItems: 2, totalPages: 1,
      items: [{ memberId: 't-v', technicianId: 't-v', name: 'Vishal verma', roles: ['nail_technician'], code: 'EMP-V', live: 'available', reasons: [{ kind: 'ticket', kinds: ['service_line', 'ticket_primary'], refId: 'tk1', ticketNumber: 'H-9001', date: '2026-10-27', time: null, services: ['Gel Manicure'], customerName: 'Hanh Pham', customerPhone: '••• 9901', upcoming: false }], moreReasons: 0 },
        { memberId: 't-c', technicianId: 't-c', name: 'CD T6805', roles: ['nail_technician'], code: 'EMP-C', live: 'off', reasons: [{ kind: 'ticket', kinds: ['ticket_helper'], refId: 'tk1', ticketNumber: 'H-9001', date: '2026-10-27', time: null, services: [], customerName: 'Hanh Pham', customerPhone: '••• 9901', upcoming: false }], moreReasons: 0 }] });
    mount();
    fireEvent.click(await screen.findByTestId('mode-customer'));
    fireEvent.change(screen.getByTestId('search'), { target: { value: '8565559901' } });
    await waitFor(() => expect(api.customerLinks).toHaveBeenCalledWith(expect.objectContaining({ q: '8565559901' })));
    const rows = await screen.findAllByTestId('cl-row'); expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toMatch(/Performed the service \+ Primary technician/); expect(rows[1].textContent).toMatch(/Helper technician/);
    expect(rows[0].textContent).toMatch(/Ticket #H-9001/); expect(document.body.textContent).not.toContain('555-9901');
    expect(api.directory.mock.calls.every((c) => c[0].q !== '8565559901')).toBe(true);
    expect(seen).toContain('mode=customer'); expect(seen).not.toContain('9901');
    // TM-01 gap (Nov 5 2026): archived staff only when asked, marked Archived
    expect(api.customerLinks.mock.calls.every((c) => !c[0].archived)).toBe(true);
    api.customerLinks.mockResolvedValue({ query: { kind: 'phone' }, matchedCustomers: 1, customers: [], page: 1, pageSize: 10, totalItems: 1, totalPages: 1,
      items: [{ memberId: 't-x', technicianId: 't-x', name: 'Former Tech', roles: ['nail_technician'], code: 'EMP-X', live: 'off', archived: true, reasons: [], moreReasons: 0 }] });
    fireEvent.click(screen.getByTestId('cl-archived'));
    await waitFor(() => expect(api.customerLinks).toHaveBeenLastCalledWith(expect.objectContaining({ archived: 'include', page: 1 })));
    expect(await screen.findByTestId('cl-archived-chip')).toHaveTextContent('Archived');
  });

  it('TM-03: ?created=<id> → page 1, newest first, highlighted; hidden by filters → View new employee / Clear filters', async () => {
    const id = '11111111-2222-4333-8444-555555555555';
    api.directory.mockResolvedValue(page([{ ...row(id, 'Nora Quinn'), memberId: id }, row('t-v', 'Vishal verma')]));
    mount(`/tenant/team/members?created=${id}&page=3&sort=name`);
    await waitFor(() => expect(lastDir()).toMatchObject({ page: 1 })); expect(lastDir().sort).toBeUndefined();
    const hl = await screen.findByText('Nora Quinn'); await waitFor(() => expect(hl.closest('tr')?.className).toContain('tm2-new'));
    expect((await screen.findByTestId('created-note')).textContent).toMatch(/highlighted on page 1/);
    api.directory.mockResolvedValue(page([row('t-v', 'Vishal verma')]));
    fireEvent.change(screen.getByTestId('role'), { target: { value: 'receptionist' } });
    await waitFor(() => expect(screen.getByTestId('created-note').textContent).toMatch(/current filters hide/));
    expect(screen.getByTestId('created-view')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('created-clear')); await waitFor(() => expect(lastDir().role).toBeUndefined());
  });

  it('TM-05: a fake stream event refreshes the directory in place; Live only while CONNECTED; an older answer never replaces a newer one', async () => {
    mount('/tenant/team/members?role=nail_technician&page=2');
    await waitFor(() => expect(api.directory).toHaveBeenCalled());
    expect(screen.getByTestId('live-indicator').getAttribute('data-mode')).not.toBe('live');   // jsdom: no stream → never "Live"
    act(() => { window.dispatchEvent(new CustomEvent(REALTIME_STATUS, { detail: { status: 'CONNECTED' } })); });
    await waitFor(() => expect(screen.getByTestId('live-indicator').getAttribute('data-mode')).toBe('live'));
    const n = api.directory.mock.calls.length;
    api.directory.mockResolvedValue(page([row('t-v', 'Vishal verma', 'on_break')], { asOf: '2026-10-30T15:05:00Z' }));
    act(() => { window.dispatchEvent(new CustomEvent(REALTIME_EVENT, { detail: { event: 'technician_status_updated', screens: ['technicians'] } })); });
    await waitFor(() => expect(api.directory.mock.calls.length).toBeGreaterThan(n));
    expect(lastDir()).toMatchObject({ role: 'nail_technician', page: 2 });
    await waitFor(() => expect(screen.getAllByText('On Break').length).toBeGreaterThan(0));
    act(() => { window.dispatchEvent(new CustomEvent(REALTIME_STATUS, { detail: { status: 'RECONNECTING' } })); });
    await waitFor(() => expect(screen.getByTestId('live-indicator').getAttribute('data-mode')).toBe('reconnecting'));
    act(() => { window.dispatchEvent(new CustomEvent(REALTIME_STATUS, { detail: { status: 'DEGRADED' } })); });
    await waitFor(() => expect(screen.getByTestId('live-indicator').getAttribute('data-mode')).toBe('polling'));
    // an unrelated screen's event refreshes nothing
    const m = api.directory.mock.calls.length;
    act(() => { window.dispatchEvent(new CustomEvent(REALTIME_EVENT, { detail: { event: 'checkout_total_recalculated', screens: ['checkout'] } })); });
    await new Promise((r) => setTimeout(r, 400)); expect(api.directory.mock.calls.length).toBe(m);
  });

  it('TM-05 (pure): the indicator and the stale guard', () => {
    expect(liveModeOf('CONNECTED', true)).toBe('live'); expect(liveModeOf('RECONNECTING', false)).toBe('reconnecting');
    expect(liveModeOf('RECONNECTING', true)).toBe('polling'); expect(liveModeOf('OFFLINE', false)).toBe('polling'); expect(liveModeOf('DEGRADED', false)).toBe('polling');
    expect(isStale({ asOf: '2026-10-30T15:00:00Z' }, { asOf: '2026-10-30T15:05:00Z' })).toBe(true);
    expect(isStale({ asOf: '2026-10-30T15:05:00Z' }, { asOf: '2026-10-30T15:00:00Z' })).toBe(false); expect(isStale({ asOf: null }, { asOf: '2026-10-30T15:00:00Z' })).toBe(false);
  });
});
