// JobsDeadLettersScreen.test — BUILD_PLAN Phase 2: the job queue and the event dead letters, and what the screen
// refuses to fake (a failed request is "unknown", never an empty green list).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('../api/superAdminJobsApi', () => ({ superAdminJobsApi: { eventHealth: vi.fn(), selfTest: vi.fn(), stats: vi.fn(), list: vi.fn(), retry: vi.fn(), cancel: vi.fn(), deadLetters: vi.fn(), retryDeadLetter: vi.fn(), discardDeadLetter: vi.fn() } }));
import { superAdminJobsApi as api } from '../api/superAdminJobsApi';
import { JobsDeadLettersScreen, waitLabel } from './JobsDeadLettersScreen';

const cls = (jobClass: string, over: Record<string, unknown> = {}) => ({ jobClass, queued: 0, running: 0, dead: 0, succeededLastHour: 0, oldestQueuedSeconds: null, ...over });
const job = (over: Record<string, unknown> = {}) => ({ id: 'j1', jobClass: 'standard', jobType: 'reports.export', tenantId: 't1', priority: 2, status: 'dead', attempts: 5, maxAttempts: 5, runAfter: '2026-10-07T00:00:00Z', lastError: 'provider down', createdAt: '2026-10-07T00:00:00Z', finishedAt: null, correlationId: null, payloadKeys: ['reportId'], ...over });
const letter = (over: Record<string, unknown> = {}) => ({ id: 'd1', event_id: 'e1', consumer_name: 'loyalty.points', tenant_id: 't1', event_type: 'visit.completed', correlation_id: null, attempts: 6, error_class: 'TRANSIENT', last_error_code: 'DB_TIMEOUT', first_failed_at: '2026-10-07T00:00:00Z', last_failed_at: '2026-10-07T00:01:00Z', status: 'open', next_attempt_at: null, ...over });

beforeEach(() => {
  for (const f of Object.values(api)) vi.mocked(f as any).mockReset();
  vi.mocked(api.stats).mockResolvedValue({ classes: [cls('critical'), cls('standard', { dead: 2, queued: 3, oldestQueuedSeconds: 125 })], handlers: ['reports.export'] } as never);
  vi.mocked(api.list).mockResolvedValue({ items: [job()] } as never);
  vi.mocked(api.deadLetters).mockResolvedValue([letter()] as never);
  vi.mocked(api.eventHealth).mockResolvedValue({ outbox: { pending: 0, claimed: 0, published: 9, failed: 0, oldestPendingAgeSec: null, publishedLastHour: 9 }, consumers: [
    { consumerName: 'loyalty.points', eventTypes: ['visit.completed'], critical: true, processedLastHour: 12, lagSec: 90, duplicateEventsLastDay: 2, duplicateDeliveries: 5 },
    { consumerName: 'sms.receipts', eventTypes: ['payment.captured'], critical: false, processedLastHour: 3, lagSec: null, duplicateEventsLastDay: 0, duplicateDeliveries: 0 }] } as never);
});

