// displayMode.test.tsx — Dual-Screen mandate §11–§12, §81 on the display: ONE state model decides the screen (no
// competing booleans) — a checkout outranks a phone-code request, a guest at the check-in, maintenance and the network;
// a guest's check-in step is reported as the model's modes; with the server unreachable and no checkout the check-in
// says "We're temporarily offline. Please see the receptionist." and what the guest typed is gone.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { CustomerDisplayState } from '@aipowersalon/api-contracts/customer';
import type { RotatingAd } from '@aipowersalon/ui';

const api = vi.hoisted(() => ({
  startDisplaySession: vi.fn(), completeSession: vi.fn(), heartbeat: vi.fn(), lookupPhone: vi.fn(), confirmCustomer: vi.fn(), createCustomer: vi.fn(),
  todayAppointments: vi.fn(), checkInAppointment: vi.fn(), listServices: vi.fn(), listTechnicians: vi.fn(), checkInWalkIn: vi.fn(), placeInLine: vi.fn(),
  technicianIdentify: vi.fn(), technicianClockIn: vi.fn(), technicianClockOut: vi.fn(),
}));
vi.mock('./goCheckInApi', () => ({ ...api, usd: (c: number) => '$' + Math.round(c / 100) }));

import { Display23 } from './Display23';
import { appMode } from './App';
import { checkInStepOf } from './useCheckInFlow';
import type { CheckoutActions } from './CheckoutPanel';
import type { AdPlayback } from './useAdPlaylist';

const KIOSK = { sessionId: 'k1', sessionToken: 't1', config: { salonName: 'Luxury Nails', settings: {
  enabled: true, appointmentCheckinEnabled: true, walkinCheckinEnabled: true, newCustomerEnabled: true, serviceSelectionEnabled: true,
  technicianPreferenceEnabled: true, tenantPhoneLookupEnabled: true, centralLookupEnabled: false, customerLinkingEnabled: true,
  showWaitEstimate: true, autoSendToQueue: true, requireFrontDeskApproval: false, confirmationTimeoutSeconds: 8 } } };
const idle = (o: Partial<CustomerDisplayState> = {}): CustomerDisplayState => ({
  state: 'idle', salonName: 'Luxury Nails', tipOptions: [], selectedTipCents: 0, payButtonEnabled: false, checkIn: true,
  totals: { subtotalCents: 0, tipCents: 0, taxCents: 0, surchargeCents: 0, giftCardChargeCents: 0, totalDueCents: 0 }, ...o,
});
const slide = (id: string): RotatingAd => ({ id, version: 1, durationSeconds: 8, image: { url: `blob:${id}`, width: 720, height: 1080 }, fit: 'cover', focalX: 0.5, focalY: 0.5, headline: `Ad ${id}`, subheadline: null, description: null, ctaText: null, qr: null });
const playback = (): AdPlayback => ({ playlist: null, usable: true, panelAds: [slide('a1')], fullAds: [], fullScreenIdle: { enabled: false, afterSeconds: 60 }, onShown: vi.fn() });
const actions = (): CheckoutActions => ({ submitting: false, actionError: null, rated: null, onTip: vi.fn(), onMethod: vi.fn(), onPay: vi.fn(), onRate: vi.fn(), onClearError: vi.fn() });

beforeEach(() => {
  Object.values(api).forEach((f) => (f as any).mockReset());
  api.startDisplaySession.mockResolvedValue(KIOSK);
  api.completeSession.mockResolvedValue({ ok: true });
  api.heartbeat.mockResolvedValue({ ok: true });
  api.listServices.mockResolvedValue({ services: [] });
  api.listTechnicians.mockResolvedValue({ technicians: [] });
});
afterEach(() => { vi.useRealTimers(); });

