import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const receptionCopilot = vi.fn((_q?: string) => Promise.resolve({ ok: true, text: 'Next up: Ann at 10:00.', degraded: false }));
const receptionCopilotContext = vi.fn((_p?: string) => Promise.resolve({ matchState: 'exact', candidates: [], customer: { customerId: 'c1', fullName: 'Ann Lee', maskedPhone: '•••• 1234', returning: true, visitsCount: 4, lastVisitDate: '2026-06-20', loyaltyTier: 'gold', favoriteServiceName: 'Gel Mani', favoriteTechnicianName: 'Amy', upcomingAppointment: null } }));
const receptionCopilotQueue = vi.fn(() => Promise.resolve({ available: true, waiting: 3, inService: 1, unassigned: 1, vipWaiting: 0, longestWaitMinutes: 20 }));
const allOn = { enabled: true, actionsEnabled: true, allowCreate: true, allowReschedule: true, allowCancel: true, allowSendMessage: true };
const receptionCopilotGetSettings = vi.fn(() => Promise.resolve(allOn));
const receptionCopilotPatchSettings = vi.fn((p: any) => Promise.resolve({ ...allOn, ...p }));
vi.mock("../api/posServicesApi", () => ({ posServicesApi: { list: () => Promise.resolve([]) } }));
vi.mock("../api/posAiApi", () => ({ posAiApi: { receptionCopilot: (q: string) => receptionCopilot(q), receptionCopilotContext: (p: string) => receptionCopilotContext(p), receptionCopilotQueue: () => receptionCopilotQueue(), receptionCopilotDuplicates: () => Promise.resolve({ groups: [] }), receptionCopilotAvailability: (d: string) => Promise.resolve({ available: true, date: d, recommendations: [{ time: "10:00", technicianId: "t1", technicianName: "Amy" }], byTechnician: [] }), receptionCopilotConflict: () => Promise.resolve({ hasConflict: false, status: "ok", conflictingAppointmentId: null }), receptionCopilotTechnicians: () => Promise.resolve({ available: true, technicians: [{ technicianId: "t1", name: "Amy", firstAvailable: "10:00", openSlots: 2, isUsual: false }] }), receptionCopilotDraftMessage: () => Promise.resolve({ kind: "reminder", body: "Hi Ann, reminder2026", matched: true, customerName: "Ann" }), receptionCopilotGetSettings: () => receptionCopilotGetSettings(), receptionCopilotIntent: () => Promise.resolve({ intent: "general_question", confidence: "low", label: "General question", matched: [] }), receptionCopilotAiPhoneActivity: () => Promise.resolve({ available: false, calls: [] }), receptionCopilotExplainService: () => Promise.resolve({ found: false }), receptionCopilotWaitlist: () => Promise.resolve({ recommended: true, waiting: 2, estimatedWaitMinutes: 15, message: "Offer standby: 2 guests waiting." }), receptionCopilotNextActions: () => Promise.resolve([]), receptionCopilotPatchSettings: (p: any) => receptionCopilotPatchSettings(p) } }));
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

