// Fair Turn §35–40 on the Time Clock: an interrupted break (inline reason), a classified break list with a correction
// (append-only on the server), and the salon break policy panel (read + save).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
const m = vi.hoisted(() => ({ state: vi.fn(), breakInterrupt: vi.fn(), breakPolicy: vi.fn(), saveBreakPolicy: vi.fn(), adjustBreak: vi.fn(), breakEnd: vi.fn() }));
vi.mock('../api/posTimeClockApi', () => ({ posTimeClockApi: { state: m.state, breakInterrupt: m.breakInterrupt, breakPolicy: m.breakPolicy, saveBreakPolicy: m.saveBreakPolicy, adjustBreak: m.adjustBreak, breakEnd: m.breakEnd, clockIn: vi.fn(), clockOut: vi.fn(), breakStart: vi.fn(), resetClockPin: vi.fn(), adjustTimecard: vi.fn() } }));
import { POSTimeClockScreen } from './POSTimeClockScreen';

const POLICY = { jurisdiction: 'US-FEDERAL', restBreakPaidUpToMinutes: 20, mealBreakMinMinutes: 30, interruptedMealCompensable: true, kindDefaults: { break: 'rest', lunch: 'meal' } };
const row = (o: any = {}) => ({ technicianId: 'A', technicianName: 'Ana', state: 'clocked_in', clockedInAt: '2026-03-02T14:00:00Z', onBreakSince: null, lastClockOutAt: null, hoursToday: 3, shiftCount: 1,
  shifts: [{ id: 's1', technicianId: 'A', startTime: '2026-03-02T14:00:00Z', endTime: null, status: 'active' }], breaks: [], ...o });
const state = (techs: any[]) => ({ kpis: { technicianCount: techs.length, clockedInCount: techs.length, totalHoursToday: 3 }, technicians: techs });

beforeEach(() => { Object.values(m).forEach((f) => f.mockReset()); m.breakPolicy.mockResolvedValue({ policy: POLICY, defaults: POLICY, version: 0, salon: null, branch: null }); });

describe('POSTimeClockScreen — breaks', () => {
  it('records an interrupted break with an inline reason', async () => {
    m.state.mockResolvedValue(state([row({ state: 'on_break', onBreakSince: '2026-03-02T17:00:00Z' })]));
    m.breakInterrupt.mockResolvedValue({});
    render(<POSTimeClockScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Interrupted' }));
    fireEvent.change(await screen.findByLabelText('Your answer'), { target: { value: 'walk-in rush' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record interruption' }));
    await waitFor(() => expect(m.breakInterrupt).toHaveBeenCalledWith('A', 'walk-in rush'));
  });
  it('lists the classified breaks and corrects one with a reason', async () => {
    m.state.mockResolvedValue(state([row({ breaks: [{ id: 'b1', kind: 'lunch', startedAt: '2026-03-02T17:00:00Z', endedAt: '2026-03-02T17:20:00Z', classification: 'paid_meal_short', paidMinutes: 20, unpaidMinutes: 0, interrupted: false }] })]));
    m.adjustBreak.mockResolvedValue({});
    render(<POSTimeClockScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Shifts' }));
    expect(await screen.findByText(/Paid \(meal too short\) · paid 20m \/ unpaid 0m/)).toBeInTheDocument();
    const adjusts = screen.getAllByRole('button', { name: 'Adjust' });
    fireEvent.click(adjusts[adjusts.length - 1]);
    fireEvent.click(screen.getByRole('button', { name: 'Save break' }));
    expect(m.adjustBreak).not.toHaveBeenCalled();   // a reason is required
    fireEvent.change(screen.getByLabelText('Break correction reason'), { target: { value: 'forgot to end lunch' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save break' }));
    await waitFor(() => expect(m.adjustBreak).toHaveBeenCalledWith('b1', expect.objectContaining({ reason: 'forgot to end lunch', startedAt: '2026-03-02T17:00:00.000Z', endedAt: '2026-03-02T17:20:00.000Z' })));
  });
  it('shows the break policy and saves an edit', async () => {
    m.state.mockResolvedValue(state([row()]));
    m.saveBreakPolicy.mockResolvedValue({ policy: { ...POLICY, restBreakPaidUpToMinutes: 15 }, defaults: POLICY, version: 1, salon: null, branch: null });
    render(<POSTimeClockScreen />);
    expect(await screen.findByText(/rest breaks paid up to/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Paid rest minutes'), { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save policy' }));
    await waitFor(() => expect(m.saveBreakPolicy).toHaveBeenCalledWith({ scope: 'salon', policy: { jurisdiction: 'US-FEDERAL', restBreakPaidUpToMinutes: 15, mealBreakMinMinutes: 30, interruptedMealCompensable: true } }));
    expect(await screen.findByText('15 min')).toBeInTheDocument();
  });
  it('shows an honest error when the policy cannot be read', async () => {
    m.state.mockResolvedValue(state([row()]));
    m.breakPolicy.mockRejectedValue(new Error('Policy unavailable'));
    render(<POSTimeClockScreen />);
    expect(await screen.findByText('Policy unavailable')).toBeInTheDocument();
  });
});
