// WalkInPicker.test.tsx — CPad 14 Walk-In service selection (SUNMI guide Section 4A) on the 23-inch / CPad landscape
// display, as behaviour: the salon's OWN categories (never a fixed list), search, a category's services, several services
// from several categories with an add-on, the SERVER's review ("Estimated service total"), ONE confirm per request id,
// a changed catalog renewing the approval, a gone service blocking the confirm, fail-closed offline, and the privacy reset.
// Ids W02–W06, W09, W11 of the guide's 4A.11 are named in the titles (W01/W07/W08/W10 are the server's pgtest).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within, cleanup } from '@testing-library/react';
import type { CustomerDisplayState, WalkInCatalog, WalkInPreview } from '@aipowersalon/api-contracts/customer';
import type { RotatingAd } from '@aipowersalon/ui';

const api = vi.hoisted(() => ({
  startDisplaySession: vi.fn(), completeSession: vi.fn(), heartbeat: vi.fn(), lookupPhone: vi.fn(), confirmCustomer: vi.fn(), createCustomer: vi.fn(),
  todayAppointments: vi.fn(), checkInAppointment: vi.fn(), listServices: vi.fn(), listTechnicians: vi.fn(), checkInWalkIn: vi.fn(), placeInLine: vi.fn(),
  technicianIdentify: vi.fn(), technicianClockIn: vi.fn(), technicianClockOut: vi.fn(),
  walkInCatalog: vi.fn(), walkInPreview: vi.fn(), walkInConfirm: vi.fn(),
}));
vi.mock('./goCheckInApi', () => ({ ...api, usd: (c: number) => '$' + Math.round(c / 100) }));

import { Display23 } from './Display23';
import type { CheckoutActions } from './CheckoutPanel';
import type { AdPlayback } from './useAdPlaylist';
import { CheckInApiError, DisplayApiError } from './api';
import { WALK_AWAY_MS } from './useCheckInFlow';
import { CATALOG_RECHECK_MS } from './useWalkInSelection';

// a salon's own catalog — deliberately NOT the guide's sample categories, so nothing can be hard-coded to pass
const RULES = { requireServices: true, showPrices: true, showDurations: true, allowAddOns: true, allowTechnicianPreference: false, notesMaxLength: 200 };
const CATALOG: WalkInCatalog = {
  revision: 'rev-1', rules: RULES,
  categories: [{ id: 'c-hands', name: 'Hands & Polish', description: 'Our hand services', iconKey: null, serviceCount: 2 }, { id: 'c-feet', name: 'Foot Spa', description: null, iconKey: null, serviceCount: 1 }],
  services: [
    { id: 'svc-gel', name: 'Signature Gel', description: 'Two coats, cured', categoryId: 'c-hands', priceCents: 4250, priceIsFrom: false, durationMinutes: 40, addOnIds: ['ao-chrome'] },
    { id: 'svc-buff', name: 'Buff & Shine', description: null, categoryId: 'c-hands', priceCents: 1800, priceIsFrom: false, durationMinutes: null, addOnIds: ['ao-chrome'] },
    { id: 'svc-soak', name: 'Herbal Soak', description: null, categoryId: 'c-feet', priceCents: 5500, priceIsFrom: false, durationMinutes: 55, addOnIds: ['ao-chrome'] },
  ],
  addOns: [{ id: 'ao-chrome', name: 'Chrome Powder', priceCents: 900, durationMinutes: 10 }],
};
const okPreview = (lines: { serviceId: string; addOnIds?: string[] }[], o: Partial<WalkInPreview> = {}): WalkInPreview => {
  const out = lines.map((l) => {
    const s = CATALOG.services.find((x) => x.id === l.serviceId)!;
    return { serviceId: s.id, name: s.name, state: 'ok' as const, priceCents: s.priceCents, durationMinutes: s.durationMinutes, addOns: (l.addOnIds ?? []).map((id) => ({ id, name: 'Chrome Powder', state: 'ok' as const, priceCents: 900, durationMinutes: 10 })) };
  });
  const total = out.reduce((n, l) => n + (l.priceCents ?? 0) + l.addOns.reduce((m, a) => m + (a.priceCents ?? 0), 0), 0);
  const mins = out.reduce((n, l) => n + (l.durationMinutes ?? 0) + l.addOns.reduce((m, a) => m + (a.durationMinutes ?? 0), 0), 0);
  return { revision: 'rev-1', lines: out, estimatedTotalCents: total, estimatedMinutes: mins || null, confirmable: true, warnings: [], ...o };
};
const SESSION = { sessionId: 'k1', sessionToken: 't1', config: { salonName: 'Test Salon', settings: {
  enabled: true, appointmentCheckinEnabled: true, walkinCheckinEnabled: true, newCustomerEnabled: true, serviceSelectionEnabled: true,
  technicianPreferenceEnabled: false, tenantPhoneLookupEnabled: true, centralLookupEnabled: false, customerLinkingEnabled: true,
  showWaitEstimate: true, autoSendToQueue: true, requireFrontDeskApproval: false, confirmationTimeoutSeconds: 8 } } };
