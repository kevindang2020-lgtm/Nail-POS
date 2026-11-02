// LiveOperationsScreen (owner, read-only): live floor snapshot for the selected branch (or all locations) — waiting/
// serving/completed counts, ready-to-checkout + delayed-appointment + walk-in signals, an active Tech Queue, and a Live
// customer Queue. Verifies the snapshot renders (counts, tech row + elapsed, VIP queue row + wait), a friendly 403, and
// empty states. Data is typed from /owner/live; the screen never mutates the floor.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('../shell/OwnerBranchContext', () => ({ useOwnerBranch: () => ({ effectiveBranchId: undefined }) }));
vi.mock('../api/useOwnerStream', () => ({ useOwnerStream: () => {} }));
vi.mock('../api/ownerApi', () => ({ ownerLiveApi: { get: vi.fn() } }));

import { ownerLiveApi } from '../api/ownerApi';
import { LiveOperationsScreen } from './LiveOperationsScreen';

const snap = (over: any = {}) => ({
  branchId: null,
  counts: { waiting: 5, serving: 3, completedToday: 12 },
  techQueue: [{ technicianId: 'te1', technicianName: 'Mia', serviceLabel: 'Gel-X Full Set', customerName: 'Grace', elapsedMinutes: 14, paused: false }],
  team: [{ technicianId: 'te1', technicianName: 'Mia', queueStatus: 'SERVING', clockStatus: 'CLOCKED_IN', currentCustomerName: 'Grace', salesTodayCents: 12500, tipsTodayCents: 2000 },
         { technicianId: 'te2', technicianName: 'Leo', queueStatus: 'BREAK', clockStatus: 'ON_BREAK', currentCustomerName: null, salesTodayCents: 0, tipsTodayCents: 0 }],
  liveQueue: [{ queueItemId: 'q1', customerName: 'Ana', isVip: true, serviceLabel: 'Pedicure', requestedTechnicianName: 'Mia', waitMinutes: 8, status: 'waiting' }],
  todaySoFar: { servicesDone: 12, walkIns: 4 },
  signals: { readyForCheckout: 2, delayedAppointments: 1 },
  generatedAt: '2026-06-27T15:00:00.000Z',
  ...over,
});

beforeEach(() => { vi.clearAllMocks(); (ownerLiveApi.get as any).mockResolvedValue(snap()); });

describe('LiveOperationsScreen', () => {
  it('renders counts, the active tech queue, and the live customer queue', async () => {
    render(<LiveOperationsScreen />);
    // Mia also appears in the Team section (Oct 12 merge, workforce audit #28)
    await waitFor(() => expect(screen.getAllByText('Mia').length).toBeGreaterThan(0));
    expect(screen.getByText('Tech Queue')).toBeInTheDocument();
    expect(screen.getByText('Live Queue')).toBeInTheDocument();
    expect(screen.getByText(/Gel-X Full Set/)).toBeInTheDocument();
    expect(screen.getByText('14m')).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('VIP')).toBeInTheDocument();
    expect(screen.getByText('8m')).toBeInTheDocument();
  });

  it('shows a friendly error when the request is rejected (e.g., a forbidden branch)', async () => {
    (ownerLiveApi.get as any).mockRejectedValue(new Error('You do not have access to that branch.'));
    render(<LiveOperationsScreen />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/access to that branch/i));
  });

  it('shows empty states when nothing is on the floor', async () => {
    (ownerLiveApi.get as any).mockResolvedValue(snap({ techQueue: [], liveQueue: [] }));
    render(<LiveOperationsScreen />);
    await waitFor(() => expect(screen.getByText('No services in progress.')).toBeInTheDocument());
    expect(screen.getByText('No one waiting.')).toBeInTheDocument();
  });
  it('Team: every technician with live queue status, current customer, and today\'s sales + tips (audit #28)', async () => {
    (ownerLiveApi.get as any).mockResolvedValue(snap());
    render(<LiveOperationsScreen />);
    expect(await screen.findByText('With Grace')).toBeInTheDocument();
    expect(screen.getByText('$125.00')).toBeInTheDocument();
    expect(screen.getByText('tips $20.00')).toBeInTheDocument();
    expect(screen.getAllByText('On break').length).toBe(2); // queue pill + clock line for Leo
    expect(screen.getByText('2 technicians')).toBeInTheDocument();
  });

  it('Team: honest empty state when the API sends no team', async () => {
    (ownerLiveApi.get as any).mockResolvedValue(snap({ team: [] }));
    render(<LiveOperationsScreen />);
    expect(await screen.findByText('No technicians in this view.')).toBeInTheDocument();
  });
});

