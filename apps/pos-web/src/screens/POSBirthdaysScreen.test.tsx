// POSBirthdaysScreen — Birthday Campaigns guide (Oct 31 2026): the original Month dropdown (current month by default) and the
// count, the server query (range / scope / search / page size), month/day only (never a year), the real empty state with
// Check Missing Birthdays, the overlay's Book Appointment handoff, the role-gated birthday edit and the assistant's no-send draft.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { api, deals, navigate, perms } = vi.hoisted(() => ({
  api: { summary: vi.fn(), customers: vi.fn(), missing: vi.fn(), history: vi.fn(), settings: vi.fn(), saveSettings: vi.fn(), customer: vi.fn(), updateBirthday: vi.fn(), plan: vi.fn(), save: vi.fn() },
  deals: { library: vi.fn() }, navigate: vi.fn(), perms: { list: ['marketing.view', 'marketing.manage', 'customers.view', 'customers.edit'] as string[] } }));
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<any>()), useNavigate: () => navigate }));
vi.mock('../api/posBirthdaysApi', () => ({ posBirthdaysApi: api }));
vi.mock('../api/posDealsOffersApi', () => ({ posDealsOffersApi: deals }));
vi.mock('../components/usePermissions', () => ({ useCan: () => (p: string) => perms.list.includes(p) }));
import { POSBirthdaysScreen } from './POSBirthdaysScreen';

const SUM = { asOf: '2026-10-31T12:00:00Z', timezone: 'America/New_York', today: '2026-10-31', ruleset: 'birthdays-v1', feb29Policy: 'feb28', range: { preset: 'month', from: '2026-10-01', to: '2026-10-31' },
  kpis: { inRange: 2, next7Days: 1, eligibleSms: 1, eligibleEmail: 0, messagesSent: 0, messagesInFlight: 0, offersRedeemed: 0, bookingsAfterMessage: 0, bookingsAfterMessageCents: 0, associationDays: 30, occasionYear: 2026 },
  completeness: { total: 10, recorded: 6, missing: 4, yearUnknown: 1, percent: 60 } };
const row = (o: Record<string, unknown> = {}) => ({ customerId: 'c1', name: 'Ava Glow', maskedPhone: '•••• 0101', maskedEmail: null, birthdayMonthDay: '10-15', birthdayStatus: 'recorded', nextOccurrence: '2027-10-15', daysUntil: 349,
  lastVisitAt: '2026-10-29T19:00:00Z', loyaltyTier: 'Gold', sms: 'eligible', email: 'no_consent', birthdayMessage: 'not_sent', ...o });
const list = (items: unknown[], o: Record<string, unknown> = {}) => ({ items, page: 1, pageSize: 20, totalItems: items.length, totalPages: 1, scope: 'period', hint: null, ...o });
const mount = () => render(<MemoryRouter><POSBirthdaysScreen /></MemoryRouter>);
beforeEach(() => {
  for (const f of [...Object.values(api), deals.library, navigate]) f.mockReset();
  perms.list = ['marketing.view', 'marketing.manage', 'customers.view', 'customers.edit'];
  api.summary.mockResolvedValue(SUM);
  api.customers.mockResolvedValue(list([row(), row({ customerId: 'c2', name: 'Eve Glow', birthdayMonthDay: '10-05', daysUntil: 339 })]));
  deals.library.mockResolvedValue({ items: [] });
});

