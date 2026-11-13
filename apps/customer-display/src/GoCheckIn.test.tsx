import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { CustomerDisplayState } from '@aipowersalon/api-contracts/customer';

// Mock the public Go Check-In client so the tests exercise the real hook + flow wiring (useGoCheckIn → GoCheckIn)
// without network. Both the component and the hook import from './goCheckInApi', so one mock covers both.
const api = vi.hoisted(() => ({
  startDisplaySession: vi.fn(), completeSession: vi.fn(), heartbeat: vi.fn(), lookupPhone: vi.fn(), confirmCustomer: vi.fn(), createCustomer: vi.fn(),
  todayAppointments: vi.fn(), checkInAppointment: vi.fn(), listServices: vi.fn(), listTechnicians: vi.fn(), checkInWalkIn: vi.fn(), placeInLine: vi.fn(),
  technicianIdentify: vi.fn(), technicianClockIn: vi.fn(), technicianClockOut: vi.fn(),
  walkInCatalog: vi.fn(), walkInPreview: vi.fn(), walkInConfirm: vi.fn(),
}));
vi.mock('./goCheckInApi', () => ({ ...api, usd: (c: number) => '$' + Math.round(c / 100) }));

// Mock useDisplay too, so we can also assert the App-level idle switch (check-in on → Go Check-In vs plain Welcome).
const disp = vi.hoisted(() => ({ ret: null as any }));
vi.mock('./useDisplay', () => ({ useDisplay: () => disp.ret }));
vi.mock('./useAdPlaylist', () => ({ useAdPlaylist: () => ({ playlist: null, usable: false, panelAds: [], fullAds: [], fullScreenIdle: { enabled: false, afterSeconds: 60 }, onShown: () => undefined }) }));
vi.mock('./useCredentials', () => ({ useCredentials: () => ({ status: 'ready', creds: { mode: 'device', deviceToken: 'd1' }, paired: vi.fn(), forget: vi.fn() }) }));
vi.mock('./useHeartbeat', () => ({ useHeartbeat: () => undefined }));

import { GoCheckIn } from './GoCheckIn';
import { App } from './App';
import { DisplayApiError } from './api';

const CONFIG = {
  sessionId: 'sess1', sessionToken: 'tok1',
  config: { salonName: 'Polished Nails', settings: {
    enabled: true, appointmentCheckinEnabled: true, walkinCheckinEnabled: true, newCustomerEnabled: true,
    serviceSelectionEnabled: true, technicianPreferenceEnabled: true, tenantPhoneLookupEnabled: true,
    centralLookupEnabled: true, customerLinkingEnabled: true, showWaitEstimate: true, autoSendToQueue: true, requireFrontDeskApproval: false,
  } },
};

const type10 = () => { for (let i = 0; i < 10; i++) fireEvent.click(screen.getByRole('button', { name: '5' })); };

beforeEach(() => {
  Object.values(api).forEach((f) => (f as any).mockReset());
  // SUNMI guide 4A: these tests pin the PLAIN walk-in — the server answers the walk-in catalog with 404 (an older API);
  // the 4A service selection has its own tests (WalkInPicker.test.tsx)
  api.walkInCatalog.mockRejectedValue(new DisplayApiError(404, 'Not Found'));
  api.startDisplaySession.mockResolvedValue(CONFIG);
  api.completeSession.mockResolvedValue({ ok: true });
  api.heartbeat.mockResolvedValue({ ok: true });
  api.listServices.mockResolvedValue({ services: [{ id: 's1', name: 'Gel Manicure', priceCents: 4500, durationMinutes: 45 }] });
  api.listTechnicians.mockResolvedValue({ technicians: [{ technicianId: 't1', displayName: 'Olivia' }] });
  api.placeInLine.mockResolvedValue({ position: 3, waitingAhead: 2 });
});

