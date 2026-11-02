// POSTechniciansScreen — the Technicians Management Center rebuild (Oct 30 2026): the eight KPIs with their definitions
// (Active Accounts ≠ On Shift; rating with its sample; Open Positions not configured), the directory controls, the three
// priority flows, the edit drawer that never sends a status, and Vietnamese.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setLanguage } from '@aipowersalon/mobile-sdk/i18n';
const { ts, techs } = vi.hoisted(() => ({
  ts: { dashboard: vi.fn(), directory: vi.fn(), history: vi.fn(), certifications: vi.fn(), appointments: vi.fn(), serviceHistory: vi.fn(), mapping: vi.fn() },
  techs: { commission: vi.fn(), update: vi.fn(), setCommission: vi.fn(), lookup: vi.fn(), create: vi.fn(), suspend: vi.fn(), archive: vi.fn(), activate: vi.fn(), reactivate: vi.fn(), setServices: vi.fn(), detail: vi.fn(), profileRatings: vi.fn(), techProfile: vi.fn(),
    membershipRequests: vi.fn(async () => []), profileChanges: vi.fn(async () => ({ items: [] })), profilePolicy: vi.fn(async () => ({})) },
}));
vi.mock('../api/posTeamScreensApi', () => ({ posTechniciansScreenApi: ts }));
vi.mock('../api/posTechniciansApi', () => ({ posTechniciansApi: techs }));
vi.mock('../components/MembershipRequestsPanel', () => ({ MembershipRequestsPanel: () => null }));
vi.mock('../components/ProfileChangeRequestsPanel', () => ({ ProfileChangeRequestsPanel: () => null }));
vi.mock('../components/PendingTimeOffPanel', () => ({ PendingTimeOffPanel: () => null }));
import { POSTechniciansScreen } from './POSTechniciansScreen';

const period = { preset: 'today', from: '2026-10-30', to: '2026-10-30', tz: 'America/New_York', today: '2026-10-30' };
const kpis = { totalTeam: 3, activeAccounts: 3, scheduledToday: 1, onShiftNow: 1, clockedIn: 1, availableNow: 1, inService: 0, assigned: 0, onBreak: 0, offToday: 2, avgRating: 5, ratingCount: 1, ratedTechnicians: 1,
  servicesCompleted: 0, commissionEstCents: 0, commissionLinesWithoutSnapshot: 0, pendingApprovals: 0, approvals: { skills: 0, timeOff: 0, profile: 0, membership: 0 }, openPositions: null, missingServiceMapping: 2 };
const row = (id: string, name: string, working: string, mapped: number, rating: number | null) => ({ technicianId: id, name, avatarUrl: null, code: id.toUpperCase(), branchName: 'Main', role: 'Technician', status: 'active', working,
  email: null, phone: '(856) 555-1234', contactMasked: false, qualifiedServices: mapped, missingMapping: mapped === 0, rating, ratingCount: rating ? 1 : 0, servicesToday: 0, app: 'not_set', shiftToday: null, shiftSource: null, matchedVia: null, matchedServices: [] });
const ROWS = [row('c3', 'CD T6805', 'off', 0, null), row('c2', 'Kevin Dang', 'off', 0, null), row('c1', 'Vishal verma', 'available', 2, 5)];
const page = (items: unknown[], extra = {}) => ({ period, items, page: 1, pageSize: 10, totalItems: items.length, totalPages: 1, ...extra });
beforeEach(() => {
  for (const g of [ts, techs]) Object.values(g).forEach((f) => (f as any).mockReset?.());
  ts.dashboard.mockResolvedValue({ period, kpis, insights: [{ kind: 'unmapped', severity: 'warn', n: 2, action: 'mapping' }], attendance: { availableNow: 1, inService: 0, assigned: 0, onBreak: 0, offToday: 2, scheduledToday: 1, clockedIn: 1 },
    bands: { excellent: 1, veryGood: 0, good: 0, needs: 0, unrated: 2 }, topPerformers: [{ technicianId: 'c1', name: 'Vishal verma', rating: 5, ratingCount: 1, servicesCompleted: 0 }],
    productivityToday: { servicesCompleted: 0, revenueCents: 0, commissionEstCents: 0, tipsCents: 0 }, shiftOverview: { onShift: 1, onBreak: 0, offOrNotClockedIn: 2, scheduledToday: 1, clockedIn: 1 }, certifications: { valid: 0, expiringSoon: 0, expired: 0, verified: 0 }, birthdays: { recorded: false } });
  ts.directory.mockImplementation(async (q: any) => (q?.q && /^c\d$/.test(q.q) ? page(ROWS.filter((r) => r.technicianId === q.q)) : page(ROWS, { roles: { all: 3, byRole: [{ role: 'Technician', count: 3 }] } })));
  ts.history.mockResolvedValue(page([])); ts.certifications.mockResolvedValue({ ...page([]), today: '2026-10-30' });
  ts.mapping.mockResolvedValue({ technicianId: 'c2', services: [{ serviceId: 's1', name: 'Gel Manicure', category: 'Nails', durationMinutes: 45, priceCents: 5500, active: true, mapped: false, performedBefore: 0, requested: false }] });
  techs.commission.mockResolvedValue({ defaultPercent: 40 }); techs.update.mockResolvedValue({}); techs.setServices.mockResolvedValue({ serviceIds: ['s1'] });
});
afterEach(async () => { await setLanguage('en'); });
const mount = () => render(<MemoryRouter><POSTechniciansScreen /></MemoryRouter>);