describe('Jobs & Dead Letters', () => {
  it('shows per-class counts, the oldest wait and the dead jobs with their last error', async () => {
    render(<JobsDeadLettersScreen />);
    expect(await screen.findByTestId('class-standard')).toHaveTextContent('2 min');
    expect(screen.getByTestId('class-standard')).toHaveTextContent('3');
    expect(await screen.findByTestId('job-j1')).toHaveTextContent('provider down');
    expect(vi.mocked(api.list)).toHaveBeenCalledWith({ status: 'dead', limit: 100 });
  });
  it('retrying a job requires a reason of at least 5 characters, and sends it', async () => {
    vi.mocked(api.retry).mockResolvedValue({ ok: true } as never);
    render(<JobsDeadLettersScreen />);
    fireEvent.click(await screen.findByText('Retry', { selector: '[data-testid="job-j1"] button' }));
    const input = await screen.findByLabelText('Reason');
    fireEvent.change(input, { target: { value: 'no' } });
    fireEvent.click(screen.getByText('Retry job'));
    expect(await screen.findByText('Enter at least 5 characters.')).toBeTruthy();
    expect(api.retry).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'provider recovered at 09:10' } });
    fireEvent.click(screen.getByText('Retry job'));
    await waitFor(() => expect(api.retry).toHaveBeenCalledWith('j1', 'provider recovered at 09:10'));
    expect(await screen.findByTestId('notice')).toHaveTextContent('queued again');
  });
  it('lists open event dead letters and retries one', async () => {
    vi.mocked(api.retryDeadLetter).mockResolvedValue({ ok: true } as never);
    render(<JobsDeadLettersScreen />);
    const row = await screen.findByTestId('letter-d1');
    expect(row).toHaveTextContent('visit.completed');
    expect(row).toHaveTextContent('TRANSIENT · DB_TIMEOUT');
    fireEvent.click(screen.getByText('Retry', { selector: '[data-testid="letter-d1"] button' }));
    await waitFor(() => expect(api.retryDeadLetter).toHaveBeenCalledWith('d1'));
    expect(await screen.findByTestId('notice')).toHaveTextContent('retrying');
  });
  it('a refused dead-letter action says why', async () => {
    vi.mocked(api.discardDeadLetter).mockResolvedValue({ ok: false, reason: 'not_found_or_final' } as never);
    render(<JobsDeadLettersScreen />);
    fireEvent.click(await screen.findByText('Discard', { selector: '[data-testid="letter-d1"] button' }));
    expect(api.discardDeadLetter).not.toHaveBeenCalled();                       // nothing happens before the confirmation
    fireEvent.click(await screen.findByText('Discard', { selector: '[role="alertdialog"] button' }));
    expect(await screen.findByTestId('notice')).toHaveTextContent('Not done: not_found_or_final');
  });
  it('a failed request is shown as failed — never as an empty, healthy queue', async () => {
    vi.mocked(api.stats).mockRejectedValue(new Error('500'));
    vi.mocked(api.deadLetters).mockRejectedValue(new Error('403'));
    render(<JobsDeadLettersScreen />);
    expect(await screen.findByTestId('stats-failed')).toBeTruthy();
    expect(await screen.findByTestId('letters-failed')).toBeTruthy();
    expect(screen.queryByTestId('letters-empty')).toBeNull();
  });
  it('the self-test queues jobs and says what to expect', async () => {
    vi.mocked(api.selfTest).mockResolvedValue({ ok: true, ids: ['a', 'b', 'c', 'd', 'e'] } as never);
    render(<JobsDeadLettersScreen />);
    fireEvent.click(await screen.findByTestId('self-test'));
    expect(await screen.findByTestId('notice')).toHaveTextContent('5 jobs queued');
    expect(api.selfTest).toHaveBeenCalledWith(5);
  });
  it('waitLabel', () => {
    expect(waitLabel(null)).toBe('nothing waiting'); expect(waitLabel(42)).toBe('42s'); expect(waitLabel(7200)).toBe('2.0 h');
  });
  // extras TECH QUEUE 15 (round 10): retries / duplicates per event consumer — duplicates absorbed are counted, handled once
  it('shows each event consumer with its lag, open dead letters and the duplicate deliveries absorbed in the last day', async () => {
    render(<JobsDeadLettersScreen />);
    const row = await screen.findByTestId('consumer-loyalty.points');
    expect(row).toHaveTextContent('loyalty.points · critical'); expect(row).toHaveTextContent('2 min');
    expect(screen.getByTestId('consumer-dups-loyalty.points')).toHaveTextContent('5 repeat(s) of 2 event(s) — handled once');
    expect(screen.getByTestId('consumer-dups-sms.receipts')).toHaveTextContent('none');
    await waitFor(() => expect(row.children[3]).toHaveTextContent('1'));   // the one open dead letter of loyalty.points
  });
  it('a failed health request says so (never an empty green table)', async () => {
    vi.mocked(api.eventHealth).mockRejectedValue(new Error('403'));
    render(<JobsDeadLettersScreen />);
    expect(await screen.findByTestId('consumers-failed')).toBeInTheDocument();
    expect(screen.queryByTestId('consumers')).toBeNull();
  });
});