describe('GoCheckIn (idle dual-purpose display)', () => {
  it('starts the guest\'s session with the DISPLAY\'s own credential (no kiosk slug) and shows the welcome + phone keypad', async () => {
    render(<GoCheckIn deviceToken="dev-tok" salon="Polished Nails" />);
    expect(screen.getByText('Check In Here')).toBeTruthy();
    expect(screen.getByText('Enter your phone number')).toBeTruthy();
    await waitFor(() => expect(api.startDisplaySession).toHaveBeenCalledWith('dev-tok'));
    await waitFor(() => expect((screen.getByText('Find My Appointment') as HTMLButtonElement).disabled).toBe(false));
  });

  it('shows the custom welcome message from config when set', async () => {
    api.startDisplaySession.mockResolvedValue({ ...CONFIG, config: { ...CONFIG.config, welcomeMessage: 'Welcome to Polished Nails!' } });
    render(<GoCheckIn deviceToken="dev-tok" salon="Polished Nails" />);
    await screen.findByText('Welcome to Polished Nails!');
  });

  it('phone lookup surfacing an appointment shows the card and checks in on "I\'m Here"', async () => {
    api.lookupPhone.mockResolvedValue({ match: { source: 'tenant', firstName: 'Sophia', lastInitial: 'M', customerId: 'c1' }, foundInTenant: true, appointment: { appointmentId: 'a1', startTimeLabel: '11:00 AM', serviceName: 'Gel Manicure', technicianName: 'Olivia' }, canWalkIn: true, canCreate: false });
    api.checkInAppointment.mockResolvedValue({ status: 'checked_in', firstName: 'Sophia', estimatedWaitMinutes: 25, estimatedWait: { fromMinutes: 25, toMinutes: 35 }, checkInId: 'ci_1' });
    render(<GoCheckIn deviceToken="dev-tok" salon="Polished Nails" />);
    await waitFor(() => expect((screen.getByText('Find My Appointment') as HTMLButtonElement).disabled).toBe(false));
    type10();
    fireEvent.click(screen.getByText('Find My Appointment'));
    await waitFor(() => expect(api.lookupPhone).toHaveBeenCalled());
    expect(api.lookupPhone.mock.calls[0][1]).toBe('5555555555');
    await screen.findByText('Appointment Found');
    expect(screen.getByText('Today at 11:00 AM')).toBeTruthy();
    expect(screen.getByText(/with Olivia/)).toBeTruthy();
    fireEvent.click(screen.getByText("I'm Here"));
    await waitFor(() => expect(api.checkInAppointment).toHaveBeenCalled());
    expect(api.checkInAppointment.mock.calls[0][1]).toBe('a1');
    await screen.findByText("You're Checked In!");
    expect(screen.getByText('Estimated Wait Time')).toBeTruthy();
    expect(screen.getByText('25–35 min')).toBeTruthy();
    await waitFor(() => expect(api.placeInLine).toHaveBeenCalled());
    expect(api.placeInLine.mock.calls[0][1]).toBe('ci_1');
    await screen.findByText('#3');
  });

  it('no appointment → walk-in name + Done checks the guest into the queue', async () => {
    api.lookupPhone.mockResolvedValue({ match: null, foundInTenant: false, appointment: null, canWalkIn: true, canCreate: true });
    api.checkInWalkIn.mockResolvedValue({ status: 'checked_in', firstName: 'Alex', estimatedWaitMinutes: 15, estimatedWait: { fromMinutes: 15, toMinutes: 25 } });
    render(<GoCheckIn deviceToken="dev-tok" salon="Polished Nails" />);
    await waitFor(() => expect((screen.getByText('Find My Appointment') as HTMLButtonElement).disabled).toBe(false));
    type10();
    fireEvent.click(screen.getByText('Find My Appointment'));
    await waitFor(() => expect(api.lookupPhone).toHaveBeenCalled());
    await screen.findByText('No appointment found');
    fireEvent.change(screen.getByPlaceholderText('Enter your first name'), { target: { value: 'Alex' } });
    await screen.findByText('Gel Manicure');
    fireEvent.click(screen.getByText('Gel Manicure'));
    fireEvent.click(screen.getByText('Done'));
    await waitFor(() => expect(api.checkInWalkIn).toHaveBeenCalled());
    expect(api.checkInWalkIn.mock.calls[0][1]).toMatchObject({ customerName: 'Alex', phone: '5555555555', serviceIds: ['s1'] });
    await screen.findByText("You're Checked In!");
    expect(screen.getByText('15–25 min')).toBeTruthy();
  });
  it('auto-returns to the welcome after the confirmation timeout', async () => {
    api.lookupPhone.mockResolvedValue({ match: null, foundInTenant: false, appointment: null, canWalkIn: true, canCreate: true });
    api.checkInWalkIn.mockResolvedValue({ status: 'checked_in', firstName: 'Alex', estimatedWaitMinutes: 5 });
    api.startDisplaySession.mockResolvedValue({ ...CONFIG, config: { ...CONFIG.config, settings: { ...CONFIG.config.settings, confirmationTimeoutSeconds: 2 } } });
    render(<GoCheckIn deviceToken="dev-tok" salon="Polished Nails" />);
    await waitFor(() => expect((screen.getByText('Find My Appointment') as HTMLButtonElement).disabled).toBe(false));
    type10();
    fireEvent.click(screen.getByText('Find My Appointment'));
    await screen.findByText('No appointment found');
    fireEvent.change(screen.getByPlaceholderText('Enter your first name'), { target: { value: 'Alex' } });
    fireEvent.click(await screen.findByText('Gel Manicure'));
    fireEvent.click(screen.getByText('Done'));
    await screen.findByText("You're Checked In!");
    await waitFor(() => expect(screen.queryByText("You're Checked In!")).toBeNull(), { timeout: 3000 });
    expect(screen.getByText('Check In Here')).toBeTruthy();
    // that guest's turn is over: their session is completed and the next guest gets a fresh one
    await waitFor(() => expect(api.startDisplaySession).toHaveBeenCalledTimes(2));
    expect(api.completeSession).toHaveBeenCalledWith({ sessionId: 'sess1', token: 'tok1' });
  });

});

