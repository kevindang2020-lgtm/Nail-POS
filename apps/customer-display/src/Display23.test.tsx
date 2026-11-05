// Display23.test.tsx — Kevin's 23-inch layout, as behaviour (spec §5–§7, §13, §26–§28, §43–§46, §79–§80, §107):
// check-in on the left/centre, the right panel dynamic — the salon's ads with no checkout, the customer's live ticket
// once checkout begins (the ad is GONE, not covered), the payment status, the completed summary, then ads again with
// nothing of the customer left; the salon's own brand on top; full-screen idle ads only when nobody is using the screen.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import type { CustomerDisplayState } from '@aipowersalon/api-contracts/customer';
import type { RotatingAd } from '@aipowersalon/ui';

const api = vi.hoisted(() => ({
  startDisplaySession: vi.fn(), completeSession: vi.fn(), heartbeat: vi.fn(), lookupPhone: vi.fn(), confirmCustomer: vi.fn(), createCustomer: vi.fn(),
  todayAppointments: vi.fn(), checkInAppointment: vi.fn(), listServices: vi.fn(), listTechnicians: vi.fn(), checkInWalkIn: vi.fn(), placeInLine: vi.fn(),
  technicianIdentify: vi.fn(), technicianClockIn: vi.fn(), technicianClockOut: vi.fn(),
}));
vi.mock('./goCheckInApi', () => ({ ...api, usd: (c: number) => '$' + Math.round(c / 100) }));

import { Display23 } from './Display23';
import { rightPanelMode, type CheckoutActions } from './CheckoutPanel';
import type { AdPlayback } from './useAdPlaylist';

const KIOSK = { sessionId: 'k1', sessionToken: 't1', config: { salonName: 'Luxury Nails', settings: {
  enabled: true, appointmentCheckinEnabled: true, walkinCheckinEnabled: true, newCustomerEnabled: true, serviceSelectionEnabled: true,
  technicianPreferenceEnabled: true, tenantPhoneLookupEnabled: true, centralLookupEnabled: false, customerLinkingEnabled: true,
  showWaitEstimate: true, autoSendToQueue: true, requireFrontDeskApproval: false, confirmationTimeoutSeconds: 8 } } };
const BRANDING = { salonName: 'Luxury Nails', logoUrl: '/media/salon-logos/t/logo-0123456789abcdef01234567.png', tagline: 'Luxury for every hand', branchName: 'Cherry Hill', idleMessage: 'Ready for our next guest' };
const idle = (o: Partial<CustomerDisplayState> = {}): CustomerDisplayState => ({
  state: 'idle', salonName: 'Luxury Nails', branding: BRANDING, tipOptions: [], selectedTipCents: 0, payButtonEnabled: false, checkIn: true,
  totals: { subtotalCents: 0, tipCents: 0, taxCents: 0, surchargeCents: 0, giftCardChargeCents: 0, totalDueCents: 0 }, ...o,
});
const checkout = (state: CustomerDisplayState['state'], o: Partial<CustomerDisplayState> = {}): CustomerDisplayState => idle({
  state, sessionId: 's1', version: 3, customer: { firstName: 'Sophia' },
  checkout: { ticketNumber: '#12', date: '2026-10-06T15:00:00.000Z', lines: [{ kind: 'service', name: 'Gel Manicure', technicianName: 'Olivia', quantity: 1, amountCents: 4500 }],
    adjustments: [], itemsSubtotalCents: 4500, discountCents: 0, taxCents: 300, customerFeeCents: 0, tipCents: 900, giftCardSaleCents: 0, totalCents: 5700,
    paidCents: state === 'payment_success' ? 5700 : 0, balanceDueCents: state === 'payment_success' ? 0 : 5700, payments: [], paymentStatus: state === 'payment_success' ? 'paid' : 'unpaid', paymentMethod: 'card', loyaltyPointsEarned: state === 'payment_success' ? 57 : undefined },
  tipOptions: [18, 20, 22].map((p) => ({ label: `${p}%`, tipType: 'percent' as const, percent: p, amountCents: 45 * p, selected: p === 20 })), selectedTipCents: 900,
  totals: { subtotalCents: 4500, tipCents: 900, taxCents: 300, surchargeCents: 0, giftCardChargeCents: 0, totalDueCents: 5700, paymentMethod: 'card' }, ...o,
});
const slide = (id: string): RotatingAd => ({ id, version: 1, durationSeconds: 8, image: { url: `blob:${id}`, width: 720, height: 1080 }, fit: 'cover', focalX: 0.5, focalY: 0.5, headline: `Ad ${id}`, subheadline: null, description: null, ctaText: null, qr: null });
const playback = (o: Partial<AdPlayback> = {}): AdPlayback => ({ playlist: null, usable: true, panelAds: [slide('a1')], fullAds: [], fullScreenIdle: { enabled: false, afterSeconds: 60 }, onShown: vi.fn(), ...o });
const actions = (): CheckoutActions => ({ submitting: false, actionError: null, rated: null, onTip: vi.fn(), onMethod: vi.fn(), onPay: vi.fn(), onRate: vi.fn(), onClearError: vi.fn() });
const panel = () => screen.getByTestId('right-panel');