const idle = (o: Partial<CustomerDisplayState> = {}): CustomerDisplayState => ({
  state: 'idle', salonName: 'Test Salon', branding: { salonName: 'Test Salon', logoUrl: null, tagline: null, branchName: null, idleMessage: null }, tipOptions: [], selectedTipCents: 0, payButtonEnabled: false, checkIn: true,
  totals: { subtotalCents: 0, tipCents: 0, taxCents: 0, surchargeCents: 0, giftCardChargeCents: 0, totalDueCents: 0 }, ...o,
});
const slide = (id: string): RotatingAd => ({ id, version: 1, durationSeconds: 8, image: { url: `blob:${id}`, width: 720, height: 1080 }, fit: 'cover', focalX: 0.5, focalY: 0.5, headline: `Ad ${id}`, subheadline: null, description: null, ctaText: null, qr: null });
const playback = (): AdPlayback => ({ playlist: null, usable: true, panelAds: [slide('a1')], fullAds: [], fullScreenIdle: { enabled: false, afterSeconds: 60 }, onShown: vi.fn() });
const actions = (): CheckoutActions => ({ submitting: false, actionError: null, rated: null, onTip: vi.fn(), onMethod: vi.fn(), onPay: vi.fn(), onRate: vi.fn(), onClearError: vi.fn() });

beforeEach(() => {
  Object.values(api).forEach((f) => (f as any).mockReset());
  // the CPad 14: 1920 × 1200 landscape
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1920 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1200 });
  api.startDisplaySession.mockResolvedValue(SESSION);
  api.completeSession.mockResolvedValue({ ok: true });
  api.heartbeat.mockResolvedValue({ ok: true });
  api.listServices.mockResolvedValue({ services: [] });
  api.listTechnicians.mockResolvedValue({ technicians: [] });
  api.placeInLine.mockResolvedValue({ position: 2, waitingAhead: 1 });
  api.lookupPhone.mockResolvedValue({ match: null, foundInTenant: false, appointment: null, canWalkIn: true, canCreate: true });
  api.walkInCatalog.mockImplementation(async (_s: unknown, rev?: string) => (rev === CATALOG.revision ? { revision: rev, notModified: true, rules: RULES, categories: [], services: [], addOns: [] } : CATALOG));
  api.walkInPreview.mockImplementation(async (_s: unknown, lines: { serviceId: string; addOnIds?: string[] }[]) => okPreview(lines));
  api.walkInConfirm.mockImplementation(async (_s: unknown, body: any) => ({ status: 'checked_in', firstName: 'Mai', checkInId: 'q1', checkinRequestId: body.checkinRequestId, requestState: 'queued', replayed: false, servicesPending: !!body.skipServices, estimatedWait: { fromMinutes: 10, toMinutes: 20 } }));
});
afterEach(() => { vi.useRealTimers(); });

