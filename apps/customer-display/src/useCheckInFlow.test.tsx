// useCheckInFlow.test.tsx — the display's check-in session and flow.
//  • asked ONCE per session. Regression (Oct 6 2026, found by the Unit 4 live browser proof): useGoCheckIn returned a NEW
//    object on every render and the services/technicians effect depended on it — every answer re-rendered, re-ran the
//    effect and asked again: a tight loop of hundreds of requests a second per display (Chromium refused the overflow
//    with ERR_INSUFFICIENT_RESOURCES and the display's own checkout requests queued behind it for seconds).
//  • 23-inch spec §8, §12, §18 (Unit 7): the session is started with the DISPLAY's credential, one per guest; a session
//    the server ended is replaced; a refused start backs off.
//  • §20–§25 (Unit 7): add-ons go with a service; the walk-in minimum (first name, phone, service); technicians asked
//    again for the chosen services; an existing customer is looked up before walking in; a guest who walked away is
//    cleared.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({
  startDisplaySession: vi.fn(), completeSession: vi.fn(), heartbeat: vi.fn(), lookupPhone: vi.fn(), confirmCustomer: vi.fn(), createCustomer: vi.fn(),
  todayAppointments: vi.fn(), checkInAppointment: vi.fn(), listServices: vi.fn(), listTechnicians: vi.fn(), checkInWalkIn: vi.fn(), placeInLine: vi.fn(),
  technicianIdentify: vi.fn(), technicianClockIn: vi.fn(), technicianClockOut: vi.fn(),
}));
vi.mock('./goCheckInApi', () => ({ ...api, usd: (c: number) => '$' + Math.round(c / 100) }));

import { useGoCheckIn, START_RETRY_MS } from './useGoCheckIn';
import { useCheckInFlow, WALK_AWAY_MS } from './useCheckInFlow';
import { DisplayApiError } from './api';

const SETTINGS = {
  enabled: true, appointmentCheckinEnabled: true, walkinCheckinEnabled: true, newCustomerEnabled: true, serviceSelectionEnabled: true,
  technicianPreferenceEnabled: true, tenantPhoneLookupEnabled: true, centralLookupEnabled: false, customerLinkingEnabled: true,
  showWaitEstimate: true, autoSendToQueue: true, requireFrontDeskApproval: false, confirmationTimeoutSeconds: 8 };
let n = 0;
/** Every start is a NEW session (as from the server) — sess-1, sess-2, … */
const session = () => { n += 1; return { sessionId: `sess-${n}`, sessionToken: `tok-${n}`, config: { salonName: 'Luxury Nails', settings: { ...SETTINGS } } }; };
const GEL = { id: 'gel', name: 'Gel Manicure', priceCents: 4500, durationMinutes: 45, category: 'Manicure', isAddOn: false };
const PEDI = { id: 'pedi', name: 'Spa Pedicure', priceCents: 6000, durationMinutes: 50, category: 'Pedicure', isAddOn: false };
const ART = { id: 'art', name: 'Nail Art', priceCents: 1000, durationMinutes: 15, category: 'Add-ons', isAddOn: true };
const NO_MATCH = { match: null, foundInTenant: false, appointment: null, canWalkIn: true, canCreate: true };

beforeEach(() => {
  n = 0;
  Object.values(api).forEach((f) => (f as any).mockReset());
  api.startDisplaySession.mockImplementation(async () => session());
  api.completeSession.mockResolvedValue({ ok: true });
  api.heartbeat.mockResolvedValue({ ok: true });
  // every answer is a NEW array (as from the network) — the shape that kept the old effect re-running
  api.listServices.mockImplementation(async () => ({ services: [{ ...GEL }, { ...PEDI }, { ...ART }] }));
  api.listTechnicians.mockImplementation(async (_s: unknown, ids: string[] = []) => ({
    technicians: ids.includes('pedi') ? [{ technicianId: 'lisa', name: 'Lisa', fromLabel: 'From 12:00 PM' }] : [{ technicianId: 'lisa', name: 'Lisa' }, { technicianId: 'olivia', name: 'Olivia' }],
  }));
  api.lookupPhone.mockResolvedValue(NO_MATCH);
  api.checkInWalkIn.mockResolvedValue({ status: 'checked_in', firstName: 'Alex', estimatedWait: { fromMinutes: 10, toMinutes: 20 } });
});
afterEach(() => { vi.useRealTimers(); });