beforeEach(() => {
  Object.values(api).forEach((f) => (f as any).mockReset());
  api.startDisplaySession.mockResolvedValue(KIOSK);
  api.completeSession.mockResolvedValue({ ok: true });
  api.heartbeat.mockResolvedValue({ ok: true });
  api.listServices.mockResolvedValue({ services: [{ id: 's1', name: 'Gel Manicure', priceCents: 4500, durationMinutes: 45 }] });
  api.listTechnicians.mockResolvedValue({ technicians: [{ technicianId: 't1', displayName: 'Olivia' }] });
  api.placeInLine.mockResolvedValue({ position: 3, waitingAhead: 2 });
});
afterEach(() => { vi.useRealTimers(); });

describe('§79–§80 what the right panel shows — deterministic, checkout first', () => {
  it.each([
    ['idle', 'ads'], ['disconnected', 'ads'], ['ticket_review', 'checkout'], ['tip_selected', 'checkout'],
    ['payment_processing', 'payment'], ['payment_verifying', 'payment'], ['payment_failed', 'payment'], ['payment_success', 'completed'], ['expired', 'message'],
  ] as const)('%s → %s', (state, mode) => {
    expect(rightPanelMode(idle({ state }))).toBe(mode);
  });
  it('a paid card checkout goes to the thank-you — the display never asks for a signature (the Clover terminal does); no state at all is advertising', () => {
    // even a field an older server might still send changes nothing
    expect(rightPanelMode(idle({ state: 'payment_success', ...({ signatureRequired: true } as object) }))).toBe('completed');
    expect(rightPanelMode(null)).toBe('ads');
  });
});

