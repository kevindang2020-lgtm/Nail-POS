// TenantLogsScreen.tsx — Devices & Integrations › Device & Integration Logs (spec §54-§55; SUNMI batch 8 guide, Nov 9 2026).
// A read-only operational log console over GET /pos/logs (paged mode):
//   • five verified cards over the SAME filters as the table — events in range · warnings · errors · device events ·
//     integration events (server counts; "—" when unreadable, never a guessed 0)
//   • the original filters kept (All categories · All severities · Search message or source) + From–To calendar, Refresh,
//     a link to Device Health (the heartbeat engine — this page never becomes it)
//   • newest first, numbered pages 10 / 25 / 50 / 100; an event's details
// Device events are the real ones already kept by their owners (display / register / terminal changes, kiosk events);
// integration events come from the log store (webhook deliveries, deployments). Nothing is manufactured.
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { posLogsApi, type LogEntryView, type LogsPage } from '../api/posLogsApi';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { codeLabel } from '../components/codeLabel';
import { fmtDateTime, fmtNumber } from '../i18n/format';
import { FitDialog, KpiCard, Pager, Empty, ErrorRetry } from '../components/FitKit';

// Customer-impact context (backlog Device Integration Logs · 12): what the device that logged the event is FOR, so staff see
// what a problem there can touch. A fixed role per device kind — never inferred from the customer or from hardware data.
const DEVICE_ROLE: Record<string, string> = { payment_terminal: 'card', pos_station: 'checkout', customer_display: 'display', kiosk: 'checkin' };
import { RangeCalendar } from '../components/FinanceKit';
import { deviceToday } from '../lib/deviceToday';
import { reportError } from './reportsCommon';
import { useCan } from '../components/usePermissions';
import { errorTextOf } from '../i18n/error-text';
import { posHelpCenterApi, type HelpTicketRow } from '../api/posHelpCenterApi';
import { RoutedAlertsDialog, RetryQueueDialog } from './TenantLogsOps';   // backlog Device Integration Logs · 05 + 09

// backlog Device Integration Logs · 04 — Error Triage & Assignment: a log event becomes a support issue in THE support engine
// (POST /tenant/help/tickets — owner = its assignee, priority, follow-up / status and audit are that engine's; help.request
// to open, help.triage to assign). One issue per event (idempotency key = the event id: asking again answers the same
// ticket). The issue text carries the event's ids and codes only — never its metadata, so nothing private is copied.
const ISSUE_PRIORITIES = ['normal', 'high', 'urgent'] as const;
const PRIORITY_KEY: Record<string, string> = { normal: 'pos.normal_priority', high: 'pos.high_priority', urgent: 'pos.urgent' };   // the Help Center's own labels
const defaultPriority = (sev: string) => (sev === 'critical' ? 'urgent' : sev === 'error' ? 'high' : 'normal');
export function logIssueInput(e: LogEntryView, priority: string, note: string) {
  const lines = [
    `${tx('lgx.issue.event')}: ${e.id}`, e.createdIso ? `${tx('lgx.issue.when')}: ${e.createdIso}` : '',
    `${tt('lgx.category')}: ${e.category} · ${tt('lgx.source')}: ${e.source} · ${tx('pos.severity_2')}: ${e.severity}${e.status ? ` · ${tx('pos.status')}: ${e.status}` : ''}`,
    e.relatedId ? `${tt('lgx.related')}: ${e.relatedId}` : '', e.correlationId ? `${tt('lgx.correlation')}: ${e.correlationId}` : '',
    note.trim() ? `\n${note.trim()}` : '',
  ].filter(Boolean);
  return { subject: `${codeLabel('admin.logs.category', e.category)}: ${e.message}`.slice(0, 200), description: lines.join('\n'), priority,
    category: e.category === 'device' ? 'device' : 'integration', affectedModule: 'device_logs', idempotencyKey: `log-event:${e.id}` };
}
function LogIssuePanel({ entry, onOpenSupport }: { entry: LogEntryView; onOpenSupport: () => void }) {
  const [priority, setPriority] = useState(defaultPriority(entry.severity));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [ticket, setTicket] = useState<HelpTicketRow | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true); setErr(null);
    try { setTicket(await posHelpCenterApi.createTicket(logIssueInput(entry, priority, note))); }
    catch (e) { reportError(e, 'logs'); setErr(errorTextOf(e, tx('pos.the_ticket_could_not_be_submitted'))); }
    finally { setBusy(false); }
  };
  if (ticket) return (
    <div className="fk-note ok" role="status" data-testid="lgx-issue-done" style={{ marginTop: 10 }}>
      <span>{tt('lgx.issue.done', { n: ticket.ticketNumber || ticket.id, s: codeLabel('admin.help.ticketStatus', ticket.status, ['payment', 'drawer']) })}</span>
      <button className="btn ghost sm" data-testid="lgx-issue-open" onClick={onOpenSupport}>{tx('lgx.issue.openSupport')}</button>
    </div>
  );
  return (
    <div data-testid="lgx-issue" style={{ marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 8, display: 'grid', gap: 6 }}>
      <div style={{ fontWeight: 700 }}>{tx('lgx.issue.title')}</div>
      <div className="sub">{tx('lgx.issue.hint')}</div>
      <label className="rvw-f"><span>{tx('lgx.issue.priority')}</span>
        <select data-testid="lgx-issue-priority" value={priority} onChange={(e) => setPriority(e.target.value)}>{ISSUE_PRIORITIES.map((p) => <option key={p} value={p}>{tx(PRIORITY_KEY[p])}</option>)}</select></label>
      <textarea data-testid="lgx-issue-note" value={note} maxLength={2000} rows={2} onChange={(e) => setNote(e.target.value)} placeholder={tx('lgx.issue.notePh')} aria-label={tx('lgx.issue.notePh')} />
      {err ? <div className="fk-note bad" role="alert" data-testid="lgx-issue-err"><span>{err}</span></div> : null}
      <div><button className="btn" data-testid="lgx-issue-submit" disabled={busy} onClick={submit}>{busy ? tx('pos.submitting') : tx('lgx.issue.submit')}</button></div>
    </div>
  );
}

