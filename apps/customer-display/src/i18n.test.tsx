// i18n.test.tsx — customer-facing words come from the catalog, not the components; placeholders are filled. POSLanguage.pdf
// §16 / §30 (Oct 28 2026): the Customer Display is ENGLISH ONLY — even when the server offers Vietnamese, or the provider is
// handed Vietnamese — while guest / technician names saved in Vietnamese are shown exactly as saved.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { CustomerDisplayState } from '@aipowersalon/api-contracts/customer';

const api = vi.hoisted(() => ({
  startDisplaySession: vi.fn(), completeSession: vi.fn(), heartbeat: vi.fn(), lookupPhone: vi.fn(), confirmCustomer: vi.fn(), createCustomer: vi.fn(),
  todayAppointments: vi.fn(), checkInAppointment: vi.fn(), listServices: vi.fn(), listTechnicians: vi.fn(), checkInWalkIn: vi.fn(), placeInLine: vi.fn(),
  technicianIdentify: vi.fn(), technicianClockIn: vi.fn(), technicianClockOut: vi.fn(),
}));
vi.mock('./goCheckInApi', () => ({ ...api, usd: (c: number) => '$' + Math.round(c / 100) }));
import * as messages from './i18n/messages';
import { EN, translate } from './i18n/messages';
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
const vi_ = { lang: 'vi' as any, available: ['en', 'vi'] as any[], setLang: () => undefined };   // a Vietnamese language forced into the provider

describe('the catalog', () => {
  it('English only: no Vietnamese catalogue, language names or locales', () => {
    expect(messages.DISPLAY_LANGUAGES).toEqual(['en']);
    expect(Object.keys(messages.CATALOGS)).toEqual(['en']);
    expect(Object.keys(messages).filter((k) => k === 'VI')).toEqual([]);
    expect(Object.keys(messages.LOCALES)).toEqual(['en']);
  });
  it('placeholders are filled; any other language — Vietnamese included — is English', () => {
    expect(translate('vi', 'ci.todayAt', { time: '11:00 AM' })).toBe(translate('en', 'ci.todayAt', { time: '11:00 AM' }));
    expect(translate('fr', 'ci.imHere')).toBe("I'm Here");
    expect(availableLanguages(['vi', 'xx', 'en', 'vi'])).toEqual(['en']);
    expect(availableLanguages(['vi'])).toEqual(['en']);
    expect(availableLanguages(undefined)).toEqual(['en']);
  });
});

describe('the screens stay English even when handed Vietnamese', () => {
  it('the 23-inch check-in', async () => {
    render(<LanguageProvider value={vi_}><Display23 deviceToken="dev" d={idle()} a={{ submitting: false, actionError: null, rated: null, onTip: vi.fn(), onMethod: vi.fn(), onPay: vi.fn(), onRate: vi.fn(), onClearError: vi.fn() }} ads={{ playlist: null, usable: true, panelAds: [], fullAds: [], fullScreenIdle: { enabled: false, afterSeconds: 60 }, onShown: vi.fn() }} /></LanguageProvider>);
    await waitFor(() => expect(screen.getByText(EN['ci.find'])).toBeInTheDocument());
    expect(screen.getByText('Find My Appointment')).toBeInTheDocument();
    expect(screen.queryByText('Tìm lịch hẹn của tôi')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Language' })).toBeNull();
  });
  it('the checkout ticket — the guest\'s and technician\'s Vietnamese names are kept exactly', () => {
    render(<LanguageProvider value={vi_}><CheckoutTicket firstName="Hằng" c={{ ticketNumber: '#12', date: '2026-10-06T15:00:00.000Z', lines: [{ kind: 'service', name: 'Sơn gel', technicianName: 'Nguyễn Thị Hương', quantity: 1, amountCents: 4500 }], adjustments: [], itemsSubtotalCents: 4500, discountCents: 0, taxCents: 300, customerFeeCents: 0, tipCents: 0, giftCardSaleCents: 0, totalCents: 4800, paidCents: 0, balanceDueCents: 4800, payments: [], paymentStatus: 'unpaid', paymentMethod: 'card' } as any} /></LanguageProvider>);
    expect(screen.getByText('Sơn gel')).toBeInTheDocument();
    expect(screen.getByText(/Nguyễn Thị Hương/)).toBeInTheDocument();
    expect(screen.queryByText('Tổng cộng')).toBeNull();
    expect(screen.queryByText('Thuế')).toBeNull();
  });
});