describe('the 23-inch screen', () => {
  it('idle: check-in on the left, the salon\'s ad on the right, the salon\'s brand on top — AI PowerSalon only as "Powered by"', async () => {
    render(<Display23 deviceToken="dev-tok" d={idle()} a={actions()} ads={playback()} />);
    await waitFor(() => expect(api.startDisplaySession).toHaveBeenCalledWith('dev-tok'));   // the display's own credential
    expect(screen.getByText('Check In Here')).toBeInTheDocument();
    expect(panel()).toHaveAttribute('data-mode', 'ads');
    expect(panel().querySelector('img[src="blob:a1"]')).not.toBeNull();
    expect(screen.getAllByText('Luxury Nails').length).toBeGreaterThan(0);
    expect(screen.getByText('Luxury for every hand · Cherry Hill')).toBeInTheDocument();
    expect(document.querySelector('.d23-head img.salon-logo')?.getAttribute('src')).toBe(BRANDING.logoUrl);
    expect(screen.getByText('Powered by AI PowerSalon')).toBeInTheDocument();
    expect(document.querySelector('img[src*="aipowersalon-logo"]')).toBeNull();   // never the platform as the salon's identity
  });

  it('no ads → the salon\'s branded panel (never blank, never another salon\'s)', () => {
    render(<Display23 deviceToken="dev-tok" d={idle()} a={actions()} ads={playback({ panelAds: [] })} />);
    expect(panel()).toHaveTextContent('Luxury Nails');
    expect(panel()).toHaveTextContent('Gift cards available');
  });

  it('checkout begins → the ad is GONE from the panel and the customer\'s ticket takes it; check-in stays usable', async () => {
    const ads = playback();
    const { rerender } = render(<Display23 deviceToken="dev-tok" d={idle()} a={actions()} ads={ads} />);
    rerender(<Display23 deviceToken="dev-tok" d={checkout('tip_selected')} a={actions()} ads={ads} />);
    expect(panel()).toHaveAttribute('data-mode', 'checkout');
    expect(panel().querySelector('.aps-adslide')).toBeNull();
    expect(screen.getByText('Hi Sophia,')).toBeInTheDocument();
    expect(screen.getByText('Gel Manicure')).toBeInTheDocument();
    expect(screen.getByText('Total due')).toBeInTheDocument();
    expect(screen.getByText('Check In Here')).toBeInTheDocument();   // §6: the check-in is still on screen
  });

  it('a tip tap is sent as a CHOICE (the server computes the money)', () => {
    const a = actions();
    render(<Display23 deviceToken="dev-tok" d={checkout('tip_selected')} a={a} ads={playback()} />);
    fireEvent.click(screen.getByText('22%'));
    expect(a.onTip).toHaveBeenCalledWith(expect.objectContaining({ tipType: 'percent', percent: 22 }));
  });

  it('§80 a payment in flight keeps the panel: processing, verifying (never "pay again"), declined — no ad covers it', () => {
    const { rerender } = render(<Display23 deviceToken="dev-tok" d={checkout('payment_processing')} a={actions()} ads={playback()} />);
    expect(screen.getByText('Processing payment')).toBeInTheDocument();
    expect(panel().querySelector('.aps-adslide')).toBeNull();
    rerender(<Display23 deviceToken="dev-tok" d={checkout('payment_verifying')} a={actions()} ads={playback()} />);
    expect(screen.getByText('Verifying payment')).toBeInTheDocument();
    expect(screen.getByText(/Please do not pay again/)).toBeInTheDocument();
    rerender(<Display23 deviceToken="dev-tok" d={checkout('payment_failed')} a={actions()} ads={playback()} />);
    expect(screen.getByText('Payment didn’t go through')).toBeInTheDocument();
  });

  it('§44 the completed summary, then §45–§46/§107: back to ads with NOTHING of the customer left in the page', () => {
    const ads = playback();
    const { rerender, container } = render(<Display23 deviceToken="dev-tok" d={checkout('payment_success')} a={actions()} ads={ads} />);
    expect(screen.getByText('Payment complete')).toBeInTheDocument();
    expect(screen.getByText('Thank you, Sophia!')).toBeInTheDocument();
    expect(screen.getByText('You earned 57 points.')).toBeInTheDocument();
    // useDisplay replaces the state with an idle shell built from nothing (useDisplay.test) — the panel follows
    rerender(<Display23 deviceToken="dev-tok" d={idle()} a={actions()} ads={ads} />);
    expect(panel()).toHaveAttribute('data-mode', 'ads');
    for (const s of ['Sophia', 'Gel Manicure', '$57.00', 'Thank you', 'Olivia']) expect(container.textContent).not.toContain(s);
  });

  it('check-in off for the branch (no `checkIn`): a welcome in the salon\'s words, ads still on the right — a kiosk slug alone changes nothing', () => {
    render(<Display23 deviceToken="dev-tok" d={idle({ checkIn: undefined, goCheckInSlug: 'lux-ch' })} a={actions()} ads={playback()} />);
    expect(screen.getByText('Welcome')).toBeInTheDocument();
    expect(screen.getAllByText('Ready for our next guest').length).toBeGreaterThan(0);
    expect(api.startDisplaySession).not.toHaveBeenCalled();
    expect(panel()).toHaveAttribute('data-mode', 'ads');
  });
});