// 200-technician mandate §2 (Oct 27 2026): at 1,000 technicians the screen downloaded the whole team (a window of 1,000)
// and the in-service list (another 1,000) and paged them here. Now the server pages both; every request asks for one page
// and no response the screen reads carries more than one page of technicians.
import { fireEvent, within } from '@testing-library/react';
import { TEAM_PAGE_SIZE, TECH_QUEUE_PAGE_SIZE } from './LiveOperationsScreen';
describe('LiveOperationsScreen at 1,000 technicians (§2)', () => {
  const N = 1000;
  const pad = (i: number) => String(i).padStart(4, '0');
  const TEAM = Array.from({ length: N }, (_, i) => ({ technicianId: `t${pad(i + 1)}`, technicianName: `Tech ${pad(i + 1)}`, queueStatus: i % 10 === 9 ? 'BREAK' : 'AVAILABLE', clockStatus: 'CLOCKED_IN', currentCustomerName: null, salesTodayCents: 0, tipsTodayCents: 0 }));
  const SERVING = TEAM.slice(0, 60).map((t, i) => ({ technicianId: t.technicianId, technicianName: t.technicianName, serviceLabel: 'Gel', customerName: `G${i}`, elapsedMinutes: i, paused: false }));
  const largest: number[] = [];
  // the fake server: the repository's paging rules
  const server = (_branch: string | undefined, q: any = {}) => {
    const size = Math.min(50, q.teamPageSize || 25); const tqSize = Math.min(50, q.techQueuePageSize || 25);
    const hit = TEAM.filter((t) => (!q.teamSearch || t.technicianName.toLowerCase().includes(String(q.teamSearch).toLowerCase())) && (!q.teamStatus || t.queueStatus === q.teamStatus));
    const pages = Math.max(1, Math.ceil(hit.length / size)); const page = Math.min(pages, q.teamPage || 1);
    const tqPages = Math.ceil(SERVING.length / tqSize); const tqPage = Math.min(tqPages, q.techQueuePage || 1);
    const body = snap({ team: hit.slice((page - 1) * size, page * size), techQueue: SERVING.slice((tqPage - 1) * tqSize, tqPage * tqSize),
      totals: { team: N, techQueue: SERVING.length, liveQueue: 1 }, teamPage: { page, pageSize: size, total: hit.length, totalPages: pages }, techQueuePage: { page: tqPage, pageSize: tqSize, total: SERVING.length, totalPages: tqPages } });
    largest.push(Math.max(body.team.length, body.techQueue.length));
    return Promise.resolve(body);
  };
  it('asks for one page of the team and of the in-service list; searches, filters and pages on the server', async () => {
    (ownerLiveApi.get as any).mockImplementation(server);
    render(<LiveOperationsScreen />);
    expect(await screen.findByText(`Page 1 of ${N / TEAM_PAGE_SIZE} · ${N} technicians`)).toBeInTheDocument();
    expect(screen.getByTestId('tq-pager')).toHaveTextContent(`Page 1 of ${Math.ceil(60 / TECH_QUEUE_PAGE_SIZE)}`);
    fireEvent.click(screen.getAllByText('Next ›')[1]);   // the Team pager
    expect(await screen.findByText(`Page 2 of ${N / TEAM_PAGE_SIZE} · ${N} technicians`)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search technicians'), { target: { value: 'Tech 0999' } });
    await waitFor(() => expect(document.body.textContent).toContain('Tech 0999'), { timeout: 2000 });
    expect(document.body.textContent).not.toContain('Tech 0030');
    fireEvent.change(screen.getByLabelText('Search technicians'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'BREAK' } });
    expect(await screen.findByText(`Page 1 of 4 · 100 technicians`, {}, { timeout: 2000 })).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId('tq-pager')).getByText('Next ›'));
    await waitFor(() => expect(screen.getByTestId('tq-pager')).toHaveTextContent('Page 2 of 3'));
    const calls = (ownerLiveApi.get as any).mock.calls as [string | undefined, any][];
    expect(calls.every(([, q]) => q.teamPageSize === TEAM_PAGE_SIZE && q.techQueuePageSize === TECH_QUEUE_PAGE_SIZE)).toBe(true);
    expect(calls.some(([, q]) => q.teamSearch === 'Tech 0999')).toBe(true);
    expect(calls.some(([, q]) => q.teamStatus === 'BREAK')).toBe(true);
    expect(Math.max(...largest)).toBeLessThanOrEqual(TEAM_PAGE_SIZE);
  });
});
