import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { mockWait } = vi.hoisted(() => ({ mockWait: vi.fn() }));
vi.mock('../api/superAdminBookingCheckinApi', () => ({ superAdminBookingCheckinApi: { waitTimeAnalysis: (q: any) => mockWait(q) } }));

import WaitTimeAnalysisScreen from './WaitTimeAnalysisScreen';

const branch = (id: string, name: string, avg: number, status: string) => ({ branchId: id, branch: name, avgWaitSec: avg, avgWaitDisplay: `${Math.floor(avg / 60)}m ${String(avg % 60).padStart(2, '0')}s`, medianWaitSec: avg, p90WaitSec: avg, longestWaitSec: avg, longestWaitDisplay: `${Math.floor(avg / 60)}m ${String(avg % 60).padStart(2, '0')}s`, waits: 2, checkins: 5, status });
const resp = (available = true, branches = [branch('bA2', 'Uptown', 738, 'poor'), branch('bA1', 'Downtown', 454, 'at_risk')]) => ({
  ok: true, scope: { tenantId: null, branchId: null, label: 'All tenants' }, range: { start: '', endInclusive: '' },
  summary: { avgWaitSec: 548, avgWaitDisplay: '09m 08s', medianWaitSec: 535, medianWaitDisplay: '08m 55s', p90WaitSec: 697, p90WaitDisplay: '11m 37s', longestWaitSec: 738, longestWaitDisplay: '12m 18s', sampled: available ? 3 : 0, entered: 4, abandoned: 1, abandonmentRate: 25, available },
  branches: available ? branches : [], sources: available ? [{ key: 'online', label: 'Online', avgWaitSec: 548, avgWaitDisplay: '09m 08s', waits: 3 }] : [], hours: available ? [{ hour: 14, avgWaitSec: 548, waits: 3 }] : [],
});
const renderScreen = () => render(<MemoryRouter initialEntries={['/booking-checkin/wait-time-analysis']}><WaitTimeAnalysisScreen /></MemoryRouter>);
beforeEach(() => { mockWait.mockReset(); });

describe('WaitTimeAnalysisScreen', () => {
  it('renders summary stats and worst-first branch ranking', async () => {
    mockWait.mockResolvedValue(resp());
    renderScreen();
    await waitFor(() => expect(screen.getByText('Branch Ranking')).toBeInTheDocument());
    // Uptown (worst) ranked first
    const rows = screen.getAllByRole('row');
    // header + 2 branch rows
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('Uptown')).toBeInTheDocument();
    expect(screen.getByText('Downtown')).toBeInTheDocument();
    expect(screen.getByText('Avg Wait by Hour')).toBeInTheDocument();
  });

  it('re-queries when the date range changes', async () => {
    mockWait.mockResolvedValue(resp());
    renderScreen();
    await waitFor(() => expect(mockWait).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('Date range'), { target: { value: '30' } });
    await waitFor(() => expect(mockWait).toHaveBeenCalledTimes(2));
  });

  it('shows an empty state when there are no waits', async () => {
    mockWait.mockResolvedValue(resp(false));
    renderScreen();
    await waitFor(() => expect(screen.getByText('No completed waits in this period.')).toBeInTheDocument());
  });

  it('surfaces an error with a retry', async () => {
    mockWait.mockRejectedValueOnce(new Error('nope')).mockResolvedValueOnce(resp());
    renderScreen();
    await waitFor(() => expect(screen.getByText(/Couldn/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.getByText('Branch Ranking')).toBeInTheDocument());
  });
});