const type10 = () => { for (let i = 0; i < 10; i++) fireEvent.click(screen.getByRole('button', { name: '5' })); };
const ready = () => waitFor(() => expect((screen.getByRole('button', { name: '5' }) as HTMLButtonElement).disabled).toBe(false));
/** Welcome → phone → first name → "Choose Your Services" (the walk-in path). */
async function openPicker(name = 'Mai') {
  render(<Display23 deviceToken="dev-tok" d={idle()} a={actions()} ads={playback()} />);
  await ready();
  type10();
  fireEvent.change(screen.getByPlaceholderText('First name'), { target: { value: name } });
  const go = await screen.findByRole('button', { name: 'Choose Your Services' });
  await waitFor(() => expect(go).not.toBeDisabled());
  fireEvent.click(go);
  return screen.findByTestId('walkin-picker');
}
const tile = (name: string) => screen.getByRole('button', { name: new RegExp(name) });

describe('W02 browse and search — the salon\'s own categories at 1920×1200', () => {
  it('category tiles come from THIS salon\'s catalog; a category lists name, description, price, duration; Back; the list scrolls inside, Review stays pinned', async () => {
    const picker = await openPicker();
    expect(within(picker).getByText('Walk-In | Choose Your Services')).toBeInTheDocument();
    expect(within(picker).getByText('Choose Your Services')).toBeInTheDocument();
    expect(tile('Hands & Polish')).toHaveTextContent('2 services');
    expect(tile('Foot Spa')).toHaveTextContent('1 service');
    expect(within(picker).queryByText('Manicure')).toBeNull();          // the guide's sample names are not on this salon's screen
    expect(screen.getByRole('button', { name: 'Review My Services' })).toBeDisabled();   // W04: nothing picked yet
    fireEvent.click(tile('Hands & Polish'));
    const gel = screen.getByTestId('wis-svc-svc-gel');
    expect(gel).toHaveTextContent('Signature Gel');
    expect(gel).toHaveTextContent('Two coats, cured');
    expect(gel).toHaveTextContent('$42.50');
    expect(gel).toHaveTextContent('40 min');
    expect(screen.getByTestId('wis-svc-svc-buff')).not.toHaveTextContent('min');   // no duration set → none shown
    // layout: the list is inside its own scroller; the count + Review are in the pinned footer, outside it
    const scroller = picker.querySelector('.wis-scroll')!;
    expect(scroller.contains(gel)).toBe(true);
    expect(scroller.contains(screen.getByRole('button', { name: 'Review My Services' }))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '‹ Back' }));
    expect(tile('Foot Spa')).toBeInTheDocument();
    // search: name, description or category, accents/case ignored
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'SOAK' } });
    expect(screen.getByTestId('wis-svc-svc-soak')).toBeInTheDocument();
    expect(screen.queryByTestId('wis-svc-svc-gel')).toBeNull();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'hands' } });
    expect(screen.getByTestId('wis-svc-svc-gel')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zzz' } });
    expect(screen.getByText('No services match your search.')).toBeInTheDocument();
  });
  it('the picker takes the whole screen while the guest chooses (the salon\'s ads are covered); during a checkout it takes the check-in side only', async () => {
    render(<Display23 deviceToken="dev-tok" d={idle()} a={actions()} ads={playback()} />);
    await ready();
    expect(within(screen.getByTestId('right-panel')).getByText('Ad a1')).toBeInTheDocument();   // idle: the salon's ad
    cleanup();
    const picker = await openPicker();
    expect(picker).not.toHaveClass('in-main');
    expect(picker.closest('.d23-main')).toBeNull();
    expect(within(screen.getByTestId('right-panel')).queryByText('Ad a1')).toBeNull();          // gone while the guest chooses
  });
});

