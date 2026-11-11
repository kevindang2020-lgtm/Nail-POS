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

const dash = '—';
const tt = (k: string, v?: Record<string, string | number>) => tx(k, v as Parameters<typeof tx>[1]);
const sevChip = (s: string) => <span className={'chip ' + (s === 'warning' ? 'warn' : s === 'error' || s === 'critical' ? 'bad' : '')}>{codeLabel('admin.logs.severity', s, ['level', 'priority'])}</span>;
type F = { category: string; severity: string; search?: string; from?: string; to?: string; page: number; pageSize: number };

export function TenantLogsScreen() {
  const nav = useNavigate();
  const [f, setFState] = useState<F>({ category: 'all', severity: 'all', page: 1, pageSize: 25 });
  const [draft, setDraft] = useState('');
  const [d, setD] = useState<LogsPage | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cal, setCal] = useState(false);
  const [open, setOpen] = useState<LogEntryView | null>(null);
  const seq = useRef(0);
  const setF = (p: Partial<F>, keepPage = false) => setFState((c) => ({ ...c, ...p, page: keepPage ? (p.page ?? c.page) : 1 }));
  const load = useCallback(() => {
    const my = ++seq.current; setErr(null);
    posLogsApi.page(f).then((r) => { if (my === seq.current) setD(r); }).catch((e) => { if (my === seq.current) setErr(reportError(e, 'logs')); });
  }, [f]);
  useEffect(load, [load]);
  const s = d?.summary;
  const card = (k: keyof NonNullable<typeof s>, label: string, tone?: 'warn' | 'bad' | 'gold', go?: Partial<F>) =>
    <KpiCard key={k} testId={`lgx-kpi-${k}`} label={label} value={s ? fmtNumber(s[k]) : err ? dash : ''} loading={!d && !err} tone={s && s[k] ? tone : undefined} onClick={go ? () => setF(go) : undefined} />;
  const anyFilter = f.category !== 'all' || f.severity !== 'all' || !!f.search || !!f.from || !!f.to;

  return (
    <div className="work" data-testid="lgx-screen" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="vh dfx-head">
        <div style={{ flex: '1 1 320px', minWidth: 0 }}><h1>{tx('pos.device_integration_logs')}</h1><div className="sub">{tt('lgx.subtitle')}</div></div>
        <button className="btn ghost" data-testid="lgx-health" onClick={() => nav('/tenant/devices/health')}>{tt('lgx.toHealth')}</button>
        <button className="btn ghost" data-testid="lgx-refresh" onClick={load}>{tx('pos.refresh')}</button>
      </div>
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
      {open ? <FitDialog wide testId="lgx-detail" title={open.message} subtitle={open.createdIso ? fmtDateTime(open.createdIso) : undefined} onClose={() => setOpen(null)} footer={<button className="btn ghost" onClick={() => setOpen(null)}>{tx('pos.close')}</button>}>
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
      </FitDialog> : null}
    </div>
  );
}
