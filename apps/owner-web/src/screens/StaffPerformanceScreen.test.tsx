// StaffPerformanceScreen (owner, Module 4): Technicians tab (top-tech table + Today's Snapshot KPIs) and Attendance tab
// (tiles). Verifies the technician table + money/rating rendering + snapshot, tapping a technician through to detail, the
// attendance tab tiles, the empty state, and a friendly 403. Data is typed from /owner/staff/{performance,attendance}.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const nav = vi.hoisted(() => ({ openTechDetail: vi.fn() }));
vi.mock('../shell/nav', () => ({ useOwnerNav: () => nav }));
vi.mock('../shell/OwnerBranchContext', () => ({ useOwnerBranch: () => ({ effectiveBranchId: undefined }) }));
vi.mock('../api/ownerApi', () => ({ ownerStaffApi: { performance: vi.fn(), attendance: vi.fn() } }));

import { ownerStaffApi } from '../api/ownerApi';
import { StaffPerformanceScreen } from './StaffPerformanceScreen';

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
