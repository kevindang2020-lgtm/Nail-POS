// SystemOperationsScreen.test — Constitution 11 §140–156, §80, §332: what the control plane shows, and refuses to fake.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
vi.mock('../api/superAdminApi', () => ({ superAdminApi: { systemOperationsOverview: vi.fn(), systemComponentHistory: vi.fn(), systemOperationsApi: vi.fn() } }));
import { superAdminApi } from '../api/superAdminApi';
import { SystemOperationsScreen, budgetLabel, validationLabel } from './SystemOperationsScreen';

const card = (key: string, status: string, over: Record<string, unknown> = {}) =>
  ({ key, name: key.toUpperCase(), criticality: 'CRITICAL', owner: 'platform', runbook: `RUNBOOKS.md#${key}`, status, reason: status === 'HEALTHY' ? 'ok' : 'probe_failed', stale: false, computedAt: null, lastChangeAt: null, ...over });
const slo = (id: string, over: Record<string, unknown> = {}) =>
  ({ id, name: id, status: 'proposed', target: 0.995, sli: 0.998, total: 12000, bad: 24, budgetRemaining: 0.6, burnRateFast: 0.4, alert: null, ...over });
const overview = (over: Record<string, unknown> = {}) => ({
  generatedAt: '2026-09-21T12:00:00Z', overall: 'HEALTHY', stale: false,
  components: [card('database', 'HEALTHY'), card('payments', 'HEALTHY')],
  alerts: { open: 0, bySeverity: {}, recent: [] }, slos: [slo('api_availability')], ...over,
});
const mount = () => render(<MemoryRouter><SystemOperationsScreen /></MemoryRouter>);
beforeEach(() => {
  vi.mocked(superAdminApi.systemOperationsOverview).mockReset(); vi.mocked(superAdminApi.systemComponentHistory).mockReset();
  vi.mocked(superAdminApi.systemOperationsApi).mockReset().mockResolvedValue({ windowMinutes: 60, failing: [], slowest: [] } as never);
});

describe('the overview', () => {
  it('shows the overall status and a card per component', async () => {
    vi.mocked(superAdminApi.systemOperationsOverview).mockResolvedValue(overview() as never);
    mount();
    expect(await screen.findByTestId('overall')).toHaveTextContent('Healthy');
    expect(screen.getByTestId('card-database')).toBeTruthy();
    expect(screen.getByTestId('card-payments')).toBeTruthy();
  });
  it('an outage shows its reason and runbook — a responder can act from the card (§142, §177)', async () => {
    vi.mocked(superAdminApi.systemOperationsOverview).mockResolvedValue(overview({ overall: 'OUTAGE', components: [card('database', 'OUTAGE')] }) as never);
    mount();
    expect(await screen.findByTestId('status-database')).toHaveTextContent('Outage');
    expect(screen.getByTestId('card-database')).toHaveTextContent('Reason: probe_failed');
    expect(screen.getByTestId('card-database')).toHaveTextContent('RUNBOOKS.md#database');
  });
  it('lists open alerts', async () => {
    vi.mocked(superAdminApi.systemOperationsOverview).mockResolvedValue(overview({ alerts: { open: 1, bySeverity: { critical: 1 }, recent: [{ id: 'a1', title: 'Database is down', severity: 'critical', component: 'database', createdAt: '2026-09-21T11:59:00Z' }] } }) as never);
    mount();
    expect(await screen.findByText('Database is down')).toBeTruthy();
    expect(screen.getByTestId('overall')).toHaveTextContent('1 open alert');
  });
});

describe('§332 no fake green', () => {
  it('a stale payload puts a warning above everything', async () => {
    vi.mocked(superAdminApi.systemOperationsOverview).mockResolvedValue(overview({ stale: true, overall: 'UNKNOWN', components: [card('database', 'UNKNOWN', { reason: 'stale', stale: true })] }) as never);
    mount();
    expect(await screen.findByTestId('stale-banner')).toHaveTextContent(/aggregator may have stopped/);
    expect(screen.getByTestId('status-database')).toHaveTextContent('Unknown');
  });
  it('a fresh payload shows no stale banner', async () => {
    vi.mocked(superAdminApi.systemOperationsOverview).mockResolvedValue(overview() as never);
    mount();
    await screen.findByTestId('overall');
    expect(screen.queryByTestId('stale-banner')).toBeNull();
  });
  it('UNKNOWN is shown as Unknown — never styled or worded as Healthy', async () => {
    vi.mocked(superAdminApi.systemOperationsOverview).mockResolvedValue(overview({ overall: 'UNKNOWN', components: [card('payments', 'UNKNOWN', { reason: 'no_provider_traffic' })] }) as never);
    mount();
    expect(await screen.findByTestId('status-payments')).toHaveTextContent('Unknown');
    expect(screen.getByTestId('overall')).not.toHaveTextContent('Healthy');
  });
  it('a load failure is an error, not an empty "all good" page', async () => {
    vi.mocked(superAdminApi.systemOperationsOverview).mockRejectedValue(new Error('500'));
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('500');
  });
});

