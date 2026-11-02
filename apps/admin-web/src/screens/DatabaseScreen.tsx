// Super-Admin → System Operations → Database — BUILD_PLAN Phase 10 (Constitution 1 §94–98).
//
// What the platform's PostgreSQL is doing, read from its own catalogue and statistics views through the API:
//   Overview       version, size, connections vs max, cache hit ratio, deadlocks, checkpoints, migration version + pending
//                  + ledger integrity, replica + lag, last backup report, which extensions answer
//   Tables         the 50 largest: rows, dead tuples, bloat estimate, last (auto)vacuum / analyze, seq vs index scans
//   Indexes        unused since the stats reset, INVALID (an interrupted CONCURRENTLY build), duplicate definitions
//   Slow queries   pg_stat_statements when it answers, else the API's own slow-query shapes (never parameter values)
//   Activity       connections by application, transactions open > 30 s, idle in transaction, lock waits
//   Schema health  constraints a migration had to defer (retry), NOT VALID constraints, backfills
//   Retention      the retention executor's runs · Growth  90-day size per table
// Actions (cancel a backend's query, VACUUM ANALYZE one table, retry a deferred constraint) need a reason (≥ 10
// characters, audited) and step-up. There is no SQL input (§98). A section whose request failed says so — never zero.
import { useCallback, useEffect, useState } from 'react';
import { useInlineAsk } from '@aipowersalon/ui';
import { superAdminDatabaseApi as api, type DbActivity, type DbGrowth, type DbIndexes, type DbOverview, type DbRetentionRuns, type DbSchemaHealth, type DbSlowQueries, type DbTables } from '../api/superAdminDatabaseApi';

