// POSReceptionCopilotHold.test.tsx — Round 2 H (Oct 12 2026): "Hold this time" on a recommended slot in the Reception
// Copilot. A hold reserves the exact slot (server: POST copilot/hold, behind pos.booking.create) with a live countdown and
// a Release button; "Book this time" carries the hold into the booking card, and the booking presents the hold token so
// the server converts the hold. A taken slot and a missing permission are said honestly. Fixed clock (fake timers).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const NOW = Date.parse('2030-11-04T14:00:00.000Z');
const allOn = { enabled: true, actionsEnabled: true, allowCreate: true, allowReschedule: true, allowCancel: true, allowSendMessage: true };
const receptionCopilotAvailability = vi.fn((d: string, _s?: string[]) => Promise.resolve({ available: true, date: d, recommendations: [{ time: '10:00', technicianId: 't1', technicianName: 'Amy' }, { time: '11:00', technicianId: 't2', technicianName: 'Bea' }], byTechnician: [] }));
const receptionCopilotHold = vi.fn((p: any) => Promise.resolve({ held: true, holdToken: 'bs~tok1~sig', holdId: 'h1', expiresAt: new Date(NOW + 5 * 60_000).toISOString(), date: p.date, startTime: p.startTime, technicianId: p.technicianId }));
const receptionCopilotReleaseHold = vi.fn((_t: string) => Promise.resolve({ released: true }));
vi.mock('../api/posServicesApi', () => ({ posServicesApi: { list: () => Promise.resolve([]) } }));
vi.mock('../api/posAiApi', () => ({ posAiApi: {
  receptionCopilot: () => Promise.resolve({ ok: true, text: '', degraded: false }), receptionCopilotContext: () => Promise.resolve({ matchState: 'none', candidates: [], customer: null }),
  receptionCopilotQueue: () => Promise.resolve({ available: false, waiting: 0, inService: 0, unassigned: 0, vipWaiting: 0, longestWaitMinutes: null }), receptionCopilotDuplicates: () => Promise.resolve({ groups: [] }),
  receptionCopilotAvailability: (d: string, s?: string[]) => receptionCopilotAvailability(d, s), receptionCopilotTechnicians: () => Promise.resolve({ available: false, technicians: [] }),
  receptionCopilotHold: (p: any) => receptionCopilotHold(p), receptionCopilotReleaseHold: (t: string) => receptionCopilotReleaseHold(t),
  receptionCopilotConflict: () => Promise.resolve({ hasConflict: false, status: 'ok', conflictingAppointmentId: null }), 
  receptionCopilotDraftMessage: () => Promise.resolve({ kind: 'reminder', body: '', matched: false, customerName: null }),
  receptionCopilotGetSettings: () => Promise.resolve(allOn), receptionCopilotIntent: () => Promise.resolve({ intent: 'general_question', confidence: 'low', label: 'General question', matched: [] }),
  receptionCopilotAiPhoneActivity: () => Promise.resolve({ available: false, calls: [] }), receptionCopilotExplainService: () => Promise.resolve({ found: false }),
  receptionCopilotWaitlist: () => Promise.resolve({ recommended: false, waiting: 0, estimatedWaitMinutes: null, message: '' }), receptionCopilotNextActions: () => Promise.resolve([]),
  receptionCopilotPatchSettings: (p: any) => Promise.resolve({ ...allOn, ...p }),
} }));
// Reception Copilot guide: customer-affecting actions go prepare → confirm through /pos/ai/copilot-center
const ccPrepare = vi.fn((a: any) => Promise.resolve({ state: 'awaiting_confirmation', title: '', type: a.type, current: null, proposed: {}, warnings: [], notices: [], blocked: [], token: 'tok-1', expiresAt: null }));
const ccConfirm = vi.fn((a: any, _t: string) => Promise.resolve({ ok: true, requestKey: 'cc:1', errorCode: null, message: null, duplicate: false, state: 'completed', record: { appointmentId: a.appointmentId ?? 'new-1', status: 'booked' } }));
vi.mock('../api/posCopilotCenterApi', () => ({ posCopilotCenterApi: {
  prepare: (a: any) => ccPrepare(a), confirm: (a: any, t: string) => ccConfirm(a, t),
  overview: () => Promise.resolve({ asOf: '2026-10-31T12:00:00Z', queue: null, queueState: 'no_branch', activeTechnicians: 0, upcomingNext2h: 0, missedCalls24h: 0, failedActions24h: 0, lastHealth: null }),
  priorities: () => Promise.resolve({ asOf: '2026-10-31T12:00:00Z', items: [] }),
  activity: () => Promise.resolve({ items: [], total: 0, page: 1, pageSize: 20, pages: 1, window: { from: '2026-10-01', to: '2026-10-31', tz: 'UTC' } }),
  search: () => Promise.resolve({ items: [], total: 0, page: 1, pageSize: 20, pages: 1, hint: 'Type at least 2 characters.' }),
  health: () => Promise.resolve({ overall: 'READY', checks: [] }), customer: () => Promise.resolve(null),
} }));
import { POSReceptionCopilotScreen } from './POSReceptionCopilotScreen';

beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true, now: NOW }); receptionCopilotHold.mockClear(); receptionCopilotReleaseHold.mockClear(); });
afterEach(() => { vi.useRealTimers(); });

async function findTimes() {
  render(<MemoryRouter><POSReceptionCopilotScreen /></MemoryRouter>);
  fireEvent.change(screen.getByLabelText('Date to check'), { target: { value: '2030-11-04' } });
  fireEvent.change(screen.getByPlaceholderText(/Service IDs to hold/), { target: { value: 'svc1, svc2' } });
  fireEvent.click(within(screen.getByLabelText('Date to check').parentElement!).getByText('Check'));
  await waitFor(() => expect(receptionCopilotAvailability).toHaveBeenLastCalledWith('2030-11-04', ['svc1', 'svc2']));
  await screen.findByRole('button', { name: 'Hold 10:00 with Amy' });
}

describe('Reception Copilot — Hold this time', () => {
  it('holds the exact recommended slot, counts down, and releases it', async () => {
    await findTimes();
    fireEvent.click(screen.getByRole('button', { name: 'Hold 10:00 with Amy' }));
    await waitFor(() => expect(receptionCopilotHold).toHaveBeenCalledWith({ date: '2030-11-04', startTime: '10:00', serviceIds: ['svc1', 'svc2'], technicianId: 't1', holdToken: undefined }));
    expect(await screen.findByText(/Held: 10:00 with Amy/)).toBeInTheDocument();
    expect(screen.getByRole('timer')).toHaveTextContent(/^(5:00|4:59)$/);   // the server's expiry, counted on this clock
    await act(async () => { vi.advanceTimersByTime(61_000); });
    expect(screen.getByRole('timer')).toHaveTextContent(/^3:5[89]$/);
    fireEvent.click(screen.getByRole('button', { name: 'Release hold' }));
    await waitFor(() => expect(receptionCopilotReleaseHold).toHaveBeenCalledWith('bs~tok1~sig'));
    await waitFor(() => expect(screen.queryByText(/Held: 10:00/)).not.toBeInTheDocument());
  });

  it('holding another slot moves the SAME hold (its token is sent back)', async () => {
    await findTimes();
    fireEvent.click(screen.getByRole('button', { name: 'Hold 10:00 with Amy' }));
    await screen.findByText(/Held: 10:00 with Amy/);
    fireEvent.click(screen.getByRole('button', { name: 'Hold 11:00 with Bea' }));
    await waitFor(() => expect(receptionCopilotHold).toHaveBeenLastCalledWith(expect.objectContaining({ startTime: '11:00', technicianId: 't2', holdToken: 'bs~tok1~sig' })));
    expect(await screen.findByText(/Held: 11:00 with Bea/)).toBeInTheDocument();
  });

  it('"Book this time" fills the booking card; confirming books FROM the hold (token sent), then the hold panel clears', async () => {
    await findTimes();
    fireEvent.click(screen.getByRole('button', { name: 'Hold 10:00 with Amy' }));
    await screen.findByText(/Held: 10:00 with Amy/);
    fireEvent.click(screen.getByRole('button', { name: 'Book this time' }));
    expect((screen.getByPlaceholderText('Customer name') as HTMLInputElement)).toBeInTheDocument();
    expect((screen.getByPlaceholderText('10:00') as HTMLInputElement).value).toBe('10:00');
    fireEvent.change(screen.getByPlaceholderText('Customer name'), { target: { value: 'Ann Lee' } });
    fireEvent.click(screen.getByText('Review booking'));
    fireEvent.click(await screen.findByText('Confirm booking'));
    await waitFor(() => expect(ccConfirm).toHaveBeenCalledWith(expect.objectContaining({ type: 'create_appointment', customerName: 'Ann Lee', date: '2030-11-04', startTime: '10:00', technicianId: 't1', serviceIds: ['svc1', 'svc2'], holdToken: 'bs~tok1~sig' }), 'tok-1'));
    await waitFor(() => expect(screen.queryByText(/Held: 10:00/)).not.toBeInTheDocument());
    expect(receptionCopilotReleaseHold).not.toHaveBeenCalled();   // booked from it — converted by the server, not released
  });

  it('when the countdown runs out the hold is gone (the booking no longer carries it); a taken slot / no permission are said honestly', async () => {
    await findTimes();
    fireEvent.click(screen.getByRole('button', { name: 'Hold 10:00 with Amy' }));
    await screen.findByText(/Held: 10:00 with Amy/);
    await act(async () => { vi.advanceTimersByTime(5 * 60_000 + 1000); });
    expect(await screen.findByText(/hold expired/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Book this time' })).not.toBeInTheDocument();
    receptionCopilotHold.mockResolvedValueOnce({ held: false, reason: 'taken' } as any);
    fireEvent.click(screen.getByRole('button', { name: 'Hold 11:00 with Bea' }));
    expect(await screen.findByText(/just taken/i)).toBeInTheDocument();
    receptionCopilotHold.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
    fireEvent.click(screen.getByRole('button', { name: 'Hold 11:00 with Bea' }));
    expect(await screen.findByText(/permission to hold/i)).toBeInTheDocument();
  });
});