const settle = async (k = 20) => { for (let i = 0; i < k; i++) await act(async () => { await Promise.resolve(); await new Promise((r) => setTimeout(r, 1)); }); };
const flow = () => renderHook(() => useCheckInFlow(useGoCheckIn('dev-tok')));
const typePhone = (r: { current: ReturnType<typeof useCheckInFlow> }, digits = '2155550142') => { for (const k of digits) act(() => r.current.press(k)); };

describe('the check-in menu and team are asked once per session', () => {
  it('services and technicians: one request each, however many renders follow', async () => {
    const { result, rerender } = renderHook(({ k }) => { void k; return useCheckInFlow(useGoCheckIn('dev-tok')); }, { initialProps: { k: 0 } });
    await waitFor(() => expect(result.current.services).toHaveLength(3));
    await waitFor(() => expect(result.current.techs).toHaveLength(2));
    await settle();
    for (let k = 1; k <= 5; k++) rerender({ k });          // the screen re-renders for its own reasons (a clock, a keypress…)
    await settle();
    expect(api.listServices).toHaveBeenCalledTimes(1);
    expect(api.listTechnicians).toHaveBeenCalledTimes(1);
  });

  it('typing on the keypad re-renders the flow — and asks for nothing', async () => {
    const { result } = flow();
    await waitFor(() => expect(result.current.services).toHaveLength(3));
    await settle();
    typePhone(result);
    act(() => result.current.setName('Liam'));
    await settle();
    expect(result.current.phone).toBe('(215) 555-0142');
    expect(api.listServices).toHaveBeenCalledTimes(1);
    expect(api.listTechnicians).toHaveBeenCalledTimes(1);
  });

  it('even handed a fresh session object on every render, the flow asks once (it depends on the stable calls only)', async () => {
    const { result, rerender } = renderHook(({ k }) => { void k; const g = useGoCheckIn('dev-tok'); return useCheckInFlow({ ...g }); }, { initialProps: { k: 0 } });
    await waitFor(() => expect(result.current.services).toHaveLength(3));
    await settle();
    for (let k = 1; k <= 3; k++) rerender({ k });
    await settle();
    expect(api.listServices).toHaveBeenCalledTimes(1);
    expect(api.listTechnicians).toHaveBeenCalledTimes(1);
  });

  it('the session object keeps its identity between renders (so effects that depend on it stay quiet)', async () => {
    const { result, rerender } = renderHook(({ k }) => { void k; return useGoCheckIn('dev-tok'); }, { initialProps: { k: 0 } });
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    const first = result.current;
    rerender({ k: 1 }); rerender({ k: 2 });
    expect(result.current).toBe(first);
    expect(result.current.listServices).toBe(first.listServices);
  });
});