describe('POSTechniciansScreen', () => {
  it('keeps the eight KPIs with honest definitions and every module of both views', async () => {
    mount();
    expect(await screen.findByTestId('kpi-rating')).toHaveTextContent('5.0 / 5');
    expect(screen.getByTestId('kpi-active')).toHaveTextContent('Active Accounts');
    expect(screen.getByTestId('kpi-on-shift')).toHaveTextContent('1');
    expect(screen.getByTestId('kpi-positions')).toHaveTextContent('—');
    for (const t of ['insights', 'attendance', 'performance', 'top-performers', 'directory', 'productivity', 'shift-overview', 'birthdays', 'certifications', 'activity', 'missing-mapping', 'new-technician']) expect(screen.getByTestId(t)).toBeInTheDocument();
    expect(await screen.findAllByTestId('tech-row')).toHaveLength(3);
  });
  it('Missing Service Mapping refetches with missingMapping=1', async () => {
    mount(); await screen.findAllByTestId('tech-row');
    fireEvent.click(screen.getByTestId('missing-mapping'));
    await waitFor(() => expect(ts.directory).toHaveBeenLastCalledWith(expect.objectContaining({ missingMapping: '1', page: 1 })));
  });
  it('saving an edit never sends a status', async () => {
    mount(); await screen.findAllByTestId('tech-row');
    fireEvent.click(screen.getAllByTestId('row-edit')[2]);
    await waitFor(() => expect(techs.commission).toHaveBeenCalledWith('c1'));
    fireEvent.change(screen.getByTestId('edit-name'), { target: { value: 'Vishal Verma' } });
    fireEvent.click(screen.getByTestId('edit-save'));
    await waitFor(() => expect(techs.update).toHaveBeenCalled());
    expect(techs.update.mock.calls[0][1]).not.toHaveProperty('status');
  });
  it('the mapping assistant never pre-ticks and saves the chosen list', async () => {
    ts.directory.mockImplementation(async (q: any) => (q?.missingMapping ? page(ROWS.slice(0, 2)) : q?.q ? page([ROWS[1]]) : page(ROWS, { roles: { all: 3, byRole: [] } })));
    mount(); fireEvent.click(await screen.findByTestId('open-mapping'));
    fireEvent.click((await screen.findAllByTestId('mapping-open'))[1]);
    const box = await screen.findByTestId('mapping-check');
    expect(box).not.toBeChecked(); expect(screen.getByTestId('mapping-save')).toBeDisabled();
    fireEvent.click(box); fireEvent.click(screen.getByTestId('mapping-save'));
    await waitFor(() => expect(techs.setServices).toHaveBeenCalledWith('c2', { serviceIds: ['s1'] }));
  });
  it('403 is a permission state', async () => {
    ts.dashboard.mockRejectedValue({ status: 403 }); mount();
    expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument();
  });
  it('reads in Vietnamese', async () => {
    await setLanguage('vi'); mount();
    expect(await screen.findByText('Tài khoản hoạt động')).toBeInTheDocument();
    expect(screen.getByText('Danh bạ thợ')).toBeInTheDocument();
  });
});