describe('POSBirthdaysScreen', () => {
  it('keeps the original title, Month dropdown (current month) and count; asks the server for this month', async () => {
    mount();
    expect(await screen.findByText('Ava Glow')).toBeInTheDocument();
    expect(screen.getByText('Birthdays')).toBeInTheDocument();
    expect((screen.getByTestId('bd-month') as HTMLSelectElement).value).toBe(String(new Date().getMonth() + 1));
    expect(api.customers).toHaveBeenCalledWith(expect.objectContaining({ preset: 'month', month: new Date().getMonth() + 1, scope: 'period', page: 1, pageSize: 20 }));
    expect(screen.getByTestId('bd-count')).toHaveTextContent('2');
  });
  it('shows month and day only — never a birth year', async () => {
    mount();
    await screen.findByText('Ava Glow');
    expect(screen.getByText('October 15')).toBeInTheDocument();
    expect(screen.queryByText(/2000/)).not.toBeInTheDocument();
  });
  it('changing month, page size and scope re-queries the server (back to page 1)', async () => {
    mount(); await screen.findByText('Ava Glow');
    fireEvent.change(screen.getByTestId('bd-month'), { target: { value: '12' } });
    await waitFor(() => expect(api.customers).toHaveBeenLastCalledWith(expect.objectContaining({ month: 12, page: 1 })));
    fireEvent.change(screen.getByTestId('bd-size'), { target: { value: '50' } });
    await waitFor(() => expect(api.customers).toHaveBeenLastCalledWith(expect.objectContaining({ pageSize: 50, page: 1 })));
    fireEvent.click(screen.getByTestId('bd-scope-missing'));
    await waitFor(() => expect(api.customers).toHaveBeenLastCalledWith(expect.objectContaining({ scope: 'missing' })));
  });
  it('a real empty month says so and offers Check Missing Birthdays (read-only counts)', async () => {
    api.customers.mockResolvedValue(list([]));
    api.missing.mockResolvedValue({ status: 'missing', checkedAt: '2026-10-31T12:00:00Z', counts: { total: 10, recorded: 6, missing: 4, invalid: 0, yearUnknown: 1, completenessPercent: 60 },
      sources: { staff: 1, customerApp: 2, import: 3, atCreation: 0, notRecorded: 0 }, importRejected: null, importRejectedReason: 'not stored' });
    mount();
    expect(await screen.findByText(/No recorded birthdays for/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('bd-check-missing-empty'));
    expect(await screen.findByTestId('bd-mc-missing')).toHaveTextContent('4');
  });
  it('overlay: Book Appointment preselects the customer; the birthday edit sends the version', async () => {
    api.customer.mockResolvedValue({ customerName: 'Ava Glow', birthday: { monthDay: '10-15', status: 'recorded', yearKnown: true, source: 'staff', updatedAt: null, nextOccurrence: { date: '2027-10-15', daysUntil: 349 }, recordVersion: 4 },
      contact: { maskedPhone: '•••• 0101', maskedEmail: null }, preferences: { smsMarketingConsent: true, emailMarketingConsent: false }, loyalty: { tier: 'Gold', pointsBalance: 10 },
      visits: [], appointments: [], refunds: [], birthdayMessages: [], birthdayOffers: [], noHistory: true });
    api.updateBirthday.mockResolvedValue({ monthDay: '07-04' });
    mount(); fireEvent.click(await screen.findByText('Ava Glow'));
    expect(await screen.findByTestId('bd-ov-nohistory')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('bd-edit-input'), { target: { value: '07-04' } });
    fireEvent.click(screen.getByTestId('bd-edit-save'));
    await waitFor(() => expect(api.updateBirthday).toHaveBeenCalledWith('c1', { birthday: '07-04', expectedVersion: 4 }));
    fireEvent.click(screen.getByTestId('bd-book'));
    expect(navigate).toHaveBeenCalledWith('/booking/new?customerId=c1&from=birthdays');
  });
  it('without customers.edit the birthday edit is not offered', async () => {
    perms.list = ['marketing.view', 'customers.view'];
    api.customer.mockResolvedValue({ customerName: 'Ava Glow', birthday: { monthDay: '10-15', status: 'recorded', yearKnown: true, source: null, nextOccurrence: null, recordVersion: 1 },
      contact: {}, preferences: {}, loyalty: {}, visits: [], appointments: [], refunds: [], birthdayMessages: [], birthdayOffers: [], noHistory: true });
    mount(); fireEvent.click(await screen.findByText('Ava Glow'));
    await screen.findByTestId('bd-ov-nohistory');
    expect(screen.queryByTestId('bd-edit-input')).not.toBeInTheDocument();
    expect(screen.getByTestId('bd-create')).toBeDisabled();
  });
  it('assistant: check shows selected / eligible / excluded; save makes a draft — no send call exists', async () => {
    api.plan.mockResolvedValue({ objective: 'greeting', channel: 'sms', range: { from: '2026-10-01', to: '2026-10-31' }, timezone: 'America/New_York',
      audience: { selected: 2, eligible: 1, excluded: 1, excludedReasons: { no_consent: 1 } }, offer: null, template: null, templates: [],
      suggestions: { message: 'Happy birthday from {salon_name}!', messageIsSuggestion: true, schedule: { date: '2026-10-31' } }, variables: ['{salon_name}', '{offer}'] });
    api.save.mockResolvedValue({ draftId: 'd1', campaignId: 'k1', eligible: 1, sent: 0 });
    mount(); await screen.findByText('Ava Glow');
    fireEvent.click(screen.getByTestId('bd-create'));
    fireEvent.click(await screen.findByTestId('bd-ai-check'));
    expect(await screen.findByTestId('bd-ai-counts')).toHaveTextContent('2 selected · 1 eligible · 1 excluded');
    fireEvent.click(screen.getByTestId('bd-ai-save'));
    expect(await screen.findByTestId('bd-ai-saved')).toBeInTheDocument();
    expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ objective: 'greeting', channel: 'sms', message: 'Happy birthday from {salon_name}!', idempotencyKey: expect.any(String) }));
  });
  it('a 403 shows the no-access state', async () => {
    api.summary.mockRejectedValue({ status: 403, code: 'PERMISSION_DENIED' }); api.customers.mockRejectedValue({ status: 403, code: 'PERMISSION_DENIED' });
    mount();
    expect(await screen.findByText(/cannot open Birthday Campaigns/)).toBeInTheDocument();
  });
  it('A20 Nov 6: activity / source filters and the new date bases reach the server; the Offer column shows; history search, range and page size', async () => {
    api.customers.mockResolvedValue(list([row({ offerStatus: 'redeemed' })]));
    api.history.mockResolvedValue({ page: 1, pageSize: 10, totalItems: 0, totalPages: 1, items: [] });
    mount();
    expect(await screen.findByTestId('bd-offer')).toHaveTextContent('Redeemed');
    fireEvent.change(screen.getByTestId('bd-activity'), { target: { value: 'lapsed' } });
    fireEvent.change(screen.getByTestId('bd-source'), { target: { value: 'customer_app' } });
    fireEvent.change(screen.getByTestId('bd-basis'), { target: { value: 'last_visit' } });
    await waitFor(() => expect(api.customers).toHaveBeenLastCalledWith(expect.objectContaining({ activity: 'lapsed', source: 'customer_app', basis: 'last_visit', page: 1 })));
    fireEvent.click(screen.getByTestId('bd-history'));
    fireEvent.change(await screen.findByTestId('bd-hist-from'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByTestId('bd-hist-size'), { target: { value: '50' } });
    fireEvent.change(screen.getByTestId('bd-hist-q'), { target: { value: 'sms' } });
    await waitFor(() => expect(api.history).toHaveBeenLastCalledWith(expect.objectContaining({ from: '2026-10-01', pageSize: 50, q: 'sms', page: 1 })));
  });
});
