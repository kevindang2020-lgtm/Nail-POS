// DatabaseScreen.test — BUILD_PLAN Phase 10 (Constitution 1 §94–98): the Super Admin Database page. Real figures from the
// API, a section that failed says so (never a fake zero), actions need a reason, and there is no SQL input.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
vi.mock('../api/superAdminDatabaseApi', () => ({ superAdminDatabaseApi: {
  overview: vi.fn(), tables: vi.fn(), indexes: vi.fn(), slowQueries: vi.fn(), activity: vi.fn(), schemaHealth: vi.fn(), retentionRuns: vi.fn(), growth: vi.fn(),
  snapshotNow: vi.fn(), cancelBackend: vi.fn(), vacuumAnalyze: vi.fn(), retryDeferred: vi.fn(),
} }));
import { superAdminDatabaseApi as api } from '../api/superAdminDatabaseApi';
import { DatabaseScreen, formatBytes } from './DatabaseScreen';

const OBS = '2026-10-08T12:00:00.000Z';
const overview = (over: Record<string, unknown> = {}) => ({
  observedAt: OBS, server: { version: 'PostgreSQL 16.15', versionNum: 160015, uptimeSeconds: 7200 },
  size: { databaseBytes: 3 * 1024 ** 3, tableCount: 711, indexCount: 2200 },
  connections: { total: 12, active: 2, idle: 9, idleInTransaction: 1, waiting: 0, max: 100, utilisation: 0.12 },
  cacheHitRatio: 0.9931, deadlocks: 0, tempBytes: 0, statsResetAt: null, checkpoints: { timed: 10, requested: 1 }, walBytes: 1024,
  migrations: { latest: '546_explain_pass_indexes.sql', applied: 542, files: 542, pending: [], ledgerIntegrity: 'ok', unknownLedgerRows: [] },
  replica: { configured: false, inRecovery: null, lagSeconds: null, replicationSlots: 0, standbys: [], note: 'No read replica is configured (DATABASE_REPLICA_URL) — reads use the primary.' },
  backups: { lastSuccessAt: null, lastStatus: null, pitrEnabled: null },
  extensions: { pgStatStatements: false, pgTrgm: true, pgcrypto: true }, ...over,
});
const tables = { observedAt: OBS, rows: [{ table: 'payments', totalBytes: 5_000_000, tableBytes: 3_000_000, indexBytes: 2_000_000, rowEstimate: 20000, deadTuples: 500, deadRatio: 0.024, seqScans: 3, idxScans: 900, lastVacuum: null, lastAutovacuum: OBS, lastAnalyze: null, lastAutoanalyze: OBS, bloatEstimateBytes: 73000 }] };
const health = { observedAt: OBS, deferred: [{ id: 'd1000000-0000-4000-8000-000000000001', name: 'uq_users_email', table: 'users', kind: 'unique', migration: '538_core_constraints.sql', reason: '3 duplicate groups', blockingRows: 3, createdAt: OBS, retryable: true }], notValidConstraints: [{ table: 'payments', name: 'fk_payments_ticket', type: 'foreign_key' }], backfills: [] };

