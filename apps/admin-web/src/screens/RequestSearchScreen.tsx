// Super-Admin → System → Request search — BUILD_PLAN Phase 14 A (Constitution 11 §181, §291–292, trace ↔ log linking).
//
// Support quotes "Reference: req_01J…" (or a correlation id from a mobile report, or a trace id from a collector) and finds
// the request here: the search box takes any of the three (a 32-hex value is a trace id, `req_`/`job_`/`evt_` a request id,
// anything else a correlation id — or pick the field), narrowed by status, level and time window (the store keeps 14 days).
// Selecting a result opens its detail: the span waterfall of its trace with each span's log lines under it, the lines that
// belong to no stored span, and the correlation chain (requests, jobs, events, provider calls).
//
// §181: what the server returns depends on the CALLER's keys — without super_admin.telemetry.sensitive.view the rows are
// redacted (no tenant ids, id segments collapsed, error messages hidden) and the screen says so; it never asks for more.
import { useCallback, useState } from 'react';
import { api } from '../api/client';
import type {
  TelemetryCorrelationView, TelemetryLogLine, TelemetryRequestDetail, TelemetryRequestList, TelemetryRequestSummary, TelemetryTraceView,
} from '@aipowersalon/api-contracts';

type Field = 'auto' | 'requestId' | 'correlationId' | 'traceId' | 'tenantId' | 'route';
const FIELDS: Array<[Field, string]> = [['auto', 'Any id'], ['requestId', 'Request ID'], ['correlationId', 'Correlation ID'], ['traceId', 'Trace ID'], ['tenantId', 'Tenant ID'], ['route', 'Route starts with']];
const WINDOWS: Array<[number, string]> = [[1, 'Last hour'], [24, 'Last 24 hours'], [24 * 7, 'Last 7 days'], [24 * 14, 'Last 14 days']];
const LEVEL_COLOR: Record<string, string> = { info: '#5B6B7A', warn: '#A0711B', error: '#B85B4D', fatal: '#8A2B1F' };

/** Which filter an id typed into "Any id" is. */
export function fieldForId(v: string): Exclude<Field, 'auto' | 'tenantId' | 'route'> {
  if (/^[0-9a-f]{32}$/.test(v)) return 'traceId';
  if (/^(req|job|evt)_/.test(v)) return 'requestId';
  return 'correlationId';
}