describe('§26–§28 the check-in result, and what the next customer can see', () => {
  const type10 = () => { for (let i = 0; i < 10; i++) fireEvent.click(screen.getByRole('button', { name: '5' })); };
  it('"I\'m Here" → the footer shows the result; what was typed is already gone; the next tap clears the rest', async () => {
    api.lookupPhone.mockResolvedValue({ match: { source: 'tenant', firstName: 'Sophia', lastInitial: 'L', customerId: 'c1' }, foundInTenant: true, appointment: { appointmentId: 'a1', startTimeLabel: '11:00 AM', serviceName: 'Gel Manicure', technicianName: 'Olivia' }, canWalkIn: true, canCreate: false });
    api.checkInAppointment.mockResolvedValue({ status: 'checked_in', firstName: 'Sophia', estimatedWaitMinutes: 25, estimatedWait: { fromMinutes: 25, toMinutes: 35 }, checkInId: 'ci1' });
    render(<Display23 deviceToken="dev-tok" d={idle()} a={actions()} ads={playback()} />);
    await waitFor(() => expect((screen.getByRole('button', { name: '5' }) as HTMLButtonElement).disabled).toBe(false));
    type10();
    expect(screen.getByText('(555) 555-5555')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Find My Appointment'));
    await screen.findByText('Appointment Found');
    fireEvent.click(screen.getByText("I'm Here"));
    await screen.findByText('You’re checked in!');
    expect(screen.getByText('25–35 min')).toBeInTheDocument();
    await screen.findByText('#3');
    expect(screen.queryByText('(555) 555-5555')).toBeNull();          // the phone number left with the check-in
    expect(screen.queryByText('Appointment Found')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '1' }));        // the next customer's first tap
    expect(screen.queryByText('You’re checked in!')).toBeNull();
    expect(screen.queryByText(/Sophia/)).toBeNull();
  });

  it('the result clears itself after the salon\'s time (held to the spec\'s 5–10 s)', async () => {
    api.lookupPhone.mockResolvedValue({ match: null, foundInTenant: false, appointment: null, canWalkIn: true, canCreate: true });
    api.checkInWalkIn.mockResolvedValue({ status: 'checked_in', firstName: 'Alex', estimatedWaitMinutes: 10, estimatedWait: { fromMinutes: 10, toMinutes: 20 } });
    api.startDisplaySession.mockResolvedValue({ ...KIOSK, config: { ...KIOSK.config, settings: { ...KIOSK.config.settings, confirmationTimeoutSeconds: 60 } } });
    render(<Display23 deviceToken="dev-tok" d={idle()} a={actions()} ads={playback()} />);
    await waitFor(() => expect((screen.getByRole('button', { name: '5' }) as HTMLButtonElement).disabled).toBe(false));
    type10();
    fireEvent.click(screen.getByText('Find My Appointment'));
    await screen.findByText('No appointment found');
    fireEvent.change(screen.getByPlaceholderText('First name'), { target: { value: 'Alex' } });
    fireEvent.click(screen.getByRole('button', { name: /Gel Manicure/ }));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(screen.getByRole('button', { name: 'Check In' }));
    await screen.findByText('You’re checked in!');
    expect(api.checkInWalkIn.mock.calls[0][1]).toMatchObject({ customerName: 'Alex', phone: '5555555555' });
    await act(async () => { vi.advanceTimersByTime(9_000); });
    expect(screen.getByText('You’re checked in!')).toBeInTheDocument();   // 60 s asked for → held to 10 s
    await act(async () => { vi.advanceTimersByTime(1_100); });
    expect(screen.queryByText('You’re checked in!')).toBeNull();
    expect(screen.queryByText(/Alex/)).toBeNull();
  });
});

