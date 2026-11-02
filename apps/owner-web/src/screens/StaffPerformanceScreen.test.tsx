// StaffPerformanceScreen (owner, Module 4): Technicians tab (top-tech table + Today's Snapshot KPIs) and Attendance tab
// (tiles). Verifies the technician table + money/rating rendering + snapshot, tapping a technician through to detail, the
// attendance tab tiles, the empty state, and a friendly 403. Data is typed from /owner/staff/{performance,attendance}.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const nav = vi.hoisted(() => ({ openTechDetail: vi.fn(), go: vi.fn() }));
vi.mock('../shell/nav', () => ({ useOwnerNav: () => nav }));
vi.mock('../shell/OwnerBranchContext', () => ({ useOwnerBranch: () => ({ effectiveBranchId: undefined }) }));
vi.mock('../api/ownerApi', () => ({ ownerStaffApi: { performance: vi.fn(), attendance: vi.fn(), technicians: vi.fn() } }));

import { ownerStaffApi } from '../api/ownerApi';
import { StaffPerformanceScreen, AllTechniciansCard } from './StaffPerformanceScreen';
import '../i18n/catalog';

const perf = (over: any = {}) => ({
  topTechnicians: [
    { technicianId: 't1', fullName: 'Jane Nguyen', avatarUrl: null, roleLabel: 'Senior Tech', servicesCompleted: 24, salesCents: 185000, utilizationPercent: 88, rating: 4.8 },
    { technicianId: 't2', fullName: 'Mary Lee', avatarUrl: null, roleLabel: 'Tech', servicesCompleted: 18, salesCents: 142000, utilizationPercent: 70, rating: 0 },
  ],
  totalStaff: 8, onDutyCount: 5, utilizationPercent: 76, utilizationTrendPercent: 4.2, totalCommissionCents: 320000, ...over,
});
const att = { scheduled: 8, clockedIn: 5, late: 1, onBreak: 1, absent: 0, offShift: 2, overtime: 0 };

beforeEach(() => {
  vi.clearAllMocks();
  (ownerStaffApi.performance as any).mockResolvedValue(perf());
  (ownerStaffApi.attendance as any).mockResolvedValue(att);
  (ownerStaffApi.technicians as any).mockResolvedValue({ period: { from: 'a', to: 'b' }, items: [], total: 0, totalAll: 0, page: 1, pageSize: 20, totalPages: 1, sort: 'sales', dir: 'desc' });
});

describe('StaffPerformanceScreen', () => {
  it('renders the technician table and the snapshot KPIs', async () => {
    render(<StaffPerformanceScreen />);
    expect((await screen.findAllByText('Jane Nguyen')).length).toBeGreaterThan(0);
    expect(screen.getByText('Mary Lee')).toBeInTheDocument();
    expect(screen.getByText('Top Performer')).toBeInTheDocument();
    expect(screen.getByText('$1,850')).toBeInTheDocument();        // top performer's sales, 0 fraction digits
    expect(screen.getAllByText('4.8').length).toBeGreaterThan(0);  // Jane's rating (table + Top Performer card)
    expect(screen.getByText('88%')).toBeInTheDocument();           // Jane's per-tech utilization
    expect(screen.getByText('70%')).toBeInTheDocument();           // Mary's per-tech utilization
    expect(screen.getByText('76%')).toBeInTheDocument();           // overall utilization (snapshot)
    expect(screen.getByText('▲ 4.2%')).toBeInTheDocument();        // utilization trend
    expect(screen.getByText('$3,200')).toBeInTheDocument();        // total commission
    expect(screen.getByText('5 On Duty')).toBeInTheDocument();
  });

  it('renders a dash for a technician with no rating', async () => {
    render(<StaffPerformanceScreen />);
    await screen.findByText('Mary Lee');
    expect(screen.getByText('—')).toBeInTheDocument();             // rating 0 -> "—"
  });

  it('opens the technician detail when a row is tapped', async () => {
    render(<StaffPerformanceScreen />);
    fireEvent.click((await screen.findAllByText('Jane Nguyen'))[0].closest('.owner-staffrow') as HTMLElement);
    expect(nav.openTechDetail).toHaveBeenCalledWith('t1');
  });

  it('has a Back arrow to More and is titled like its More entry (developer merge, Oct 6 2026)', async () => {
    render(<StaffPerformanceScreen />);
    await screen.findAllByText('Jane Nguyen');
    expect(screen.getByText('Team Performance')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Back'));
    expect(nav.go).toHaveBeenCalledWith('more');
  });

  it('shows attendance tiles on the Attendance tab', async () => {
    render(<StaffPerformanceScreen />);
    await screen.findAllByText('Jane Nguyen');
    fireEvent.click(screen.getByText('Attendance'));
    for (const label of ['Scheduled', 'Clocked In', 'On Break', 'Off Shift', 'Absent', 'Late', 'Overtime']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('shows the empty state when no technicians have completed services', async () => {
    (ownerStaffApi.performance as any).mockResolvedValue(perf({ topTechnicians: [] }));
    render(<StaffPerformanceScreen />);
    expect(await screen.findByText('No staff performance yet')).toBeInTheDocument();
  });

  it('shows a friendly 403 with Retry', async () => {
    (ownerStaffApi.performance as any).mockRejectedValue({ status: 403 });
    render(<StaffPerformanceScreen />);
    expect(await screen.findByText('You do not have access to staff reports.')).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });
});

// 200-technician mandate §62 / §69 / §71: every technician, paged / searched / sorted on the server
describe('AllTechniciansCard (200 technicians)', () => {
  const row = (i: number) => ({ technicianId: 't' + i, fullName: 'Tech ' + i, roleLabel: 'Technician', servicesCompleted: i % 9, salesCents: (201 - i) * 1000, utilizationPercent: 50, rating: 0, rank: i, commissionCents: 0 });
  const pageOf = (q: any) => { const page = q.page ?? 1; return { period: { from: 'a', to: 'b' }, items: Array.from({ length: 20 }, (_, k) => row((page - 1) * 20 + k + 1)), total: 200, totalAll: 200, page, pageSize: 20, totalPages: 10, sort: q.sort ?? 'sales', dir: 'desc' }; };
  it('shows 20 of 200 with ranks, pages, searches and sorts through the API', async () => {
    (ownerStaffApi.technicians as any).mockImplementation(async (q: any) => pageOf(q));
    const open = vi.fn();
    render(<AllTechniciansCard period="month" onOpen={open} debounceMs={0} />);
    expect(await screen.findByText('20 of 200 technicians')).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 10')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-tech-row]').length).toBe(20);
    fireEvent.click(screen.getByText('Next'));
    expect(await screen.findByText('Page 2 of 10')).toBeInTheDocument();
    expect(screen.getByText('Tech 21')).toBeInTheDocument();
    expect((ownerStaffApi.technicians as any)).toHaveBeenLastCalledWith(expect.objectContaining({ period: 'month', page: 2, sort: 'sales' }));
    fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'rating' } });
    await vi.waitFor(() => expect((ownerStaffApi.technicians as any)).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'rating', page: 1 })));
    fireEvent.change(screen.getByLabelText('Search technician or #rank'), { target: { value: '#150' } });
    await vi.waitFor(() => expect((ownerStaffApi.technicians as any)).toHaveBeenLastCalledWith(expect.objectContaining({ search: '#150', page: 1 })));
    fireEvent.click(screen.getByText('Tech 1'));
    expect(open).toHaveBeenCalledWith('t1');
  });
});
