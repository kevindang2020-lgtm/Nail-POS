// POSAICheckoutUpsellAssistantScreen — AI Checkout + Upsell Assistant guide (Nov 3 2026): honest add-on header; the cards say whether the
// assistant is really on and what happened to 30 days of suggestions; the activity is a server query; the check renders the upsell
// center's localized checks; nothing here charges or edits a hóa đơn.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { uc, pkg } = vi.hoisted(() => ({ uc: { summary: vi.fn(), activity: vi.fn(), history: vi.fn(), check: vi.fn() }, pkg: { detail: vi.fn(), startTrial: vi.fn(), cancel: vi.fn() } }));
vi.mock('../api/posAiCheckoutUpsellApi', () => ({ posAiCheckoutUpsellApi: { center: uc } }));
vi.mock('../api/posAiUsageApi', () => ({ posAiUsageScreenApi: pkg }));
import { POSAICheckoutUpsellAssistantScreen } from './POSAICheckoutUpsellAssistantScreen';

const CARD = { package: { code: 'ai_checkout_upsell_assistant', name: 'AI Checkout + Upsell Assistant', description: 'Suggests add-ons.', category: 'Growth', posArea: 'Checkout / Service Done / Receipt', state: 'active', storedStatus: 'active',
  disabledReason: null, price: { cents: 4900, period: 'monthly', source: 'subscription' }, usage: { used: 12, limit: 2000, unit: 'calls', percent: 1, level: 'ok', periodStart: '2026-11-01T00:00:00Z', periodEnd: '2026-12-01T00:00:00Z', remaining: 1988 },
  trial: { days: 14, endsAt: null, daysLeft: null, eligible: false }, actions: ['cancel'] } };
const SUM = { effective: 'subscription_restricted', last30d: { generated: 9, accepted: 4, applied: 3, dismissed: 5, failed: 1, lastAt: null } };
const ROW = { id: 'u1', type: 'service_addon', status: 'APPLIED', title: 'Paraffin add-on', priceCents: 1000, ticketNumber: 'T-1042', customer: 'Linh Pham', customerPhoneLast4: '0142', createdAt: '2026-11-02T15:00:00Z' };
const page = (items: any[]) => ({ items, total: items.length, page: 1, pageSize: 25, totalPages: 1, period: { today: '2026-11-03' } });

beforeEach(() => { vi.clearAllMocks(); pkg.detail.mockResolvedValue(CARD); uc.summary.mockResolvedValue(SUM); uc.activity.mockResolvedValue(page([ROW])); });

describe('AI Checkout + Upsell Assistant', () => {
  it('CU-01 the real assistant state (not just the subscription), 30-day outcomes, an activity row', async () => {
    render(<MemoryRouter><POSAICheckoutUpsellAssistantScreen /></MemoryRouter>);
    expect(await screen.findByTestId('as-kpi-state')).not.toHaveTextContent('ucx.');
    await waitFor(() => expect(screen.getByTestId('as-kpi-applied')).toHaveTextContent('3'));
    expect(screen.getByTestId('as-kpi-failed')).toHaveTextContent('1');
    const row = await screen.findByTestId('as-row');
    expect(row).toHaveTextContent('Paraffin add-on'); expect(row).toHaveTextContent('T-1042'); expect(row).toHaveTextContent('•••0142'); expect(row).toHaveTextContent('$10.00');
    expect(screen.getByTestId('as-open')).toHaveAttribute('href', '/tenant/ai/checkout-upsell/settings');
  });
  it('CU-02 type, status, presets and pages reach the activity query', async () => {
    render(<MemoryRouter><POSAICheckoutUpsellAssistantScreen /></MemoryRouter>);
    await screen.findByTestId('as-row');
    fireEvent.change(screen.getByTestId('as-f-type'), { target: { value: 'product' } });
    fireEvent.change(screen.getByTestId('as-f-status'), { target: { value: 'FAILED' } });
    fireEvent.click(screen.getByTestId('as-preset-week'));
    await waitFor(() => expect(uc.activity).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'product', status: 'FAILED', preset: 'week', page: 1, pageSize: 25 })));
  });
  it('CU-03 the check renders localized checks', async () => {
    uc.check.mockResolvedValue({ overall: 'WARNING', checkedAt: '2026-11-03T05:00:00Z', checks: [{ key: 'categories_connected', state: 'WARNING', count: 5 }] });
    render(<MemoryRouter><POSAICheckoutUpsellAssistantScreen /></MemoryRouter>);
    fireEvent.click(await screen.findByTestId('as-check'));
    const k = await screen.findByTestId('as-chk-categories_connected');
    expect(k.textContent).not.toContain('ucx.');
  });
});
