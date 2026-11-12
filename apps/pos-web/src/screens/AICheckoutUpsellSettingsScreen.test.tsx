// AICheckoutUpsellSettingsScreen.test.tsx — Functional Decision 27 (the value caps) and the Checkout Upsell Assistant
// Settings guide (Nov 2 2026): saves send only the changed key + the version read; Disable asks first; 409 / 403 are
// explained; categories say when they are not connected; Suggestion Activity / Settings History / System Health.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setLanguage } from '@aipowersalon/mobile-sdk/i18n';
import { leftoverEnglish } from './viScan.testkit';

const tun = { maxTotal: 2, maxAddOn: 2, maxProduct: 2, maxMembership: 1, maxAddedValueCents: 3000, maxAddedPercent: 30, addOnsEnabled: true, productsEnabled: true, membershipEnabled: true,
  loyaltyEnrollEnabled: true, loyaltyRedeemEnabled: true, giftCardEnabled: true, rebookingEnabled: true, allowAfterServiceDone: true };
const settings = { enabled: true, disabledAtLevel: null, tunables: tun, sources: { maxTotal: 'platform', productsEnabled: 'tenant' }, salon: { version: 4, updatedAt: '2026-11-01T10:00:00Z', enabled: null, tunables: {} } };
const summary = { effective: 'enabled', subscription: { allowed: true, reason: 'ok', status: 'active' },
  categories: ['addOnsEnabled', 'productsEnabled', 'membershipEnabled', 'loyaltyEnrollEnabled', 'loyaltyRedeemEnabled', 'giftCardEnabled', 'rebookingEnabled'].map((k) => ({ key: k, on: true, wired: k === 'addOnsEnabled' || k === 'membershipEnabled', source: 'platform' })),
  limits: { maxTotal: 2, maxAddOn: 2, maxProduct: 2 }, version: 4, last30d: { generated: 3, accepted: 2, applied: 1, dismissed: 1, failed: 0 }, lastCheck: null };
const page = (items: any[]) => ({ items, total: items.length, page: 1, pageSize: 25, totalPages: 1, period: { today: '2026-11-02' }, customersVisible: true });
vi.mock('../api/posAiCheckoutUpsellApi', () => ({ posAiCheckoutUpsellApi: { settings: vi.fn(), updateSettings: vi.fn(), center: { summary: vi.fn(), activity: vi.fn(), history: vi.fn(), check: vi.fn() } } }));
import { posAiCheckoutUpsellApi } from '../api/posAiCheckoutUpsellApi';
import { AICheckoutUpsellSettingsScreen } from './AICheckoutUpsellSettingsScreen';
const A = posAiCheckoutUpsellApi as any;

beforeEach(() => {
  vi.clearAllMocks();
  A.settings.mockResolvedValue(settings);
  A.updateSettings.mockImplementation(async (_l: string, p: any) => ({ ...settings, enabled: p.enabled ?? settings.enabled, tunables: { ...tun, ...p.tunables }, salon: { ...settings.salon, version: 5 } }));
  A.center.summary.mockResolvedValue(summary);
  A.center.activity.mockResolvedValue(page([{ id: 'r1', type: 'service_addon', status: 'APPLIED', title: 'Paraffin Dip', priceCents: 1500, checkoutId: 'c1', ticketNumber: 'T-1001', customer: 'Linh Pham', customerPhoneLast4: '0142', acceptedBy: 'Owner Kim', createdAt: '2026-11-02T14:00:00Z' }]));
  A.center.history.mockResolvedValue(page([{ id: 'h1', level: 'tenant', version: 4, actor: 'Manager Lan', role: 'MANAGER', at: '2026-11-01T10:00:00Z', changes: [{ key: 'productsEnabled', before: null, after: false }, { key: 'maxTotal', before: 2, after: 3 }] }]));
  A.center.check.mockResolvedValue({ id: 'h', overall: 'WARNING', reused: false, checkedAt: '2026-11-02T14:00:00Z', checks: [{ key: 'categories_connected', state: 'WARNING', count: 5 }, { key: 'no_side_effects', state: 'PASSED' }] });
});
const renderIt = () => render(<MemoryRouter><AICheckoutUpsellSettingsScreen /></MemoryRouter>);

describe('AI checkout upsell settings — Decision 27 value caps', () => {
  it('shows the defaults ($30 / 30%) and saves ONLY the changed cap with the version it read', async () => {
    renderIt();
    const dollars = (await screen.findByLabelText('Max added value per visit')) as HTMLSelectElement;
    const share = screen.getByLabelText('Max share of booked services') as HTMLSelectElement;
    expect(dollars.value).toBe('3000'); expect(share.value).toBe('30');
    fireEvent.change(dollars, { target: { value: '5000' } });
    await waitFor(() => expect(A.updateSettings).toHaveBeenCalledWith('tenant', { tunables: { maxAddedValueCents: 5000 }, expectedVersion: 4 }));
    fireEvent.change(screen.getByLabelText('Max share of booked services'), { target: { value: '20' } });
    await waitFor(() => expect(A.updateSettings).toHaveBeenLastCalledWith('tenant', { tunables: { maxAddedPercent: 20 }, expectedVersion: 5 }));
  });
});

