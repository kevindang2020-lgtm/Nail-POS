// POSAICustomerProfileAssistantScreen — AI Customer Profile Assistant guide (Nov 3 2026): honest add-on header; the cards come from the
// latest Customer Intelligence scan ("Not scanned yet", never zeros); the list is a server query with masked contact; the check renders
// Customer Intelligence's localized checks (incl. the eligibility reconciliation).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { ci, pkg } = vi.hoisted(() => ({ ci: { summary: vi.fn(), customers: vi.fn(), check: vi.fn() }, pkg: { detail: vi.fn(), startTrial: vi.fn(), cancel: vi.fn() } }));
vi.mock('../api/posCustomerIntelligenceApi', () => ({ posCustomerIntelligenceApi: ci }));
vi.mock('../api/posAiUsageApi', () => ({ posAiUsageScreenApi: pkg }));
const cust = vi.hoisted(() => ({ getDetail: vi.fn() }));
vi.mock('../api/posCustomersApi', () => ({ posCustomersApi: cust }));
import { POSAICustomerProfileAssistantScreen } from './POSAICustomerProfileAssistantScreen';

const CARD = { package: { code: 'ai_customer_profile_assistant', name: 'AI Customer Profile Assistant', description: 'Customer insights.', category: 'Growth', posArea: 'Customers', state: 'trialing', storedStatus: 'trialing',
  disabledReason: null, price: { cents: 3900, period: 'monthly', source: 'catalog_list' }, usage: { used: 0, limit: 1000, unit: 'insights', percent: 0, level: 'ok', periodStart: null, periodEnd: '2026-11-20T00:00:00Z', remaining: 1000 },
  trial: { days: 14, endsAt: '2026-11-20T00:00:00Z', daysLeft: 17, eligible: false }, actions: ['cancel'] } };
const ROW = { id: 'c1', name: 'Linh Pham', phone: '(•••) •••-0142', scanned: true, status: 'due_for_return', neverServed: false, completedVisits: 7, lastVisitAt: '2026-09-01T15:00:00Z', daysSinceLast: 63,
  nextAppointmentDate: null, churnWatch: true, rebooking: false, duplicate: false };
const page = (items: any[]) => ({ items, total: items.length, page: 1, pageSize: 25, totalPages: 1, period: { today: '2026-11-03' } });
const wrap = () => render(<MemoryRouter><POSAICustomerProfileAssistantScreen /></MemoryRouter>);
beforeEach(() => { vi.clearAllMocks(); pkg.detail.mockResolvedValue(CARD); ci.customers.mockResolvedValue(page([ROW])); });

describe('AI Customer Profile Assistant', () => {
  it('CP-01 never scanned → "Not scanned yet", not zeros; a row with masked phone, status, visits and churn flag', async () => {
    ci.summary.mockResolvedValue({ cards: null });
    wrap();
    await waitFor(() => expect(screen.getByTestId('as-kpi-active')).toHaveTextContent('Not scanned yet'));
    const row = await screen.findByTestId('as-row');
    expect(row).toHaveTextContent('Linh Pham'); expect(row).toHaveTextContent('-0142'); expect(row).toHaveTextContent('63 days ago'); expect(row.textContent).not.toContain('cix.');
  });
  it('CP-02 scanned cards; status / flag / which date / presets reach the query', async () => {
    ci.summary.mockResolvedValue({ cards: { scanned: 40, active: 22, withUpcoming: 9, inactive: 11, churnWatch: 3, rebooking: 5 } });
    wrap();
    await waitFor(() => expect(screen.getByTestId('as-kpi-churn')).toHaveTextContent('3'));
    fireEvent.change(screen.getByTestId('as-f-status'), { target: { value: 'inactive_all' } });
    fireEvent.change(screen.getByTestId('as-f-flag'), { target: { value: 'churn_watch' } });
    fireEvent.change(screen.getByTestId('as-f-dateField'), { target: { value: 'created' } });
    fireEvent.click(screen.getByTestId('as-preset-last_90'));
    await waitFor(() => expect(ci.customers).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'inactive_all', flag: 'churn_watch', dateField: 'created', preset: 'last_90', page: 1 })));
  });
  it('CP-03 the check renders the eligibility reconciliation, not a raw key', async () => {
    ci.summary.mockResolvedValue({ cards: null });
    ci.check.mockResolvedValue({ overall: 'PASSED', checkedAt: '2026-11-03T05:00:00Z', checks: [{ key: 'eligibility', state: 'PASSED', detail: { scanned: 40, active: 22, inactiveCard: 11, neverServed: 2, underCadence: 3, rebookingSoon: 1, dueForReturn: 1 } }] });
    wrap();
    fireEvent.click(await screen.findByTestId('as-check'));
    const k = await screen.findByTestId('as-chk-eligibility');
    expect(k.textContent).not.toContain('cix.');
    expect(k).toHaveTextContent('40');
  });
  it('extras #04 Customer Snapshot: a row opens the real Customer 360 Quick View (same detail read), read-only with Booking / History / Notes links', async () => {
    ci.summary.mockResolvedValue({ cards: null });
    cust.getDetail.mockResolvedValue({ displayName: 'Linh Pham', status: 'active', phone: '(•••) •••-0142', visitCount: 7, totalSpendCents: 42000, averageSpendCents: 6000,
      loyalty: { points: 120, earned: 150, redeemed: 30, tier: 'Silver' }, giftCards: [], recentVisits: [], notes: { allergyNotes: 'Latex' } });
    wrap();
    fireEvent.click(await screen.findByTestId('cpx-snapshot-open'));
    await waitFor(() => expect(cust.getDetail).toHaveBeenCalledWith('c1'));
    const q = await screen.findByTestId('cpx-quick');
    expect(await screen.findByText('$420.00')).toBeInTheDocument();
    expect(screen.getByTestId('cpx-book')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('cpx-tab-visits')); expect(screen.getByTestId('cpx-history')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('cpx-tab-notes')); expect(screen.getByTestId('cpx-edit-notes')).toBeInTheDocument();
    expect(q.textContent).not.toMatch(/cpf\.|cpx\.snapshot/);
    fireEvent.click(screen.getByTestId('cpx-full'));
    await waitFor(() => expect(screen.queryByTestId('cpx-quick')).toBeNull());
  });
});
