import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const receptionCopilot = vi.fn((_q?: string) => Promise.resolve({ ok: true, text: 'Next up: Ann at 10:00.', degraded: false }));
const receptionCopilotContext = vi.fn((_p?: string) => Promise.resolve({ matchState: 'exact', candidates: [], customer: { customerId: 'c1', fullName: 'Ann Lee', maskedPhone: '•••• 1234', returning: true, visitsCount: 4, lastVisitDate: '2026-06-20', loyaltyTier: 'gold', favoriteServiceName: 'Gel Mani', favoriteTechnicianName: 'Amy', upcomingAppointment: null } }));
const receptionCopilotQueue = vi.fn(() => Promise.resolve({ available: true, waiting: 3, inService: 1, unassigned: 1, vipWaiting: 0, longestWaitMinutes: 20 }));
const receptionCopilotSendMessage = vi.fn((..._a: any[]) => Promise.resolve({ ok: true }));
const allOn = { enabled: true, actionsEnabled: true, allowCreate: true, allowReschedule: true, allowCancel: true, allowSendMessage: true };
const receptionCopilotGetSettings = vi.fn(() => Promise.resolve(allOn));
const receptionCopilotPatchSettings = vi.fn((p: any) => Promise.resolve({ ...allOn, ...p }));
const receptionCopilotRescheduleAppointment = vi.fn((..._a: any[]) => Promise.resolve({ ok: true }));
const receptionCopilotCancelAppointment = vi.fn((_id?: string, _r?: string, _c?: boolean) => Promise.resolve({ ok: true }));
vi.mock("../api/posServicesApi", () => ({ posServicesApi: { list: () => Promise.resolve([]) } }));
vi.mock("../api/posAiApi", () => ({ posAiApi: { receptionCopilot: (q: string) => receptionCopilot(q), receptionCopilotContext: (p: string) => receptionCopilotContext(p), receptionCopilotQueue: () => receptionCopilotQueue(), receptionCopilotDuplicates: () => Promise.resolve({ groups: [] }), receptionCopilotAvailability: (d: string) => Promise.resolve({ available: true, date: d, recommendations: [{ time: "10:00", technicianId: "t1", technicianName: "Amy" }], byTechnician: [] }), receptionCopilotConflict: () => Promise.resolve({ hasConflict: false, status: "ok", conflictingAppointmentId: null }), receptionCopilotTechnicians: () => Promise.resolve({ available: true, technicians: [{ technicianId: "t1", name: "Amy", firstAvailable: "10:00", openSlots: 2, isUsual: false }] }), receptionCopilotCancelAppointment: (id: string, r: string, c: boolean) => receptionCopilotCancelAppointment(id, r, c), receptionCopilotRescheduleAppointment: (...a: any[]) => receptionCopilotRescheduleAppointment(...a), receptionCopilotCreateAppointment: () => Promise.resolve({ ok: true }), receptionCopilotSendMessage: (...a: any[]) => receptionCopilotSendMessage(...a), receptionCopilotDraftMessage: () => Promise.resolve({ kind: "reminder", body: "Hi Ann, reminder2026", matched: true, customerName: "Ann" }), receptionCopilotGetSettings: () => receptionCopilotGetSettings(), receptionCopilotIntent: () => Promise.resolve({ intent: "general_question", confidence: "low", label: "General question", matched: [] }), receptionCopilotAiPhoneActivity: () => Promise.resolve({ available: false, calls: [] }), receptionCopilotExplainService: () => Promise.resolve({ found: false }), receptionCopilotWaitlist: () => Promise.resolve({ recommended: true, waiting: 2, estimatedWaitMinutes: 15, message: "Offer standby: 2 guests waiting." }), receptionCopilotNextActions: () => Promise.resolve([]), receptionCopilotPatchSettings: (p: any) => receptionCopilotPatchSettings(p) } }));
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

  it('cancel action requires an explicit confirmation card before it executes', async () => {
    render(<MemoryRouter><POSReceptionCopilotScreen /></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText('Appointment ID'), { target: { value: 'appt_1' } });
    fireEvent.change(screen.getByPlaceholderText('Reason'), { target: { value: 'customer request' } });
    fireEvent.click(screen.getByText('Prepare'));
    // A confirmation card appears; nothing has been sent yet.
    await waitFor(() => expect(screen.getByText('Confirm: cancel appointment?')).toBeInTheDocument());
    expect(receptionCopilotCancelAppointment).not.toHaveBeenCalled();
    // Only after confirming does it call the backend with confirm=true.
    fireEvent.click(screen.getByText('Confirm cancel'));
    await waitFor(() => expect(receptionCopilotCancelAppointment).toHaveBeenCalledWith('appt_1', 'customer request', true));
    await waitFor(() => expect(screen.getByText('Appointment cancelled.')).toBeInTheDocument());
  });

  it('reschedule action also requires an explicit confirmation before executing', async () => {
    render(<MemoryRouter><POSReceptionCopilotScreen /></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText('Appt ID to move'), { target: { value: 'appt_2' } });
    fireEvent.change(screen.getByPlaceholderText('11:15'), { target: { value: '11:15' } });
    fireEvent.click(screen.getByText('Review'));
    await waitFor(() => expect(screen.getByText('Confirm: reschedule appointment?')).toBeInTheDocument());
    expect(receptionCopilotRescheduleAppointment).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Confirm reschedule'));
    await waitFor(() => expect(receptionCopilotRescheduleAppointment).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('Appointment rescheduled.')).toBeInTheDocument());
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