const dash = '—';
const tt = (k: string, v?: Record<string, string | number>) => tx(k, v as Parameters<typeof tx>[1]);
const sevChip = (s: string) => <span className={'chip ' + (s === 'warning' ? 'warn' : s === 'error' || s === 'critical' ? 'bad' : '')}>{codeLabel('admin.logs.severity', s, ['level', 'priority'])}</span>;
type F = { category: string; severity: string; search?: string; relatedId?: string; correlationId?: string; from?: string; to?: string; page: number; pageSize: number };

/** Device Integration Logs 06: say plainly whether payment events here come from a sandbox (test / UAT) or a production
 *  merchant, and whether a production validation is recorded — so a test log is never read as certification or readiness. */
function PaymentEnvLabel({ e }: { e: NonNullable<LogsPage['paymentEnvironment']> }) {
  const env = e.environment ?? 'none';
  const tone = env === 'production' ? 'ok' : env === 'sandbox' ? 'warn' : '';
  return (
    <div className="sub" data-testid="lgx-env" data-env={env} style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      <span className={'chip ' + tone}>{tt('lgx.env.' + env)}</span>
      <span>{tt('lgx.env.' + env + 'Why', { p: e.processor ? codeLabel('lgx.env.proc', e.processor) : dash })}{e.source ? ' · ' + tt('lgx.env.src.' + e.source) : ''}</span>
      {e.environment ? <span data-testid="lgx-env-cert">{e.certification ? tt('lgx.env.cert', { s: codeLabel('lgx.env.certStatus', e.certification) }) : tt('lgx.env.noCert')}</span> : null}
    </div>
  );
}