describe('§80 SLOs — proposed targets are labelled as such', () => {
  it('every proposed target carries the Proposed badge', async () => {
    vi.mocked(superAdminApi.systemOperationsOverview).mockResolvedValue(overview({ slos: [slo('api_availability'), slo('checkout_payment')] }) as never);
    mount();
    expect(await screen.findByTestId('proposed-api_availability')).toHaveTextContent('Proposed');
    expect(screen.getByTestId('proposed-checkout_payment')).toBeTruthy();
  });
  it('a validated target does NOT carry the badge — the label means something', async () => {
    vi.mocked(superAdminApi.systemOperationsOverview).mockResolvedValue(overview({ slos: [slo('api_availability', { status: 'validated' })] }) as never);
    mount();
    await screen.findByTestId('slo-api_availability');
    expect(screen.queryByTestId('proposed-api_availability')).toBeNull();
  });
  it('no traffic reads "No traffic yet", never 100%', async () => {
    vi.mocked(superAdminApi.systemOperationsOverview).mockResolvedValue(overview({ slos: [slo('refund_like', { sli: null, total: 0, budgetRemaining: null, burnRateFast: null })] }) as never);
    mount();
    const row = await screen.findByTestId('slo-refund_like');
    expect(row).toHaveTextContent('No traffic yet');
    expect(row).not.toHaveTextContent('100');
  });
  it('budget wording: remaining, overspent, or no traffic', () => {
    expect(budgetLabel(0.6)).toBe('60% remaining');
    expect(budgetLabel(-0.5)).toBe('Overspent by 50%');
    expect(budgetLabel(null)).toBe('No traffic yet');
  });
});

describe('§391 component history', () => {
  it('opens the timeline of changes for a component', async () => {
    vi.mocked(superAdminApi.systemOperationsOverview).mockResolvedValue(overview() as never);
    vi.mocked(superAdminApi.systemComponentHistory).mockResolvedValue({ changes: [{ status: 'HEALTHY', previous: 'DEGRADED', reason: 'ok', at: '2026-09-21T10:35:00Z' }] } as never);
    mount();
    fireEvent.click((await screen.findAllByText('History'))[0]);
    await waitFor(() => expect(screen.getByTestId('history-database')).toHaveTextContent('Degraded → Healthy'));
    expect(superAdminApi.systemComponentHistory).toHaveBeenCalledWith('database');
  });
});

describe('§143 API — last hour', () => {
  it('lists the top failing and slowest route templates', async () => {
    vi.mocked(superAdminApi.systemOperationsOverview).mockResolvedValue(overview() as never);
    vi.mocked(superAdminApi.systemOperationsApi).mockResolvedValue({ windowMinutes: 60,
      failing: [{ method: 'POST', route: '/pos/checkout/tickets/:ticketId/pay/card', total: 100, serverErrors: 7 }],
      slowest: [{ method: 'GET', route: '/pos/reports/sales', total: 40, avgMs: 1800, maxMs: 4200 }] } as never);
    mount();
    await waitFor(() => expect(screen.getByTestId('api-section')).toHaveTextContent('POST /pos/checkout/tickets/:ticketId/pay/card'));
    expect(screen.getByTestId('api-section')).toHaveTextContent('1800 ms');
  });
  it('if the API section fails, the overview still renders — and the section says it FAILED, never "no errors"', async () => {
    // My first version of this test asserted "No server errors" on failure — pinning fake green. It now forbids it.
    vi.mocked(superAdminApi.systemOperationsOverview).mockResolvedValue(overview() as never);
    vi.mocked(superAdminApi.systemOperationsApi).mockRejectedValue(new Error('boom'));
    mount();
    expect(await screen.findByTestId('overall')).toBeTruthy();
    expect(await screen.findByTestId('api-failed')).toHaveTextContent('Could not load');
    expect(screen.getByTestId('api-section')).not.toHaveTextContent('No server errors');
  });
});

// BUILD_PLAN Phase 14 C (§80): the evidence-based verdict beside each SLO.
describe('SLO validation', () => {
  const v = (id: string, over: Record<string, unknown> = {}) => ({ id, name: id, status: 'proposed', target: 0.995, windowDays: 30, requiredDays: 28, daysWithData: 3, total: 900, bad: 1, sli: 0.9989, evaluatedAt: null, validatedAt: null, breachedAt: null, ...over });
  it('proposed until enough days; validated / breached name their evidence; missing is "not evaluated", never validated', () => {
    expect(validationLabel(v('a') as never)).toBe('Proposed — 3 of 28 days of data');
    expect(validationLabel(v('a', { status: 'validated', daysWithData: 30 }) as never)).toBe('Validated — met over 30 days');
    expect(validationLabel(v('a', { status: 'breached', daysWithData: 29, sli: 0.9912 }) as never)).toBe('Breached — 99.12% over 29 days');
    expect(validationLabel(undefined)).toBe('Not evaluated yet');
  });
  it('the SLO table shows each objective verdict from the overview', async () => {
    vi.mocked(superAdminApi.systemOperationsOverview).mockResolvedValue(overview({ sloValidations: [v('api_availability', { status: 'validated', daysWithData: 30 })] }) as never);
    mount();
    expect(await screen.findByTestId('validation-api_availability')).toHaveTextContent('Validated — met over 30 days');
  });
});
