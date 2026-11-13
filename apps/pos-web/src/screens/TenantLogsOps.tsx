// TenantLogsOps.tsx — two read-mostly dialogs on Device & Integration Logs (backlog, Nov 12 2026):
//   • Device Integration Logs 05 — Automated Alert Routing: the deduplicated device / integration alerts the server routed into
//     the salon's alert feed (device offline · terminal unavailable · repeated sync failures · critical provider errors). The
//     rules, the dedupe and the cooldown are the server's (device-alert-routing.ts) — this list only shows them; Resolve uses
//     the existing owner-alert lifecycle and is offered only when the server says the viewer may.
//   • Device Integration Logs 09 — Worker Delay & Retry Visibility: the salon's work in the existing retry stores (job queue +
//     webhook deliveries): attempt n of max, next attempt, lag past due, dead letters. No retry button — the queue retries itself.
import { useCallback, useEffect, useRef, useState } from 'react';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posLogsApi, type DfAlertsResponse, type LogRetryQueueView } from '../api/posLogsApi';
import { codeLabel } from '../components/codeLabel';
import { fmtDateTime, fmtNumber } from '../i18n/format';
import { FitDialog, Pager, Empty, ErrorRetry } from '../components/FitKit';
import { reportError } from './reportsCommon';
import { errorTextOf } from '../i18n/error-text';

const dash = '—';
const tt = (k: string, v?: Record<string, string | number>) => tx(k, v as Parameters<typeof tx>[1]);
/** seconds → "45 s" / "12 min" / "3 h" (whole units, never a guess) */
export function lagText(sec: number | null): string {
  if (sec == null) return dash;
  if (sec < 90) return tt('lgx.ops.sec', { n: fmtNumber(sec) });
  if (sec < 5400) return tt('lgx.ops.min', { n: fmtNumber(Math.round(sec / 60)) });
  return tt('lgx.ops.hr', { n: fmtNumber(Math.round(sec / 3600)) });
}
const sevTone = (s: string) => (s === 'critical' || s === 'high' ? 'bad' : s === 'warning' ? 'warn' : '');

