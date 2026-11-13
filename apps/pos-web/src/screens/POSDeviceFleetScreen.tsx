// POSDeviceFleetScreen.tsx — the Devices & Integrations sub-pages: Reception POS · Check-In Kiosks · iPads & Tablets ·
// Receipt Devices · Device Assignments · Device Health (SUNMI batch 8 guides, Nov 9 2026).
//
// One workspace, six views, each reading its OWN registry through /pos/device-fleet/* (the old page filtered the customer
// displays by types that registry never stores, so Reception POS / Kiosks / Receipt Devices always said "0 connected"):
//   • title + "{n} connected" (kept) · Refresh · Check <page> System · the owning page's setup action when there is one
//   • four equal cards, each a real count with its definition (Device Health keeps its ORIGINAL four from the Devices
//     Overview: connected devices · online · payment terminals · locations)
//   • Devices | History tabs — search, status, which date + From–To calendar, sort, newest first, numbered pages
//     10 / 25 / 50 / 100 — the six original columns (Device · Type · Branch · Station · Status · Last sync) + details
//   • a device's details with its own history; the true empty state with what to do next
//   • Receipt Devices: AI PowerSalon keeps no printer registry (receipts are digital — Email / SMS / No receipt on the
//     customer display), so printers show NOT CONFIGURED and the page shows the real digital-receipt history.
// Read-only: device actions stay on the owning pages (registers & displays → Customer Displays, terminals → Payment
// Terminals; kiosks are set up by AIPowerSalon support). No count is invented — an unreadable figure shows "—".
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DfClass, DfDevice, DfSummary, DfListResponse, DfHistoryResponse, DfCheckResponse } from '@aipowersalon/api-contracts/tenant';
import { posDevicesApi, type DevicesOverview } from '../api/posDevicesApi';
import { posDeviceFleetApi, type DeviceFleetQuery } from '../api/posDeviceFleetApi';
import { reportError } from './reportsCommon';
import { FitDialog, KpiCard, Pager, Empty, ErrorRetry } from '../components/FitKit';
import { RangeCalendar } from '../components/FinanceKit';
import { codeLabel, agoLabel } from '../components/codeLabel';
import { fmtInZone, fmtNumber } from '../i18n/format';
import { deviceToday } from '../lib/deviceToday';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { HardwareReadinessDialog } from './hardwareReadiness';

/** extras (Tablets · 08) — App lifecycle: a device's reported app version against the NEWEST version reported by the devices
 *  listed. There is no minimum-version policy in the product, so nothing is called "unsupported" and no upgrade is required —
 *  an older version is shown as older, a missing one as not reported. */