beforeEach(() => {
  for (const f of Object.values(api)) vi.mocked(f as any).mockReset();
  vi.mocked(api.overview).mockResolvedValue(overview() as never);
  vi.mocked(api.tables).mockResolvedValue(tables as never);
  vi.mocked(api.schemaHealth).mockResolvedValue(health as never);
  vi.mocked(api.slowQueries).mockResolvedValue({ observedAt: OBS, source: 'app_telemetry', note: 'pg_stat_statements is not available on this database', rows: [{ hash: 'abc123', shape: 'select * from payments where tenant_id = $?', calls: 3, meanMs: 400, maxMs: 700, totalMs: 1200, rows: 30, lastSeenAt: OBS, table: 'payments' }] } as never);
  vi.mocked(api.activity).mockResolvedValue({ observedAt: OBS, byApplication: [{ applicationName: 'api', state: 'idle', count: 9 }], longTransactions: [{ pid: 4242, applicationName: 'api', state: 'idle in transaction', waitEventType: null, waitEvent: null, xactSeconds: 95, querySeconds: 90, queryShape: 'update tickets set status = ? where id = $?', backendType: 'client backend' }], idleInTransaction: [], lockWaits: [] } as never);
  vi.mocked(api.indexes).mockResolvedValue({ observedAt: OBS, computedAt: OBS, cached: true, statsResetAt: null, unused: [], invalid: [{ index: 'idx_broken', table: 'payments', bytes: 0, scans: 0, definition: 'CREATE INDEX idx_broken ON public.payments USING btree (tenant_id)' }], duplicates: [] } as never);
  vi.mocked(api.retentionRuns).mockResolvedValue({ observedAt: OBS, rows: [] } as never);
  vi.mocked(api.growth).mockResolvedValue({ observedAt: OBS, days: 90, totals: [{ day: '2026-10-08', totalBytes: 1000 }], tables: [{ table: 'payments', latestBytes: 1000, changeBytes: 200, series: [{ day: '2026-10-07', totalBytes: 800, rowEstimate: 1 }, { day: '2026-10-08', totalBytes: 1000, rowEstimate: 2 }] }] } as never);
});