export function RoutedAlertsDialog({ onClose, onOpenLogs }: { onClose: () => void; onOpenLogs: (f: { category?: string; severity?: string }) => void }) {
  const [status, setStatus] = useState<'open' | 'closed' | 'all'>('open');
  const [page, setPage] = useState(1);
  const [d, setD] = useState<DfAlertsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const seq = useRef(0);
  const load = useCallback(() => {
    const my = ++seq.current; setErr(null);
    posLogsApi.alerts({ status, page, pageSize: 10 }).then((r) => { if (my === seq.current) setD(r); }).catch((e) => { if (my === seq.current) setErr(reportError(e, 'logs')); });
  }, [status, page]);
  useEffect(load, [load]);
  const resolve = async (id: string) => {
    setBusy(id); setNote(null);
    try { await posLogsApi.resolveAlert(id); setNote({ ok: true, text: tt('lgx.alerts.resolved') }); load(); }
    catch (e) { setNote({ ok: false, text: errorTextOf(e, tt('lgx.alerts.resolveFailed')) }); }
    finally { setBusy(null); }
  };
  return (
    <FitDialog wide testId="lgx-alerts" title={tt('lgx.alerts.title')} subtitle={tt('lgx.alerts.sub', { m: d ? fmtNumber(d.cooldownMinutes) : dash })} onClose={onClose}
      footer={<button className="btn ghost" onClick={onClose}>{tx('pos.close')}</button>}>
      <div className="rvw-filters" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        {(['open', 'closed', 'all'] as const).map((s) => <button key={s} className={'btn ghost sm' + (status === s ? ' on' : '')} data-testid={`lgx-alerts-f-${s}`} onClick={() => { setStatus(s); setPage(1); }}>{tt('lgx.alerts.status.' + s)}</button>)}
        <span className="sub" data-testid="lgx-alerts-eval">{d?.evaluatedAt ? tt('lgx.alerts.checked', { t: fmtDateTime(d.evaluatedAt) }) : ''}</span>
      </div>
      {note ? <div className={'fk-note ' + (note.ok ? 'ok' : 'bad')} role={note.ok ? 'status' : 'alert'} data-testid="lgx-alerts-note"><span>{note.text}</span></div> : null}
      {err ? <ErrorRetry message={err} onRetry={load} />
        : !d ? <div className="state">{tx('pos.loading')}</div>
        : d.items.length === 0 ? <Empty title={status === 'open' ? tt('lgx.alerts.none') : tt('lgx.alerts.noneClosed')} />
        : <ul className="lgx-alerts" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>{d.items.map((a) => (
          <li key={a.id} data-testid="lgx-alert" data-rule={a.rule} className="panel" style={{ padding: 10 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span className={'chip ' + sevTone(a.severity)}>{codeLabel('lgx.alerts.sev', a.severity)}</span>
              <strong data-testid="lgx-alert-title">{tt('lgx.alerts.rule.' + a.rule, { n: fmtNumber(a.count), c: a.deviceClass ? codeLabel('lgx.alerts.cls', a.deviceClass) : dash, s: a.source ? codeLabel('admin.logs.source', a.source, 'source') : dash })}</strong>
              <span className="sub">{codeLabel('lgx.alerts.st', a.status)}</span>
            </div>
            {a.names.length ? <div className="sub" data-testid="lgx-alert-names">{a.names.join(', ')}</div> : null}
            <div className="sub" data-testid="lgx-alert-action">{tt('lgx.alerts.action.' + (a.action || 'none'))}</div>
            <div className="sub">{tt('lgx.alerts.seen', { n: fmtNumber(a.detections), t: a.updatedAt ? fmtDateTime(a.updatedAt) : dash })}{a.resolvedAt ? ' · ' + tt('lgx.alerts.resolvedBy', { t: fmtDateTime(a.resolvedAt), w: a.resolvedBy ?? dash }) : ''}</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              {a.rule === 'sync_failures' || a.rule === 'provider_critical'
                ? <button className="btn ghost sm" data-testid="lgx-alert-logs" onClick={() => onOpenLogs({ category: 'integration', severity: a.rule === 'provider_critical' ? 'critical' : 'error' })}>{tt('lgx.alerts.openLogs')}</button>
                : <button className="btn ghost sm" data-testid="lgx-alert-logs" onClick={() => onOpenLogs({ category: 'device' })}>{tt('lgx.alerts.openLogs')}</button>}
              {d.canResolve && ['new', 'acknowledged', 'in_progress'].includes(a.status)
                ? <button className="btn sm" data-testid="lgx-alert-resolve" disabled={busy === a.id} onClick={() => resolve(a.id)}>{busy === a.id ? tx('pos.saving') : tt('lgx.alerts.resolve')}</button> : null}
            </div>
          </li>))}</ul>}
      {d ? <Pager info={{ page: d.page, pageSize: d.pageSize, totalItems: d.totalItems, totalPages: d.totalPages }} onPage={setPage} /> : null}
      <p className="sub">{tt('lgx.alerts.foot')}</p>
    </FitDialog>
  );
}

export function RetryQueueDialog({ onClose }: { onClose: () => void }) {
  const [page, setPage] = useState(1);
  const [d, setD] = useState<LogRetryQueueView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const seq = useRef(0);
  const load = useCallback(() => {
    const my = ++seq.current; setErr(null);
    posLogsApi.retries({ page, pageSize: 10 }).then((r) => { if (my === seq.current) setD(r); }).catch((e) => { if (my === seq.current) setErr(reportError(e, 'logs')); });
  }, [page]);
  useEffect(load, [load]);
  const store = (k: 'jobs' | 'webhooks') => {
    const s = d?.[k];
    return (
      <div className="panel" data-testid={`lgx-retry-${k}`} style={{ padding: 10, flex: '1 1 240px' }}>
        <div style={{ fontWeight: 700 }}>{tt('lgx.retry.store.' + k)}</div>
        <div className="sub">{s ? tt('lgx.retry.counts', { w: fmtNumber(s.waiting), r: fmtNumber(s.retrying), u: fmtNumber(s.running), d: fmtNumber(s.dead) }) : dash}</div>
        <div className="sub" data-testid={`lgx-retry-${k}-lag`}>{tt('lgx.retry.lag', { l: s ? lagText(s.oldestDueLagSeconds) : dash })}</div>
      </div>
    );
  };
  return (
    <FitDialog wide testId="lgx-retry" title={tt('lgx.retry.title')} subtitle={tt('lgx.retry.sub', { n: d ? fmtNumber(d.deadWindowDays) : dash })} onClose={onClose}
      footer={<><button className="btn ghost" data-testid="lgx-retry-refresh" onClick={load}>{tx('pos.refresh')}</button><button className="btn ghost" onClick={onClose}>{tx('pos.close')}</button></>}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>{store('jobs')}{store('webhooks')}</div>
      {err ? <ErrorRetry message={err} onRetry={load} />
        : !d ? <div className="state">{tx('pos.loading')}</div>
        : d.items.length === 0 ? <Empty title={tt('lgx.retry.none')} />
        : <div className="rvw-table-wrap"><table className="tbl rvw-table">
          <thead><tr><th>{tt('lgx.retry.col.store')}</th><th>{tt('lgx.retry.col.type')}</th><th>{tx('pos.status')}</th><th>{tt('lgx.retry.col.attempt')}</th><th>{tt('lgx.retry.col.next')}</th><th>{tt('lgx.retry.col.lag')}</th><th>{tt('lgx.retry.col.error')}</th></tr></thead>
          <tbody>{d.items.map((r) => (
            <tr key={r.store + r.id} data-testid="lgx-retry-row" data-state={r.state}>
              <td className="sub">{tt('lgx.retry.store.' + (r.store === 'job' ? 'jobs' : 'webhooks'))}</td>
              <td className="sub" style={{ overflowWrap: 'anywhere' }}>{codeLabel('lgx.retry.type', r.type)}</td>
              <td><span className={'chip ' + (r.state === 'dead' ? 'bad' : r.state === 'retrying' ? 'warn' : '')}>{codeLabel('lgx.retry.state', r.state)}</span></td>
              <td data-testid="lgx-retry-attempt">{tt('lgx.retry.attemptOf', { a: fmtNumber(r.attempt), m: fmtNumber(r.maxAttempts) })}</td>
              <td className="sub nowrap">{r.nextAttemptAt ? fmtDateTime(r.nextAttemptAt) : dash}</td>
              <td data-testid="lgx-retry-lag">{lagText(r.lagSeconds)}</td>
              <td className="sub" style={{ overflowWrap: 'anywhere' }}>{r.lastError ?? dash}</td>
            </tr>))}</tbody></table></div>}
      {d ? <Pager info={{ page: d.page, pageSize: d.pageSize, totalItems: d.total, totalPages: d.totalPages }} onPage={setPage} /> : null}
      <p className="sub">{tt('lgx.retry.foot')}</p>
    </FitDialog>
  );
}