export function formatBytes(b: number | null | undefined): string {
  if (b === null || b === undefined || !Number.isFinite(b)) return '—';
  const sign = b < 0 ? '-' : ''; let v = Math.abs(b);
  const units = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${sign}${i === 0 ? v : v.toFixed(1)} ${units[i]}`;
}
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : '—');
const pct = (r: number | null | undefined, digits = 1) => (r === null || r === undefined ? '—' : `${(r * 100).toFixed(digits)}%`);
const num = (n: number) => n.toLocaleString('en-US');
const secs = (s: number | null) => (s === null ? '—' : `${s} s`);
const MIN_REASON = 10;

type Tab = 'overview' | 'tables' | 'indexes' | 'slow' | 'activity' | 'schema' | 'retention' | 'growth';
const TABS: Array<[Tab, string]> = [['overview', 'Overview'], ['tables', 'Tables'], ['indexes', 'Indexes'], ['slow', 'Slow queries'], ['activity', 'Activity'], ['schema', 'Schema health'], ['retention', 'Retention'], ['growth', 'Growth']];
type Section<T> = T | { failed: string } | null;
const failed = (s: unknown): s is { failed: string } => !!s && typeof s === 'object' && 'failed' in (s as any);

export function DatabaseScreen() {
  const [tab, setTab] = useState<Tab>('overview');
  const [data, setData] = useState<Record<Tab, Section<any>>>({ overview: null, tables: null, indexes: null, slow: null, activity: null, schema: null, retention: null, growth: null });
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { ask, askUi } = useInlineAsk();

  const load = useCallback((t: Tab) => {
    const fetchers: Record<Tab, () => Promise<unknown>> = {
      overview: api.overview, tables: () => api.tables(50), indexes: api.indexes, slow: api.slowQueries, activity: api.activity,
      schema: api.schemaHealth, retention: () => api.retentionRuns(50), growth: () => api.growth(90),
    };
    fetchers[t]().then((r) => setData((d) => ({ ...d, [t]: r }))).catch((e: any) => setData((d) => ({ ...d, [t]: { failed: e?.message || 'request failed' } })));
  }, []);
  useEffect(() => { load(tab); const t = setInterval(() => load(tab), 30_000); return () => clearInterval(t); }, [tab, load]);

  const act = (key: string, question: string, confirmLabel: string, run: (reason: string) => Promise<string>, reload: Tab) =>
    ask(question, (reason) => {
      setBusy(key);
      run(reason).then((msg) => { setNotice(msg); load(reload); }).catch((e: any) => setNotice(e?.message || 'The action failed.')).finally(() => setBusy(null));
    }, { minLength: MIN_REASON, inputLabel: 'Reason', confirmLabel });

  const s = data[tab];
  return (
    <div className="work">
      <div className="vh"><h1>Database</h1><div className="sub">System Operations · the platform PostgreSQL · refreshes every 30 s · read-only figures; three audited actions; no SQL console</div></div>
      {askUi}
      {notice && <div className="panel" role="status" data-testid="notice">{notice}</div>}
      <div role="tablist" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '8px 0 12px' }}>
        {TABS.map(([t, label]) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'btn' : 'btn ghost'} onClick={() => setTab(t)}>{label}</button>)}
      </div>
      {s === null && <div className="state">Loading…</div>}
      {failed(s) && <div className="err" role="alert" data-testid="section-failed">Could not read this section — its state is unknown, not empty. {s.failed}</div>}
      {s && !failed(s) && tab === 'overview' && <OverviewView o={s as DbOverview} onSnapshot={() => { setBusy('snap'); api.snapshotNow().then((r) => setNotice(`Size snapshot taken for ${r.written} tables.`)).catch((e: any) => setNotice(e?.message || 'Snapshot failed.')).finally(() => setBusy(null)); }} busy={busy === 'snap'} />}
      {s && !failed(s) && tab === 'tables' && (
        <table className="tbl" data-testid="db-tables">
          <thead><tr><th>Table</th><th>Total</th><th>Heap</th><th>Indexes</th><th>Rows (est.)</th><th>Dead</th><th>Bloat (est.)</th><th>Seq / idx scans</th><th>Last vacuum</th><th>Last analyze</th><th></th></tr></thead>
          <tbody>{(s as DbTables).rows.map((t) => (
            <tr key={t.table} data-testid={`table-${t.table}`}>
              <td>{t.table}</td><td>{formatBytes(t.totalBytes)}</td><td>{formatBytes(t.tableBytes)}</td><td>{formatBytes(t.indexBytes)}</td><td>{num(t.rowEstimate)}</td>
              <td>{num(t.deadTuples)} ({pct(t.deadRatio)})</td><td>{formatBytes(t.bloatEstimateBytes)}</td><td>{num(t.seqScans)} / {num(t.idxScans)}</td>
              <td>{when(t.lastVacuum ?? t.lastAutovacuum)}</td><td>{when(t.lastAnalyze ?? t.lastAutoanalyze)}</td>
              <td><button disabled={busy === `vac-${t.table}`} onClick={() => act(`vac-${t.table}`, `VACUUM ANALYZE ${t.table} — why?`, 'Run VACUUM ANALYZE', async (reason) => { const r = await api.vacuumAnalyze(t.table, reason); return `VACUUM ANALYZE ${r.table}: done in ${r.durationMs} ms.`; }, 'tables')}>VACUUM ANALYZE</button></td>
            </tr>))}</tbody>
        </table>
      )}
      {s && !failed(s) && tab === 'indexes' && <IndexesView x={s as DbIndexes} onRefresh={() => { setBusy('idx-refresh'); api.indexes(true).then((r) => setData((d) => ({ ...d, indexes: r }))).catch((e: any) => setNotice(e?.message || 'Refresh failed.')).finally(() => setBusy(null)); }} refreshing={busy === 'idx-refresh'} />}
      {s && !failed(s) && tab === 'slow' && (
        <>
          <div className="s" data-testid="slow-source">Source: {(s as DbSlowQueries).source === 'pg_stat_statements' ? 'pg_stat_statements' : 'the API\'s slow-query shapes'} — {(s as DbSlowQueries).note}</div>
          {(s as DbSlowQueries).rows.length === 0 && <div className="state">No slow query shapes recorded.</div>}
          {(s as DbSlowQueries).rows.length > 0 && <table className="tbl"><thead><tr><th>Shape</th><th>Calls</th><th>Mean</th><th>Max</th><th>Total</th><th>Rows</th><th>Last seen</th></tr></thead>
            <tbody>{(s as DbSlowQueries).rows.map((q) => <tr key={q.hash} data-testid={`slow-${q.hash}`}><td><code>{q.shape}</code></td><td>{num(q.calls)}</td><td>{q.meanMs} ms</td><td>{q.maxMs} ms</td><td>{num(q.totalMs)} ms</td><td>{num(q.rows)}</td><td>{when(q.lastSeenAt)}</td></tr>)}</tbody></table>}
        </>
      )}
      {s && !failed(s) && tab === 'activity' && <ActivityView a={s as DbActivity} busy={busy} onCancel={(pid) => act(`pid-${pid}`, `Cancel the running query of backend ${pid} — why?`, 'Cancel backend query', async (reason) => { const r = await api.cancelBackend(pid, reason); return r.cancelled ? `Backend ${pid}: query cancelled.` : `Backend ${pid}: nothing was running to cancel.`; }, 'activity')} />}
      {s && !failed(s) && tab === 'schema' && <SchemaView h={s as DbSchemaHealth} busy={busy} onRetry={(id, name) => act(`def-${id}`, `Retry ${name} — why now?`, 'Retry constraint', async (reason) => (await api.retryDeferred(id, reason)).message, 'schema')} />}
      {s && !failed(s) && tab === 'retention' && (
        (s as DbRetentionRuns).rows.length === 0 ? <div className="state" data-testid="retention-empty">No retention runs recorded yet.</div> :
          <table className="tbl"><thead><tr><th>When</th><th>Data class</th><th>Mode</th><th>Cutoff</th><th>Eligible</th><th>Affected</th></tr></thead>
            <tbody>{(s as DbRetentionRuns).rows.map((r) => <tr key={r.id}><td>{when(r.occurredAt)}</td><td>{r.dataClass}</td><td>{r.mode}</td><td>{when(r.cutoff)}</td><td>{num(r.eligible)}</td><td>{num(r.affected)}</td></tr>)}</tbody></table>
      )}
      {s && !failed(s) && tab === 'growth' && <GrowthView g={s as DbGrowth} />}
    </div>
  );
}

function OverviewView({ o, onSnapshot, busy }: { o: DbOverview; onSnapshot: () => void; busy: boolean }) {
  const m = o.migrations;
  const ck = 'available' in o.checkpoints ? null : o.checkpoints;
  const bk = 'available' in o.backups ? null : o.backups;
  return (
    <div data-testid="db-overview">
      <table className="tbl"><tbody>
        <tr><th>Server</th><td>{o.server.version} · up {o.server.uptimeSeconds === null ? '—' : `${(o.server.uptimeSeconds / 3600).toFixed(1)} h`}</td></tr>
        <tr><th>Database size</th><td>{formatBytes(o.size.databaseBytes)} · {num(o.size.tableCount)} tables · {num(o.size.indexCount)} indexes</td></tr>
        <tr><th>Connections</th><td>{o.connections.total} / {o.connections.max} ({pct(o.connections.utilisation)}) · active {o.connections.active} · idle in transaction {o.connections.idleInTransaction} · waiting on locks {o.connections.waiting}</td></tr>
        <tr><th>Cache hit ratio</th><td>{pct(o.cacheHitRatio)}</td></tr>
        <tr><th>Deadlocks · temp files</th><td>{num(o.deadlocks)} · {formatBytes(o.tempBytes)} (since {when(o.statsResetAt)})</td></tr>
        <tr><th>Checkpoints</th><td>{ck ? `${num(ck.timed)} timed · ${num(ck.requested)} requested` : 'not readable'}</td></tr>
        <tr><th>WAL position</th><td>{formatBytes(o.walBytes)}</td></tr>
        <tr><th>Backups</th><td>{bk ? (bk.lastSuccessAt ? `last success ${when(bk.lastSuccessAt)} · PITR ${bk.pitrEnabled === null ? 'unknown' : bk.pitrEnabled ? 'on' : 'off'}` : 'never reported') : 'unknown'}</td></tr>
        <tr><th>Extensions</th><td>pg_stat_statements {o.extensions.pgStatStatements ? 'installed' : 'absent'} · pg_trgm {o.extensions.pgTrgm ? 'yes' : 'no'} · pgcrypto {o.extensions.pgcrypto ? 'yes' : 'no'}</td></tr>
      </tbody></table>
      <div className="panel" data-testid="db-migrations">
        <strong>Migrations:</strong> version {m.latest ?? 'none'} · {m.applied} applied of {m.files} files · {m.pending.length} pending · ledger {m.ledgerIntegrity}
        {m.pending.length > 0 && <div className="err">Pending: {m.pending.join(', ')}</div>}
        {m.unknownLedgerRows.length > 0 && <div className="err">Ledger rows with no file: {m.unknownLedgerRows.join(', ')}</div>}
      </div>
      <div className="panel" data-testid="db-replica">
        <strong>Replica:</strong> {o.replica.configured ? `configured · ${o.replica.inRecovery ? 'standby' : 'not in recovery'} · lag ${o.replica.lagSeconds === null ? '—' : `${o.replica.lagSeconds.toFixed(1)} s`}` : 'not configured'}
        {o.replica.standbys.length > 0 && <> · standbys: {o.replica.standbys.map((s) => `${s.applicationName} (${s.state}, ${s.replayLagSeconds ?? '—'} s)`).join(', ')}</>}
        {o.replica.note && <div className="s">{o.replica.note}</div>}
      </div>
      <button className="btn ghost" disabled={busy} onClick={onSnapshot} data-testid="snapshot-now">Take size snapshot now</button>
      <div className="s">Observed {when(o.observedAt)}</div>
    </div>
  );
}

function IndexesView({ x, onRefresh, refreshing }: { x: DbIndexes; onRefresh: () => void; refreshing: boolean }) {
  return (
    <div data-testid="db-indexes">
      {/* B-30: the report reads every index's definition and size (seconds on a cold catalog), so it is computed once per 10 minutes */}
      <div className="state" data-testid="db-indexes-computed">
        Computed {when(x.computedAt)}{x.cached ? ' (from cache)' : ''} · <button type="button" disabled={refreshing} onClick={onRefresh}>{refreshing ? 'Refreshing…' : 'Refresh now'}</button>
      </div>
      <h2>INVALID indexes</h2>
      {x.invalid.length === 0 ? <div className="state">None.</div> : <ul>{x.invalid.map((i) => <li key={i.index} data-testid={`invalid-${i.index}`}><code>{i.definition}</code></li>)}</ul>}
      <h2>Duplicate definitions</h2>
      {x.duplicates.length === 0 ? <div className="state">None.</div> : <ul>{x.duplicates.map((d) => <li key={`${d.table}-${d.indexes.join()}`}>{d.table}: {d.indexes.join(', ')} — <code>{d.definition}</code></li>)}</ul>}
      <h2>Unused since the statistics reset ({when(x.statsResetAt)})</h2>
      {x.unused.length === 0 ? <div className="state">None.</div> :
        <table className="tbl"><thead><tr><th>Index</th><th>Table</th><th>Size</th></tr></thead><tbody>{x.unused.map((i) => <tr key={i.index}><td>{i.index}</td><td>{i.table}</td><td>{formatBytes(i.bytes)}</td></tr>)}</tbody></table>}
    </div>
  );
}

function ActivityView({ a, busy, onCancel }: { a: DbActivity; busy: string | null; onCancel: (pid: number) => void }) {
  const rows = (list: DbActivity['longTransactions'], prefix: string) => list.length === 0 ? <div className="state">None.</div> : (
    <table className="tbl"><thead><tr><th>pid</th><th>Application</th><th>State</th><th>Transaction</th><th>Query</th><th>Shape</th><th></th></tr></thead>
      <tbody>{list.map((r) => <tr key={r.pid} data-testid={`${prefix}-${r.pid}`}><td>{r.pid}</td><td>{r.applicationName || '—'}</td><td>{r.state}</td><td>{secs(r.xactSeconds)}</td><td>{secs(r.querySeconds)}</td><td><code>{r.queryShape}</code></td>
        <td>{r.backendType === 'client backend' && <button disabled={busy === `pid-${r.pid}`} onClick={() => onCancel(r.pid)}>Cancel query</button>}</td></tr>)}</tbody></table>
  );
  return (
    <div data-testid="db-activity">
      <h2>Connections by application</h2>
      <table className="tbl"><thead><tr><th>Application</th><th>State</th><th>Count</th></tr></thead><tbody>{a.byApplication.map((r) => <tr key={`${r.applicationName}-${r.state}`}><td>{r.applicationName || '—'}</td><td>{r.state || '—'}</td><td>{r.count}</td></tr>)}</tbody></table>
      <h2>Transactions open longer than 30 s</h2>{rows(a.longTransactions, 'long')}
      <h2>Idle in transaction</h2>{rows(a.idleInTransaction, 'iit')}
      <h2>Lock waits</h2>
      {a.lockWaits.length === 0 ? <div className="state">None.</div> : <ul>{a.lockWaits.map((w) => <li key={w.waitingPid}>pid {w.waitingPid} waits {secs(w.waitingSeconds)} on {w.relation ?? 'a lock'} ({w.mode ?? '—'}) behind {w.blockingPids.join(', ')}</li>)}</ul>}
    </div>
  );
}

function SchemaView({ h, busy, onRetry }: { h: DbSchemaHealth; busy: string | null; onRetry: (id: string, name: string) => void }) {
  return (
    <div data-testid="db-schema">
      <h2>Deferred constraints (open)</h2>
      {h.deferred.length === 0 ? <div className="state" data-testid="deferred-empty">None — every constraint the migrations wanted is in place.</div> :
        <table className="tbl"><thead><tr><th>Name</th><th>Table</th><th>Kind</th><th>Migration</th><th>Why deferred</th><th>Since</th><th></th></tr></thead>
          <tbody>{h.deferred.map((d) => <tr key={d.id} data-testid={`deferred-${d.id}`}><td>{d.name}</td><td>{d.table}</td><td>{d.kind}</td><td>{d.migration}</td><td>{d.reason}</td><td>{when(d.createdAt)}</td>
            <td>{d.retryable ? <button disabled={busy === `def-${d.id}`} onClick={() => onRetry(d.id, d.name)}>Retry</button> : <span className="s">fix in a deployment</span>}</td></tr>)}</tbody></table>}
      <h2>NOT VALID constraints</h2>
      <div data-testid="not-valid">{h.notValidConstraints.length === 0 ? <div className="state">None.</div> : <ul>{h.notValidConstraints.map((c) => <li key={`${c.table}.${c.name}`}>{c.table}.{c.name} ({c.type.replace('_', ' ')})</li>)}</ul>}</div>
      <h2>Backfills</h2>
      {h.backfills.length === 0 ? <div className="state">None recorded.</div> :
        <table className="tbl"><thead><tr><th>Name</th><th>Status</th><th>Rows</th><th>Batches</th><th>Updated</th><th>Last error</th></tr></thead>
          <tbody>{h.backfills.map((b) => <tr key={b.name}><td>{b.name}</td><td>{b.status}</td><td>{num(b.rowsDone)}</td><td>{b.batchesDone}</td><td>{when(b.updatedAt)}</td><td>{b.lastError ?? '—'}</td></tr>)}</tbody></table>}
    </div>
  );
}

function GrowthView({ g }: { g: DbGrowth }) {
  if (!g.totals.length) return <div className="state" data-testid="growth-empty">No size snapshots yet — the database.size_snapshot job writes one row per table per day.</div>;
  const max = Math.max(...g.totals.map((t) => t.totalBytes), 1);
  return (
    <div data-testid="db-growth">
      <h2>Total size, last {g.days} days</h2>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 80 }} aria-label="Total size per day">
        {g.totals.map((t) => <div key={t.day} title={`${t.day}: ${formatBytes(t.totalBytes)}`} style={{ width: 6, height: `${Math.max(2, (t.totalBytes / max) * 80)}px`, background: 'var(--aps-accent, #2f6fde)' }} />)}
      </div>
      <h2>Fastest-growing tables</h2>
      <table className="tbl"><thead><tr><th>Table</th><th>Now</th><th>Change</th><th>Days</th></tr></thead>
        <tbody>{g.tables.map((t) => <tr key={t.table} data-testid={`growth-${t.table}`}><td>{t.table}</td><td>{formatBytes(t.latestBytes)}</td><td>{t.changeBytes >= 0 ? '+' : ''}{formatBytes(t.changeBytes)}</td><td>{t.series.length}</td></tr>)}</tbody></table>
    </div>
  );
}