describe('Database page', () => {
  it('overview shows the real version, size, connections, cache hit ratio and the migration version with nothing pending', async () => {
    render(<DatabaseScreen />);
    const o = await screen.findByTestId('db-overview');
    expect(o).toHaveTextContent('PostgreSQL 16.15');
    expect(o).toHaveTextContent('3.0 GB');
    expect(o).toHaveTextContent('12 / 100');
    expect(o).toHaveTextContent('99.3%');
    expect(screen.getByTestId('db-migrations')).toHaveTextContent('546_explain_pass_indexes.sql');
    expect(screen.getByTestId('db-migrations')).toHaveTextContent('0 pending');
    expect(screen.getByTestId('db-migrations')).toHaveTextContent('ledger ok');
    expect(screen.getByTestId('db-replica')).toHaveTextContent('No read replica is configured');
  });
  it('a pending migration and a broken ledger are shown as problems', async () => {
    vi.mocked(api.overview).mockResolvedValue(overview({ migrations: { latest: '545_x.sql', applied: 1, files: 2, pending: ['546_y.sql'], ledgerIntegrity: 'broken', unknownLedgerRows: ['999_gone.sql'] } }) as never);
    render(<DatabaseScreen />);
    const m = await screen.findByTestId('db-migrations');
    expect(m).toHaveTextContent('1 pending'); expect(m).toHaveTextContent('546_y.sql'); expect(m).toHaveTextContent('999_gone.sql');
  });
  it('a failed section is "unknown", never an empty healthy list', async () => {
    vi.mocked(api.overview).mockRejectedValue(new Error('This section could not be read: permission denied for pg_stat_activity'));
    render(<DatabaseScreen />);
    expect(await screen.findByTestId('section-failed')).toHaveTextContent('permission denied');
    expect(screen.queryByTestId('db-overview')).toBeNull();
  });
  it('tables tab: top tables with dead tuples; VACUUM ANALYZE needs a reason and sends it', async () => {
    vi.mocked(api.vacuumAnalyze).mockResolvedValue({ ok: true, table: 'payments', durationMs: 120 } as never);
    render(<DatabaseScreen />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Tables' }));
    const row = await screen.findByTestId('table-payments');
    expect(row).toHaveTextContent('20,000'); expect(row).toHaveTextContent('2.4%');
    fireEvent.click(screen.getByText('VACUUM ANALYZE', { selector: '[data-testid="table-payments"] button' }));
    fireEvent.change(await screen.findByLabelText('Reason'), { target: { value: 'short' } });
    fireEvent.click(screen.getByText('Run VACUUM ANALYZE'));
    expect(await screen.findByText('Enter at least 10 characters.')).toBeTruthy();
    expect(api.vacuumAnalyze).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'dead tuples after the import' } });
    fireEvent.click(screen.getByText('Run VACUUM ANALYZE'));
    await waitFor(() => expect(api.vacuumAnalyze).toHaveBeenCalledWith('payments', 'dead tuples after the import'));
    expect(await screen.findByTestId('notice')).toHaveTextContent('payments');
  });
  it('schema health lists open deferred constraints and NOT VALID ones; retry sends the reason and reports the result', async () => {
    vi.mocked(api.retryDeferred).mockResolvedValue({ ok: true, id: health.deferred[0].id, resolved: false, message: 'Still blocked: could not create unique index' } as never);
    render(<DatabaseScreen />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Schema health' }));
    const row = await screen.findByTestId(`deferred-${health.deferred[0].id}`);
    expect(row).toHaveTextContent('uq_users_email'); expect(row).toHaveTextContent('3 duplicate groups');
    expect(screen.getByTestId('not-valid')).toHaveTextContent('fk_payments_ticket');
    fireEvent.click(screen.getByText('Retry', { selector: `[data-testid="deferred-${health.deferred[0].id}"] button` }));
    fireEvent.change(await screen.findByLabelText('Reason'), { target: { value: 'duplicates merged by support' } });
    fireEvent.click(screen.getByText('Retry constraint'));
    await waitFor(() => expect(api.retryDeferred).toHaveBeenCalledWith(health.deferred[0].id, 'duplicates merged by support'));
    expect(await screen.findByTestId('notice')).toHaveTextContent('Still blocked');
  });
  it('slow queries say where they come from (no pg_stat_statements → the app\'s shapes)', async () => {
    render(<DatabaseScreen />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Slow queries' }));
    expect(await screen.findByTestId('slow-source')).toHaveTextContent('pg_stat_statements is not available');
    expect(screen.getByTestId('slow-abc123')).toHaveTextContent('select * from payments where tenant_id = $?');
  });
  it('activity shows long transactions and cancel needs a reason', async () => {
    vi.mocked(api.cancelBackend).mockResolvedValue({ ok: true, pid: 4242, cancelled: true } as never);
    render(<DatabaseScreen />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Activity' }));
    const row = await screen.findByTestId('long-4242');
    expect(row).toHaveTextContent('95 s');
    fireEvent.click(screen.getByText('Cancel query', { selector: '[data-testid="long-4242"] button' }));
    fireEvent.change(await screen.findByLabelText('Reason'), { target: { value: 'blocking the queue board' } });
    fireEvent.click(screen.getByText('Cancel backend query'));
    await waitFor(() => expect(api.cancelBackend).toHaveBeenCalledWith(4242, 'blocking the queue board'));
  });
  it('indexes tab lists INVALID indexes; growth tab draws the series', async () => {
    render(<DatabaseScreen />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Indexes' }));
    expect(await screen.findByTestId('invalid-idx_broken')).toBeTruthy();
    // B-30: the report says when it was computed and offers a refresh that asks the API to recompute
    expect(screen.getByTestId('db-indexes-computed')).toHaveTextContent(/\(from cache\)/);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh now' }));
    await waitFor(() => expect(vi.mocked(api.indexes)).toHaveBeenLastCalledWith(true));
    fireEvent.click(screen.getByRole('tab', { name: 'Growth' }));
    expect(await screen.findByTestId('growth-payments')).toHaveTextContent('+200 B');
  });
  it('has no SQL input anywhere (§98)', async () => {
    const { container } = render(<DatabaseScreen />);
    await screen.findByTestId('db-overview');
    for (const name of ['Overview', 'Tables', 'Indexes', 'Slow queries', 'Activity', 'Schema health', 'Retention', 'Growth']) fireEvent.click(screen.getByRole('tab', { name }));
    await waitFor(() => expect(api.growth).toHaveBeenCalled());
    expect(container.querySelector('textarea')).toBeNull();
    expect(container.textContent).not.toMatch(/run sql/i);
  });
  it('formatBytes', () => {
    expect(formatBytes(0)).toBe('0 B'); expect(formatBytes(1536)).toBe('1.5 KB'); expect(formatBytes(3 * 1024 ** 3)).toBe('3.0 GB'); expect(formatBytes(-200)).toBe('-200 B');
  });
});