describe('App idle switch — the SINGLE-COLUMN screen (a portrait tablet; the 23-inch landscape layout has its own tests)', () => {
  // jsdom's default window (1024×768) is landscape — the 23-inch layout. A portrait tablet gets this screen.
  const dims = { w: window.innerWidth, h: window.innerHeight };
  beforeEach(() => { Object.defineProperty(window, 'innerWidth', { configurable: true, value: 768 }); Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1024 }); });
  afterEach(() => { Object.defineProperty(window, 'innerWidth', { configurable: true, value: dims.w }); Object.defineProperty(window, 'innerHeight', { configurable: true, value: dims.h }); });
  const idle = (over: Partial<CustomerDisplayState> = {}): CustomerDisplayState => ({
    state: 'idle', salonName: 'Polished Nails', tipOptions: [], selectedTipCents: 0,
    totals: { subtotalCents: 0, tipCents: 0, taxCents: 0, surchargeCents: 0, giftCardChargeCents: 0, totalDueCents: 0 }, payButtonEnabled: false, ...over,
  });
  const base = { creds: { mode: 'device', deviceToken: 'd1' }, phase: 'ready', online: true, submitting: false, actionError: null, rated: null,
    chooseTip: vi.fn(), chooseMethod: vi.fn(), pay: vi.fn(), rate: vi.fn(), clearActionError: vi.fn() };

  it('renders the check-in when the server says it is on for this display — started with the display\'s credential', async () => {
    disp.ret = { ...base, data: idle({ checkIn: true }) };
    render(<App />);
    expect(screen.queryByTestId('display-23')).toBeNull();          // the single-column screen, not the 23-inch layout
    expect(screen.getByText('Check In Here')).toBeTruthy();
    await waitFor(() => expect(api.startDisplaySession).toHaveBeenCalledWith('d1'));
  });

  it('a kiosk slug alone no longer decides it: no `checkIn` → the plain Welcome, and no session is started', () => {
    disp.ret = { ...base, data: idle({ goCheckInSlug: 'branch-slug' }) };
    render(<App />);
    expect(screen.getAllByText('Welcome').length).toBeGreaterThan(0);
    expect(screen.queryByText('Check In Here')).toBeNull();
    expect(api.startDisplaySession).not.toHaveBeenCalled();
  });
});

describe('GoCheckIn — technician time clock mode', () => {
  it('switches to clock mode, identifies by PIN, and clocks in', async () => {
    api.technicianIdentify.mockResolvedValue({ technicianId: 't1', technicianName: 'Olivia Chen', avatarUrl: 'https://cdn.example.com/olivia.jpg', clockedIn: false, action: 'clock_in', clockedInAt: null, lastClockOutAt: null, hoursToday: 0, serverTime: new Date().toISOString() });
    api.technicianClockIn.mockResolvedValue({ ok: true, action: 'clock_out', technicianName: 'Olivia Chen', clockedInAt: new Date().toISOString(), serverTime: new Date().toISOString() });
    render(<GoCheckIn deviceToken="dev-tok" salon="Polished Nails" />);
    await waitFor(() => expect(api.startDisplaySession).toHaveBeenCalled());

    fireEvent.click(screen.getByText(/Technician Clock-In/));
    expect(screen.getByText('Technician Time Clock')).toBeTruthy();

    for (const d of ['7', '3', '9', '1']) fireEvent.click(screen.getByRole('button', { name: d }));
    fireEvent.click(screen.getByText('Continue'));
    await waitFor(() => expect(api.technicianIdentify).toHaveBeenCalled());
    expect(api.technicianIdentify.mock.calls[0][1]).toBe('7391');

    await screen.findByText('Olivia Chen');
    expect(document.querySelector('img[src="https://cdn.example.com/olivia.jpg"]')).toBeTruthy();
    fireEvent.click(screen.getByText('Clock In'));
    await waitFor(() => expect(api.technicianClockIn).toHaveBeenCalled());
    await screen.findByText(/You're clocked in, Olivia Chen/);
  });

  it('shows a safe error when the PIN is not recognised', async () => {
    api.technicianIdentify.mockRejectedValue(new Error('That PIN was not recognised at this location.'));
    render(<GoCheckIn deviceToken="dev-tok" salon="Polished Nails" />);
    await waitFor(() => expect(api.startDisplaySession).toHaveBeenCalled());
    fireEvent.click(screen.getByText(/Technician Clock-In/));
    for (const d of ['0', '0', '0', '0']) fireEvent.click(screen.getByRole('button', { name: d }));
    fireEvent.click(screen.getByText('Continue'));
    await screen.findByText(/not recognised/);
  });
});