export function cmpVersion(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map((x) => Number.parseInt(x, 10)); const pb = b.split(/[.+-]/).map((x) => Number.parseInt(x, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = Number.isFinite(pa[i]) ? pa[i] : 0; const y = Number.isFinite(pb[i]) ? pb[i] : 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
export function newestAppVersion(items: DfDevice[]): string | null {
  let best: string | null = null;
  for (const d of items) { const v = d.facts?.appVersion; if (typeof v === 'string' && v.trim() && (!best || cmpVersion(v, best) > 0)) best = v.trim(); }
  return best;
}
export function appVersionStanding(d: DfDevice, newest: string | null): { kind: 'current' | 'older' | 'unreported'; version: string | null } | null {
  if (d.source !== 'display') return null;   // only customer displays / tablets report an app version
  const v = typeof d.facts?.appVersion === 'string' && d.facts.appVersion.trim() ? d.facts.appVersion.trim() : null;
  if (!v) return { kind: 'unreported', version: null };
  return { kind: newest && cmpVersion(v, newest) < 0 ? 'older' : 'current', version: v };
}

export type DeviceView = 'overview' | 'health' | 'assignments' | 'reception-pos' | 'check-in-kiosk' | 'tablets' | 'receipt-devices';
const tt = (k: string, v?: Record<string, string | number>) => tx(k, v as Parameters<typeof tx>[1]);
type Cfg = { cls: DfClass; title: () => string; noun: () => string; key: string; manage?: { to: string; label: string } };
const CFG: Record<DeviceView, Cfg> = {
  'reception-pos': { cls: 'reception_pos', title: () => tx('pos.reception_pos'), noun: () => tx('admin.devices.noun.receptionPos'), key: 'rpos', manage: { to: '/tenant/devices/customer-displays', label: 'dfx.manage.registers' } },
  'check-in-kiosk': { cls: 'kiosk', title: () => tx('pos.check_in_kiosks'), noun: () => tx('admin.devices.noun.kiosk'), key: 'kiosk' },
  'tablets': { cls: 'tablet', title: () => tx('pos.tablets'), noun: () => tx('admin.devices.noun.tablet'), key: 'tablet', manage: { to: '/tenant/devices/customer-displays', label: 'dfx.manage.displays' } },
  'receipt-devices': { cls: 'receipt', title: () => tx('pos.receipt_devices'), noun: () => tx('admin.devices.noun.printer'), key: 'receipt' },
  'assignments': { cls: 'all', title: () => tx('pos.device_assignments'), noun: () => tx('dfx.noun.device'), key: 'assign' },
  'health': { cls: 'all', title: () => tx('pos.device_health'), noun: () => tx('dfx.noun.device'), key: 'health' },
  // Devices Overview (Nov 9 guide P2): the same fleet registry/history embedded under the overview panels — no second list
  'overview': { cls: 'all', title: () => tx('dfx.embedTitle'), noun: () => tx('dfx.noun.device'), key: 'health' },
};
const STATUSES = ['all', 'online', 'offline', 'attention', 'pending', 'unassigned', 'disabled', 'unknown', 'retired', 'revoked'] as const;
const SORTS = ['newest', 'last_seen', 'name', 'status'] as const;
const typeLabel = (t: string) => (t && t !== '—' ? codeLabel('admin.devices.type', t, 'deviceType') : '—');
const TONE: Record<string, string> = { online: 'ok', offline: 'bad', attention: 'warn', pending: 'warn', unassigned: 'warn', maintenance: 'warn', unknown: '', disabled: '', retired: '', revoked: 'bad' };
const statusChip = (s: string) => <span className={'chip ' + (TONE[s] ?? '')} data-status={s}>{tt('dfx.st.' + s)}</span>;
const when = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: '2-digit', hour: 'numeric', minute: '2-digit' }) || '—' : '—');