describe('§16–§17, §20–§25 (Unit 7) the visit, and the walk-in from the branch\'s own catalog', () => {
  const type10 = () => { for (let i = 0; i < 10; i++) fireEvent.click(screen.getByRole('button', { name: '5' })); };
  const ready = () => waitFor(() => expect((screen.getByRole('button', { name: '5' }) as HTMLButtonElement).disabled).toBe(false));
  it('a visit of several services: "Today at 11:00 AM", each with its technician — compact, "+ 2 more" opens the rest', async () => {
    const items = [
      { serviceName: 'Gel Manicure', technicianName: 'Olivia', startTimeLabel: '11:00 AM' }, { serviceName: 'Spa Pedicure', technicianName: 'Lisa', startTimeLabel: '11:00 AM' },
      { serviceName: 'Paraffin Dip', technicianName: 'Lisa', startTimeLabel: '11:00 AM' }, { serviceName: 'Nail Art', technicianName: 'Olivia', startTimeLabel: '11:45 AM' },
    ];
    api.lookupPhone.mockResolvedValue({ match: { source: 'tenant', firstName: 'Sophia', lastInitial: 'L', customerId: 'c1' }, foundInTenant: true, canWalkIn: true, canCreate: false,
      appointment: { appointmentId: 'a1', startTimeLabel: '11:00 AM', serviceName: 'Gel Manicure', technicianName: 'Olivia', items } });
    api.checkInAppointment.mockResolvedValue({ status: 'checked_in', firstName: 'Sophia', appointmentsCheckedIn: 2, estimatedWait: { fromMinutes: 5, toMinutes: 15 }, checkInId: 'ci1' });
    render(<Display23 deviceToken="dev-tok" d={idle()} a={actions()} ads={playback()} />);
    await ready(); type10();
    fireEvent.click(screen.getByText('Find My Appointment'));
    await screen.findByText('Appointment Found');
    expect(screen.getByText('Today at 11:00 AM')).toBeInTheDocument();
    expect(screen.getByText('Gel Manicure')).toBeInTheDocument();
    expect(screen.getByText('Spa Pedicure')).toBeInTheDocument();
    expect(screen.getByText('with Lisa')).toBeInTheDocument();
    expect(screen.queryByText('Paraffin Dip')).toBeNull();                       // compact: what fits, then…
    fireEvent.click(screen.getByRole('button', { name: '+ 2 more' }));
    expect(screen.getByText('Paraffin Dip')).toBeInTheDocument();                // …the rest, on request
    expect(screen.getByText('Nail Art')).toBeInTheDocument();
    expect(screen.getByText('11:45 AM')).toBeInTheDocument();                    // back to back: its own time
    expect(screen.getByRole('button', { name: 'Show less' })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByText("I'm Here"));
    await screen.findByText('You’re checked in!');
    expect(screen.getByText('Thanks, Sophia. Both of your appointments are checked in.')).toBeInTheDocument();
    expect(screen.getByText('5–15 min')).toBeInTheDocument();                    // the queue engine's band, as it came
  });

  it('services and prices from the branch; add-ons only with a service; technicians who work today and do it ("From 12:00 PM")', async () => {
    api.listServices.mockResolvedValue({ services: [
      { id: 'gel', name: 'Gel Manicure', priceCents: 5000, durationMinutes: 45, category: 'Manicure', isAddOn: false },
      { id: 'pedi', name: 'Spa Pedicure', priceCents: 6000, durationMinutes: 50, category: 'Pedicure', isAddOn: false },
      { id: 'art', name: 'Nail Art', priceCents: 1000, durationMinutes: 15, category: 'Add-ons', isAddOn: true },
    ] });
    api.listTechnicians.mockImplementation(async (_s: unknown, ids: string[] = []) => ({ technicians: ids.includes('pedi') ? [{ technicianId: 't2', name: 'Lisa', fromLabel: 'From 12:00 PM' }] : [{ technicianId: 't1', name: 'Olivia' }, { technicianId: 't2', name: 'Lisa', fromLabel: 'From 12:00 PM' }] }));
    api.lookupPhone.mockResolvedValue({ match: null, foundInTenant: false, appointment: null, canWalkIn: true, canCreate: true });
    api.checkInWalkIn.mockResolvedValue({ status: 'checked_in', firstName: 'Alex', estimatedWait: { fromMinutes: 20, toMinutes: 30 } });
    render(<Display23 deviceToken="dev-tok" d={idle()} a={actions()} ads={playback()} />);
    await ready();
    expect(await screen.findByRole('button', { name: /Gel Manicure/ })).toHaveTextContent('$50');        // this branch's price
    const art = screen.getByRole('button', { name: /Nail Art/ });
    expect(art).toBeDisabled();                                                                          // with a service
    expect(within(screen.getByRole('group', { name: 'Add-ons' })).getByText('(with a service)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Spa Pedicure/ }));
    expect(art).not.toBeDisabled();
    fireEvent.click(art);
    expect(art).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveTextContent('Lisa · From 12:00 PM'));
    expect(screen.getByRole('combobox')).not.toHaveTextContent('Olivia');                                // no pedicures
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 't2' } });
    type10();
    fireEvent.change(screen.getByPlaceholderText('First name'), { target: { value: 'Alex' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check In' }));
    await screen.findByText('You’re checked in!');
    expect(api.checkInWalkIn.mock.calls[0][1]).toMatchObject({ customerName: 'Alex', phone: '5555555555', serviceIds: ['pedi'], addOnIds: ['art'], technicianId: 't2' });
    expect(screen.getByText('20–30 min')).toBeInTheDocument();
  });
});

describe('§7 full-screen idle advertising', () => {
  const fs = (o: Partial<AdPlayback> = {}) => playback({ fullAds: [slide('f1')], fullScreenIdle: { enabled: true, afterSeconds: 30 }, ...o });
  it('after 30 s untouched it takes the screen; a touch returns — and that touch presses nothing underneath', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<Display23 deviceToken="dev-tok" d={idle()} a={actions()} ads={fs()} />);
    await act(async () => { vi.advanceTimersByTime(29_000); });
    expect(screen.queryByTestId('fullscreen-ads')).toBeNull();
    await act(async () => { vi.advanceTimersByTime(1_500); });
    const overlay = screen.getByTestId('fullscreen-ads');
    expect(overlay.querySelector('img[src="blob:f1"]')).not.toBeNull();
    expect(panel().querySelector('.aps-adslide')).toBeNull();   // the panel does not play (and count) underneath
    fireEvent.pointerDown(overlay);
    expect(screen.getByTestId('fullscreen-ads')).toHaveClass('leaving');   // still catching the rest of the touch
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(screen.queryByTestId('fullscreen-ads')).toBeNull();
    expect(screen.getByText('(555) 123-4567')).toBeInTheDocument();       // nothing was typed by that touch
  });

  it('never during a checkout; never while the salon has it off; any checkout ends it at once', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { rerender } = render(<Display23 deviceToken="dev-tok" d={checkout('tip_selected')} a={actions()} ads={fs()} />);
    await act(async () => { vi.advanceTimersByTime(90_000); });
    expect(screen.queryByTestId('fullscreen-ads')).toBeNull();
    rerender(<Display23 deviceToken="dev-tok" d={idle()} a={actions()} ads={fs({ fullScreenIdle: { enabled: false, afterSeconds: 30 } })} />);
    await act(async () => { vi.advanceTimersByTime(90_000); });
    expect(screen.queryByTestId('fullscreen-ads')).toBeNull();
    rerender(<Display23 deviceToken="dev-tok" d={idle()} a={actions()} ads={fs()} />);
    await act(async () => { vi.advanceTimersByTime(31_000); });
    expect(screen.getByTestId('fullscreen-ads')).toBeInTheDocument();
    rerender(<Display23 deviceToken="dev-tok" d={checkout('ticket_review')} a={actions()} ads={fs()} />);
    expect(screen.queryByTestId('fullscreen-ads')).toBeNull();
    expect(panel()).toHaveAttribute('data-mode', 'checkout');
  });

  it('not while someone is mid-check-in — however long they stay still; back once the screen is empty again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });   // before the render: the idle timer is armed on mount
    render(<Display23 deviceToken="dev-tok" d={idle()} a={actions()} ads={fs()} />);
    await waitFor(() => expect((screen.getByRole('button', { name: '5' }) as HTMLButtonElement).disabled).toBe(false));
    const five = screen.getByRole('button', { name: '5' });
    fireEvent.pointerDown(five); fireEvent.click(five);              // a real touch: pointerdown, then the press
    await act(async () => { vi.advanceTimersByTime(60_000); });       // they stop to find their number…
    expect(screen.queryByTestId('fullscreen-ads')).toBeNull();        // …and no ad covers what they typed
    expect(document.querySelector('.d23-phone .val')!.textContent).toBe('5');
    const clear = screen.getByRole('button', { name: 'Clear phone number' });
    fireEvent.pointerDown(clear); fireEvent.click(clear);             // the screen is empty again
    await act(async () => { vi.advanceTimersByTime(29_000); });
    expect(screen.queryByTestId('fullscreen-ads')).toBeNull();        // the 30 s count starts from that last touch
    await act(async () => { vi.advanceTimersByTime(2_000); });
    expect(screen.getByTestId('fullscreen-ads')).toBeInTheDocument();
  });
});
