// i18n.test.tsx — Dual-Screen mandate §119: customer-facing words come from the catalogs, not the components; Vietnamese
// is complete and placeholders are filled; the 23-inch check-in renders in the guest's language.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { CustomerDisplayState } from '@aipowersalon/api-contracts/customer';

const api = vi.hoisted(() => ({
  startDisplaySession: vi.fn(), completeSession: vi.fn(), heartbeat: vi.fn(), lookupPhone: vi.fn(), confirmCustomer: vi.fn(), createCustomer: vi.fn(),
  todayAppointments: vi.fn(), checkInAppointment: vi.fn(), listServices: vi.fn(), listTechnicians: vi.fn(), checkInWalkIn: vi.fn(), placeInLine: vi.fn(),
  technicianIdentify: vi.fn(), technicianClockIn: vi.fn(), technicianClockOut: vi.fn(),
}));
vi.mock('./goCheckInApi', () => ({ ...api, usd: (c: number) => '$' + Math.round(c / 100) }));
import { EN, VI, translate } from './i18n/messages';
import { availableLanguages, LanguageProvider } from './i18n';
import { Display23 } from './Display23';
import { CheckoutTicket } from './CheckoutTicket';

const idle = (o: Partial<CustomerDisplayState> = {}): CustomerDisplayState => ({
  state: 'idle', salonName: 'Luxury Nails', tipOptions: [], selectedTipCents: 0, payButtonEnabled: false, checkIn: true,
  totals: { subtotalCents: 0, tipCents: 0, taxCents: 0, surchargeCents: 0, giftCardChargeCents: 0, totalDueCents: 0 }, ...o,
});
const KIOSK = { sessionId: 'k1', sessionToken: 't1', config: { salonName: 'Luxury Nails', settings: { enabled: true, appointmentCheckinEnabled: true, walkinCheckinEnabled: true, newCustomerEnabled: true, serviceSelectionEnabled: true, technicianPreferenceEnabled: true, tenantPhoneLookupEnabled: true, centralLookupEnabled: false, customerLinkingEnabled: true, showWaitEstimate: true, autoSendToQueue: true, requireFrontDeskApproval: false, confirmationTimeoutSeconds: 8 } } };
beforeEach(() => {
  Object.values(api).forEach((f) => (f as any).mockReset());
  api.startDisplaySession.mockResolvedValue(KIOSK); api.heartbeat.mockResolvedValue({ ok: true }); api.completeSession.mockResolvedValue({ ok: true });
  api.listServices.mockResolvedValue({ services: [] }); api.listTechnicians.mockResolvedValue({ technicians: [] });
});
const vi_ = { lang: 'vi' as const, available: ['en', 'vi'] as ('en' | 'vi')[], setLang: () => undefined };

describe('the catalogs', () => {
  it('Vietnamese covers every English key, keeps every placeholder, and is not English', () => {
    const keys = Object.keys(EN) as (keyof typeof EN)[];
    expect(Object.keys(VI).sort()).toEqual([...keys].sort());
    for (const k of keys) {
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
      expect(ph(VI[k]), k).toEqual(ph(EN[k]));
      expect(/<b>/.test(VI[k]), k).toBe(/<b>/.test(EN[k]));
    }
    const same = keys.filter((k) => VI[k] === EN[k] && /[a-z]{4,}/i.test(EN[k]));
    expect(same).toEqual([]);   // nothing left untranslated
  });
  it('placeholders are filled; an unknown language is English', () => {
    expect(translate('vi', 'ci.todayAt', { time: '11:00 AM' })).toBe('Hôm nay lúc 11:00 AM');
    expect(translate('fr', 'ci.imHere')).toBe("I'm Here");
    expect(availableLanguages(['vi', 'xx', 'en', 'vi'])).toEqual(['vi', 'en']);
    expect(availableLanguages(undefined)).toEqual(['en']);
  });
});

describe('the screens speak the guest\'s language', () => {
  it('the 23-inch check-in in Vietnamese — no English left in the check-in column', async () => {
    render(<LanguageProvider value={vi_}><Display23 deviceToken="dev" d={idle()} a={{ submitting: false, actionError: null, rated: null, onTip: vi.fn(), onMethod: vi.fn(), onPay: vi.fn(), onRate: vi.fn(), onClearError: vi.fn() }} ads={{ playlist: null, usable: true, panelAds: [], fullAds: [], fullScreenIdle: { enabled: false, afterSeconds: 60 }, onShown: vi.fn() }} /></LanguageProvider>);
    await waitFor(() => expect(screen.getByText('Đăng ký tại đây')).toBeInTheDocument());
    expect(screen.getByText('Tìm lịch hẹn của tôi')).toBeInTheDocument();
    expect(screen.getByText('Vận hành bởi AI PowerSalon')).toBeInTheDocument();
    expect(screen.queryByText('Find My Appointment')).toBeNull();
    expect(screen.getByText('Có bán thẻ quà tặng')).toBeInTheDocument();   // the no-ads panel too (§68)
  });
  it('the checkout ticket in Vietnamese', () => {
    render(<LanguageProvider value={vi_}><CheckoutTicket firstName="Sophia" c={{ ticketNumber: '#12', date: '2026-10-06T15:00:00.000Z', lines: [{ kind: 'service', name: 'Gel Manicure', technicianName: 'Olivia', quantity: 1, amountCents: 4500 }], adjustments: [], itemsSubtotalCents: 4500, discountCents: 0, taxCents: 300, customerFeeCents: 0, tipCents: 0, giftCardSaleCents: 0, totalCents: 4800, paidCents: 0, balanceDueCents: 4800, payments: [], paymentStatus: 'unpaid', paymentMethod: 'card' } as any} /></LanguageProvider>);
    expect(screen.getByText('Chào Sophia,')).toBeInTheDocument();
    expect(screen.getByText('với Olivia')).toBeInTheDocument();
    expect(screen.getByText('Tổng cộng')).toBeInTheDocument();
    expect(screen.getByText('Thuế')).toBeInTheDocument();
  });
});
