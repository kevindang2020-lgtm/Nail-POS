// POSNotificationsScreen.tsx — Communications → Customer Notifications (/tenant/communications/notifications), rebuilt in place
// for the "Customer Notifications Complete Build Guide" (Oct 30 2026, migration 741). Everything the old page showed stays: the
// Sent (Recent) / Blocked-Failed / Opt-Outs meaning (as the legacy line), the Activity + Opt-outs views and When / Channel /
// Recipient / Status / Detail. Added: honest KPIs (Sent ≠ Delivered, Pending vs Unknown), server search + month calendar + date
// basis, numbered pages, a details overlay with sanitized diagnosis and safe actions, failure review grouped by root cause with
// a confirmed one-time Resend, the unified customer timeline, messaging health, automatic failure alerts and opt-out history.
// Search text never goes into the URL (it may be a phone number); filters, tab, page and the open record do.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { SYNC_POLICY } from '@aipowersalon/realtime-client';
import {
  posCustomerNotificationsApi as api, newCnKey,
  type CnSummary, type CnDetail, type CnHealth, type CnFailureGroup, type CnOptOut, type CnConsentEvent, type CnTimelineItem, type CnIncident, type CnAlertSettings, type CnWindow,
} from '../api/posCustomerNotificationsApi';
import { posNotificationsApi } from '../api/posNotificationsApi';
import { useRealtime } from '../realtime/useRealtime';
import { errorTextOf } from '../i18n/error-text';
import { fmtNumber, fmtInTz } from '../i18n/format';
import { FitDialog, KpiCard, Pager, Empty, ErrorRetry, useDebounced, downloadText } from '../components/FitKit';
import { PeriodBar, periodQuery, type PeriodState, type ServerPeriod } from '../components/FinanceKit';
import { statusLabel } from '../i18n/status-label';   // the code stays the truth; only its label is translated