export function POSDeviceFleetScreen({ view, embedded = false }: { view: DeviceView; embedded?: boolean }) {
  const cfg = CFG[view];
  const nav = useNavigate();
  const [tab, setTab] = useState<'devices' | 'history'>('devices');
  const [sum, setSum] = useState<DfSummary | null>(null);
  const [ov, setOv] = useState<DevicesOverview | null>(null);
  const [topErr, setTopErr] = useState<string | null>(null);
  const [f, setFState] = useState<DeviceFleetQuery>({ class: cfg.cls, status: 'all', sort: 'newest', page: 1, pageSize: 25 });
  const [draft, setDraft] = useState('');
  const [list, setList] = useState<DfListResponse | null>(null); const [listErr, setListErr] = useState<string | null>(null);
  const [cal, setCal] = useState(false);
  const [open, setOpen] = useState<DfDevice | null>(null);
  const [health, setHealth] = useState<DfCheckResponse | 'loading' | { error: string } | null>(null);
  const seq = useRef(0);
  const setF = (p: Partial<DeviceFleetQuery>, keepPage = false) => setFState((c) => ({ ...c, ...p, page: keepPage ? (p.page ?? c.page) : 1 }));

  const loadTop = useCallback(() => {
    setTopErr(null);
    posDeviceFleetApi.summary(cfg.cls).then(setSum).catch((e) => setTopErr(reportError(e, 'devices')));
    if (view === 'health') posDevicesApi.overview().then(setOv).catch((e) => setTopErr(reportError(e, 'devices')));
  }, [cfg.cls, view]);
  const loadList = useCallback(() => {
    if (cfg.cls === 'receipt') return;
    const my = ++seq.current; setListErr(null);
    posDeviceFleetApi.devices(f).then((d) => { if (my === seq.current) setList(d); }).catch((e) => { if (my === seq.current) setListErr(reportError(e, 'devices')); });
  }, [f, cfg.cls]);
  useEffect(loadTop, [loadTop]);
  useEffect(loadList, [loadList]);
  const refresh = () => { loadTop(); loadList(); };
  const [hwOpen, setHwOpen] = useState(false);   // extras Device Assignments 08 — this register's hardware readiness (measured live, read only)
  const runCheck = () => { setHealth('loading'); posDeviceFleetApi.check(cfg.cls).then(setHealth).catch((e) => setHealth({ error: reportError(e, 'devices') })); };

  const n = (v: number | undefined | null) => (v == null ? '—' : fmtNumber(v));
  const card = (k: string, label: string, v: number | null | undefined, sub?: string, tone?: 'ok' | 'warn' | 'bad' | 'gold', status?: string) =>
    <KpiCard key={k} testId={`dfx-kpi-${k}`} label={label} value={sum || ov ? n(v) : topErr ? '—' : ''} loading={!sum && !ov && !topErr} sub={sub} tone={tone}
      onClick={status && cfg.cls !== 'receipt' ? () => { setTab('devices'); setF({ status }); } : undefined} />;
  const kpis = () => {
    const s = sum; const x = (s?.extra ?? {}) as Record<string, number | null>;
    if (view === 'health') {
      const k = ov?.kpis;   // the ORIGINAL four Device Health cards (Devices Overview), kept
      return [card('connected', tx('pos.connected_devices'), k?.connectedDevices), card('online', tx('pos.online'), k?.onlineDevices, k?.onlinePct != null ? `${k.onlinePct}%` : undefined, 'ok', 'online'),
        card('terminals', tx('pos.payment_terminals'), k?.paymentTerminals), card('locations', tx('pos.locations'), k?.locationsConnected)];
    }
    if (view === 'receipt-devices') return [
      <KpiCard key="printers" testId="dfx-kpi-printers" label={tt('dfx.kpi.printers')} value={tt('dfx.notConfigured')} sub={tt('dfx.kpi.printersSub')} />,
      card('email', tt('dfx.kpi.emailToday'), x.emailToday as number, tt('dfx.kpi.todaySub'), 'ok'), card('sms', tt('dfx.kpi.smsToday'), x.smsToday as number, tt('dfx.kpi.todaySub'), 'ok'),
      card('none', tt('dfx.kpi.noneToday'), x.noReceiptToday as number, x.failedToday ? tt('dfx.kpi.failedSub', { n: x.failedToday as number }) : tt('dfx.kpi.todaySub'), x.failedToday ? 'warn' : undefined)];
    const reg = tt(`dfx.kpi.${cfg.key}.registered`);
    const four = view === 'check-in-kiosk'
      ? card('fourth', tt('dfx.kpi.kiosk.today'), x.checkedInToday as number, tt('dfx.kpi.kiosk.todaySub'), 'gold')
      : view === 'assignments' ? card('fourth', tt('dfx.kpi.assigned'), s ? s.registered - s.unassigned : null, tt('dfx.kpi.assignedSub'), 'ok')
      : card('fourth', tt('dfx.kpi.unassigned'), s?.unassigned, tt(`dfx.kpi.${cfg.key}.unassignedSub`), s?.unassigned ? 'warn' : undefined, 'unassigned');
    return [card('registered', reg, s?.registered, s?.retired ? tt('dfx.kpi.retiredSub', { n: s.retired }) : undefined, 'gold'),
      card('online', tt(`dfx.kpi.${cfg.key}.online`), s?.online, tt(`dfx.kpi.${cfg.key}.onlineSub`), 'ok', 'online'),
      card('attention', tt('dfx.kpi.attention'), s?.attention, tt('dfx.kpi.attentionSub'), s?.attention ? 'warn' : undefined, 'attention'), four];
  };
  const connected = view === 'health' ? ov?.kpis.onlineDevices : view === 'receipt-devices' ? 0 : sum?.online;
  const anyFilter = !!(f.q || (f.status && f.status !== 'all') || f.from || f.to);

  return (
    <div className={embedded ? 'dfx-embed' : 'work'} data-testid="dfx-screen" data-view={view}>
      {embedded ? (
        <div className="dfx-head dfx-embed-head">
          <div style={{ flex: '1 1 320px', minWidth: 0 }}>
            <div className="p-h" style={{ margin: 0 }}>{cfg.title()}</div>
            <div className="sub" data-testid="dfx-connected">{tt('dfx.embedSub')}{sum ? ` · ${tt('dfx.checkedAt', { at: when(sum.checkedAt) })}` : ''}</div>
          </div>
          <button className="btn ghost" data-testid="dfx-refresh" onClick={refresh}>{tt('dfx.refresh')}</button>
          <button className="btn" data-testid="dfx-check" onClick={runCheck}>{tt(`dfx.check.${cfg.key}`)}</button>
        </div>
      ) : <>
      <div className="vh dfx-head">
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <h1>{cfg.title()}</h1>
          <div className="sub" data-testid="dfx-connected">{connected == null ? '—' : connected} {tx('pos.connected')}{sum ? ` · ${tt('dfx.checkedAt', { at: when(sum.checkedAt) })}` : ''}</div>
        </div>
        {cfg.manage ? <button className="btn ghost" data-testid="dfx-manage" onClick={() => nav(cfg.manage!.to)}>{tt(cfg.manage.label)}</button> : null}
        {view === 'assignments' ? <button className="btn ghost" data-testid="dfx-hw-open" onClick={() => setHwOpen(true)}>{tt('dfx.hw.btn')}</button> : null}
        <button className="btn ghost" data-testid="dfx-refresh" onClick={refresh}>{tt('dfx.refresh')}</button>
        <button className="btn" data-testid="dfx-check" onClick={runCheck}>{tt(`dfx.check.${cfg.key}`)}</button>
      </div>
      {hwOpen ? <HardwareReadinessDialog onClose={() => setHwOpen(false)} /> : null}
      {topErr ? <ErrorRetry message={topErr} onRetry={loadTop} /> : null}
      <div className="rvw-kpis dfx-kpis" data-testid="dfx-kpis">{kpis()}</div>
      </>}

      <div className="rvw-tabs dfx-tabs" role="tablist" data-testid="dfx-tabs">
        <button role="tab" aria-selected={tab === 'devices'} className={'btn ghost' + (tab === 'devices' ? ' on' : '')} data-testid="dfx-tab-devices" onClick={() => setTab('devices')}>{tt(view === 'receipt-devices' ? 'dfx.tab.printers' : 'dfx.tab.devices')}</button>
        <button role="tab" aria-selected={tab === 'history'} className={'btn ghost' + (tab === 'history' ? ' on' : '')} data-testid="dfx-tab-history" onClick={() => setTab('history')}>{tt(view === 'receipt-devices' ? 'dfx.tab.receipts' : 'dfx.tab.history')}</button>
      </div>

      {/* batch 8 decision 1: kiosks stay Super-Admin-provisioned (hardware AI PowerSalon ships) — the salon asks support */}
      {view === 'check-in-kiosk' ? (
        <section className="panel ksk-note" data-testid="ksk-note">
          <div style={{ flex: 1, minWidth: 0 }}><b>{tt('ksk.noteTitle')}</b><div className="sub">{tt('ksk.note')}</div></div>
          <button className="btn ghost" data-testid="ksk-request" onClick={() => nav('/tenant/account/support')}>{tt('ksk.request')}</button>
        </section>
      ) : null}
      {tab === 'devices' && view === 'receipt-devices' ? (
        <section className="panel dfx-empty" data-testid="dfx-results">
          <Empty title={tx('admin.devices.noneConnected', { noun: cfg.noun() })} />
          <p className="sub">{tt('dfx.receipt.why')}</p>
          <ul className="dfx-steps"><li>{tt('dfx.receipt.1')}</li><li>{tt('dfx.receipt.2')}</li><li>{tt('dfx.receipt.3')}</li></ul>
        </section>
      ) : tab === 'devices' ? (<>
        <section className="panel rvw-filters" data-testid="dfx-filters">
          <form className="cnx-searchrow" onSubmit={(e) => { e.preventDefault(); setF({ q: draft.trim() || undefined }); }}>
            <input className="rvw-search" type="search" data-testid="dfx-search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={tt('dfx.searchPh')} aria-label={tt('dfx.searchPh')} />
            <button className="btn" type="submit" data-testid="dfx-search-btn">{tt('dfx.search')}</button>
          </form>
          <label className="rvw-f"><span>{tt('dfx.f.status')}</span>
            <select data-testid="dfx-status" value={f.status ?? 'all'} onChange={(e) => setF({ status: e.target.value })}>{STATUSES.map((s) => <option key={s} value={s}>{tt('dfx.st.' + s)}</option>)}</select></label>
          <label className="rvw-f"><span>{tt('dfx.f.dateField')}</span>
            <select data-testid="dfx-datefield" value={f.dateField ?? 'created'} onChange={(e) => setF({ dateField: e.target.value === 'created' ? undefined : e.target.value })}>
              {['created', 'last_seen', 'updated'].map((d) => <option key={d} value={d}>{tt('dfx.date.' + d)}</option>)}</select></label>
          <button className={'btn ghost' + (f.from || f.to ? ' on' : '')} data-testid="dfx-range" onClick={() => setCal(true)}>{f.from || f.to ? `${f.from ?? '…'} → ${f.to ?? '…'}` : tt('dfx.range')}</button>
          <label className="rvw-f"><span>{tt('dfx.f.sort')}</span>
            <select data-testid="dfx-sort" value={f.sort ?? 'newest'} onChange={(e) => setF({ sort: e.target.value })}>{SORTS.map((s) => <option key={s} value={s}>{tt('dfx.sort.' + s)}</option>)}</select></label>
          {anyFilter ? <button className="btn ghost" data-testid="dfx-clear" onClick={() => { setDraft(''); setFState({ class: cfg.cls, status: 'all', sort: 'newest', page: 1, pageSize: f.pageSize }); }}>{tt('dfx.clear')}</button> : null}
          {cal ? <div className="rvw-cal"><RangeCalendar initial={{ from: f.from, to: f.to }} today={deviceToday()} onApply={(r) => { setF({ from: r.from, to: r.to }); setCal(false); }}
            onCancel={() => setCal(false)} onClear={() => { setF({ from: undefined, to: undefined }); setCal(false); }} /></div> : null}
        </section>
        <section className="panel rvw-feed" data-testid="dfx-results">
          <div className="p-h">{tt(view === 'assignments' ? 'dfx.list.assignments' : 'dfx.list.devices')}<span className="sub rvw-scope" data-testid="dfx-count">{list ? tt('dfx.count', { n: fmtNumber(list.total) }) : ''}</span></div>
          {listErr ? <ErrorRetry message={listErr} onRetry={loadList} />
            : !list ? <div className="state">{tx('pos.loading_devices')}</div>
            : list.items.length === 0 ? <div className="dfx-empty"><Empty title={anyFilter ? tt('dfx.noMatch') : tx('admin.devices.noneConnected', { noun: cfg.noun() })} />
                {!anyFilter ? <p className="sub" data-testid="dfx-empty-help">{tt(`dfx.empty.${cfg.key}`)}</p> : null}</div>
            : <div className="rvw-table-wrap"><table className="tbl rvw-table dfx-table">
              <thead><tr><th>{tx('pos.device')}</th><th>{tx('pos.type')}</th><th>{tx('pos.branch')}</th><th>{tx('pos.station')}</th><th>{tx('pos.status')}</th><th>{tx('pos.last_sync')}</th><th /></tr></thead>
              <tbody>{list.items.map((d) => (
                <tr key={`${d.source}:${d.id}`} data-testid="dfx-row">
                  <td style={{ fontWeight: 700 }}>{d.name || tt('dfx.unnamed')}</td>
                  <td className="sub">{d.source === 'station' ? tx('pos.reception_pos') : typeLabel(d.type)}</td>
                  <td>{d.branch ?? <span className="sub">{tt('dfx.noBranch')}</span>}</td>
                  <td>{d.station || <span style={{ color: 'var(--muted)' }}>{tx('pos.unassigned')}</span>}</td>
                  <td>{statusChip(d.status)}{d.reason ? <div className="sub dfx-reason">{tt('dfx.reason.' + d.reason)}</div> : null}<VersionLine st={appVersionStanding(d, newestAppVersion(list.items))} newest={newestAppVersion(list.items)} /></td>
                  <td className="sub">{d.lastSeenAt ? agoLabel(d.lastSeenAt) : '—'}</td>
                  <td className="nowrap"><button className="btn ghost sm" data-testid="dfx-view" onClick={() => setOpen(d)}>{tt('dfx.view')}</button></td>
                </tr>))}</tbody></table></div>}
          <div className="rvw-pager">
            <Pager info={list ? { page: list.page, pageSize: list.pageSize, totalItems: list.total, totalPages: list.totalPages } : null} onPage={(p) => setF({ page: p }, true)} />
            <label className="rvw-f"><span>{tt('dfx.rows')}</span><select data-testid="dfx-pagesize" value={String(f.pageSize ?? 25)} onChange={(e) => setF({ pageSize: Number(e.target.value) })}>
              {['10', '25', '50', '100'].map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
          </div>
          <p className="sub">{tt(`dfx.foot.${cfg.key}`)}</p>
          {list && list.items.some((d) => d.source === 'display') ? <p className="sub" data-testid="dfx-ver-policy">{tt('dfx.ver.policy')}</p> : null}
        </section>
      </>) : <FleetHistory cls={cfg.cls} />}

      {open ? <DeviceDetail d={open} onClose={() => setOpen(null)} /> : null}
      {health ? <FitDialog wide testId="dfx-health" title={tt(`dfx.check.${cfg.key}`)} onClose={() => setHealth(null)} footer={<button className="btn ghost" onClick={() => setHealth(null)}>{tx('pos.close')}</button>}
        subtitle={health !== 'loading' && !('error' in health) ? `${tt('dfx.hs.' + health.overall)} · ${when(health.checkedAt)}` : undefined}>
        {health === 'loading' ? <div className="state">{tt('dfx.checking')}</div> : 'error' in health ? <div className="err">{health.error}</div> : <>
          <p className="sub">{tt('dfx.readOnly')}</p>
          {health.checks.map((c) => <div key={c.key} className="rvw-check" data-testid={`dfx-chk-${c.key}`}>
            <div><span className={'chip ' + (c.state === 'READY' ? 'ok' : c.state === 'WARNING' ? 'warn' : c.state === 'FAILED' ? 'bad' : '')}>{tt('dfx.hs.' + c.state)}</span> <b>{tt('dfx.hk.' + c.key)}</b>{c.count != null ? <span className="sub"> · {fmtNumber(c.count)}</span> : null}</div>
          </div>)}
        </>}
      </FitDialog> : null}
    </div>
  );
}

/** History tab — the canonical audit / kiosk logs (or, for Receipt Devices, the digital receipts), newest first */
export function FleetHistory({ cls, deviceId }: { cls: DfClass; deviceId?: string }) {
  const [q, setQ] = useState<{ q?: string; from?: string; to?: string; page: number; pageSize: number }>({ page: 1, pageSize: deviceId ? 10 : 25 });
  const [draft, setDraft] = useState('');
  const [d, setD] = useState<DfHistoryResponse | null>(null); const [err, setErr] = useState<string | null>(null);
  const [cal, setCal] = useState(false);
  const load = useCallback(() => { setErr(null); posDeviceFleetApi.history({ class: cls, deviceId, ...q }).then(setD).catch((e) => setErr(reportError(e, 'devices'))); }, [cls, deviceId, q]);
  useEffect(load, [load]);
  const receipts = cls === 'receipt';
  return (
    <section className="panel rvw-feed" data-testid={deviceId ? 'dfx-device-history' : 'dfx-history'}>
      {!deviceId ? <div className="rvw-filters dfx-hfilters">
        <form className="cnx-searchrow" onSubmit={(e) => { e.preventDefault(); setQ((c) => ({ ...c, q: draft.trim() || undefined, page: 1 })); }}>
          <input className="rvw-search" type="search" data-testid="dfx-h-search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={tt(receipts ? 'dfx.h.receiptPh' : 'dfx.h.searchPh')} aria-label={tt('dfx.h.searchPh')} />
          <button className="btn" type="submit">{tt('dfx.search')}</button>
        </form>
        <button className={'btn ghost' + (q.from || q.to ? ' on' : '')} data-testid="dfx-h-range" onClick={() => setCal(true)}>{q.from || q.to ? `${q.from ?? '…'} → ${q.to ?? '…'}` : tt('dfx.range')}</button>
        {cal ? <div className="rvw-cal"><RangeCalendar initial={{ from: q.from, to: q.to }} today={deviceToday()} onApply={(r) => { setQ((c) => ({ ...c, from: r.from, to: r.to, page: 1 })); setCal(false); }}
          onCancel={() => setCal(false)} onClear={() => { setQ((c) => ({ ...c, from: undefined, to: undefined, page: 1 })); setCal(false); }} /></div> : null}
      </div> : null}
      {err ? <ErrorRetry message={err} onRetry={load} /> : !d ? <div className="state">{tt('dfx.loading')}</div>
        : d.total === 0 ? <Empty title={tt(receipts ? 'dfx.h.noReceipts' : 'dfx.h.empty')} />
        : <div className="rvw-table-wrap"><table className="tbl rvw-table">
          {receipts ? <><thead><tr><th>{tt('dfx.h.when')}</th><th>{tt('dfx.h.ticket')}</th><th>{tt('dfx.h.choice')}</th><th>{tt('dfx.h.result')}</th><th>{tx('pos.station')}</th></tr></thead>
            <tbody>{(d.receipts ?? []).map((r) => <tr key={r.id} data-testid="dfx-h-row"><td className="nowrap">{when(r.at)}</td><td>{r.ticket ? `#${r.ticket}` : '—'}</td><td>{tt('dfx.choice.' + r.choice)}</td><td>{r.status ? tt('dfx.rs.' + r.status) : '—'}</td><td>{r.station ?? '—'}</td></tr>)}</tbody></>
          : <><thead><tr><th>{tt('dfx.h.when')}</th><th>{tt('dfx.h.event')}</th><th>{tt('dfx.h.device')}</th><th>{tt('dfx.h.by')}</th></tr></thead>
            <tbody>{d.items.map((h) => <tr key={h.source + h.id} data-testid="dfx-h-row"><td className="nowrap">{when(h.at)}</td><td>{codeLabel('dfx.ev', h.event, 'event')}</td><td className="sub">{tt('dfx.ent.' + (h.entity || 'device'))}</td><td>{h.actor ?? (h.source === 'kiosk_log' ? tt('dfx.h.theKiosk') : '—')}</td></tr>)}</tbody></>}
        </table></div>}
      <div className="rvw-pager"><Pager info={d ? { page: d.page, pageSize: d.pageSize, totalItems: d.total, totalPages: d.totalPages } : null} onPage={(p) => setQ((c) => ({ ...c, page: p }))} /></div>
    </section>
  );
}

function VersionLine({ st, newest }: { st: ReturnType<typeof appVersionStanding>; newest: string | null }) {
  if (!st) return null;
  if (st.kind === 'unreported') return <div className="sub" data-testid="dfx-ver" data-kind="unreported">{tt('dfx.ver.unreported')}</div>;
  if (st.kind === 'older') return <div className="sub warn" data-testid="dfx-ver" data-kind="older">{tt('dfx.ver.older', { v: st.version ?? '—', n: newest ?? '—' })}</div>;
  return <div className="sub" data-testid="dfx-ver" data-kind="current">{tt('dfx.ver.current', { v: st.version ?? '—' })}</div>;
}

function DeviceDetail({ d, onClose }: { d: DfDevice; onClose: () => void }) {
  const nav = useNavigate();
  const owner = d.source === 'terminal' ? '/tenant/devices/payment-terminals' : d.source === 'display' || d.source === 'station' ? '/tenant/devices/customer-displays' : null;
  const facts = Object.entries(d.facts ?? {}).filter(([k, v]) => v != null && v !== '' && k !== 'routing');
  const routing = d.source === 'terminal' ? (d.facts?.routing as TerminalRoutingView | undefined) : undefined;
  return (
    <FitDialog wide testId="dfx-detail" title={d.name || tt('dfx.unnamed')} subtitle={`${d.source === 'station' ? tx('pos.reception_pos') : typeLabel(d.type)} · ${d.branch ?? tt('dfx.noBranch')}`} onClose={onClose}
      footer={<>{owner ? <button className="btn" data-testid="dfx-detail-manage" onClick={() => nav(owner)}>{tt(d.source === 'terminal' ? 'dfx.manage.terminals' : 'dfx.manage.displays')}</button> : <span className="sub">{tt('dfx.kioskSupport')}</span>}
        <button className="btn ghost" onClick={onClose}>{tx('pos.close')}</button></>}>
      <dl className="ahx-dl">
        <dt>{tx('pos.status')}</dt><dd>{statusChip(d.status)}{d.reason ? <span className="sub"> — {tt('dfx.reason.' + d.reason)}</span> : null}</dd>
        <dt>{tx('pos.station')}</dt><dd>{d.station ?? tx('pos.unassigned')}</dd>
        <dt>{tx('pos.last_sync')}</dt><dd>{when(d.lastSeenAt)}</dd>
        <dt>{tt('dfx.date.created')}</dt><dd>{when(d.createdAt)}</dd>
        {facts.map(([k, v]) => <Fragment key={k}><dt>{tt('dfx.fact.' + k)}</dt><dd>{typeof v === 'string' && /^[a-z_]+$/.test(v) ? tt('dfx.val.' + v) : String(v)}</dd></Fragment>)}
      </dl>
      {routing ? <RoutingGuard r={routing} onOpen={(to) => nav(to)} /> : null}
      <h3 className="dfx-h3">{tt('dfx.tab.history')}</h3>
      <FleetHistory cls={d.source === 'station' ? 'reception_pos' : d.source === 'kiosk' ? 'kiosk' : d.source === 'terminal' ? 'terminal' : 'display'} deviceId={d.id} />
    </FitDialog>
  );
}

/** extras Device Assignments 09 — the server's routing verdict for a terminal (read-only; nothing is sent to the device). */
type TerminalRoutingView = {
  verdict: 'ready' | 'busy' | 'no_register' | 'no_processor' | 'not_ready'; operational: string; registerPaired: boolean;
  reservedFor: string | null; reservedUntil: string | null; processor: string | null; environment: string | null; lastPingOk: boolean | null; lastPingAt: string | null;
};
function RoutingGuard({ r, onOpen }: { r: TerminalRoutingView; onOpen: (to: string) => void }) {
  return (
    <section data-testid="dfx-routing" data-verdict={r.verdict}>
      <h3 className="dfx-h3">{tt('dfx.route.title')}</h3>
      <div className={'pm-chip ' + (r.verdict === 'ready' ? 'ok' : r.verdict === 'busy' ? 'warn' : 'bad')}>{tt('dfx.route.v.' + r.verdict)}</div>
      <dl className="ahx-dl">
        <dt>{tt('dfx.route.register')}</dt><dd>{r.registerPaired ? tt('dfx.route.paired') : tt('dfx.route.notPaired')}</dd>
        <dt>{tt('dfx.route.reserved')}</dt><dd>{r.reservedFor ? tt('dfx.route.reservedBy.' + (r.reservedFor === 'ticket' || r.reservedFor === 'display' ? r.reservedFor : 'other'), { t: r.reservedUntil ? when(r.reservedUntil) : '—' }) : tt('dfx.route.free')}</dd>
        <dt>{tt('dfx.route.processor')}</dt><dd>{r.processor ? `${codeLabel('dfx.proc', r.processor, 'value')}${r.environment ? ' · ' + codeLabel('dfx.env', r.environment, 'value') : ''}` : tt('dfx.route.noProcessor')}</dd>
        <dt>{tt('dfx.route.ping')}</dt><dd>{r.lastPingAt ? `${r.lastPingOk === false ? tt('dfx.route.pingFailed') : tt('dfx.route.pingOk')} · ${when(r.lastPingAt)}` : tt('dfx.route.pingNever')}</dd>
      </dl>
      <div className="sub">{tt('dfx.route.note')}</div>
      <div className="row" style={{ gap: 8, marginTop: 6 }}>
        <button type="button" className="btn ghost" data-testid="dfx-route-terminals" onClick={() => onOpen('/tenant/devices/payment-terminals')}>{tt('dfx.manage.terminals')}</button>
        <button type="button" className="btn ghost" data-testid="dfx-route-gateway" onClick={() => onOpen('/tenant/integrations/payment-gateway')}>{tt('dfx.route.gateway')}</button>
      </div>
    </section>
  );
}