describe('W03 several services from several categories, with an add-on → the server\'s review → ONE confirm', () => {
  it('Signature Gel + Chrome Powder + Herbal Soak: the review is the server\'s estimate; Confirm sends one request with the picks and a request id', async () => {
    await openPicker();
    fireEvent.click(tile('Hands & Polish'));
    fireEvent.click(screen.getByRole('button', { name: 'Add Signature Gel' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Add-ons for Signature Gel' })).getByRole('button', { name: /Chrome Powder/ }));
    fireEvent.click(screen.getByRole('button', { name: '‹ Back' }));
    expect(tile('Hands & Polish')).toHaveTextContent('1 selected');
    fireEvent.click(tile('Foot Spa'));
    fireEvent.click(screen.getByRole('button', { name: 'Add Herbal Soak' }));
    expect(screen.getByText('Selected: 2 services')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review My Services' }));
    const total = await screen.findByTestId('wis-total');
    expect(total).toHaveTextContent('Estimated service total');
    expect(total).toHaveTextContent('$106.50');                          // 42.50 + 9 + 55 — from the server's preview
    expect(total).toHaveTextContent('105 min');
    expect(total).toHaveTextContent('Final prices, tax, discounts and tips are calculated at checkout.');
    expect(api.walkInPreview).toHaveBeenLastCalledWith(expect.anything(), [
      { serviceId: 'svc-gel', addOnIds: ['ao-chrome'], shownName: 'Signature Gel', shownPriceCents: 4250 },
      { serviceId: 'svc-soak', addOnIds: [], shownName: 'Herbal Soak', shownPriceCents: 5500 },
    ], 'rev-1');
    fireEvent.change(screen.getByPlaceholderText(/short nails/), { target: { value: 'x'.repeat(300) } });
    expect((screen.getByPlaceholderText(/short nails/) as HTMLTextAreaElement).value).toHaveLength(200);
    fireEvent.click(screen.getByTestId('wis-confirm'));
    await screen.findByText('You’re checked in!');
    expect(api.walkInConfirm).toHaveBeenCalledTimes(1);
    const body = api.walkInConfirm.mock.calls[0][1];
    expect(body).toMatchObject({ approvedRevision: 'rev-1', customerName: 'Mai', phone: '5555555555', skipServices: false, lines: [{ serviceId: 'svc-gel', addOnIds: ['ao-chrome'] }, { serviceId: 'svc-soak', addOnIds: [] }] });
    expect(body.checkinRequestId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(api.checkInWalkIn).not.toHaveBeenCalled();                   // the 4A path, not the plain walk-in
    expect(screen.queryByTestId('walkin-picker')).toBeNull();           // W11: the picker is gone…
    expect((screen.getByPlaceholderText('First name') as HTMLInputElement).value).toBe('');   // …and what the guest typed
  });
});

describe('W04 required selection — and the owner\'s skip', () => {
  it('required (default): no Skip, Review disabled until a service is picked', async () => {
    await openPicker();
    expect(screen.queryByRole('button', { name: /Skip/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Review My Services' })).toBeDisabled();
  });
  it('the owner allows skipping: "Skip — I need help choosing" → a review saying services pending → confirm sends skipServices', async () => {
    api.walkInCatalog.mockResolvedValue({ ...CATALOG, rules: { ...RULES, requireServices: false } });
    api.walkInPreview.mockResolvedValue({ revision: 'rev-1', lines: [], estimatedTotalCents: 0, estimatedMinutes: null, confirmable: true, warnings: [] });
    await openPicker();
    fireEvent.click(screen.getByRole('button', { name: 'Skip — I need help choosing' }));
    expect(await screen.findByTestId('wis-pending')).toHaveTextContent('services pending');
    await waitFor(() => expect(screen.getByTestId('wis-confirm')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('wis-confirm'));
    await screen.findByText('You’re checked in!');
    expect(api.walkInConfirm.mock.calls[0][1]).toMatchObject({ lines: [], skipServices: true });
  });
});

describe('W05 price updates — the approval is renewed', () => {
  it('the server refuses a stale approval with today\'s prices: the review shows them, says so, and only a NEW tap confirms (a new request id)', async () => {
    const changed = okPreview([{ serviceId: 'svc-gel' }], { revision: 'rev-2' });
    changed.lines[0] = { ...changed.lines[0], state: 'changed', priceCents: 4800 };
    changed.estimatedTotalCents = 4800;
    // the owner repriced while the guest looked: the server's answers carry today's price from the refusal on
    let today = 4250;
    api.walkInConfirm.mockImplementationOnce(async () => { today = 4800; throw new CheckInApiError(409, 'Some of your services changed.', 'WALK_IN_SELECTION_CHANGED', { preview: changed }); });
    api.walkInPreview.mockImplementation(async (_s: unknown, lines: { serviceId: string; shownPriceCents?: number | null }[]) => {
      const p = okPreview(lines, { revision: today === 4800 ? 'rev-2' : 'rev-1' });
      p.lines = p.lines.map((l, i) => ({ ...l, priceCents: today, state: lines[i].shownPriceCents === today ? 'ok' as const : 'changed' as const }));
      p.estimatedTotalCents = today;
      return p;
    });
    await openPicker();
    fireEvent.click(tile('Hands & Polish'));
    fireEvent.click(screen.getByRole('button', { name: 'Add Signature Gel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review My Services' }));
    await waitFor(() => expect(screen.getByTestId('wis-confirm')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('wis-confirm'));
    expect(await screen.findByText(/changed since you chose them/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('wis-line-svc-gel')).toHaveTextContent('$48'));
    expect(screen.getByTestId('wis-confirm')).toHaveTextContent('Confirm Updated Services');
    expect(screen.queryByText('You’re checked in!')).toBeNull();          // nothing went through on the stale price
    await waitFor(() => expect(screen.getByTestId('wis-confirm')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('wis-confirm'));
    await screen.findByText('You’re checked in!');
    const [first, second] = api.walkInConfirm.mock.calls.map((c) => c[1]);
    expect(first.lines[0].shownPriceCents).toBe(4250);
    expect(second.lines[0].shownPriceCents).toBe(4800);                  // the guest approved TODAY's price
    expect(second.checkinRequestId).not.toBe(first.checkinRequestId);    // a different payload is a different request
  });
  it('while the picker is open the catalog is re-checked with the revision the screen holds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await openPicker();
    const before = api.walkInCatalog.mock.calls.length;
    await act(async () => { vi.advanceTimersByTime(CATALOG_RECHECK_MS + 10); });
    await waitFor(() => expect(api.walkInCatalog.mock.calls.length).toBeGreaterThan(before));
    expect(api.walkInCatalog.mock.calls[api.walkInCatalog.mock.calls.length - 1][1]).toBe('rev-1');
  });
});

describe('W06 availability change', () => {
  it('a service gone from the catalog shows "No longer available" with Remove, and Confirm stays disabled until it is removed', async () => {
    await openPicker();
    fireEvent.click(tile('Hands & Polish'));
    fireEvent.click(screen.getByRole('button', { name: 'Add Signature Gel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Buff & Shine' }));
    api.walkInPreview.mockImplementation(async (_s: unknown, lines: { serviceId: string }[]) => {
      const p = okPreview(lines.filter((l) => l.serviceId !== 'svc-buff'));
      if (lines.some((l) => l.serviceId === 'svc-buff')) { p.lines.push({ serviceId: 'svc-buff', name: 'Buff & Shine', state: 'unavailable', priceCents: null, durationMinutes: null, addOns: [] }); p.confirmable = false; }
      return p;
    });
    fireEvent.click(screen.getByRole('button', { name: 'Review My Services' }));
    expect(await screen.findByTestId('wis-line-svc-buff')).toHaveTextContent('No longer available');
    expect(screen.getByTestId('wis-confirm')).toBeDisabled();
    fireEvent.click(within(screen.getByTestId('wis-line-svc-buff')).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(screen.queryByTestId('wis-line-svc-buff')).toBeNull());
    await waitFor(() => expect(screen.getByTestId('wis-confirm')).not.toBeDisabled());
  });
});

describe('W09 double tap / retry', () => {
  it('a double tap sends ONE confirm; after a network failure the next tap re-sends the SAME request id (no automatic retry)', async () => {
    let fail = true; let release!: () => void;
    api.walkInConfirm.mockImplementation((_s: unknown, body: any) => {
      if (fail) { fail = false; return Promise.reject(new TypeError('Failed to fetch')); }
      return new Promise((res) => { release = () => res({ status: 'checked_in', firstName: 'Mai', checkinRequestId: body.checkinRequestId, requestState: 'queued', replayed: true, servicesPending: false }); });
    });
    await openPicker();
    fireEvent.click(tile('Foot Spa'));
    fireEvent.click(screen.getByRole('button', { name: 'Add Herbal Soak' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review My Services' }));
    await waitFor(() => expect(screen.getByTestId('wis-confirm')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('wis-confirm'));
    expect(await screen.findByText('Check-In temporarily unavailable — please see the front desk.')).toBeInTheDocument();   // offline: fail closed
    await new Promise((r) => setTimeout(r, 30));
    expect(api.walkInConfirm).toHaveBeenCalledTimes(1);                  // nothing replayed on its own
    await waitFor(() => expect(screen.getByTestId('wis-confirm')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('wis-confirm'));
    fireEvent.click(screen.getByTestId('wis-confirm'));                  // the double tap
    fireEvent.click(screen.getByTestId('wis-confirm'));
    await waitFor(() => expect(api.walkInConfirm).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 30));
    expect(api.walkInConfirm).toHaveBeenCalledTimes(2);                  // still two: the extra taps did nothing
    await act(async () => { release(); });
    await screen.findByText('You’re checked in!');
    expect(api.walkInConfirm.mock.calls[1][1].checkinRequestId).toBe(api.walkInConfirm.mock.calls[0][1].checkinRequestId);
  });
});

describe('W11 privacy reset — nothing of a guest survives success, cancel, a walk-away or a restart', () => {
  it('Cancel (confirmed) clears the picks, the name and the phone; nothing is written to browser storage', async () => {
    const ls = vi.spyOn(Storage.prototype, 'setItem');
    await openPicker('Hoa');
    fireEvent.click(tile('Foot Spa'));
    fireEvent.click(screen.getByRole('button', { name: 'Add Herbal Soak' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByTestId('wis-cancel-yes'));
    expect(screen.queryByTestId('walkin-picker')).toBeNull();
    expect((screen.getByPlaceholderText('First name') as HTMLInputElement).value).toBe('');
    expect(screen.queryByText('(555) 555-5555')).toBeNull();
    expect(screen.queryByTestId('selection-summary')).toBeNull();
    expect(ls.mock.calls.some(([, v]) => /Hoa|5555555555|svc-soak/.test(String(v)))).toBe(false);
    ls.mockRestore();
  });
  it('a guest who walks away mid-selection is cleared after the walk-away time', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await openPicker('Lan');
    fireEvent.click(tile('Foot Spa'));
    fireEvent.click(screen.getByRole('button', { name: 'Add Herbal Soak' }));
    await act(async () => { vi.advanceTimersByTime(WALK_AWAY_MS + 1000); });
    await waitFor(() => expect(screen.queryByTestId('walkin-picker')).toBeNull());
    expect((screen.getByPlaceholderText('First name') as HTMLInputElement).value).toBe('');
  });
  it('a restart (a fresh mount) shows a clean screen — the previous guest\'s picks are not restored', async () => {
    const first = await openPicker('Thu');
    fireEvent.click(within(first).getByRole('button', { name: /Foot Spa/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Herbal Soak' }));
    cleanup();   // the CPad restarted: the app is gone, memory with it
    render(<Display23 deviceToken="dev-tok" d={idle()} a={actions()} ads={playback()} />);
    await ready();
    expect(screen.queryByTestId('walkin-picker')).toBeNull();
    expect(screen.queryByText(/Herbal Soak/)).toBeNull();
    expect((screen.getByPlaceholderText('First name') as HTMLInputElement).value).toBe('');
  });
});

describe('4A.15 fail closed', () => {
  it('the salon\'s catalog cannot be loaded: "please see the front desk", and the walk-in button cannot go on', async () => {
    api.walkInCatalog.mockRejectedValue(new DisplayApiError(503, 'unavailable', 'SERVICE_UNAVAILABLE'));
    render(<Display23 deviceToken="dev-tok" d={idle()} a={actions()} ads={playback()} />);
    await ready();
    type10();
    fireEvent.change(screen.getByPlaceholderText('First name'), { target: { value: 'Mai' } });
    expect(await screen.findByText('Choosing services is unavailable right now — please see the front desk.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose Your Services' })).toBeDisabled();
    expect(api.checkInWalkIn).not.toHaveBeenCalled();
  });
});