describe('Checkout upsell settings guide', () => {
  it('a category toggle sends only that key (never the whole resolved set); unconnected categories say so', async () => {
    renderIt();
    const products = await screen.findByTestId('ucx-cat-productsEnabled');
    await waitFor(() => expect(within(products).getByText('Not connected yet')).toBeTruthy());
    expect(within(screen.getByTestId('ucx-cat-addOnsEnabled')).queryByText('Not connected yet')).toBeNull();
    fireEvent.click(within(products).getByRole('checkbox'));
    await waitFor(() => expect(A.updateSettings).toHaveBeenCalledWith('tenant', { tunables: { productsEnabled: false }, expectedVersion: 4 }));
    expect(screen.getByTestId('ucx-kpi-categories').textContent).toContain('2 connected');
  });
  it('Disable asks first, says it does not touch checkout or billing, then sends only { enabled: false }', async () => {
    renderIt();
    fireEvent.click(await screen.findByTestId('ucx-toggle'));
    const d = await screen.findByTestId('ucx-confirm-off');
    expect(d.textContent).toContain('AI subscription are not changed');
    expect(A.updateSettings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('ucx-confirm-off-yes'));
    await waitFor(() => expect(A.updateSettings).toHaveBeenCalledWith('tenant', { enabled: false, expectedVersion: 4 }));
  });
  it('409 says someone else saved and reloads; 403 is read from the error, not the message text', async () => {
    A.updateSettings.mockRejectedValueOnce(Object.assign(new Error('UPSELL_SETTINGS_VERSION_CONFLICT'), { status: 409, code: 'UPSELL_SETTINGS_VERSION_CONFLICT' }));
    renderIt();
    fireEvent.change(await screen.findByLabelText('Max suggestions shown'), { target: { value: '3' } });
    expect(await screen.findByText(/Someone else saved these settings/)).toBeTruthy();
    await waitFor(() => expect(A.settings).toHaveBeenCalledTimes(2));
    A.updateSettings.mockRejectedValueOnce(Object.assign(new Error('INSUFFICIENT_PERMISSION'), { status: 403 }));
    fireEvent.change(await screen.findByLabelText('Max add-ons'), { target: { value: '1' } });
    expect(await screen.findByText(/permission/i)).toBeTruthy();
  });
  it('the settings could not be read → an error with Retry, never the defaults shown as "Enabled"', async () => {
    A.settings.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 503 }));
    renderIt();
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByTestId('ucx-status')).toBeNull();
  });
  it('Suggestion Activity: search and filters go to the server; Settings History shows before → after; System Health runs the check', async () => {
    renderIt();
    const act1 = await screen.findByTestId('ucx-activity');
    expect((await within(act1).findAllByTestId('ucx-row'))[0].textContent).toContain('T-1001');
    fireEvent.change(within(act1).getByTestId('ucx-search'), { target: { value: '0142' } });
    fireEvent.submit(within(act1).getByTestId('ucx-search').closest('form')!);
    await waitFor(() => expect(A.center.activity).toHaveBeenLastCalledWith(expect.objectContaining({ q: '0142', page: 1 })));
    fireEvent.change(within(act1).getByTestId('ucx-type'), { target: { value: 'product' } });
    await waitFor(() => expect(A.center.activity).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'product' })));
    fireEvent.click(within(act1).getByTestId('ucx-preset-last_30'));
    await waitFor(() => expect(A.center.activity).toHaveBeenLastCalledWith(expect.objectContaining({ preset: 'last_30' })));
    fireEvent.click(screen.getByTestId('ucx-tab-history'));
    const row = await screen.findByTestId('ucx-hrow');
    expect(row.textContent).toContain('Max suggestions shown: 2 → 3');
    expect(row.textContent).toContain('Retail products: default → Off');
    fireEvent.click(screen.getByTestId('ucx-tab-health'));
    fireEvent.click(screen.getByTestId('ucx-check'));
    expect(await screen.findByTestId('ucx-chk-categories_connected')).toHaveTextContent('Warning');
    expect(A.center.check).toHaveBeenCalledTimes(1);
  });
});

describe('Checkout upsell settings in Vietnamese', () => {
  afterEach(async () => { await act(async () => { await setLanguage('en'); }); });
  it('status row, categories, activity, history and health are Vietnamese', async () => {
    await setLanguage('vi');
    const { container } = renderIt();
    await screen.findByTestId('ucx-activity');
    await waitFor(() => expect(screen.getAllByTestId('ucx-row').length).toBe(1));
    const NAMES = ['Paraffin Dip', 'T-1001', 'Linh Pham', 'Owner Kim', 'Manager Lan', 'MANAGER'];
    expect(leftoverEnglish(container, NAMES).join(' | ')).toBe('');
    fireEvent.click(screen.getByTestId('ucx-tab-history'));
    await screen.findByTestId('ucx-hrow');
    expect(leftoverEnglish(container, NAMES).join(' | ')).toBe('');
  });
});

describe('Checkout Upsell Settings — independent states (extras #13)', () => {
  it('salon preference, can-suggest-now and payment authority are shown separately; a restricted subscription says No with why while the preference stays On', async () => {
    A.settings.mockResolvedValue({ ...settings, salon: { ...settings.salon, enabled: true } });
    A.center.summary.mockResolvedValue({ ...summary, effective: 'subscription_restricted', subscription: { allowed: false, reason: 'lapsed', status: 'past_due' } });
    renderIt();
    expect(await screen.findByTestId('ucx-state-pref')).toHaveTextContent('Salon preference: Enabled');
    await waitFor(() => expect(screen.getByTestId('ucx-state-run')).toHaveAttribute('data-kind', 'subscription_restricted'));
    expect(screen.getByTestId('ucx-state-run')).toHaveTextContent('Can suggest now: No — Subscription restricted');
    expect(screen.getByTestId('ucx-state-pay')).toHaveTextContent('Suggestions never charge');
  });
  it('no salon-level value says it follows the default; an effective assistant says Yes', async () => {
    renderIt();
    expect(await screen.findByTestId('ucx-state-pref')).toHaveTextContent('not set here — follows the default (Enabled)');
    await waitFor(() => expect(screen.getByTestId('ucx-state-run')).toHaveTextContent('Can suggest now: Yes'));
  });
});