describe('POSReceptionCopilotScreen', () => {
  it('sends a prompt to the real assistant endpoint and shows the reply', async () => {
    render(<MemoryRouter><POSReceptionCopilotScreen /></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText(/Ask the copilot/), { target: { value: 'who is next?' } });
    fireEvent.click(screen.getByText('Send'));
    await waitFor(() => expect(receptionCopilot).toHaveBeenCalledWith('who is next?'));
    await waitFor(() => expect(screen.getByText('Next up: Ann at 10:00.')).toBeInTheDocument());
  });

  it('marks a degraded reply as a sample, not a real answer', async () => {
    receptionCopilot.mockResolvedValueOnce({ ok: true, text: '[mock] hi', degraded: true } as any);
    render(<MemoryRouter><POSReceptionCopilotScreen /></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText(/Ask the copilot/), { target: { value: 'hi' } });
    fireEvent.click(screen.getByText('Send'));
    await waitFor(() => expect(screen.getByText(/Sample response/)).toBeInTheDocument());
  });

  it('looks up a caller and shows the safe customer card', async () => {
    render(<MemoryRouter><POSReceptionCopilotScreen /></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText(/Caller phone number/), { target: { value: '8565551234' } });
    fireEvent.click(screen.getByText('Look up'));
    await waitFor(() => expect(receptionCopilotContext).toHaveBeenCalledWith('8565551234'));
    await waitFor(() => expect(screen.getByText('Ann Lee')).toBeInTheDocument());
    expect(screen.getByText('•••• 1234')).toBeInTheDocument();
  });

  it('Smooth Refresh spec §62: the caller card refreshes IN PLACE when the customer is edited on another device — even while a new number is being typed', async () => {
    const { REALTIME_EVENT } = await import('../realtime/realtime-client');
    render(<MemoryRouter><POSReceptionCopilotScreen /></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText(/Caller phone number/), { target: { value: '8565551234' } });
    fireEvent.click(screen.getByText('Look up'));
    await waitFor(() => expect(screen.getByText('Ann Lee')).toBeInTheDocument());
    const first = await receptionCopilotContext.mock.results[receptionCopilotContext.mock.results.length - 1].value;
    receptionCopilotContext.mockResolvedValueOnce({ ...first, customer: { ...first.customer, fullName: 'Ann Lee-Park' } } as any);
    fireEvent.change(screen.getByPlaceholderText(/Caller phone number/), { target: { value: '85' } });   // she starts another lookup
    const calls = receptionCopilotContext.mock.calls.length;
    window.dispatchEvent(new CustomEvent(REALTIME_EVENT, { detail: { event: 'customer_profile_updated', screens: ['customers'] } }));
    await waitFor(() => expect(receptionCopilotContext.mock.calls.length).toBe(calls + 1));
    expect(receptionCopilotContext.mock.calls[calls][0]).toBe('8565551234');                        // the number on screen, not the half-typed one
    await waitFor(() => expect(screen.getByText('Ann Lee-Park')).toBeInTheDocument());
    expect((screen.getByPlaceholderText(/Caller phone number/) as HTMLInputElement).value).toBe('85');   // her typing is untouched
  });

  it('shows an unknown-caller state honestly', async () => {
    receptionCopilotContext.mockResolvedValueOnce({ matchState: 'none', candidates: [], customer: null } as any);
    render(<MemoryRouter><POSReceptionCopilotScreen /></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText(/Caller phone number/), { target: { value: '0000' } });
    fireEvent.click(screen.getByText('Look up'));
    await waitFor(() => expect(screen.getByText(/Unknown caller/)).toBeInTheDocument());
  });

  it('cancel action is prepared on the server (no write) and runs only after an explicit confirmation', async () => {
    render(<MemoryRouter><POSReceptionCopilotScreen /></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText('Appointment ID'), { target: { value: 'appt_1' } });
    fireEvent.change(screen.getByPlaceholderText('Reason'), { target: { value: 'customer request' } });
    fireEvent.click(screen.getByText('Prepare'));
    await waitFor(() => expect(ccPrepare).toHaveBeenCalledWith({ type: 'cancel_appointment', appointmentId: 'appt_1', reason: 'customer request' }));
    // a review card appears; nothing has been executed yet
    await waitFor(() => expect(screen.getByTestId('rcc-cancel')).toBeInTheDocument());
    expect(ccConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Confirm cancel'));
    await waitFor(() => expect(ccConfirm).toHaveBeenCalledWith({ type: 'cancel_appointment', appointmentId: 'appt_1', reason: 'customer request' }, 'tok-1'));
    await waitFor(() => expect(screen.getByTestId('rcc-cancel-outcome')).toHaveAttribute('data-state', 'completed'));
  });

  it('reschedule action also requires an explicit confirmation of the reviewed move', async () => {
    ccConfirm.mockClear();
    render(<MemoryRouter><POSReceptionCopilotScreen /></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText('Appt ID to move'), { target: { value: 'appt_2' } });
    fireEvent.change(screen.getByPlaceholderText('11:15'), { target: { value: '11:15' } });
    fireEvent.click(screen.getByText('Review'));
    await waitFor(() => expect(screen.getByTestId('rcc-resched')).toBeInTheDocument());
    expect(ccConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Confirm reschedule'));
    await waitFor(() => expect(ccConfirm).toHaveBeenCalledWith({ type: 'reschedule_appointment', appointmentId: 'appt_2', startTime: '11:15' }, 'tok-1'));
    await waitFor(() => expect(screen.getByTestId('rcc-resched-outcome')).toBeInTheDocument());
  });

  it('disables an action when its Copilot setting is turned off', async () => {
    receptionCopilotGetSettings.mockResolvedValueOnce({ ...allOn, allowCancel: false });
    render(<MemoryRouter><POSReceptionCopilotScreen /></MemoryRouter>);
    // Wait for settings to load, then the cancel Prepare button should be disabled even with valid inputs.
    await waitFor(() => expect(screen.getByText('Copilot settings')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText('Appointment ID'), { target: { value: 'appt_1' } });
    fireEvent.change(screen.getByPlaceholderText('Reason'), { target: { value: 'x' } });
    await waitFor(() => expect(screen.getByText('Prepare').closest('button')).toBeDisabled());
  });

  it('shows an access-denied state with a plans link', async () => {
    receptionCopilot.mockResolvedValueOnce({ ok: false, decision: { label: 'Not subscribed', reason: 'unpaid' } } as any);
    render(<MemoryRouter><POSReceptionCopilotScreen /></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText(/Ask the copilot/), { target: { value: 'hi' } });
    fireEvent.click(screen.getByText('Send'));
    await waitFor(() => expect(screen.getByText('Not subscribed')).toBeInTheDocument());
    expect(screen.getByText('View plans')).toBeInTheDocument();
  });
});

describe('Copilot gap-closure panels (§1)', () => {
  it('renders the AI-phone activity, service explainer, and waitlist panels', async () => {
    render(<MemoryRouter><POSReceptionCopilotScreen /></MemoryRouter>);
    expect(await screen.findByText('AI Phone Receptionist — recent activity')).toBeInTheDocument();
    expect(await screen.findByText('Explain a service')).toBeInTheDocument();
    expect(await screen.findByText(/Offer standby: 2 guests waiting/)).toBeInTheDocument();  // waitlist advisory from live queue
  });
});

describe('Copilot panels accessibility (§54)', () => {
  it('panels expose labelled regions and a screen-reader-labelled select', async () => {
    render(<MemoryRouter><POSReceptionCopilotScreen /></MemoryRouter>);
    expect(await screen.findByRole('region', { name: 'AI Phone Receptionist recent activity' })).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'Explain a service' })).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'Waitlist and standby' })).toBeInTheDocument();
    // the service select is labelled for screen readers
    expect(await screen.findByRole('combobox', { name: /explain a service/i })).toBeInTheDocument();
  });
});