describe('§8, §12, §18 one device identity — and one session per guest', () => {
  it('the session is started with the DISPLAY\'s credential; no credential (check-in off) starts nothing', async () => {
    const { result, rerender } = renderHook(({ t }) => useGoCheckIn(t), { initialProps: { t: null as string | null } });
    await settle(5);
    expect(result.current.phase).toBe('inactive');
    expect(api.startDisplaySession).not.toHaveBeenCalled();
    rerender({ t: 'dev-tok' });
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    expect(api.startDisplaySession).toHaveBeenCalledWith('dev-tok');
    rerender({ t: null });                                   // switched off (or the display is being serviced)
    await waitFor(() => expect(result.current.phase).toBe('inactive'));
    await waitFor(() => expect(api.completeSession).toHaveBeenCalledWith({ sessionId: 'sess-1', token: 'tok-1' }));   // its session is ended
  });

  it('a guest\'s turn ends → their session is completed and the next guest\'s started; the next guest\'s calls use the NEW one', async () => {
    const { result } = flow();
    await waitFor(() => expect(result.current.gci.phase).toBe('ready'));
    typePhone(result);
    await act(async () => { await result.current.doLookup(); });
    expect(api.lookupPhone.mock.calls[0][0]).toEqual({ sessionId: 'sess-1', token: 'tok-1' });
    act(() => result.current.reset());
    await waitFor(() => expect(api.startDisplaySession).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(api.completeSession).toHaveBeenCalledWith({ sessionId: 'sess-1', token: 'tok-1' }));
    typePhone(result, '2155550199');
    await act(async () => { await result.current.doLookup(); });
    expect(api.lookupPhone.mock.calls[1][0]).toEqual({ sessionId: 'sess-2', token: 'tok-2' });   // the next guest's own allowance
    await settle();
    expect(api.listServices).toHaveBeenCalledTimes(2);       // the new session asks for the branch's menu once more
  });

  it('a session nobody used is kept — a passer-by who taps a digit and clears costs nothing', async () => {
    const { result } = flow();
    await waitFor(() => expect(result.current.gci.phase).toBe('ready'));
    act(() => result.current.press('5'));
    act(() => result.current.press('C'));
    act(() => result.current.reset());
    await settle();
    expect(api.startDisplaySession).toHaveBeenCalledTimes(1);
    expect(api.completeSession).not.toHaveBeenCalled();
  });

  it('a session the server ended (it timed out while the screen slept) is replaced — and the call made ONCE more on the fresh one', async () => {
    api.lookupPhone.mockRejectedValueOnce(new DisplayApiError(410, 'This session timed out. Please start again.')).mockResolvedValueOnce(NO_MATCH);
    const { result } = flow();
    await waitFor(() => expect(result.current.gci.phase).toBe('ready'));
    typePhone(result);
    await act(async () => { await result.current.doLookup(); });
    expect(api.startDisplaySession).toHaveBeenCalledTimes(2);
    expect(api.lookupPhone.mock.calls.map((c) => c[0].sessionId)).toEqual(['sess-1', 'sess-2']);
    expect(result.current.err).toBeNull();
    expect(result.current.lookup).toEqual(NO_MATCH);
  });

  it('any other refusal is the guest\'s answer, not a retry (the server said no)', async () => {
    api.lookupPhone.mockRejectedValueOnce(new DisplayApiError(429, 'Too many lookups. Please see the front desk.'));
    const { result } = flow();
    await waitFor(() => expect(result.current.gci.phase).toBe('ready'));
    typePhone(result);
    await act(async () => { await result.current.doLookup(); });
    expect(api.lookupPhone).toHaveBeenCalledTimes(1);
    expect(result.current.err).toBe('Too many lookups. Please see the front desk.');
  });

  it('a refused start (check-in switched off a moment ago) backs off — 15 s, then longer — never a loop against the door', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.startDisplaySession.mockRejectedValue(new DisplayApiError(403, 'Check-in is currently turned off for this salon.'));
    const { result } = renderHook(() => useGoCheckIn('dev-tok'));
    await waitFor(() => expect(result.current.phase).toBe('error'));
    expect(api.startDisplaySession).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(START_RETRY_MS[0] - 1_000); });
    expect(api.startDisplaySession).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(1_500); });
    expect(api.startDisplaySession).toHaveBeenCalledTimes(2);
    await act(async () => { vi.advanceTimersByTime(START_RETRY_MS[1] - 1_000); });
    expect(api.startDisplaySession).toHaveBeenCalledTimes(2);
    api.startDisplaySession.mockImplementation(async () => session());   // switched back on
    await act(async () => { vi.advanceTimersByTime(1_500); });
    await waitFor(() => expect(result.current.phase).toBe('ready'));
  });
});