export function TenantLogsScreen() {
  const nav = useNavigate();
  const [f, setFState] = useState<F>({ category: 'all', severity: 'all', page: 1, pageSize: 25 });
  const [draft, setDraft] = useState('');
  const [d, setD] = useState<LogsPage | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cal, setCal] = useState(false);
  const [open, setOpen] = useState<LogEntryView | null>(null);
  const [ops, setOps] = useState<'alerts' | 'retry' | null>(null);
  const seq = useRef(0);
  // Device Integration Logs 08: the sanitized export (the server checks the range, redacts, and records who exported)
  const can = useCan();
  const [exp, setExp] = useState<{ busy: boolean; note?: { ok: boolean; text: string } }>({ busy: false });
  const doExport = async () => {
    setExp({ busy: true });
    try {
      const csv = await posLogsApi.exportCsv({ category: f.category, severity: f.severity, search: f.search, relatedId: f.relatedId, correlationId: f.correlationId, from: f.from, to: f.to });
      const blob = new Blob([String(csv)], { type: 'text/csv;charset=utf-8' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'device-integration-logs.csv'; a.click(); URL.revokeObjectURL(a.href);
      setExp({ busy: false, note: { ok: true, text: tt('lgx.export.done') } });
    } catch (e) { setExp({ busy: false, note: { ok: false, text: errorTextOf(e, tt('lgx.export.failed')) } }); }
  };
  const setF = (p: Partial<F>, keepPage = false) => setFState((c) => ({ ...c, ...p, page: keepPage ? (p.page ?? c.page) : 1 }));
  const load = useCallback(() => {
    const my = ++seq.current; setErr(null);
    posLogsApi.page(f).then((r) => { if (my === seq.current) setD(r); }).catch((e) => { if (my === seq.current) setErr(reportError(e, 'logs')); });
  }, [f]);
  useEffect(load, [load]);
  const s = d?.summary;
  const card = (k: keyof NonNullable<typeof s>, label: string, tone?: 'warn' | 'bad' | 'gold', go?: Partial<F>) =>
    <KpiCard key={k} testId={`lgx-kpi-${k}`} label={label} value={s ? fmtNumber(s[k]) : err ? dash : ''} loading={!d && !err} tone={s && s[k] ? tone : undefined} onClick={go ? () => setF(go) : undefined} />;
  const anyFilter = f.category !== 'all' || f.severity !== 'all' || !!f.search || !!f.relatedId || !!f.correlationId || !!f.from || !!f.to;

  return (
    <div className="work" data-testid="lgx-screen" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="vh dfx-head">
        <div style={{ flex: '1 1 320px', minWidth: 0 }}><h1>{tx('pos.device_integration_logs')}</h1><div className="sub">{tt('lgx.subtitle')}</div></div>
        <button className="btn ghost" data-testid="lgx-health" onClick={() => nav('/tenant/devices/health')}>{tt('lgx.toHealth')}</button>
        <button className="btn ghost" data-testid="lgx-alerts-open" onClick={() => setOps('alerts')}>{tt('lgx.alerts.btn')}</button>
        <button className="btn ghost" data-testid="lgx-retry-open" onClick={() => setOps('retry')}>{tt('lgx.retry.btn')}</button>
        <button className="btn ghost" data-testid="lgx-refresh" onClick={load}>{tx('pos.refresh')}</button>
        {can('pos.reports.export') ? <button className="btn ghost" data-testid="lgx-export" disabled={exp.busy} title={tt('lgx.export.hint')} onClick={doExport}>{exp.busy ? tx('pos.exporting') : tt('lgx.export.btn')}</button> : null}
      </div>
      {exp.note ? <div className={'fk-note ' + (exp.note.ok ? 'ok' : 'bad')} role={exp.note.ok ? 'status' : 'alert'} data-testid="lgx-export-note"><span>{exp.note.text}</span></div> : null}
      {d?.paymentEnvironment ? <PaymentEnvLabel e={d.paymentEnvironment} /> : null}
      <div className="rvw-kpis lgx-kpis" data-testid="lgx-kpis">
        {card('events', tt('lgx.kpi.events'), 'gold')}
        {card('warnings', tt('lgx.kpi.warnings'), 'warn', { severity: 'warning' })}
        {card('errors', tt('lgx.kpi.errors'), 'bad', { severity: 'error' })}
        {card('device', tt('lgx.kpi.device'), undefined, { category: 'device' })}
        {card('integration', tt('lgx.kpi.integration'), undefined, { category: 'integration' })}
      </div>
      <section className="panel rvw-filters" data-testid="lgx-filters">
        <select data-testid="lgx-category" value={f.category} onChange={(e) => setF({ category: e.target.value })} aria-label={tt('lgx.category')}><option value="all">{tx('pos.all_categories_2')}</option><option value="device">{tx('pos.device')}</option><option value="integration">{tx('pos.integration')}</option></select>
        <select data-testid="lgx-severity" value={f.severity} onChange={(e) => setF({ severity: e.target.value })} aria-label={tt('lgx.severity')}><option value="all">{tx('pos.all_severities')}</option><option value="info">{tx('pos.info')}</option><option value="warning">{tx('pos.warning_2')}</option><option value="error">{tx('pos.error_2')}</option><option value="critical">{tx('pos.critical_2')}</option></select>
        <form className="cnx-searchrow" onSubmit={(e) => { e.preventDefault(); setF({ search: draft.trim() || undefined }); }}>
          <input className="rvw-search" type="search" data-testid="lgx-search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={tx('pos.search_message_or_source')} aria-label={tx('pos.search_message_or_source')} />
          <button className="btn" type="submit" data-testid="lgx-search-btn">{tt('dfx.search')}</button>
        </form>
        <button className={'btn ghost' + (f.from || f.to ? ' on' : '')} data-testid="lgx-range" onClick={() => setCal(true)}>{f.from || f.to ? `${f.from ?? '…'} → ${f.to ?? '…'}` : tt('dfx.range')}</button>
        {f.relatedId ? <button className="btn ghost on" data-testid="lgx-device-chip" title={tt('lgx.deviceOnlyClear')} onClick={() => setF({ relatedId: undefined })}>{tt('lgx.deviceOnly')} ✕</button> : null}
        {f.correlationId ? <button className="btn ghost on" data-testid="lgx-trace-chip" title={tt('lgx.traceOnlyClear')} onClick={() => setF({ correlationId: undefined })}>{tt('lgx.traceOnly')} ✕</button> : null}
        {anyFilter ? <button className="btn ghost" data-testid="lgx-clear" onClick={() => { setDraft(''); setFState({ category: 'all', severity: 'all', page: 1, pageSize: f.pageSize }); }}>{tt('dfx.clear')}</button> : null}
        {cal ? <div className="rvw-cal"><RangeCalendar initial={{ from: f.from, to: f.to }} today={deviceToday()} onApply={(r) => { setF({ from: r.from, to: r.to }); setCal(false); }}
          onCancel={() => setCal(false)} onClear={() => { setF({ from: undefined, to: undefined }); setCal(false); }} /></div> : null}
      </section>
      <section className="panel rvw-feed" data-testid="lgx-results">
        <div className="p-h">{tt('lgx.events')}<span className="sub rvw-scope" data-testid="lgx-count">{d ? tt('lgx.count', { n: fmtNumber(d.total) }) : ''}</span></div>
        {err ? <ErrorRetry message={err} onRetry={load} />
          : !d ? <div className="state">{tx('pos.loading_logs')}</div>
          : d.logs.length === 0 ? <Empty title={anyFilter ? tx('pos.no_logs_match_these_filters') : tx('pos.no_logs_recorded_yet')} />
          : <div className="rvw-table-wrap"><table className="tbl rvw-table">
            <thead><tr><th>{tx('pos.time')}</th><th>{tx('pos.severity_2')}</th><th>{tt('lgx.category')}</th><th>{tt('lgx.source')}</th><th>{tt('lgx.message')}</th><th>{tx('pos.status')}</th><th /></tr></thead>
            <tbody>{d.logs.map((r) => (
              <tr key={r.id} data-testid="lgx-row">
                <td className="nowrap sub">{r.createdIso ? fmtDateTime(r.createdIso) : dash}</td>
                <td>{sevChip(r.severity)}</td>
                <td className="sub">{codeLabel('admin.logs.category', r.category)}</td>
                <td className="sub">{codeLabel('admin.logs.source', r.source, 'source')}</td>
                <td style={{ overflowWrap: 'anywhere' }}>{r.message}</td>
                <td className="sub">{r.status ? codeLabel('admin.logs.status', r.status, ['deviceUpdate', 'payment']) : dash}</td>
                <td><button className="btn ghost sm" data-testid="lgx-view" onClick={() => setOpen(r)}>{tt('dfx.view')}</button></td>
              </tr>))}</tbody></table></div>}
        <div className="rvw-pager">
          <Pager info={d ? { page: d.page, pageSize: d.pageSize, totalItems: d.total, totalPages: d.totalPages } : null} onPage={(p) => setF({ page: p }, true)} />
          <label className="rvw-f"><span>{tt('dfx.rows')}</span><select data-testid="lgx-pagesize" value={String(f.pageSize)} onChange={(e) => setF({ pageSize: Number(e.target.value) })}>
            {['10', '25', '50', '100'].map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
        </div>
        <p className="sub">{tt('lgx.foot')}</p>
      </section>
      <div><button className="btn ghost" onClick={() => nav('/tenant/devices/overview')}>{tx('pos.back_to_devices_integrations')}</button></div>
      {ops === 'alerts' ? <RoutedAlertsDialog onClose={() => setOps(null)} onOpenLogs={(g) => { setDraft(''); setFState({ category: g.category ?? 'all', severity: g.severity ?? 'all', page: 1, pageSize: f.pageSize }); setOps(null); }} /> : null}
      {ops === 'retry' ? <RetryQueueDialog onClose={() => setOps(null)} /> : null}
      {open ? <FitDialog wide testId="lgx-detail" title={open.message} subtitle={open.createdIso ? fmtDateTime(open.createdIso) : undefined} onClose={() => setOpen(null)} footer={<>
        {/* backlog Device Integration Logs · 03: this device's own timeline (every event that points at it, newest first) */}
        {open.category === 'device' && open.relatedId && f.relatedId !== open.relatedId ? <button className="btn" data-testid="lgx-device-history" onClick={() => { setDraft(''); setF({ category: 'device', severity: 'all', search: undefined, relatedId: open.relatedId ?? undefined }); setOpen(null); }}>{tt('lgx.deviceHistory')}</button> : null}
        {/* backlog Device Integration Logs · 02: the request's trace — every event under the same correlation id (command, provider response, status inquiry) */}
        {open.correlationId && f.correlationId !== open.correlationId ? <button className="btn" data-testid="lgx-trace" onClick={() => { setDraft(''); setF({ category: 'all', severity: 'all', search: undefined, relatedId: undefined, correlationId: open.correlationId ?? undefined }); setOpen(null); }}>{tt('lgx.trace')}</button> : null}
        <button className="btn ghost" onClick={() => setOpen(null)}>{tx('pos.close')}</button></>}>
        <dl className="ahx-dl">
          <dt>{tx('pos.severity_2')}</dt><dd>{sevChip(open.severity)}</dd>
          <dt>{tt('lgx.category')}</dt><dd>{codeLabel('admin.logs.category', open.category)}</dd>
          <dt>{tt('lgx.source')}</dt><dd>{codeLabel('admin.logs.source', open.source, 'source')}</dd>
          <dt>{tx('pos.status')}</dt><dd>{open.status ? codeLabel('admin.logs.status', open.status, ['deviceUpdate', 'payment']) : dash}</dd>
          {open.category === 'device' && DEVICE_ROLE[open.source] ? <><dt>{tt('lgx.impact')}</dt><dd data-testid="lgx-impact">{tt('lgx.role.' + DEVICE_ROLE[open.source])}</dd></> : null}
          <dt>{tt('lgx.related')}</dt><dd>{open.relatedId ?? dash}</dd>
          <dt>{tt('lgx.correlation')}</dt><dd>{open.correlationId ?? dash}</dd>
          {open.metadata && typeof open.metadata === 'object' ? Object.entries(open.metadata as Record<string, unknown>).slice(0, 12).map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{String(v)}</dd></Fragment>) : null}
        </dl>
        {can('help.request') ? <LogIssuePanel key={open.id} entry={open} onOpenSupport={() => nav('/tenant/account/support')} /> : null}
      </FitDialog> : null}
    </div>
  );
}
