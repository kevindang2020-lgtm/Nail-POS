// RequestSearchScreen.test.tsx — BUILD_PLAN Phase 14 A (Constitution 11 §181, §291–292): Super Admin → System → Request search.
// The search box routes an id to the right filter, results open the request with its trace waterfall and each span's log
// lines, the correlation chain opens from the detail, a redacted response is labelled, and failures say so.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
vi.mock('../api/client', () => ({ api: { get: vi.fn() } }));
import { api } from '../api/client';
import { RequestSearchScreen, fieldForId } from './RequestSearchScreen';

const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';
const line = (o: any) => ({ ts: '2026-10-01T10:00:00.000Z', level: 'info', service: 'aipowersalon-api', processRole: 'api', requestId: 'req_A', correlationId: 'corr_1', traceId: TRACE, spanId: null, tenantId: null, route: null, status: null, durationMs: null, msg: 'x', fields: {}, ...o });
const summary = { requestId: 'req_A', kind: 'request', startedAt: '2026-10-01T10:00:00.000Z', lastAt: '2026-10-01T10:00:00.230Z', correlationId: 'corr_1', traceId: TRACE, tenantId: null, route: '/checkout/:id/pay', status: 500, durationMs: 230, lines: 3, maxLevel: 'error', service: 'aipowersalon-api' };
const list = { redacted: false, from: '', to: '', items: [summary] };
const detail = { redacted: false, summary, traceIds: [TRACE], logs: [line({ msg: 'checkout.pay_requested', spanId: 'a'.repeat(16) }), line({ level: 'error', msg: 'request.failed', spanId: 'b'.repeat(16) }), line({ msg: 'outside', spanId: null })] };
const trace = {
  redacted: false, traceId: TRACE, startedAt: '2026-10-01T10:00:00.000Z', durationMs: 230,
  spans: [
    { spanId: 'a'.repeat(16), parentSpanId: null, name: 'POST /checkout/:id/pay', kind: 'server', service: 's', startTs: '', offsetMs: 0, durationMs: 230, depth: 0, status: 'error', statusMessage: null, attributes: {}, tenantId: null, logs: [line({ msg: 'checkout.pay_requested' })] },
    { spanId: 'b'.repeat(16), parentSpanId: 'a'.repeat(16), name: 'db insert payments', kind: 'client', service: 's', startTs: '', offsetMs: 5, durationMs: 4, depth: 1, status: 'error', statusMessage: 'DatabaseError', attributes: {}, tenantId: null, logs: [line({ level: 'error', msg: 'request.failed' })] },
  ],
  unattachedLogs: [line({ msg: 'outside' })],
};
const corr = { redacted: false, correlationId: 'corr_1', requests: [summary], jobs: [{ ...summary, requestId: 'job_7', kind: 'job', route: null }], events: [], traceIds: [TRACE], providerCalls: [{ traceId: TRACE, spanId: 'c'.repeat(16), name: 'stripe payment_intents.create', startTs: '2026-10-01T10:00:00.001Z', durationMs: 120, status: 'unset' }], logs: [] };

function route(over: Record<string, any> = {}) {
  (api.get as any).mockImplementation((p: string) => {
    for (const [k, v] of Object.entries(over)) if (p.includes(k)) return v instanceof Error ? Promise.reject(v) : Promise.resolve(v);
    if (p === '/super-admin/observability/requests') return Promise.resolve(list);
    if (p.startsWith('/super-admin/observability/requests/')) return Promise.resolve(detail);
    if (p.startsWith('/super-admin/observability/traces/')) return Promise.resolve(trace);
    if (p.startsWith('/super-admin/observability/correlations/')) return Promise.resolve(corr);
    return Promise.reject(new Error('unexpected ' + p));
  });
}

describe('Request search (§291–292)', () => {
  beforeEach(() => { vi.clearAllMocks(); route(); });

  it('an id typed into "Any id" goes to the right filter', () => {
    expect(fieldForId(TRACE)).toBe('traceId');
    expect(fieldForId('req_01JABC')).toBe('requestId');
    expect(fieldForId('job_123')).toBe('requestId');
    expect(fieldForId('corr_checkout_1')).toBe('correlationId');
  });

  it('searching a request id sends it as requestId within the chosen window, with status and level', async () => {
    render(<RequestSearchScreen />);
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'req_A' } });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: '5xx' } });
    fireEvent.change(screen.getByLabelText('Level'), { target: { value: 'error' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByTestId('request-results');
    const [path, q] = (api.get as any).mock.calls[0];
    expect(path).toBe('/super-admin/observability/requests');
    expect(q).toMatchObject({ requestId: 'req_A', status: '5xx', level: 'error' });
    expect(Date.parse(q.to) - Date.parse(q.from)).toBe(24 * 3_600_000);
  });

  it('a trace id searches by traceId; a correlation id by correlationId', async () => {
    render(<RequestSearchScreen />);
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: TRACE } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByTestId('request-results');
    expect((api.get as any).mock.calls[0][1]).toMatchObject({ traceId: TRACE });
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'corr_checkout_1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect((api.get as any).mock.calls.length).toBe(2));
    expect((api.get as any).mock.calls[1][1]).toMatchObject({ correlationId: 'corr_checkout_1' });
  });

  it('opening a result shows the span waterfall with each span\'s own log lines, and the lines outside any span', async () => {
    render(<RequestSearchScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.click(await screen.findByRole('button', { name: 'req_A' }));
    const wf = await screen.findByTestId('trace-waterfall');
    expect(within(wf).getByText('POST /checkout/:id/pay')).toBeTruthy();
    expect(within(screen.getByTestId(`span-logs-${'b'.repeat(16)}`)).getByText('request.failed')).toBeTruthy();
    expect(within(screen.getByTestId(`span-logs-${'a'.repeat(16)}`)).getByText('checkout.pay_requested')).toBeTruthy();
    expect(within(screen.getByTestId('unattached-logs')).getByText('outside')).toBeTruthy();
    expect(api.get).toHaveBeenCalledWith(`/super-admin/observability/traces/${TRACE}`);
  });

  it('the correlation chain opens from the detail: requests, jobs and provider calls', async () => {
    render(<RequestSearchScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.click(await screen.findByRole('button', { name: 'req_A' }));
    fireEvent.click(await screen.findByRole('button', { name: 'corr_1' }));
    const cv = await screen.findByTestId('correlation-view');
    expect(within(cv).getByText(/1 request\(s\) · 1 job\(s\) · 0 event\(s\)/)).toBeTruthy();
    expect(within(screen.getByTestId('provider-calls')).getByText('stripe payment_intents.create')).toBeTruthy();
  });

  it('a redacted response is labelled; an empty result explains sampling; a failure says so', async () => {
    route({ '/super-admin/observability/requests': { ...list, redacted: true, items: [] } });
    render(<RequestSearchScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByTestId('redacted-note')).toBeTruthy();
    expect(screen.getByTestId('no-results').textContent).toMatch(/sampled/);
  });

  it('a failed search is reported, never shown as "no results"', async () => {
    route({ '/super-admin/observability/requests': new Error('down') });
    render(<RequestSearchScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText(/could not be read/i)).toBeTruthy();
    expect(screen.queryByTestId('no-results')).toBeNull();
  });
});