const SIZES = [10, 20, 50] as const;
const TABS = ['all', 'sms', 'email', 'failed', 'blocked', 'pending', 'unknown', 'optouts'] as const;
const BASES = ['created', 'delivered', 'callback'] as const;
const TYPES = ['receipt', 'reminder', 'followup', 'marketing', 'account', 'notification', 'conversation', 'unknown'] as const;
const TONE: Record<string, string> = { delivered: 'ok', sent: 'info', pending: 'mut', unknown: 'warn', failed: 'bad', blocked: 'bad', simulated: 'mut', received: 'info', ready: 'ok', pending_h: 'mut', attention: 'warn', not_applicable: 'mut' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const nf = (n: number) => fmtNumber(n);
const errText = (e: unknown) => errorTextOf(e, tx('cn.err.generic'));
const isForbidden = (e: unknown) => { const x = e as { status?: number; code?: string } | null; return !!x && (x.status === 403 || x.code === 'PERMISSION_DENIED'); };
const when = (iso: string | null | undefined, tz?: string) => (iso ? fmtInTz(iso, tz, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const whenLong = (iso: string | null | undefined, tz?: string) => (iso ? fmtInTz(iso, tz, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' }) : '—');
function Chip({ s, label, testId }: { s: string; label?: string; testId?: string }) { return <span className={'fk-chip ' + (TONE[s] ?? 'mut')} data-testid={testId ?? 'cn-chip-' + s}>{label ?? tx('cn.st.' + s)}</span>; }
function HChip({ s }: { s: string }) { return <span className={'fk-chip ' + (s === 'pending' ? 'mut' : TONE[s] ?? 'mut')} data-testid={'cn-h-' + s}>{tx('cn.hs.' + s)}</span>; }
const typeLabel = (t: string | null | undefined) => tx('cn.type.' + (t ?? 'unknown'));
const periodState = (sp: URLSearchParams): PeriodState => (sp.get('preset') === 'custom' && sp.get('from') && sp.get('to')
  ? { preset: 'custom', from: sp.get('from')!, to: sp.get('to')! } as PeriodState
  : { preset: (['today', 'week', 'month', 'year', 'all'].includes(sp.get('preset') ?? '') ? sp.get('preset') : 'month') as PeriodState['preset'] } as PeriodState);
const serverOf = (p: CnWindow | null | undefined): ServerPeriod | null => (p ? { preset: p.preset, from: p.from, to: p.to, tz: p.tz, today: p.today ?? '' } as ServerPeriod : null);
const periodLabel = (w: CnWindow | null | undefined) => (!w ? '' : w.from && w.to ? (w.from === w.to ? w.from : `${w.from} – ${w.to}`) : tx('cn.tab.all'));

export function POSNotificationsScreen() {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const setView = (patch: Record<string, string | number | null>) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === '' || v === undefined) next.delete(k); else next.set(k, String(v)); }
    if (!('page' in patch)) next.delete('page');
    setSp(next, { replace: true });
  };
  const tab = (TABS as readonly string[]).includes(sp.get('tab') ?? '') ? String(sp.get('tab')) : 'all';
  const page = Math.max(1, Number(sp.get('page')) || 1);
  const pageSize = (SIZES as readonly number[]).includes(Number(sp.get('size'))) ? Number(sp.get('size')) : 20;
  const basis = (BASES as readonly string[]).includes(sp.get('basis') ?? '') ? String(sp.get('basis')) : 'created';
  const type = (TYPES as readonly string[]).includes(sp.get('type') ?? '') ? String(sp.get('type')) : '';
  const sort = sp.get('sort') === 'oldest' ? 'oldest' : 'newest';
  const period = periodState(sp);
  const record = UUID.test(sp.get('record') ?? '') ? String(sp.get('record')) : null;
  const [search, setSearch] = useState(''); const q = useDebounced(search.trim(), 300);
  const qRef = useRef(q);
  useEffect(() => { if (qRef.current !== q) { qRef.current = q; if (page !== 1) setView({ page: null }); } }, [q]);   // eslint-disable-line react-hooks/exhaustive-deps

  const [summary, setSummary] = useState<CnSummary | null>(null); const [sumErr, setSumErr] = useState<unknown>(null);
  const [list, setList] = useState<Awaited<ReturnType<typeof api.list>> | null>(null); const [listErr, setListErr] = useState<unknown>(null);
  const [health, setHealth] = useState<CnHealth | null>(null);
  const [incidents, setIncidents] = useState<Awaited<ReturnType<typeof api.incidents>> | null>(null);
  const [reload, setReload] = useState(0); const refresh = () => setReload((n) => n + 1);
  const [note, setNote] = useState<{ tone: 'ok' | 'bad' | 'warn'; text: string } | null>(null);
  const [exporting, setExporting] = useState(false);   // C2 audit: export the filtered list
  // Email guide (Oct 31 2026): ?timeline=<customer id> opens that customer's unified email + SMS timeline (linked from Email details)
  const linkedTimeline = /^[0-9a-f-]{36}$/i.test(sp.get('timeline') ?? '') ? String(sp.get('timeline')) : null;
  const [dlg, setDlg] = useState<null | { kind: 'failures' } | { kind: 'health' } | { kind: 'timeline'; customerId: string } | { kind: 'reoptin'; row: CnOptOut } | { kind: 'alerts' }>(linkedTimeline ? { kind: 'timeline', customerId: linkedTimeline } : null);
  const seq = useRef(0);
  const sq = JSON.stringify({ ...periodQuery(period), basis });
  useEffect(() => { setSumErr(null); api.summary(JSON.parse(sq)).then(setSummary, setSumErr); }, [sq, reload]);
  useEffect(() => { api.health().then(setHealth, () => setHealth(null)); api.incidents({}).then(setIncidents, () => setIncidents(null)); }, [reload]);
  const lq = JSON.stringify({ ...periodQuery(period), basis, tab: tab === 'optouts' ? 'all' : tab, type: type || undefined, sort, q: q || undefined, page, pageSize });
  useEffect(() => {
    if (tab === 'optouts') return;
    const my = ++seq.current; setListErr(null);
    api.list(JSON.parse(lq)).then((d) => { if (my !== seq.current) return; setList(d); if (d.page !== page) setView({ page: d.page > 1 ? d.page : null }); }, (e) => { if (my === seq.current) setListErr(e); });
  }, [lq, reload, tab]);   // eslint-disable-line react-hooks/exhaustive-deps
  useRealtime(['notifications', 'communications'], () => refresh(), { intervalMs: SYNC_POLICY.detailMs });

  const k = summary?.kpis; const tz = summary?.window.tz;
  const anyFilter = !!(search || type || sp.get('preset') || sp.get('basis') || sp.get('sort') || (tab !== 'all' && tab !== 'optouts'));
  if (sumErr && isForbidden(sumErr)) return <div className="work"><div className="err" style={{ marginTop: 12 }} data-testid="cn-forbidden">{tx('cn.noPermission')}</div></div>;
  const openIncidents = (incidents?.items ?? []).filter((i) => i.status === 'new' || i.status === 'acknowledged' || i.status === 'in_progress');

  return (
    <div className="work cn" data-testid="customer-notifications">
      <header className="fk-head">
        <div className="vh" style={{ marginBottom: 0, minWidth: 0 }}><h1>{tx('cn.title')}</h1>
          <div className="sub">{tx('cn.sub')}{summary ? <span className="fk-muted" data-testid="cn-updated"> · {tx('cn.updated', { time: when(summary.provenance.computedAt, tz) })}</span> : null}</div></div>
        <div className="fk-head-actions">
          <button type="button" className="fk-btn ghost" onClick={refresh} data-testid="cn-refresh">{tx('cn.refresh')}</button>
          <button type="button" className="fk-btn ghost" onClick={() => setDlg({ kind: 'health' })} data-testid="cn-open-health">{tx('cn.checkHealth')}</button>
          <button type="button" className="fk-btn primary" onClick={() => setDlg({ kind: 'failures' })} data-testid="cn-open-failures">{tx('cn.reviewFailures')}</button>
          <button type="button" className="fk-btn ghost" onClick={() => setDlg({ kind: 'alerts' })} data-testid="cn-open-alerts">{tx('cn.alertSettings')}</button>
          <button type="button" className="fk-btn ghost" disabled={tab === 'optouts' || exporting} data-testid="cn-export" onClick={async () => {
            setExporting(true);
            try { const { page: _p, pageSize: _s, ...f } = JSON.parse(lq); downloadText('customer-notifications.csv', await api.exportCsv(f)); setNote({ tone: 'ok', text: tx('cn.exported') }); }
            catch (e) { setNote({ tone: 'bad', text: errorTextOf(e, tx('cn.exportFailed')) }); } finally { setExporting(false); }
          }}>{exporting ? tx('cn.exporting') : tx('cn.export')}</button>
        </div>
      </header>
      {note ? <div className={'fk-note ' + note.tone} role="status" data-testid="cn-note">{note.text}</div> : null}

      <div className="fk-kpis cn-kpis" data-testid="cn-kpis">
        {sumErr ? <div className="fk-error"><ErrorRetry message={errText(sumErr)} onRetry={refresh} /></div> : <>
          <KpiCard label={tx('cn.kpi.sent')} value={k ? nf(k.sent) : '…'} sub={tx('cn.kpi.sentSub')} loading={!k} testId="cn-kpi-sent" onClick={() => setView({ tab: 'all' })} />
          <KpiCard label={tx('cn.kpi.delivered')} value={k ? nf(k.delivered) : '…'} sub={tx('cn.kpi.deliveredSub')} tone="ok" loading={!k} testId="cn-kpi-delivered" />
          <KpiCard label={tx('cn.kpi.failed')} value={k ? nf(k.failed) : '…'} tone={k && k.failed > 0 ? 'bad' : undefined} loading={!k} testId="cn-kpi-failed" onClick={() => setView({ tab: 'failed' })} />
          <KpiCard label={tx('cn.kpi.blocked')} value={k ? nf(k.blocked) : '…'} sub={tx('cn.kpi.blockedSub')} tone={k && k.blocked > 0 ? 'warn' : undefined} loading={!k} testId="cn-kpi-blocked" onClick={() => setView({ tab: 'blocked' })} />
          <KpiCard label={tx('cn.kpi.pending')} value={k ? nf(k.pending) : '…'} sub={k ? tx('cn.kpi.pendingSub', { n: nf(k.unknown) }) : undefined} loading={!k} testId="cn-kpi-pending" onClick={() => setView({ tab: 'pending' })} />
          <KpiCard label={tx('cn.kpi.optouts')} value={k ? nf(k.optOutsCurrent) : '…'} sub={k ? tx('cn.kpi.optoutsSub', { n: nf(k.optOutsNew) }) : undefined} loading={!k} testId="cn-kpi-optouts" onClick={() => setView({ tab: 'optouts' })} />
        </>}
      </div>
      {summary ? <div className="cn-prov" data-testid="cn-provenance">
        <span data-testid="cn-window">{tx('cn.window', { period: periodLabel(summary.window), basis: tx('cn.basis.' + summary.window.basis), tz: summary.window.tz })}</span>
        <span>· {summary.kpis.deliveryRate == null ? tx('cn.kpi.rateNa') : tx('cn.kpi.rate', { pct: summary.kpis.deliveryRate })}</span>
        <span data-testid="cn-legacy">· {tx('cn.legacy', { sent: nf(summary.legacy.sentRecent), bf: nf(summary.legacy.blockedFailedRecent) })}</span>
        {summary.kpis.simulated > 0 ? <span>· {tx('cn.simulated', { n: nf(summary.kpis.simulated) })}</span> : null}
        <details className="cn-defs"><summary>{tx('cn.defs')}</summary><dl className="fk-dl">{Object.entries(summary.provenance.definitions).map(([key, v]) => <div key={key}><dt>{key}</dt><dd>{v}</dd></div>)}</dl></details>
      </div> : null}

      <div className="cn-top">
        <section className="fk-panel cn-search" data-testid="cn-search-panel">
          <div className="cn-tools">
            <input className="fk-search cn-q" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tx('cn.search')} aria-label={tx('cn.search')} data-testid="cn-q" />
            <select className="fk-select" aria-label={tx('cn.col.type')} value={type} onChange={(e) => setView({ type: e.target.value || null })} data-testid="cn-type">
              <option value="">{tx('cn.allTypes')}</option>{TYPES.map((x) => <option key={x} value={x}>{typeLabel(x)}</option>)}
            </select>
            <select className="fk-select" aria-label={tx('pos.sort_by')} value={sort} onChange={(e) => setView({ sort: e.target.value === 'newest' ? null : e.target.value })} data-testid="cn-sort">
              <option value="newest">↓ {tx('cn.col.when')}</option><option value="oldest">↑ {tx('cn.col.when')}</option>
            </select>
            {anyFilter ? <button type="button" className="fk-link" onClick={() => { setSearch(''); setView({ type: null, preset: null, from: null, to: null, basis: null, sort: null, tab: null }); }} data-testid="cn-clear">{tx('cn.clearAll')}</button> : null}
          </div>
          <PeriodBar compact allowAll value={period} server={serverOf(summary?.window)}
            onChange={(p) => setView(p.preset === 'custom' ? { preset: 'custom', from: p.from ?? null, to: p.to ?? null } : { preset: p.preset === 'month' ? null : p.preset, from: null, to: null })}
            basis={basis} onBasis={(b) => setView({ basis: b === 'created' ? null : b })} basisOptions={BASES.map((b) => ({ value: b, label: tx('cn.basis.' + b) }))} />
        </section>
        <section className="fk-panel cn-health" data-testid="cn-health-panel">
          <div className="fk-panel-head"><h2>{tx('cn.h.title')}</h2>{health ? <HChip s={health.overall} /> : null}</div>
          <div className="cn-hgrid">
            {(['twilio', 'email', 'webhooks', 'registration'] as const).map((key) => (
              <div key={key} className="cn-hcell" data-testid={'cn-hcell-' + key}><span>{tx('cn.h.' + key)}</span>{health ? <HChip s={health[key].state} /> : <span className="fk-muted">…</span>}</div>
            ))}
          </div>
          {health ? <div className="fk-hint">{health.callbacks.lastReceivedAt ? tx('cn.h.lastReport', { time: when(health.callbacks.lastReceivedAt, tz) }) : tx('cn.h.noReport')} · {tx('cn.h.failed24', { n: nf(health.failedLast24h) })}</div> : null}
        </section>
      </div>

      {openIncidents.length ? <Incidents items={openIncidents} canResolve={!!incidents?.canResolve} tz={tz} onChanged={refresh} onNote={setNote} /> : null}

      <section className="fk-panel cn-activity" data-testid="cn-activity">
        <div className="fk-panel-head">
          <div className="fk-seg cn-tabs" role="tablist">
            {TABS.map((x) => <button key={x} type="button" role="tab" aria-selected={tab === x} className={tab === x ? 'on' : ''} onClick={() => setView({ tab: x === 'all' ? null : x })} data-testid={'cn-tab-' + x}>{tx('cn.tab.' + x)}</button>)}
          </div>
          {tab !== 'optouts' && list ? <span className="fk-muted" data-testid="cn-total">{tx('cn.matching', { n: nf(list.totalItems) })}</span> : null}
        </div>
        {tab === 'optouts' ? <OptOuts canManage={!!summary?.canManage} tz={tz} onReOptIn={(row) => setDlg({ kind: 'reoptin', row })} reload={reload} /> : (
          <>
            {list?.recipientsMasked ? <div className="fk-hint" data-testid="cn-masked">{tx('cn.masked')}</div> : null}
            <div className="fk-panel-body cn-scroll">
              {listErr ? (isForbidden(listErr) ? <div className="err">{tx('cn.noPermission')}</div> : <ErrorRetry message={errText(listErr)} onRetry={refresh} />)
                : !list ? <div className="state">{tx('cn.loading')}</div>
                : list.items.length === 0 ? <Empty title={anyFilter ? tx('cn.empty') : tx('cn.emptyAll')} />
                : <table className="fk-table cn-table" data-testid="cn-table">
                  <thead><tr><th>{tx('cn.col.when')}</th><th>{tx('cn.col.customer')}</th><th>{tx('cn.col.recipient')}</th><th>{tx('cn.col.channel')}</th><th>{tx('cn.col.type')}</th><th>{tx('cn.col.status')}</th><th>{tx('cn.col.detail')}</th><th>{tx('cn.col.actions')}</th></tr></thead>
                  <tbody>{list.items.map((r) => (
                    <tr key={r.id} data-testid="cn-row" className={record === r.id ? 'sel' : ''}>
                      <td className="nowrap">{when(r.createdAt, tz)}</td>
                      <td>{r.customer ? <button type="button" className="fk-link" onClick={() => setDlg({ kind: 'timeline', customerId: r.customer!.id })} data-testid="cn-cust">{r.customer.name ?? '—'}</button> : <span className="fk-muted">{tx('cn.unknownCustomer')}</span>}</td>
                      <td className="nowrap" data-testid="cn-recipient">{r.recipient}{!r.recipientValid ? <span className="fk-chip bad cn-mini">!</span> : null}</td>
                      <td>{tx('cn.ch.' + r.channel)}</td>
                      <td>{typeLabel(r.type)}</td>
                      <td><Chip s={r.state} />{r.resent ? <span className="fk-chip info cn-mini" data-testid="cn-resent">{tx('cn.resent')}</span> : null}{r.retryOf ? <span className="fk-chip mut cn-mini" title={tx('cn.retryOf')}>↻</span> : null}</td>
                      <td className="cn-detail">{r.failure ? <><b>{tx('cn.fc.' + r.failure.category)}</b>{r.detail ? <span className="fk-muted"> — {r.detail}</span> : null}</> : (r.detail ?? '')}</td>
                      <td><button type="button" className="fk-btn ghost sm" onClick={() => setView({ record: r.id, page })} data-testid="cn-view">{tx('cn.view')}</button></td>
                    </tr>))}</tbody>
                </table>}
            </div>
            <div className="fk-panel-foot cn-foot">
              <Pager info={list} onPage={(p) => setView({ page: p > 1 ? p : null })} />
              <label className="cn-size">{tx('cn.rows')} <select className="fk-select" value={pageSize} onChange={(e) => setView({ size: Number(e.target.value) === 20 ? null : Number(e.target.value) })} data-testid="cn-size">{SIZES.map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
            </div>
          </>)}
      </section>

      {record ? <DetailDialog id={record} tz={tz} onClose={() => setView({ record: null, page })} onTimeline={(cid) => setDlg({ kind: 'timeline', customerId: cid })} onGo={(to) => nav(to)} onChanged={refresh} onNote={setNote} /> : null}
      {dlg?.kind === 'failures' ? <FailuresDialog period={period} tz={tz} onClose={() => setDlg(null)} onShow={(cat) => { setDlg(null); setView({ tab: cat === 'opted_out' || cat === 'invalid_destination' || cat === 'not_configured' || cat === 'over_limit' ? 'blocked' : 'failed' }); }} onGo={(to) => nav(to)} /> : null}
      {dlg?.kind === 'health' ? <HealthDialog initial={health} tz={tz} onClose={() => setDlg(null)} onUpdated={setHealth} onGo={(to) => nav(to)} /> : null}
      {dlg?.kind === 'timeline' ? <TimelineDialog customerId={dlg.customerId} tz={tz} onClose={() => setDlg(null)} onGo={(to) => nav(to)} /> : null}
      {dlg?.kind === 'reoptin' ? <ReOptInDialog row={dlg.row} onClose={() => setDlg(null)} onDone={() => { setDlg(null); setNote({ tone: 'ok', text: tx('cn.o.done') }); refresh(); }} /> : null}
      {dlg?.kind === 'alerts' ? <AlertSettingsDialog onClose={() => setDlg(null)} onSaved={() => { setDlg(null); setNote({ tone: 'ok', text: tx('cn.a.saved') }); refresh(); }} /> : null}
    </div>
  );
}

function Incidents({ items, canResolve, tz, onChanged, onNote }: { items: CnIncident[]; canResolve: boolean; tz?: string; onChanged: () => void; onNote: (n: { tone: 'ok' | 'bad' | 'warn'; text: string }) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (id: string, fn: 'ack' | 'resolve') => { setBusy(id); try { if (fn === 'ack') await api.acknowledgeIncident(id); else await api.resolveIncident(id); onChanged(); } catch (e) { onNote({ tone: 'bad', text: errText(e) }); } finally { setBusy(null); } };
  return (
    <section className="fk-panel cn-incidents" data-testid="cn-incidents">
      <div className="fk-panel-head"><h2>{tx('cn.i.title')}</h2>{!canResolve ? <span className="fk-muted">{tx('cn.i.ownerOnly')}</span> : null}</div>
      <ul className="fk-list">{items.map((i) => (
        <li key={i.id} className="fk-li" data-testid="cn-incident">
          <div className="fk-li-main"><div className="fk-li-t"><span className={'fk-chip ' + (i.severity === 'critical' || i.severity === 'high' ? 'bad' : 'warn')}>{statusLabel('level', i.severity)}</span> {i.title}</div>
            <div className="fk-li-s">{i.body} · {tx('cn.i.count', { n: nf(i.detections), c: nf(i.count) })} · {when(i.lastEventAt ?? i.updatedAt, tz)} · {tx('cn.i.status.' + i.status)}</div></div>
          {canResolve ? <div className="fk-li-acts">
            {i.status === 'new' ? <button type="button" className="fk-btn ghost sm" disabled={busy === i.id} onClick={() => act(i.id, 'ack')} data-testid="cn-incident-ack">{tx('cn.i.ack')}</button> : null}
            <button type="button" className="fk-btn ghost sm" disabled={busy === i.id} onClick={() => act(i.id, 'resolve')} data-testid="cn-incident-resolve">{tx('cn.i.resolve')}</button>
          </div> : null}
        </li>))}</ul>
    </section>
  );
}

function DetailDialog({ id, tz, onClose, onTimeline, onGo, onChanged, onNote }: { id: string; tz?: string; onClose: () => void; onTimeline: (customerId: string) => void; onGo: (to: string) => void; onChanged: () => void; onNote: (n: { tone: 'ok' | 'bad' | 'warn'; text: string }) => void }) {
  const [d, setD] = useState<CnDetail | null>(null); const [e, setE] = useState<unknown>(null);
  const [confirm, setConfirm] = useState(false); const [busy, setBusy] = useState(false); const keyRef = useRef<string | null>(null);
  const load = useCallback(() => { setE(null); api.detail(id).then(setD, setE); }, [id]);
  useEffect(() => { load(); }, [load]);
  const resend = async () => {
    if (!d) return; setBusy(true);
    keyRef.current = keyRef.current ?? newCnKey();   // the same request id if the answer is lost and staff press again
    try {
      const r = await api.retry(d.id, keyRef.current);
      onNote(r.outcome === 'refused' ? { tone: 'warn', text: tx('cn.d.retryRefused', { reason: tx('errors.' + (r.refusalCode ?? 'NOTIFICATION_RETRY_NOT_ALLOWED')) }) } : { tone: r.outcome === 'sent' || r.outcome === 'simulated' ? 'ok' : 'warn', text: tx('cn.d.retryDone', { outcome: tx('cn.st.' + (r.outcome === 'simulated' ? 'simulated' : r.outcome)) }) });
      setConfirm(false); keyRef.current = null; onChanged(); load();
    } catch (err) { onNote({ tone: 'bad', text: errText(err) }); } finally { setBusy(false); }
  };
  const L = d?.links ?? {};
  return (
    <FitDialog title={tx('cn.d.title')} subtitle={d ? <span>{d.header.category ? typeLabel(d.header.category) + ' · ' : ''}<Chip s={d.state} /> {d.customer?.name ?? ''}</span> : undefined} onClose={onClose} wide side testId="cn-detail"
      footer={<button type="button" className="fk-btn ghost" onClick={onClose} data-testid="cn-detail-close">{tx('cn.d.close')}</button>}>
      {e ? <ErrorRetry message={errText(e)} onRetry={load} /> : !d ? <div className="state">{tx('cn.loading')}</div> : (
        <div className="cn-detail-body">
          <section><h3 className="fk-h">{tx('cn.d.identity')}</h3><dl className="fk-dl">
            <div><dt>{tx('cn.d.customer')}</dt><dd>{d.customer?.name ?? tx('cn.unknownCustomer')}</dd></div>
            <div><dt>{tx('cn.d.recipient')}</dt><dd data-testid="cn-d-recipient">{d.identity.recipient}</dd></div>
            <div><dt>{tx('cn.d.branch')}</dt><dd>{d.identity.branch?.name ?? '—'}</dd></div>
            <div><dt>{tx('cn.d.sender')}</dt><dd>{d.identity.sender.route ? tx('cn.d.route.' + d.identity.sender.route) : '—'}{d.identity.sender.from ? ` (${d.identity.sender.from})` : ''}</dd></div>
          </dl></section>
          <section><h3 className="fk-h">{tx('cn.d.message')}</h3>
            {d.message.subject ? <div className="fk-li-t">{d.message.subject}</div> : null}
            {d.message.bodyHidden ? <div className="fk-hint" data-testid="cn-d-bodyhidden">{tx('cn.d.bodyHidden')}</div> : <pre className="cn-body" data-testid="cn-d-body">{d.message.body}</pre>}
            {d.message.segments != null ? <div className="fk-muted">{tx('cn.d.segments', { n: d.message.segments })}</div> : null}
          </section>
          <section><h3 className="fk-h">{tx('cn.d.timing')}</h3><dl className="fk-dl">
            <div><dt>{tx('cn.d.created')}</dt><dd>{whenLong(d.timing.createdAt, tz)}</dd></div>
            <div><dt>{tx('cn.d.accepted')}</dt><dd>{d.timing.providerAcceptedAt ? whenLong(d.timing.providerAcceptedAt, tz) : d.timing.providerAcceptedNote ? tx('cn.d.acceptedNoTime') : whenLong(null, tz)}</dd></div>
            <div><dt>{tx('cn.d.deliveredAt')}</dt><dd>{whenLong(d.timing.deliveredAt, tz)}</dd></div>
            {d.timing.failedAt ? <div><dt>{tx('cn.d.failedAt')}</dt><dd>{whenLong(d.timing.failedAt, tz)}</dd></div> : null}
            <div><dt>{tx('cn.d.lastCallback')}</dt><dd>{whenLong(d.timing.lastCallbackAt, tz)}</dd></div>
            {d.timing.unknownSince ? <div><dt>{tx('cn.d.unknownSince')}</dt><dd>{whenLong(d.timing.unknownSince, tz)}</dd></div> : null}
          </dl></section>
          {d.failure || d.diagnostics.events.length ? <section data-testid="cn-d-diag"><h3 className="fk-h">{tx('cn.d.diag')}</h3>
            {d.failure ? <div className="cn-diag">
              <div className="fk-li-t" data-testid="cn-d-category">{tx('cn.fc.' + d.failure.category)} <span className="fk-chip mut">{tx('cn.retryPolicy.' + d.failure.retry)}</span></div>
              {d.failure.rootCause ? <div className="fk-note warn" data-testid="cn-d-root">{tx('cn.root.' + d.failure.rootCause)}</div> : null}
              <div>{tx('cn.act.' + d.failure.action)}</div>
              <dl className="fk-dl">
                <div><dt>{tx('cn.d.code')}</dt><dd>{d.diagnostics.providerErrorCode ?? '—'}</dd></div>
                <div><dt>{tx('cn.d.providerStatus')}</dt><dd>{d.diagnostics.providerStatus ?? '—'}</dd></div>
                <div><dt>{tx('cn.col.detail')}</dt><dd data-testid="cn-d-message">{d.diagnostics.message ?? '—'}</dd></div>
              </dl>
            </div> : null}
            {d.diagnostics.providerReference ? <div className="fk-muted">{tx('cn.d.ref')}: {d.diagnostics.providerReference}</div> : null}
            <h4 className="fk-h">{tx('cn.d.events')}</h4>
            {d.diagnostics.events.length === 0 ? <div className="fk-muted">{tx('cn.d.noEvents')}</div>
              : <ul className="fk-list">{d.diagnostics.events.map((ev, i) => <li key={i} className="fk-li"><div className="fk-li-main"><div className="fk-li-t">{ev.providerStatus}{ev.errorCode ? ` · ${ev.errorCode}` : ''}</div><div className="fk-li-s">{whenLong(ev.receivedAt, tz)} · {ev.applied ? tx('cn.d.applied') : tx('cn.d.notApplied')}</div></div></li>)}</ul>}
          </section> : null}
          {d.attempts.length > 1 || d.retryRequests.length ? <section><h3 className="fk-h">{tx('cn.d.attempts')}</h3>
            <ul className="fk-list" data-testid="cn-d-attempts">{d.attempts.map((a) => <li key={a.id} className="fk-li"><div className="fk-li-main"><div className="fk-li-t"><Chip s={a.status === 'sent' ? 'sent' : a.status} /> {whenLong(a.createdAt, tz)}{a.current ? ` · ${tx('cn.d.thisAttempt')}` : ''}</div>{a.failure ? <div className="fk-li-s">{tx('cn.fc.' + a.failure)}</div> : null}</div></li>)}</ul>
            {d.retryRequests.length ? <><h4 className="fk-h">{tx('cn.d.retries')}</h4><ul className="fk-list">{d.retryRequests.map((r) => <li key={r.id} className="fk-li"><div className="fk-li-main"><div className="fk-li-t">{r.outcome}{r.refusalCode ? ` — ${tx('errors.' + r.refusalCode)}` : ''}</div><div className="fk-li-s">{whenLong(r.at, tz)}{r.byName ? ` · ${r.byName}` : ''}</div></div></li>)}</ul></> : null}
          </section> : null}
          {d.consent.optedOut ? <div className="fk-note warn">{tx('cn.d.optedOut')}</div> : null}
          <section className="cn-actions" data-testid="cn-d-actions">
            {d.customer ? <button type="button" className="fk-btn ghost" onClick={() => onTimeline(d.customer!.id)} data-testid="cn-d-timeline">{tx('cn.d.viewTimeline')}</button> : null}
            {L.customer ? <button type="button" className="fk-btn ghost" onClick={() => onGo(L.customer!)} data-testid="cn-d-open-customer">{tx('cn.d.openCustomer')}</button> : null}
            {L.booking ? <button type="button" className="fk-btn ghost" onClick={() => onGo(L.booking!)} data-testid="cn-d-open-booking">{tx('cn.d.openBooking')}</button> : null}
            {L.conversation ? <button type="button" className="fk-btn ghost" onClick={() => onGo(L.conversation!)} data-testid="cn-d-open-conversation">{tx('cn.d.openConversation')}</button> : null}
            {L.appointmentReminders ? <button type="button" className="fk-btn ghost" onClick={() => onGo(L.appointmentReminders!)}>{tx('cn.d.openReminders')}</button> : null}
            {L.followUps ? <button type="button" className="fk-btn ghost" onClick={() => onGo(L.followUps!)}>{tx('cn.d.openFollowUps')}</button> : null}
            {L.fix ? <button type="button" className="fk-btn ghost" onClick={() => onGo(L.fix!)} data-testid="cn-d-fix">{tx('cn.d.openFix')}</button> : null}
            {d.failure ? (d.retry.eligible
              ? (confirm ? <div className="fk-note info cn-confirm" data-testid="cn-d-confirm">{tx('cn.d.retryConfirm', { channel: tx('cn.ch.' + d.channel), recipient: d.recipientMasked })}
                  <div className="cn-confirm-btns"><button type="button" className="fk-btn primary" disabled={busy} onClick={resend} data-testid="cn-d-retry-yes">{tx('cn.d.retryYes')}</button>
                  <button type="button" className="fk-btn ghost" disabled={busy} onClick={() => setConfirm(false)}>{tx('cn.d.retryCancel')}</button></div></div>
                : <button type="button" className="fk-btn primary" onClick={() => setConfirm(true)} data-testid="cn-d-retry">{tx('cn.d.retry')}</button>)
              : <span className="fk-muted" data-testid="cn-d-noretry">{d.retry.code ? tx('errors.' + d.retry.code) : ''}</span>) : null}
          </section>
        </div>)}
    </FitDialog>
  );
}

function FailuresDialog({ period, tz, onClose, onShow, onGo }: { period: PeriodState; tz?: string; onClose: () => void; onShow: (category: string) => void; onGo: (to: string) => void }) {
  const [f, setF] = useState<{ groups: CnFailureGroup[]; scanned: number; truncated: boolean } | null>(null); const [e, setE] = useState<unknown>(null);
  const load = useCallback(() => { setE(null); api.failures(periodQuery(period)).then(setF, setE); }, [period.preset, period.from, period.to]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [load]);
  return (
    <FitDialog title={tx('cn.f.title')} subtitle={tx('cn.f.sub')} onClose={onClose} wide testId="cn-failures" footer={<button type="button" className="fk-btn ghost" onClick={onClose}>{tx('cn.d.close')}</button>}>
      {e ? <ErrorRetry message={errText(e)} onRetry={load} /> : !f ? <div className="state">{tx('cn.loading')}</div> : f.groups.length === 0 ? <Empty title={tx('cn.f.none')} /> : (
        <ul className="fk-list">{f.groups.map((g) => (
          <li key={g.category + g.channel} className="fk-li cn-fgroup" data-testid={'cn-fgroup-' + g.category}>
            <div className="fk-li-main">
              <div className="fk-li-t">{tx('cn.fc.' + g.category)} · {tx('cn.ch.' + g.channel)} <span className="fk-chip mut">{tx('cn.retryPolicy.' + g.retry)}</span></div>
              <div className="fk-li-s">{tx('cn.f.count', { n: nf(g.count) })} · {tx('cn.f.latest', { time: when(g.latestAt, tz) })}</div>
              {Object.keys(g.rootCauses).map((rc) => <div key={rc} className="fk-note warn" data-testid="cn-froot">{tx('cn.root.' + rc)} ({nf(g.rootCauses[rc])})</div>)}
              <div>{tx('cn.act.' + g.action)}</div>
              {g.example ? <div className="fk-muted">{tx('cn.f.example', { text: g.example })}</div> : null}
            </div>
            <div className="fk-li-acts">
              <button type="button" className="fk-btn ghost sm" onClick={() => onShow(g.category)}>{tx('cn.f.open')}</button>
              {g.fixLink ? <button type="button" className="fk-btn ghost sm" onClick={() => onGo(g.fixLink!)}>{tx('cn.d.openFix')}</button> : null}
            </div>
          </li>))}</ul>)}
      {f?.truncated ? <div className="fk-hint">{tx('cn.f.truncated')}</div> : null}
    </FitDialog>
  );
}

function HealthDialog({ initial, tz, onClose, onUpdated, onGo }: { initial: CnHealth | null; tz?: string; onClose: () => void; onUpdated: (h: CnHealth) => void; onGo: (to: string) => void }) {
  const [h, setH] = useState<CnHealth | null>(initial); const [e, setE] = useState<unknown>(null); const [busy, setBusy] = useState(false); const [checked, setChecked] = useState(false);
  useEffect(() => { if (!initial) api.health().then(setH, setE); }, [initial]);
  const run = async () => { setBusy(true); setE(null); try { const r = await api.checkHealth(); setH(r); onUpdated(r); setChecked(true); } catch (err) { setE(err); } finally { setBusy(false); } };
  const row = (key: string, item: { state: string; lastCheckedAt?: string | null; detail?: string | null } | undefined, extra?: string) => (
    <li key={key} className="fk-li" data-testid={'cn-hrow-' + key}><div className="fk-li-main"><div className="fk-li-t">{tx('cn.h.' + key)} {item ? <HChip s={item.state} /> : null}</div>
      <div className="fk-li-s">{item?.lastCheckedAt !== undefined ? (item?.lastCheckedAt ? tx('cn.h.lastChecked', { time: when(item.lastCheckedAt, tz) }) : tx('cn.h.never')) : ''}{extra ? ` ${extra}` : ''}</div></div></li>);
  return (
    <FitDialog title={tx('cn.h.title')} subtitle={tx('cn.h.sub')} onClose={onClose} testId="cn-health" footer={<>
      <button type="button" className="fk-btn primary" disabled={busy} onClick={run} data-testid="cn-h-run">{busy ? tx('cn.h.checking') : tx('cn.h.runCheck')}</button>
      <button type="button" className="fk-btn ghost" onClick={() => onGo('/tenant/communications/messaging-setup')}>{tx('cn.h.fix')}</button>
      <button type="button" className="fk-btn ghost" onClick={onClose}>{tx('cn.d.close')}</button></>}>
      {e ? <div className="err" data-testid="cn-h-err">{errText(e)}</div> : null}
      {checked ? <div className="fk-note ok" data-testid="cn-h-checked">{tx('cn.h.checkedNow')}</div> : null}
      {!h ? <div className="state">{tx('cn.loading')}</div> : <>
        {!h.readinessAvailable ? <div className="fk-note warn">{tx('cn.h.unavailable')}</div> : null}
        <div className="fk-li-t">{tx('cn.h.overall')} <HChip s={h.overall} /></div>
        <ul className="fk-list">
          {row('twilio', h.twilio)}{row('sender', h.sender)}{row('registration', h.registration)}{row('webhooks', h.webhooks, h.webhooks.lastVerifiedEventAt ? tx('cn.h.lastReport', { time: when(h.webhooks.lastVerifiedEventAt, tz) }) : '')}
          {row('outbound', h.outbound, [...h.outbound.blockers, ...h.outbound.warnings].join(' · '))}
          {row('email', h.email, tx('cn.h.emailEvents'))}
          <li className="fk-li" data-testid="cn-hrow-callbacks"><div className="fk-li-main"><div className="fk-li-t">{tx('cn.h.callbacks')} <HChip s={h.callbacks.state} /></div>
            <div className="fk-li-s">{h.callbacks.lastReceivedAt ? tx('cn.h.lastReport', { time: when(h.callbacks.lastReceivedAt, tz) }) : tx('cn.h.noReport')} · {tx('cn.h.awaiting', { n: nf(h.callbacks.awaiting), u: nf(h.callbacks.unknown) })}</div></div></li>
          <li className="fk-li"><div className="fk-li-main"><div className="fk-li-t">{tx('cn.h.worker')} <HChip s="not_applicable" /></div><div className="fk-li-s">{h.worker.detail}</div></div></li>
        </ul>
        <div className="fk-hint">{tx('cn.h.failed24', { n: nf(h.failedLast24h) })}</div>
      </>}
    </FitDialog>
  );
}

function TimelineDialog({ customerId, tz, onClose, onGo }: { customerId: string; tz?: string; onClose: () => void; onGo: (to: string) => void }) {
  const [ch, setCh] = useState('all'); const [page, setPage] = useState(1);
  const [d, setD] = useState<Awaited<ReturnType<typeof api.timeline>> | null>(null); const [e, setE] = useState<unknown>(null);
  const load = useCallback(() => { setE(null); api.timeline(customerId, { channel: ch, page, pageSize: 20 }).then(setD, setE); }, [customerId, ch, page]);
  useEffect(() => { load(); }, [load]);
  return (
    <FitDialog title={tx('cn.t.title')} subtitle={d ? tx('cn.t.sub', { name: d.customer.name }) : undefined} onClose={onClose} wide side testId="cn-timeline" footer={<>
      {d ? <button type="button" className="fk-btn ghost" onClick={() => onGo(d.links.profile)}>{tx('cn.d.openCustomer')}</button> : null}
      {d ? <button type="button" className="fk-btn ghost" onClick={() => onGo(d.links.booking)} data-testid="cn-t-booking">{tx('cn.d.openBooking')}</button> : null}
      <button type="button" className="fk-btn ghost" onClick={onClose} data-testid="cn-t-close">{tx('cn.d.close')}</button></>}>
      <div className="fk-seg" role="tablist">{['all', 'sms', 'email', 'booking', 'follow_up', 'receipt'].map((x) => <button key={x} type="button" className={ch === x ? 'on' : ''} onClick={() => { setCh(x); setPage(1); }} data-testid={'cn-t-ch-' + x}>{tx('cn.ch.' + x)}</button>)}</div>
      {e ? <ErrorRetry message={errText(e)} onRetry={load} /> : !d ? <div className="state">{tx('cn.loading')}</div> : d.items.length === 0 ? <Empty title={tx('cn.t.empty')} /> : (
        <ul className="fk-list cn-tl" data-testid="cn-t-list">{d.items.map((it: CnTimelineItem) => (
          <li key={it.kind + it.id} className={'fk-li cn-tl-' + it.direction + (it.failed ? ' failed' : '')} data-testid={'cn-t-' + it.kind}>
            <div className="fk-li-main">
              <div className="fk-li-t">{tx('cn.t.kind.' + it.kind)} · {tx('cn.ch.' + (['sms', 'email', 'booking', 'follow_up', 'receipt'].includes(it.channel) ? it.channel : 'sms'))} · <span className="fk-muted">{tx(it.direction === 'inbound' ? 'cn.t.inbound' : it.direction === 'internal' ? 'cn.t.internal' : 'cn.t.outbound')}</span> {['delivered', 'sent', 'pending', 'unknown', 'failed', 'blocked', 'simulated', 'received'].includes(it.status) ? <Chip s={statusLabel('state', it.status)} /> : <span className="fk-chip mut">{statusLabel('state', it.status)}</span>}{it.unresolved ? <span className="fk-chip warn">{tx('cn.t.unresolved')}</span> : null}</div>
              <div className="fk-li-s">{when(it.at, tz)}{it.counterpart ? ` · ${it.counterpart}` : ''}{it.summary ? ` · ${it.summary}` : ''}</div>
            </div>
            {it.link ? <div className="fk-li-acts"><button type="button" className="fk-btn ghost sm" onClick={() => onGo(it.link!)}>{tx('cn.t.open')}</button></div> : null}
          </li>))}</ul>)}
      {d?.capped ? <div className="fk-hint">{tx('cn.t.capped')}</div> : null}
      <Pager info={d} onPage={setPage} compact />
    </FitDialog>
  );
}

function OptOuts({ canManage, tz, onReOptIn, reload }: { canManage: boolean; tz?: string; onReOptIn: (row: CnOptOut) => void; reload: number }) {
  const [view, setView] = useState<'current' | 'history'>('current'); const [page, setPage] = useState(1);
  const [s, setS] = useState(''); const q = useDebounced(s.trim(), 300);
  const [d, setD] = useState<Awaited<ReturnType<typeof api.optOuts>> | null>(null); const [e, setE] = useState<unknown>(null);
  const load = useCallback(() => { setE(null); api.optOuts({ view, q: q || undefined, page, pageSize: 20 }).then(setD, setE); }, [view, q, page]);
  useEffect(() => { load(); }, [load, reload]);
  useEffect(() => { setPage(1); }, [q, view]);
  const rows = useMemo(() => d?.items ?? [], [d]);
  return (
    <div className="cn-optouts" data-testid="cn-optouts">
      <div className="cn-tools">
        <div className="fk-seg">{(['current', 'history'] as const).map((v) => <button key={v} type="button" className={view === v ? 'on' : ''} onClick={() => setView(v)} data-testid={'cn-o-' + v}>{tx('cn.o.' + v)}</button>)}</div>
        <input className="fk-search" type="search" value={s} onChange={(ev) => setS(ev.target.value)} placeholder={tx('cn.o.search')} aria-label={tx('cn.o.search')} data-testid="cn-o-q" />
      </div>
      <div className="fk-hint">{tx('cn.o.rules')}</div>
      <div className="fk-panel-body cn-scroll">
        {e ? <ErrorRetry message={errText(e)} onRetry={load} /> : !d ? <div className="state">{tx('cn.loading')}</div> : rows.length === 0 ? <Empty title={view === 'current' ? tx('cn.o.empty') : tx('cn.o.emptyHistory')} /> : view === 'current' ? (
          <table className="fk-table" data-testid="cn-o-table"><thead><tr><th>{tx('cn.o.col.recipient')}</th><th>{tx('cn.o.col.channel')}</th><th>{tx('cn.o.col.source')}</th><th>{tx('cn.o.col.reason')}</th><th>{tx('cn.o.col.since')}</th><th>{tx('cn.o.col.customers')}</th><th>{tx('cn.o.col.action')}</th></tr></thead>
            <tbody>{(rows as CnOptOut[]).map((o, i) => <tr key={i} data-testid="cn-o-row">
              <td className="nowrap">{o.recipient}</td><td>{tx('cn.ch.' + o.channel)}</td><td>{tx('cn.o.src.' + o.source)}</td><td>{o.reason ?? '—'}</td><td className="nowrap">{when(o.since, tz)}</td><td>{nf(o.matchingCustomers)}</td>
              <td>{o.reOptIn === 'customer_only' ? <span className="fk-muted" data-testid="cn-o-customeronly">{tx('cn.o.customerOnly')}</span>
                : o.reOptIn === 'staff_with_note' && canManage ? <button type="button" className="fk-btn ghost sm" onClick={() => onReOptIn(o)} data-testid="cn-o-reoptin">{tx('cn.o.reOptIn')}</button>
                : <span className="fk-muted">{tx('cn.o.noPerm')}</span>}</td>
            </tr>)}</tbody></table>
        ) : (
          <table className="fk-table" data-testid="cn-o-history"><thead><tr><th>{tx('cn.o.col.at')}</th><th>{tx('cn.o.col.recipient')}</th><th>{tx('cn.o.col.channel')}</th><th>{tx('cn.o.col.event')}</th><th>{tx('cn.o.col.source')}</th><th>{tx('cn.o.col.note')}</th><th>{tx('cn.o.col.by')}</th></tr></thead>
            <tbody>{(rows as CnConsentEvent[]).map((ev) => <tr key={ev.id} data-testid="cn-o-event">
              <td className="nowrap">{when(ev.at, tz)}</td><td className="nowrap">{ev.recipient}</td><td>{tx('cn.ch.' + ev.channel)}</td><td>{tx('cn.o.ev.' + ev.action)}</td><td>{tx('cn.o.src.' + ev.source)}</td><td>{ev.consentNote ?? ev.reason ?? '—'}</td><td>{ev.byName ?? '—'}</td>
            </tr>)}</tbody></table>
        )}
      </div>
      <div className="fk-panel-foot"><Pager info={d} onPage={setPage} /></div>
    </div>
  );
}

function ReOptInDialog({ row, onClose, onDone }: { row: CnOptOut; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState(''); const [busy, setBusy] = useState(false); const [e, setE] = useState<unknown>(null);
  const go = async () => { setBusy(true); setE(null); try { await posNotificationsApi.optIn(row.channel, row.recipientKey ?? '', note.trim()); onDone(); } catch (err) { setE(err); } finally { setBusy(false); } };
  return (
    <FitDialog title={tx('cn.o.dlgTitle', { recipient: row.recipient })} subtitle={tx('cn.o.dlgSub')} onClose={onClose} busy={busy} testId="cn-reoptin" footer={<>
      <button type="button" className="fk-btn primary" disabled={busy || note.trim().length < 5 || !row.recipientKey} onClick={go} data-testid="cn-reoptin-go">{tx('cn.o.confirm')}</button>
      <button type="button" className="fk-btn ghost" onClick={onClose}>{tx('cn.d.retryCancel')}</button></>}>
      <label className="fk-field"><span>{tx('cn.o.note')}</span>
        <textarea rows={3} maxLength={300} value={note} onChange={(ev) => setNote(ev.target.value)} placeholder={tx('cn.o.notePh')} data-testid="cn-reoptin-note" /></label>
      {e ? <div className="err" data-testid="cn-reoptin-err">{errText(e)}</div> : null}
    </FitDialog>
  );
}

function AlertSettingsDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [s, setS] = useState<CnAlertSettings | null>(null); const [canEdit, setCanEdit] = useState(true); const [e, setE] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { api.alertSettings().then((r) => setS(r.settings), setE); }, []);
  const num = (v: string) => Math.max(0, Math.trunc(Number(v) || 0));
  const save = async () => { if (!s) return; setBusy(true); setE(null); try { await api.saveAlertSettings(s); onSaved(); } catch (err) { if (isForbidden(err)) setCanEdit(false); setE(err); } finally { setBusy(false); } };
  const field = (label: string, value: number, set: (n: number) => void, id: string) => <label className="fk-field cn-num"><span>{label}</span><input type="number" min={0} value={value} onChange={(ev) => set(num(ev.target.value))} data-testid={id} disabled={!canEdit} /></label>;
  return (
    <FitDialog title={tx('cn.a.title')} subtitle={tx('cn.a.sub')} onClose={onClose} busy={busy} testId="cn-alerts" footer={<>
      <button type="button" className="fk-btn primary" disabled={busy || !s || !canEdit} onClick={save} data-testid="cn-a-save">{tx('cn.a.save')}</button>
      <button type="button" className="fk-btn ghost" onClick={onClose}>{tx('cn.d.close')}</button></>}>
      {e ? <div className="err" data-testid="cn-a-err">{isForbidden(e) ? tx('cn.noManage') : errText(e)}</div> : null}
      {!s ? <div className="state">{tx('cn.loading')}</div> : <div className="cn-alerts">
        <label className="fk-check"><input type="checkbox" checked={s.enabled} disabled={!canEdit} onChange={(ev) => setS({ ...s, enabled: ev.target.checked })} data-testid="cn-a-enabled" /> {tx('cn.a.enabled')}</label>
        <div className="fk-h">{tx('cn.a.repeat')} <span className="fk-muted">{tx('cn.a.repeatHint', { count: s.repeatedFailures.count, min: s.repeatedFailures.windowMinutes })}</span></div>
        <div className="cn-row2">{field(tx('cn.a.count'), s.repeatedFailures.count, (n) => setS({ ...s, repeatedFailures: { ...s.repeatedFailures, count: n } }), 'cn-a-rcount')}{field(tx('cn.a.minutes'), s.repeatedFailures.windowMinutes, (n) => setS({ ...s, repeatedFailures: { ...s.repeatedFailures, windowMinutes: n } }), 'cn-a-rmin')}</div>
        <div className="fk-h">{tx('cn.a.ratio')} <span className="fk-muted">{tx('cn.a.ratioHint', { att: s.failureRatio.minAttempts, pct: s.failureRatio.ratioPercent, min: s.failureRatio.windowMinutes })}</span></div>
        <div className="cn-row2">{field(tx('cn.a.attempts'), s.failureRatio.minAttempts, (n) => setS({ ...s, failureRatio: { ...s.failureRatio, minAttempts: n } }), 'cn-a-att')}{field(tx('cn.a.percent'), s.failureRatio.ratioPercent, (n) => setS({ ...s, failureRatio: { ...s.failureRatio, ratioPercent: n } }), 'cn-a-pct')}{field(tx('cn.a.minutes'), s.failureRatio.windowMinutes, (n) => setS({ ...s, failureRatio: { ...s.failureRatio, windowMinutes: n } }), 'cn-a-qmin')}</div>
        {field(tx('cn.a.stale'), s.callbackStaleHours, (n) => setS({ ...s, callbackStaleHours: n }), 'cn-a-stale')}
        <div className="fk-h">{tx('cn.a.backlog')} <span className="fk-muted">{tx('cn.a.backlogHint', { count: s.pendingBacklog.count, min: s.pendingBacklog.oldestMinutes })}</span></div>
        <div className="cn-row2">{field(tx('cn.a.count'), s.pendingBacklog.count, (n) => setS({ ...s, pendingBacklog: { ...s.pendingBacklog, count: n } }), 'cn-a-bcount')}{field(tx('cn.a.minutes'), s.pendingBacklog.oldestMinutes, (n) => setS({ ...s, pendingBacklog: { ...s.pendingBacklog, oldestMinutes: n } }), 'cn-a-bmin')}</div>
      </div>}
    </FitDialog>
  );
}
