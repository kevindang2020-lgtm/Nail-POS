import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const { stateMock, inMock, outMock, resetMock, adjustMock, bsMock, beMock } = vi.hoisted(() => ({ bsMock: vi.fn(), beMock: vi.fn(), stateMock: vi.fn(), inMock: vi.fn(), outMock: vi.fn(), resetMock: vi.fn(), adjustMock: vi.fn() }));
vi.mock('../api/posTimeClockApi', () => ({ posTimeClockApi: { state: stateMock, clockIn: inMock, clockOut: outMock, resetClockPin: resetMock, adjustTimecard: adjustMock, breakStart: bsMock, breakEnd: beMock } }));
const { rtMock } = vi.hoisted(() => ({ rtMock: vi.fn() }));
vi.mock('../realtime/useRealtime', () => ({ useRealtime: rtMock }));
import { POSTimeClockScreen } from './POSTimeClockScreen';
beforeEach(() => { bsMock.mockReset(); beMock.mockReset(); stateMock.mockReset(); inMock.mockReset(); outMock.mockReset(); resetMock.mockReset(); adjustMock.mockReset(); });

const row = (o: any = {}) => ({ technicianId: 'A', technicianName: 'Ana', state: 'off', clockedInAt: null, lastClockOutAt: null, hoursToday: 0, shiftCount: 0, shifts: [], ...o });
const state = (techs: any[]) => ({ kpis: { technicianCount: techs.length, clockedInCount: techs.filter((t) => t.state === 'clocked_in').length, totalHoursToday: 0 }, technicians: techs });