describe('§20–§25 the walk-in', () => {
  it('add-ons go with a service: refused before one is chosen, cleared with the last one, sent as addOnIds', async () => {
    const { result } = flow();
    await waitFor(() => expect(result.current.services).toHaveLength(3));
    expect(result.current.mains.map((s) => s.id)).toEqual(['gel', 'pedi']);
    expect(result.current.addOnOptions.map((s) => s.id)).toEqual(['art']);
    act(() => result.current.toggleAddOn('art'));
    expect(result.current.addOns).toEqual([]);
    expect(result.current.err).toMatch(/Choose a service first/);
    act(() => result.current.toggleSvc('gel'));
    act(() => result.current.toggleAddOn('art'));
    expect(result.current.addOns).toEqual(['art']);
    act(() => result.current.toggleSvc('gel'));             // the last service off → its add-ons go too
    expect(result.current.addOns).toEqual([]);
    act(() => result.current.toggleSvc('gel'));
    act(() => result.current.toggleAddOn('art'));
    typePhone(result);
    act(() => result.current.setName('Alex'));
    await act(async () => { await result.current.doWalkIn(); });
    expect(api.checkInWalkIn.mock.calls[0][1]).toMatchObject({ customerName: 'Alex', phone: '2155550142', serviceIds: ['gel'], addOnIds: ['art'] });
  });

  it('the minimum (§21): a first name, the phone, a service when the salon lets guests choose — nothing more', async () => {
    const { result } = flow();
    await waitFor(() => expect(result.current.services).toHaveLength(3));
    await act(async () => { await result.current.doWalkIn(); });
    expect(result.current.err).toBe('Please enter your first name.');
    act(() => result.current.setName('Alex'));
    await act(async () => { await result.current.doWalkIn(); });
    expect(result.current.err).toBe('Please enter your phone number on the left.');
    typePhone(result);
    await act(async () => { await result.current.doWalkIn(); });
    expect(result.current.err).toBe('Please choose at least one service.');
    expect(api.checkInWalkIn).not.toHaveBeenCalled();
    act(() => result.current.toggleSvc('pedi'));
    await act(async () => { await result.current.doWalkIn(); });
    expect(api.checkInWalkIn).toHaveBeenCalledTimes(1);
    expect(result.current.confirmation).toMatchObject({ firstName: 'Alex', estimatedWait: { fromMinutes: 10, toMinutes: 20 } });
    expect(result.current.name).toBe('');                   // what was typed left with the check-in
    expect(result.current.phone).toBe('');
  });

  it('§25 technicians are asked again for the chosen services; one no longer qualified goes back to "Any available"', async () => {
    const { result } = flow();
    await waitFor(() => expect(result.current.techs.map((t) => t.technicianId)).toEqual(['lisa', 'olivia']));
    act(() => result.current.setTech('olivia'));
    act(() => result.current.toggleSvc('pedi'));
    await waitFor(() => expect(result.current.techs).toEqual([{ technicianId: 'lisa', name: 'Lisa', fromLabel: 'From 12:00 PM' }]));
    expect(api.listTechnicians.mock.lastCall?.[1]).toEqual(['pedi']);
    expect(result.current.tech).toBe('');                   // Olivia does no pedicures
  });

  it('§20 an existing customer: a number typed but never looked up is looked up first — and an appointment today is shown instead', async () => {
    api.lookupPhone.mockResolvedValueOnce({ match: { source: 'tenant', customerId: 'c-77', firstName: 'Alex', lastInitial: 'R' }, foundInTenant: true, appointment: null, canWalkIn: true, canCreate: false });
    const { result } = flow();
    await waitFor(() => expect(result.current.services).toHaveLength(3));
    typePhone(result);
    act(() => result.current.setName('Alex'));
    act(() => result.current.toggleSvc('gel'));
    await act(async () => { await result.current.doWalkIn(); });
    expect(api.lookupPhone).toHaveBeenCalledTimes(1);
    expect(api.checkInWalkIn.mock.calls[0][1]).toMatchObject({ customerId: 'c-77' });   // linked, not a duplicate profile

    const appt = { appointmentId: 'a-1', startTimeLabel: '11:00 AM', serviceName: 'Gel Manicure', technicianName: 'Olivia' };
    api.lookupPhone.mockResolvedValueOnce({ match: { source: 'tenant', customerId: 'c-9', firstName: 'Sophia', lastInitial: 'L' }, foundInTenant: true, appointment: appt, canWalkIn: true, canCreate: false });
    await waitFor(() => expect(result.current.confirmation).not.toBeNull());
    act(() => result.current.reset());
    typePhone(result, '2155550199');
    act(() => result.current.setName('Sophia'));
    act(() => result.current.toggleSvc('gel'));
    await act(async () => { await result.current.doWalkIn(); });
    expect(api.checkInWalkIn).toHaveBeenCalledTimes(1);     // not walked in…
    expect(result.current.appointment).toEqual(appt);      // …her appointment is on the screen: "I'm Here"
  });
});

describe('§28, §105, §107 a guest who walks away', () => {
  it('90 s without a touch mid-check-in clears the screen (and ends their session); a touch restarts the count', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result } = flow();
    await waitFor(() => expect(result.current.gci.phase).toBe('ready'));
    typePhone(result);
    await act(async () => { await result.current.doLookup(); });
    act(() => result.current.setName('Alex'));
    await act(async () => { vi.advanceTimersByTime(WALK_AWAY_MS - 10_000); });
    expect(result.current.name).toBe('Alex');
    await act(async () => { window.dispatchEvent(new Event('pointerdown')); });   // still there
    await act(async () => { vi.advanceTimersByTime(WALK_AWAY_MS - 10_000); });
    expect(result.current.name).toBe('Alex');
    await act(async () => { vi.advanceTimersByTime(11_000); });
    expect(result.current.name).toBe('');
    expect(result.current.phone).toBe('');
    expect(result.current.lookup).toBeNull();
    expect(result.current.idle).toBe(true);
    await waitFor(() => expect(api.startDisplaySession).toHaveBeenCalledTimes(2));   // the next guest's session
  });
});