const fmtMs = (ms: number | null) => (ms == null ? '—' : ms < 1 ? `${ms.toFixed(2)} ms` : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`);
const fmtTs = (ts: string) => (ts ? ts.replace('T', ' ').replace(/\.\d+Z$/, 'Z') : '—');

function LogLines({ lines, testId }: { lines: TelemetryLogLine[]; testId?: string }) {
  if (!lines.length) return null;
  return (
    <ul data-testid={testId} style={{ listStyle: 'none', margin: '4px 0 6px', padding: 0, fontSize: 12 }}>
      {lines.map((l, i) => (
        <li key={i} style={{ display: 'flex', gap: 8, padding: '2px 0', fontFamily: 'ui-monospace, monospace' }}>
          <span className="muted">{fmtTs(l.ts).slice(11)}</span>
          <span style={{ color: LEVEL_COLOR[l.level] ?? 'inherit', minWidth: 40 }}>{l.level}</span>
          <span>{l.msg}</span>
          {Object.keys(l.fields).length ? <span className="muted" style={{ overflowWrap: 'anywhere' }}>{JSON.stringify(l.fields)}</span> : null}
        </li>
      ))}
    </ul>
  );
}

export function TraceWaterfall({ trace }: { trace: TelemetryTraceView }) {
  const total = Math.max(1, trace.durationMs);
  if (!trace.spans.length) return <div className="state" data-testid="trace-empty">No spans of this trace are stored (only sampled traces are kept — the request's log lines are below).</div>;
  return (
    <div data-testid="trace-waterfall">
      {trace.spans.map((s) => (
        <div key={s.spanId} data-testid={`span-${s.spanId}`} style={{ borderBottom: '1px solid var(--line, #e5e5e5)', padding: '4px 0' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 40%) 1fr 80px', gap: 8, alignItems: 'center', fontSize: 13 }}>
            <span style={{ paddingLeft: s.depth * 16, overflowWrap: 'anywhere' }} title={`${s.kind} · ${s.service}`}>
              {s.status === 'error' ? <strong style={{ color: '#B85B4D' }}>{s.name}</strong> : s.name}
              <span className="muted"> · {s.kind}</span>
            </span>
            <span aria-hidden style={{ position: 'relative', height: 10, background: 'var(--track, #f1f1f1)', borderRadius: 3 }}>
              <span style={{ position: 'absolute', left: `${(s.offsetMs / total) * 100}%`, width: `${Math.max(0.5, (s.durationMs / total) * 100)}%`, top: 0, bottom: 0, background: s.status === 'error' ? '#B85B4D' : '#4A7BA7', borderRadius: 3 }} />
            </span>
            <span style={{ textAlign: 'right' }}>{fmtMs(s.durationMs)}</span>
          </div>
          {s.statusMessage ? <div className="muted" style={{ fontSize: 12, paddingLeft: s.depth * 16 }}>{s.statusMessage}</div> : null}
          <div style={{ paddingLeft: s.depth * 16 + 12 }}><LogLines lines={s.logs} testId={`span-logs-${s.spanId}`} /></div>
        </div>
      ))}
    </div>
  );
}

function SummaryTable({ items, onOpen, testId }: { items: TelemetryRequestSummary[]; onOpen: (id: string) => void; testId: string }) {
  return (
    <table className="table" data-testid={testId}>
      <thead><tr><th>Started</th><th>Request</th><th>Kind</th><th>Route</th><th>Status</th><th>Duration</th><th>Worst level</th><th>Tenant</th></tr></thead>
      <tbody>
        {items.map((r) => (
          <tr key={r.requestId}>
            <td>{fmtTs(r.startedAt)}</td>
            <td><button type="button" className="linklike" onClick={() => onOpen(r.requestId)}>{r.requestId}</button></td>
            <td>{r.kind}</td><td style={{ overflowWrap: 'anywhere' }}>{r.route ?? '—'}</td><td>{r.status ?? '—'}</td><td>{fmtMs(r.durationMs)}</td>
            <td style={{ color: LEVEL_COLOR[r.maxLevel] }}>{r.maxLevel}</td><td>{r.tenantId ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function RequestSearchScreen() {
  const [text, setText] = useState('');
  const [field, setField] = useState<Field>('auto');
  const [status, setStatus] = useState('');
  const [level, setLevel] = useState('');
  const [hours, setHours] = useState(24);
  const [list, setList] = useState<TelemetryRequestList | 'error' | null>(null);
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<{ req: TelemetryRequestDetail; trace: TelemetryTraceView | null } | 'error' | null>(null);
  const [corr, setCorr] = useState<TelemetryCorrelationView | 'error' | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const search = useCallback(async () => {
    setMsg(null); setDetail(null); setCorr(null); setBusy(true);
    const v = text.trim();
    const f: Field = field === 'auto' && v ? fieldForId(v) : field;
    const now = Date.now();
    const q: Record<string, string> = { from: new Date(now - hours * 3_600_000).toISOString(), to: new Date(now).toISOString() };
    if (v && f !== 'auto') q[f] = v;
    if (status) q.status = status;
    if (level) q.level = level;
    try {
      // A trace id opens the trace directly as well — it may hold spans whose request lines were not sampled.
      setList(await api.get<TelemetryRequestList>('/super-admin/observability/requests', q));
    } catch (e: any) { setList('error'); setMsg(e?.message || 'The search could not run.'); }
    finally { setBusy(false); }
  }, [text, field, status, level, hours]);

  const open = useCallback(async (requestId: string) => {
    setMsg(null); setCorr(null); setDetail(null);
    try {
      const req = await api.get<TelemetryRequestDetail>(`/super-admin/observability/requests/${encodeURIComponent(requestId)}`);
      const traceId = req.traceIds[0];
      const trace = traceId ? await api.get<TelemetryTraceView>(`/super-admin/observability/traces/${traceId}`) : null;
      setDetail({ req, trace });
    } catch { setDetail('error'); }
  }, []);

  const openCorrelation = useCallback(async (id: string) => {
    setMsg(null);
    try { setCorr(await api.get<TelemetryCorrelationView>(`/super-admin/observability/correlations/${encodeURIComponent(id)}`)); }
    catch { setCorr('error'); }
  }, []);

  const redacted = (list && list !== 'error' && list.redacted) || (detail && detail !== 'error' && detail.req.redacted);
  const attached = detail && detail !== 'error' && detail.trace ? new Set(detail.trace.spans.flatMap((s) => s.logs.map((l) => `${l.ts}|${l.msg}`))) : new Set<string>();

  return (
    <div className="page">
      <div className="phead"><h1>Request search</h1></div>
      <p className="muted" style={{ fontSize: 13, maxWidth: 780 }}>
        Find a request by the reference a salon quotes (req_…), a correlation id or a trace id. Every warning and error is kept; ordinary
        lines and traces are sampled. Lines are redacted before they are stored and kept for 14 days.
      </p>
      <form onSubmit={(e) => { e.preventDefault(); void search(); }} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'end', marginBottom: 12 }}>
        <label style={{ display: 'grid', gap: 2, fontSize: 12, flex: '1 1 260px' }}>Search
          <input aria-label="Search" value={text} placeholder="req_01J… / correlation id / trace id" onChange={(e) => setText(e.target.value)} />
        </label>
        <label style={{ display: 'grid', gap: 2, fontSize: 12 }}>Field
          <select aria-label="Field" value={field} onChange={(e) => setField(e.target.value as Field)}>{FIELDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        </label>
        <label style={{ display: 'grid', gap: 2, fontSize: 12 }}>Status
          <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Any</option><option value="5xx">5xx</option><option value="4xx">4xx</option><option value="2xx">2xx</option>
          </select>
        </label>
        <label style={{ display: 'grid', gap: 2, fontSize: 12 }}>Level
          <select aria-label="Level" value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="">Any</option><option value="warn">Warn and above</option><option value="error">Error and above</option>
          </select>
        </label>
        <label style={{ display: 'grid', gap: 2, fontSize: 12 }}>Window
          <select aria-label="Window" value={hours} onChange={(e) => setHours(Number(e.target.value))}>{WINDOWS.map(([h, l]) => <option key={h} value={h}>{l}</option>)}</select>
        </label>
        <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Searching…' : 'Search'}</button>
      </form>
      {msg ? <div className="error" role="alert">{msg}</div> : null}
      {redacted ? <div className="state" data-testid="redacted-note" style={{ marginBottom: 8 }}>Redacted view — tenant ids, ids inside routes and error messages need the sensitive telemetry permission.</div> : null}

      {list === null ? null : list === 'error' ? <div className="state">The search could not be read.</div> : list.items.length === 0 ? (
        <div className="state" data-testid="no-results">No stored request matches in this window. Ordinary requests are sampled — an error or warning is always kept.</div>
      ) : (
        <div className="panel" style={{ marginBottom: 12, overflowX: 'auto' }}>
          <SummaryTable items={list.items} onOpen={(id) => void open(id)} testId="request-results" />
        </div>
      )}

      {detail === 'error' ? <div className="state">The request could not be read.</div> : detail ? (
        <div className="panel" data-testid="request-detail" style={{ marginBottom: 12 }}>
          <div className="phead"><h2>{detail.req.summary?.requestId ?? 'Request'}</h2></div>
          {detail.req.summary ? (
            <p style={{ fontSize: 13 }}>
              {detail.req.summary.route ?? '—'} · status {detail.req.summary.status ?? '—'} · {fmtMs(detail.req.summary.durationMs)} · {detail.req.summary.lines} line(s)
              {detail.req.summary.correlationId ? <> · correlation <button type="button" className="linklike" onClick={() => void openCorrelation(detail.req.summary!.correlationId!)}>{detail.req.summary.correlationId}</button></> : null}
              {detail.req.summary.traceId ? <> · trace <code>{detail.req.summary.traceId}</code></> : null}
            </p>
          ) : <p className="muted">No stored lines for this request.</p>}
          <h3 style={{ fontSize: 14 }}>Trace</h3>
          {detail.trace ? <TraceWaterfall trace={detail.trace} /> : <div className="state">This request carries no trace id.</div>}
          {detail.trace?.unattachedLogs.length ? (<><h3 style={{ fontSize: 14 }}>Lines outside a stored span</h3><LogLines lines={detail.trace.unattachedLogs} testId="unattached-logs" /></>) : null}
          {(() => { const rest = detail.req.logs.filter((l) => !attached.has(`${l.ts}|${l.msg}`) && !detail.trace?.unattachedLogs.some((u) => u.ts === l.ts && u.msg === l.msg));
            return rest.length ? (<><h3 style={{ fontSize: 14 }}>Request lines</h3><LogLines lines={rest} testId="request-logs" /></>) : null; })()}
        </div>
      ) : null}

      {corr === 'error' ? <div className="state">The correlation chain could not be read.</div> : corr ? (
        <div className="panel" data-testid="correlation-view">
          <div className="phead"><h2>Correlation {corr.correlationId}</h2></div>
          <p className="muted" style={{ fontSize: 13 }}>{corr.requests.length} request(s) · {corr.jobs.length} job(s) · {corr.events.length} event(s) · {corr.traceIds.length} trace(s) · {corr.providerCalls.length} provider call(s)</p>
          <SummaryTable items={[...corr.requests, ...corr.jobs, ...corr.events]} onOpen={(id) => void open(id)} testId="correlation-items" />
          {corr.providerCalls.length ? (
            <table className="table" data-testid="provider-calls"><thead><tr><th>Provider call</th><th>Started</th><th>Duration</th><th>Status</th></tr></thead>
              <tbody>{corr.providerCalls.map((c) => <tr key={c.spanId}><td>{c.name}</td><td>{fmtTs(c.startTs)}</td><td>{fmtMs(c.durationMs)}</td><td>{c.status}</td></tr>)}</tbody></table>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