describe('POSTimeClockScreen', () => {
  it('subscribes to realtime + 15 s safety sync on the technicians/time-clock screens and refetches on a tick', async () => {
    stateMock.mockResolvedValue(state([row()]));
    render(<POSTimeClockScreen />);
    await screen.findByText('Ana');
    const call = rtMock.mock.calls.find((c) => Array.isArray(c[0]) && c[0].includes('time-clock'));
    expect(call).toBeTruthy();
    expect(call![0]).toEqual(expect.arrayContaining(['technicians', 'time-clock']));
    stateMock.mockResolvedValue(state([row({ technicianName: 'Bea' })]));
    await call![1]('interval');
    expect(await screen.findByText('Bea')).toBeInTheDocument();
  });
  it('renders roster + clock-in for an off technician', async () => {
    stateMock.mockResolvedValue(state([row()]));
    render(<POSTimeClockScreen />);
    expect(await screen.findByRole('heading', { name: 'Time Clock' })).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clock In' })).toBeInTheDocument();
  });
  it('clocks a technician in', async () => {
    stateMock.mockResolvedValue(state([row()]));
    inMock.mockResolvedValue({});
    render(<POSTimeClockScreen />);
    await screen.findByText('Ana');
    stateMock.mockResolvedValue(state([row({ state: 'clocked_in', clockedInAt: '2026-07-07T16:00:00Z' })]));
    fireEvent.click(screen.getByRole('button', { name: 'Clock In' }));
    await waitFor(() => expect(inMock).toHaveBeenCalledWith('A'));
  });
  it('shows clock-out for a clocked-in technician', async () => {
    stateMock.mockResolvedValue(state([row({ state: 'clocked_in', clockedInAt: '2026-07-07T16:00:00Z', hoursToday: 2.5 })]));
    render(<POSTimeClockScreen />);
    expect(await screen.findByRole('button', { name: 'Clock Out' })).toBeInTheDocument();
    expect(screen.getByText('2.50 h')).toBeInTheDocument();
  });

  it('resets a technician kiosk clock PIN and shows it to the manager', async () => {
    stateMock.mockResolvedValue(state([row()]));
    resetMock.mockResolvedValue({ ok: true });
    render(<POSTimeClockScreen />);
    await screen.findByText('Ana');
    fireEvent.click(screen.getByRole('button', { name: 'Reset PIN' }));
    fireEvent.change(await screen.findByLabelText('New clock PIN for Ana'), { target: { value: '4827' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save PIN' }));
    await waitFor(() => expect(resetMock).toHaveBeenCalledWith('A', '4827'));
    expect(await screen.findByText('4827')).toBeInTheDocument(); // confirmation shows the PIN to hand over
  });

  it('rejects a non-4-digit clock PIN without calling the server', async () => {
    stateMock.mockResolvedValue(state([row()]));
    render(<POSTimeClockScreen />);
    await screen.findByText('Ana');
    fireEvent.click(screen.getByRole('button', { name: 'Reset PIN' }));
    fireEvent.change(await screen.findByLabelText('New clock PIN for Ana'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save PIN' }));
    expect(await screen.findByText('A clock PIN must be exactly 4 digits.')).toBeInTheDocument();
    expect(resetMock).not.toHaveBeenCalled();
  });

  it('expands a technician’s punches and adjusts a timecard', async () => {
    const shift = { id: 'sh1', technicianId: 'A', startTime: '2026-07-07T16:00:00Z', endTime: '2026-07-07T20:00:00Z', status: 'completed' };
    stateMock.mockResolvedValue(state([row({ state: 'clocked_out', hoursToday: 4, shiftCount: 1, shifts: [shift] })]));
    adjustMock.mockResolvedValue({ ok: true, adjustments: 1 });
    render(<POSTimeClockScreen />);
    await screen.findByText('Ana');
    fireEvent.click(screen.getByRole('button', { name: 'Shifts' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Adjust' }));
    fireEvent.change(await screen.findByLabelText('Corrected clock-out'), { target: { value: '2026-07-07T18:30' } });
    fireEvent.change(screen.getByLabelText('Correction reason'), { target: { value: 'Forgot to clock out' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save correction' }));
    await waitFor(() => expect(adjustMock).toHaveBeenCalled());
    const [sid, body] = adjustMock.mock.calls[0];
    expect(sid).toBe('sh1');
    expect(body.reason).toBe('Forgot to clock out');
    expect(typeof body.endTime).toBe('string'); // corrected time converted to ISO
  });

  it('requires a reason before adjusting a timecard', async () => {
    const shift = { id: 'sh1', technicianId: 'A', startTime: '2026-07-07T16:00:00Z', endTime: '2026-07-07T20:00:00Z', status: 'completed' };
    stateMock.mockResolvedValue(state([row({ shiftCount: 1, shifts: [shift] })]));
    render(<POSTimeClockScreen />);
    await screen.findByText('Ana');
    fireEvent.click(screen.getByRole('button', { name: 'Shifts' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Adjust' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save correction' }));
    expect(await screen.findByText('A correction reason is required.')).toBeInTheDocument();
    expect(adjustMock).not.toHaveBeenCalled();
  });
  // merge Oct 12 (other chat, WF breaks 580): a clocked-in technician can start a break or lunch; on break → End Break only
  it('starts a break / lunch for a clocked-in technician and ends it from the on-break row', async () => {
    stateMock.mockResolvedValue(state([row({ state: 'clocked_in', clockedInAt: '2026-07-07T16:00:00Z' })]));
    bsMock.mockResolvedValue({}); beMock.mockResolvedValue({});
    render(<POSTimeClockScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Lunch' }));
    await waitFor(() => expect(bsMock).toHaveBeenCalledWith('A', 'lunch'));
    fireEvent.click(await screen.findByRole('button', { name: 'Start Break' }));
    await waitFor(() => expect(bsMock).toHaveBeenCalledWith('A', 'break'));
  });
  it('an on-break technician shows On Break and only End Break (no clock-in, no clock-out)', async () => {
    stateMock.mockResolvedValue(state([row({ state: 'on_break', clockedInAt: '2026-07-07T16:00:00Z', onBreakSince: '2026-07-07T18:00:00Z' })]));
    beMock.mockResolvedValue({});
    render(<POSTimeClockScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'End Break' }));
    expect(screen.getAllByText('On Break').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Clock In' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Clock Out' })).toBeNull();
    await waitFor(() => expect(beMock).toHaveBeenCalledWith('A'));
  });
  it('a failed refresh after data loaded keeps the roster on screen (stale-while-revalidate)', async () => {
    stateMock.mockResolvedValue(state([row()]));
    inMock.mockResolvedValue({});
    render(<POSTimeClockScreen />);
    await screen.findByText('Ana');
    stateMock.mockRejectedValue(new Error('network down'));
    fireEvent.click(screen.getByRole('button', { name: 'Clock In' }));
    await waitFor(() => expect(inMock).toHaveBeenCalled());
    await waitFor(() => expect(stateMock).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Ana')).toBeInTheDocument();
  });
});