describe('appMode — the App renders from the one model (§11–§12)', () => {
  const pad = { maskedPhone: '(•••) •••-0142' };
  it('a phone-code request (the checkout customer\'s own) shows on the checkout, never over a payment', () => {
    expect(appMode(idle({ state: 'ticket_review', sessionId: 's1', phoneVerification: pad } as any), { checkInStep: 'none', online: true, padDone: null })).toBe('PHONE_VERIFICATION');
    for (const state of ['payment_processing', 'payment_verifying', 'payment_success'] as const) {
      expect(appMode(idle({ state, sessionId: 's1', phoneVerification: pad } as any), { checkInStep: 'none', online: true, padDone: null })).not.toBe('PHONE_VERIFICATION');
    }
    expect(appMode(idle({ phoneVerification: pad } as any), { checkInStep: 'none', online: true, padDone: null })).toBe('PHONE_VERIFICATION');
    expect(appMode(idle({ phoneVerification: pad } as any), { checkInStep: 'none', online: true, padDone: pad.maskedPhone })).toBe('ADVERTISEMENT');
  });
  it('maintenance yields to a checkout; offline with nothing on screen is OFFLINE; nothing yet is null', () => {
    expect(appMode(idle({ maintenance: true, state: 'ticket_review', sessionId: 's1' }), { checkInStep: 'none', online: true, padDone: null })).toBe('CHECKOUT');
    expect(appMode(idle({ maintenance: true }), { checkInStep: 'none', online: true, padDone: null })).toBe('MAINTENANCE');
    expect(appMode(idle(), { checkInStep: 'walk_in', online: false, padDone: null })).toBe('OFFLINE');
    expect(appMode(null, { checkInStep: 'none', online: true, padDone: null })).toBeNull();
  });
});

describe('checkInStepOf — the guest\'s step as the model names it', () => {
  const base = { mode: 'customer', phone: '', lookup: null, name: '', picked: [], addOns: [], tech: '', confirmation: null, busy: false, appointment: null } as any;
  it.each([
    [{}, 'none'], [{ phone: '(555) 5' }, 'phone'], [{ phone: '(555) 555-5555', busy: true }, 'lookup'],
    [{ phone: '(555) 555-5555', lookup: { canWalkIn: true }, appointment: { appointmentId: 'a1' } }, 'appointment'],
    [{ phone: '(555) 555-5555', lookup: { canWalkIn: true } }, 'walk_in'], [{ name: 'Sophia' }, 'walk_in'], [{ picked: ['s1'] }, 'walk_in'],
    [{ confirmation: { status: 'checked_in' } }, 'success'], [{ mode: 'technician' }, 'phone'],
  ])('%o → %s', (over, step) => { expect(checkInStepOf({ ...base, ...over })).toBe(step); });
});

describe('§81 offline: no check-in without the server', () => {
  it('the check-in becomes "please see the receptionist", the ads keep playing, and what the guest typed is gone when it returns', async () => {
    const onStep = vi.fn();
    const { rerender } = render(<Display23 deviceToken="dev-tok" d={idle()} a={actions()} ads={playback()} onCheckInStep={onStep} />);
    await waitFor(() => expect((screen.getByRole('button', { name: '5' }) as HTMLButtonElement).disabled).toBe(false));
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole('button', { name: '5' }));
    expect(screen.getByText('(555) 5')).toBeInTheDocument();
    await waitFor(() => expect(onStep).toHaveBeenLastCalledWith('phone'));
    rerender(<Display23 deviceToken="dev-tok" d={idle()} a={actions()} ads={playback()} offline onCheckInStep={onStep} />);
    expect(screen.getByText(/temporarily offline\. Please see the receptionist/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '5' })).toBeNull();
    expect(screen.getByTestId('right-panel')).toHaveAttribute('data-mode', 'ads');
    rerender(<Display23 deviceToken="dev-tok" d={idle()} a={actions()} ads={playback()} onCheckInStep={onStep} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '5' })).toBeInTheDocument());
    expect(screen.queryByText('(555) 5')).toBeNull();
    await waitFor(() => expect(onStep).toHaveBeenLastCalledWith('none'));
  });
});
