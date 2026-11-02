// TurnRotationCard — Fair Turn §94–96: renders only what GET /tech/turn-queue returns (visibility is server-side),
// shows "not in rotation" honestly, an error state, and loads "My week" from /tech/turn-queue/summary on demand.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../lib/useTechStream', () => ({ useTechStream: () => {} }));
vi.mock('../api/techApi', () => ({ techApi: { turnQueue: vi.fn(), turnSummary: vi.fn() } }));
import { techApi } from '../api/techApi';
import { TurnRotationCard } from './TurnRotationCard';

const view = (over: any = {}) => ({
  businessDate: '2026-03-02', visibility: 'POSITION_ONLY', myRank: 2, queueLength: 5, myStatus: 'READY', team: [],
  me: { status: 'READY', rank: 2, turnsToday: 150, inProgressTurns: 0, walkInsToday: 2, appointmentsToday: 1, nextAppointmentAt: null, currentCustomer: null, readySince: null, onBreakSince: null, holdReason: null },
  myEarningsToday: null, fetchedAt: '2026-03-02T15:00:00Z', ...over,
});
const summary = { period: 'week', from: '2026-03-02', to: '2026-03-08', technicianId: 't1', name: 'Me', branches: [],
  time: { clockedMinutes: 480, paidBreakMinutes: 15, unpaidBreakMinutes: 30, interruptedBreaks: 0, eligibleWorkedMinutes: 450, serviceMinutes: 300, readyMinutes: 100, holdMinutes: 0, idleMinutes: 50, utilization: 0.66 },
  walkIns: { assigned: 4, completed: 3, requested: 1, firstAvailable: 2 }, appointments: { scheduled: 2, completed: 2, canceled: 0, noShow: 0, rescheduled: 0, requestedTechnician: 1, anyTechnician: 1 },
  turns: { turnUnits: 350, fullTurns: 3, partialTurns: 1, automaticAssignments: 2, manualAssignments: 1, eligibleSkips: 0, voluntaryDeclines: 0, managerOverrides: 0, averageReadyWaitMinutes: 10, queueOpportunityRate: null },
  money: { serviceSalesCents: 30000, commissionCents: 12000, tipsCents: 4500, cardTipsCents: 4500, cashTipsCents: 0, retailCommissionCents: 0, adjustmentsCents: null, estimatedEarningsCents: 16500, approvedCents: null, paidCents: null, source: 'payroll_snapshot', status: 'estimate' } };

beforeEach(() => { vi.clearAllMocks(); });

describe('TurnRotationCard', () => {
  it('shows my rank of the queue length, my turns today and no team list under POSITION_ONLY', async () => {
    (techApi.turnQueue as any).mockResolvedValue(view());
    render(<TurnRotationCard />);
    expect(await screen.findByText('#2')).toBeInTheDocument();
    expect(screen.getByText(/#2 of 5 · Ready for the next walk-in/)).toBeInTheDocument();
    expect(screen.getByText(/Turns today 1.50/)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Team rotation' })).toBeNull();
  });
  it('renders the team list exactly as the server gives it (FULL_TEAM_QUEUE)', async () => {
    (techApi.turnQueue as any).mockResolvedValue(view({ visibility: 'FULL_TEAM_QUEUE', team: [{ name: 'Ana', rank: 1, status: 'NEXT_UP', isMe: false }, { name: 'Me', rank: 2, status: 'READY', isMe: true }] }));
    render(<TurnRotationCard />);
    const list = await screen.findByRole('list', { name: 'Team rotation' });
    expect(list.textContent).toContain('Ana · You are next up');
    expect(list.textContent).toContain('You · Ready');
  });
  it('says plainly when I am not in the rotation', async () => {
    (techApi.turnQueue as any).mockResolvedValue(view({ myRank: null, queueLength: null, myStatus: null, me: null }));
    render(<TurnRotationCard />);
    expect(await screen.findByText('You are not in today’s rotation.')).toBeInTheDocument();
  });
  it('shows an honest error state when the read fails', async () => {
    (techApi.turnQueue as any).mockRejectedValue(new Error('boom'));
    render(<TurnRotationCard />);
    expect(await screen.findByText('Your turn rotation could not be loaded.')).toBeInTheDocument();
  });
  it('loads My week on demand from the summary endpoint', async () => {
    (techApi.turnQueue as any).mockResolvedValue(view());
    (techApi.turnSummary as any).mockResolvedValue(summary);
    render(<TurnRotationCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'My week' }));
    await waitFor(() => expect(techApi.turnSummary).toHaveBeenCalledWith('week'));
    expect(await screen.findByText(/3.50 \(3 full, 1 partial\)/)).toBeInTheDocument();
    expect(screen.getByText(/\$165.00/)).toBeInTheDocument();
  });
});
