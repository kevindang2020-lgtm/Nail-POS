// POSCashHandoffScreen.tsx — Payments & Money → Daily Closeout / End-of-Day Cash (/cash-handoffs). End-of-Day Cash mandate
// (Oct 29 2026): ONE full-screen page at 100 % zoom — header (Record Hand-Off · Refresh · Export Report · Cash Drawer) · five
// KPIs from the server over the whole scope (Expected (Cash) · Counted · Technicians · Reconciled · Awaiting) · a difference
// strip (net · short · over · balanced · not yet counted · into the drawer) · one universal search + status / technician /
// sort · the period bar (Today by default — the old single-date workflow — This Week / Month / Year / Custom month calendar,
// with its date field) · a server-paged table, one row per technician and business day, newest first · a detail overlay
// (the eligible cash tickets, every custody event, drawer transfers, audit) · a count overlay (full count or a partial
// hand-off, optional count sheet, the version the counter saw, one idempotency key per submission, optional transfer into
// the register) · a manager's resolution overlay (the figures stay).
// What was wrong: one day only, KPIs summed in the browser, no search / paging, a count overwrote the previous one, a
// second counter could silently overwrite the first, and a read error looked like "No technician collected cash".
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { createIntentKeys } from '@aipowersalon/api-client';
import { posCashHandoffApi } from '../api/posCashHandoffApi';
import { useRealtime } from '../realtime/useRealtime';
import { fmtMoney, fmtNumber, fmtInZone, fmtYmd } from '../i18n/format';
import { codeLabel } from '../components/peopleLabels';
import { FitDialog, FitPanel, KpiCard, Pager, Empty, useFitRows, useDebounced } from '../components/FitKit';
import { PeriodBar, periodQuery, periodText, useLoad, StateBlock, isForbidden, DateField, centsFromText, textFromCents, useFreshAt, FreshnessLine, type PeriodState } from '../components/FinanceKit';

type Unit = { id: string | null; technicianId: string; technician: string | null; technicianActive: boolean; businessDate: string | null; branch: string | null; expectedCents: number; paymentCount: number;
  countedCents: number | null; differenceCents: number | null; status: string; state: string; version: number; drawerTransferCents: number; submittedAt: string | null; countedAt: string | null; resolvedAt: string | null;
  createdAt: string | null; updatedAt: string | null; countedBy: string | null; resolvedBy: string | null; notes: string | null; resolutionReason: string | null; matchedBy?: string | null;
  reopen?: { at: string | null; by: string | null; reason: string | null; count: number } | null };
type Note = { tone: 'ok' | 'bad'; text: string; view?: { techId: string; date: string } } | null;

const STATE_TONE: Record<string, string> = { balanced: 'ok', resolved: 'ok', short: 'bad', over: 'warn', open: 'warn', submitted: 'warn', cancelled: 'mut', reopened: 'warn' };
const STATUSES = ['awaiting', 'submitted', 'short', 'over', 'discrepancy', 'balanced', 'resolved', 'reconciled'];
const SORTS = ['created_desc', 'created_asc', 'date_desc', 'expected_desc', 'variance_asc', 'variance_desc', 'technician_asc'];
const BASES = ['business', 'counted', 'submitted', 'created'];
/** US currency — the salon's only currency today; the sheet is an aid, the counted total is what is saved. */
const DENOMS = [10000, 5000, 2000, 1000, 500, 200, 100, 25, 10, 5, 1];
const when = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) || '—' : '—');
const ymdText = (d?: string | null) => (d ? fmtYmd(d, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }, d) : '—');
const stateLbl = (s: string) => codeLabel('ch.state.' + s, s);
const signed = (c: number | null) => (c == null ? '—' : (c > 0 ? '+' : c < 0 ? '−' : '') + fmtMoney(Math.abs(c)));
const errMsg = (e: unknown) => (e as Error)?.message || tx('finance.state.loadFailed');
const isConflict = (e: unknown) => (e as { code?: string; status?: number })?.code === 'HANDOFF_VERSION_CONFLICT';

export function POSCashHandoffScreen() {
  const nav = useNavigate();
  const [search, setSearch] = useState(''); const q = useDebounced(search.trim(), 300);
  const [status, setStatus] = useState(''); const [tech, setTech] = useState(''); const [sort, setSort] = useState('created_desc');
  // ?date=YYYY-MM-DD (from the Cash Drawer, Nov 7 2026): open that business day — the same day the drawer shows
  const [params] = useSearchParams(); const linkedDay = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') ?? '') ? params.get('date')! : null;
  const [period, setPeriod] = useState<PeriodState>(linkedDay ? { preset: 'custom', from: linkedDay, to: linkedDay } : { preset: 'today' }); const [basis, setBasis] = useState('business');
  const [page, setPage] = useState(1); const [tick, setTick] = useState(0); const [note, setNote] = useState<Note>(null); const [exporting, setExporting] = useState(false);
  const [detail, setDetail] = useState<{ techId: string; date: string } | null>(null);
  const [counting, setCounting] = useState<{ techId?: string; date?: string } | null>(null);
  const [resolving, setResolving] = useState<Unit | null>(null); const [reopening, setReopening] = useState<Unit | null>(null); const [flash, setFlash] = useState<string | null>(null);
  const scope = { ...periodQuery(period), dateField: basis, search: q || undefined, status: status || undefined, technician: tech || undefined, sort };
  const key = JSON.stringify(scope); useEffect(() => { setPage(1); }, [key]);
  const fit = useFitRows<HTMLDivElement>(44, { min: 3, max: 18, reserve: 34 });
  const list = useLoad(() => posCashHandoffApi.list({ ...scope, page, pageSize: fit.rows }), [key, page, fit.rows, tick]);
  const sum = useLoad(() => posCashHandoffApi.summary({ ...periodQuery(period), dateField: basis, technician: tech || undefined }), [JSON.stringify(period), basis, tech, tick]);
  const techs = useLoad(() => posCashHandoffApi.technicians(), []);
  const freshAt = useFreshAt(sum.data);   // data freshness: only after a successful summary; an error is never shown as $0
  useRealtime('cash-handoffs', () => setTick((t) => t + 1));   // a technician's hand-off / another desk's count → refresh in place
  useEffect(() => { if (list.data && list.data.page !== page) setPage(list.data.page); }, [list.data]);   // eslint-disable-line react-hooks/exhaustive-deps
  const k = sum.data?.kpis; const dif = sum.data?.difference; const perms = sum.data?.permissions ?? {};
  const rows: Unit[] = list.data?.items ?? [];
  const chips = [...(q ? [{ label: tx('ch.chip.search', { q }), clear: () => setSearch('') }] : []), ...(status ? [{ label: tx('ch.filter.' + status), clear: () => setStatus('') }] : []),
    ...(tech ? [{ label: (techs.data ?? []).find((x) => x.id === tech)?.name ?? tx('ch.technician'), clear: () => setTech('') }] : [])];
  const clearAll = () => { setSearch(''); setStatus(''); setTech(''); setSort('created_desc'); setPeriod({ preset: 'today' }); setBasis('business'); };
  const doExport = async () => {
    setExporting(true);
    try { const csv = await posCashHandoffApi.exportCsv(scope); const blob = new Blob([String(csv)], { type: 'text/csv;charset=utf-8' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'end-of-day-cash.csv'; a.click(); URL.revokeObjectURL(a.href); setNote({ tone: 'ok', text: tx('finance.exported') }); }
    catch (e) { setNote({ tone: 'bad', text: errMsg(e) }); } finally { setExporting(false); }
  };
  /** after a confirmed save: KPIs + page 1 under the default order; highlight the row when it matches, else offer a way to it */
  const saved = (techId: string, date: string, text: string) => {
    setSort('created_desc'); setPage(1); setTick((t) => t + 1); setFlash(techId + date);
    const inScope = (!tech || tech === techId) && !q && !status;
    setNote({ tone: 'ok', text, ...(inScope ? {} : { view: { techId, date } }) });
  };
  useEffect(() => { if (!flash) return; const h = setTimeout(() => setFlash(null), 4000); return () => clearTimeout(h); }, [flash]);
  if (isForbidden(list.error) || isForbidden(sum.error)) return <div className="work fit ch" data-testid="cash-screen"><h1>{tx('pos.end_of_day_cash')}</h1><StateBlock error={list.error ?? sum.error} onRetry={list.reload} /></div>;
  return (
    <div className="work fit ch" data-testid="cash-screen">
      <header className="fk-head">
        <div className="vh" style={{ marginBottom: 0, minWidth: 0 }}><h1>{tx('pos.end_of_day_cash')}</h1><div className="sub">{tx('ch.subtitle')}</div></div>
        <div className="fk-head-actions">
          {perms.count ? <button type="button" className="fk-btn primary" onClick={() => setCounting({})} data-testid="record-handoff">{tx('ch.record')}</button> : null}
          <button type="button" className="fk-btn" onClick={() => setTick((t) => t + 1)} data-testid="refresh">{tx('finance.refresh')}</button>
          {perms.export ? <button type="button" className="fk-btn" onClick={doExport} disabled={exporting} data-testid="export">{exporting ? tx('pos.loading') : tx('ch.export')}</button> : null}
          <button type="button" className="fk-btn" onClick={() => nav(period.preset === 'custom' && period.from && period.from === period.to ? `/cash-drawer?date=${period.from}` : '/cash-drawer')} data-testid="open-drawer">{tx('ch.openDrawer')}</button>
        </div>
      </header>
      {note ? <div className={'fk-note ' + note.tone} role="status" data-testid="note"><span>{note.text}</span>
        {note.view ? <><button type="button" className="fk-link" onClick={() => setDetail(note.view!)}>{tx('ch.viewHandoff')}</button><button type="button" className="fk-link" onClick={clearAll}>{tx('finance.clearFilters')}</button></> : null}
        <button type="button" className="fk-x" aria-label={tx('pos.dismiss')} onClick={() => setNote(null)}>✕</button></div> : null}
      <FreshnessLine at={freshAt} error={sum.error} testId="cash-fresh" />
      <div className="fk-kpis five" data-testid="kpis">
        {sum.error ? <StateBlock error={sum.error} onRetry={sum.reload} /> : <>
          <KpiCard testId="kpi-expected" tone="gold" label={tx('ch.kpi.expected')} loading={!k} value={k ? fmtMoney(k.expectedCents) : ''} sub={k ? tx('ch.kpi.expectedSub', { n: fmtNumber(k.payments) }) : ''} />
          <KpiCard testId="kpi-counted" label={tx('ch.kpi.counted')} loading={!k} value={k ? fmtMoney(k.countedCents) : ''} sub={dif ? tx('ch.kpi.countedSub', { u: fmtMoney(dif.uncountedExpectedCents) }) : ''} />
          <KpiCard testId="kpi-technicians" label={tx('ch.kpi.technicians')} loading={!k} value={k ? fmtNumber(k.technicians) : ''} sub={k ? tx('ch.kpi.techniciansSub', { n: fmtNumber(k.units) }) : ''} />
          <KpiCard testId="kpi-reconciled" tone={k && k.reconciled > 0 ? 'ok' : undefined} label={tx('ch.kpi.reconciled')} loading={!k} value={k ? fmtNumber(k.reconciled) : ''} sub={k ? tx('ch.kpi.reconciledSub', { n: fmtNumber(k.resolved) }) : ''} onClick={() => setStatus('reconciled')} />
          <KpiCard testId="kpi-awaiting" tone={k && k.awaiting + k.underReview > 0 ? 'warn' : undefined} label={tx('ch.kpi.awaiting')} loading={!k} value={k ? fmtNumber(k.awaiting) : ''} sub={k ? tx('ch.kpi.awaitingSub', { n: fmtNumber(k.underReview) }) : ''} onClick={() => setStatus('awaiting')} />
        </>}
      </div>
      {dif ? <div className="ch-diff" data-testid="difference-strip" role="group" aria-label={tx('ch.diff.label')}>
        <span className={'ch-dif-main ' + (dif.totalCents < 0 ? 'bad' : dif.totalCents > 0 ? 'warn' : 'ok')}><b>{tx('ch.diff.net')}</b> {signed(dif.totalCents)}</span>
        <button type="button" className="ch-dif bad" onClick={() => setStatus('short')} data-testid="dif-short">{tx('ch.diff.short', { n: fmtNumber(dif.shortUnits), a: fmtMoney(Math.abs(dif.shortCents)) })}</button>
        <button type="button" className="ch-dif warn" onClick={() => setStatus('over')} data-testid="dif-over">{tx('ch.diff.over', { n: fmtNumber(dif.overUnits), a: fmtMoney(dif.overCents) })}</button>
        <button type="button" className="ch-dif ok" onClick={() => setStatus('balanced')}>{tx('ch.diff.balanced', { n: fmtNumber(dif.balancedUnits) })}</button>
        <span className="ch-dif mut">{tx('ch.diff.uncounted', { a: fmtMoney(dif.uncountedExpectedCents) })}</span>
        <span className="ch-dif mut">{tx('ch.diff.drawer', { a: fmtMoney(dif.transferredCents) })}</span>
        <span className="fk-hint ch-dif-def">{tx('ch.diff.def')}</span>
      </div> : null}
      <div className="fn-tabsrow ch-toolbar">
        <div className="fn-search ch-search"><input className="fk-search wide" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tx('ch.searchPh')} aria-label={tx('ch.searchPh')} data-testid="search" />
          {search ? <button type="button" className="fk-x" aria-label={tx('finance.clearSearch')} onClick={() => setSearch('')}>✕</button> : null}</div>
        <select className="fk-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label={tx('finance.status')} data-testid="status"><option value="">{tx('finance.allStatuses')}</option>{STATUSES.map((s) => <option key={s} value={s}>{tx('ch.filter.' + s)}</option>)}</select>
        <select className="fk-select" value={tech} onChange={(e) => setTech(e.target.value)} aria-label={tx('ch.technician')} data-testid="technician"><option value="">{tx('ch.allTechnicians')}</option>{(techs.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}{x.active ? '' : ' · ' + tx('ch.inactive')}</option>)}</select>
        <select className="fk-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label={tx('finance.sort')} data-testid="sort">{SORTS.map((s) => <option key={s} value={s}>{tx('ch.sort.' + s)}</option>)}</select>
      </div>
      <div className="fn-tabsrow ch-periodrow">
        <PeriodBar value={period} onChange={setPeriod} server={list.data?.period} allowAll compact basis={basis} basisOptions={BASES.map((b) => ({ value: b, label: tx('ch.basis.' + b) }))} onBasis={setBasis} />
        {chips.length ? <span className="fn-chips" data-testid="chips">{chips.map((c) => <span key={c.label} className="fk-chip mut">{c.label}<button type="button" className="fk-chip-x" aria-label={tx('finance.removeFilter', { f: c.label })} onClick={c.clear}>✕</button></span>)}
          <button type="button" className="fk-link" onClick={clearAll} data-testid="clear-all">{tx('finance.clearFilters')}</button></span> : null}
      </div>
      <FitPanel testId="handoffs" bodyRef={fit.ref} className="fn-records" title={<span className="fn-chips">{tx('pos.technician_cash_hand_offs')}{list.data ? <span className="fk-muted"> · {fmtNumber(list.data.total)}</span> : null}<span className="fk-hint">{tx('ch.unitNote')}</span></span>}
        footer={<Pager info={list.data ? { page: list.data.page, pageSize: list.data.pageSize, totalItems: list.data.total, totalPages: list.data.pageCount } : null} onPage={setPage} label={tx('pos.technician_cash_hand_offs')} />}>
        {list.error ? <StateBlock error={list.error} onRetry={list.reload} /> : !list.data ? <div className="fk-loading">{tx('pos.loading')}</div>
          : rows.length === 0 ? (chips.length ? <Empty title={tx('ch.noMatches')}><button type="button" className="fk-btn" onClick={() => setSearch('')}>{tx('finance.clearSearch')}</button><button type="button" className="fk-btn" onClick={clearAll}>{tx('finance.clearFilters')}</button></Empty>
              : <Empty title={tx('ch.empty')}><span className="fk-hint">{tx('ch.emptyHint', { p: periodText(list.data.period) })}</span>
                <button type="button" className="fk-btn" onClick={() => setPeriod({ preset: 'week' })}>{tx('ch.changeRange')}</button><button type="button" className="fk-btn" onClick={() => setTick((t) => t + 1)}>{tx('finance.refresh')}</button></Empty>)
          : <table className="fk-table fn-table ch-table" data-testid="handoffs-table">
            <thead><tr><th>{tx('ch.col.date')}</th><th>{tx('ch.col.technician')}</th><th className="num">{tx('ch.col.expected')}</th><th className="num">{tx('ch.col.counted')}</th><th className="num">{tx('ch.col.difference')}</th><th>{tx('finance.status')}</th><th className="t-opt">{tx('ch.col.countedBy')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
            <tbody>{rows.map((r) => {
              const counted = r.countedCents != null; const review = r.status === 'discrepancy';
              return (
                <tr key={r.technicianId + r.businessDate} data-testid="handoff-row" className={flash === r.technicianId + r.businessDate ? 'ch-flash' : ''}>
                  <td>{ymdText(r.businessDate)}</td>
                  <td className="fn-id"><button type="button" className="fk-li-t link" onClick={() => setDetail({ techId: r.technicianId, date: r.businessDate! })}>{r.technician ?? tx('ch.unknownTech')}</button>
                    <span className="fk-li-s">{tx('ch.cashTickets', { n: fmtNumber(r.paymentCount) })}{r.branch ? ' · ' + r.branch : ''}{r.technicianActive ? '' : ' · ' + tx('ch.inactive')}{r.matchedBy && q ? ` · ${tx('ch.matched.' + r.matchedBy)}` : ''}</span></td>
                  <td className="num"><b>{fmtMoney(r.expectedCents)}</b></td>
                  <td className="num">{counted ? fmtMoney(r.countedCents) : <span className="fk-muted">{tx('ch.notCounted')}</span>}</td>
                  <td className={'num ch-d ' + (r.differenceCents == null ? '' : r.differenceCents < 0 ? 'bad' : r.differenceCents > 0 ? 'warn' : 'ok')}>{signed(r.differenceCents)}</td>
                  <td><span className={'fk-chip ' + (STATE_TONE[r.state] ?? 'mut')}>{stateLbl(r.state)}</span></td>
                  <td className="t-opt">{r.countedBy ?? '—'}<span className="fk-li-s">{when(r.resolvedAt ?? r.countedAt ?? r.submittedAt)}</span></td>
                  <td className="fn-acts">
                    {perms.reopen && r.status === 'reconciled' ? <button type="button" className="fk-btn sm" onClick={() => setReopening(r)} data-testid="reopen">{tx('ch.reopen')}</button> : null}
                    {perms.count && r.status !== 'cancelled' && r.status !== 'reconciled' ? <button type="button" className="fk-btn sm" onClick={() => setCounting({ techId: r.technicianId, date: r.businessDate! })} data-testid="count">{counted ? tx('ch.recount') : tx('ch.count')}</button>
                      : perms.count ? <button type="button" className="fk-btn sm" disabled title={tx(r.status === 'cancelled' ? 'ch.why.cancelled' : 'ch.why.closed')} aria-label={tx(r.status === 'cancelled' ? 'ch.why.cancelled' : 'ch.why.closed')} data-testid="count-blocked">{tx('ch.count')}</button> : null}
                    {perms.resolve && review ? <button type="button" className="fk-btn sm" onClick={() => setResolving(r)} data-testid="review">{tx('finance.review')}</button> : null}
                    <button type="button" className="fk-btn ghost sm" onClick={() => setDetail({ techId: r.technicianId, date: r.businessDate! })}>{tx('finance.view')}</button>
                  </td>
                </tr>
              );
            })}</tbody>
          </table>}
      </FitPanel>
      {detail ? <UnitDialog techId={detail.techId} date={detail.date} tick={tick} perms={perms} onClose={() => setDetail(null)} onCount={() => { setCounting({ techId: detail.techId, date: detail.date }); }}
        onResolve={(u) => setResolving(u)} onReopen={(u) => setReopening(u)} onTicket={(n) => nav(`/tenant/payments/transactions?search=${encodeURIComponent(n)}`)} onCustomer={(cid) => nav(`/tenant/customers/profiles?customerId=${encodeURIComponent(cid)}`)} /> : null}
      {counting ? <CountDialog techId={counting.techId} date={counting.date} today={list.data?.period?.today ?? sum.data?.period?.today} technicians={techs.data ?? []} onClose={() => setCounting(null)}
        onSaved={(techId, date, text) => { setCounting(null); saved(techId, date, text); }} /> : null}
      {resolving ? <ResolveDialog unit={resolving} onClose={() => setResolving(null)} onSaved={(text) => { const u = resolving; setResolving(null); saved(u.technicianId, u.businessDate!, text); }} /> : null}
      {reopening ? <ReopenDialog unit={reopening} onClose={() => setReopening(null)} onSaved={(text) => { const u = reopening; setReopening(null); saved(u.technicianId, u.businessDate!, text); }} /> : null}
    </div>
  );
}

function UnitDialog({ techId, date, tick, perms, onClose, onCount, onResolve, onReopen, onTicket, onCustomer }: { techId: string; date: string; tick: number; perms: Record<string, boolean>; onClose: () => void; onCount: () => void; onResolve: (u: Unit) => void; onReopen: (u: Unit) => void; onTicket: (n: string) => void; onCustomer: (id: string) => void }) {
  const d = useLoad(() => posCashHandoffApi.unit(techId, date), [techId, date, tick]);
  const u: Unit | undefined = d.data?.unit;
  return (
    <FitDialog wide title={u ? `${u.technician ?? tx('ch.unknownTech')} · ${ymdText(u.businessDate)}` : tx('ch.detailTitle')} subtitle={u ? tx('ch.detailSub', { n: fmtNumber(u.paymentCount) }) : undefined} onClose={onClose} testId="unit-dialog"
      footer={u ? <>
        {perms.resolve && u.status === 'discrepancy' ? <button type="button" className="fk-btn" onClick={() => onResolve(u)}>{tx('ch.resolve')}</button> : null}
        {perms.reopen && u.status === 'reconciled' ? <button type="button" className="fk-btn" onClick={() => onReopen(u)} data-testid="unit-reopen">{tx('ch.reopen')}</button> : null}
        {perms.count && u.status !== 'cancelled' && u.status !== 'reconciled' ? <button type="button" className="fk-btn" onClick={onCount}>{u.countedCents != null ? tx('ch.recount') : tx('ch.count')}</button>
          : perms.count ? <><button type="button" className="fk-btn" disabled data-testid="unit-count-blocked">{tx('ch.count')}</button><span className="fk-hint" data-testid="unit-count-why">{tx(u.status === 'cancelled' ? 'ch.why.cancelled' : 'ch.why.closed')}</span></> : null}
        <button type="button" className="fk-btn primary" onClick={onClose}>{tx('pos.close')}</button></> : undefined}>
      {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !u ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
        <div className="fn-statusline"><span className={'fk-chip ' + (STATE_TONE[u.state] ?? 'mut')}>{stateLbl(u.state)}</span><span className="fk-hint">{tx('ch.stateNote.' + u.state)}</span></div>
        <dl className="ch-figures" data-testid="unit-figures">
          <div><dt>{tx('ch.col.expected')}</dt><dd>{fmtMoney(u.expectedCents)}</dd></div>
          <div><dt>{tx('ch.col.counted')}</dt><dd>{u.countedCents != null ? fmtMoney(u.countedCents) : tx('ch.notCounted')}</dd></div>
          <div className={u.differenceCents == null ? '' : u.differenceCents < 0 ? 'bad' : u.differenceCents > 0 ? 'warn' : 'ok'}><dt>{tx('ch.col.difference')}</dt><dd>{signed(u.differenceCents)}</dd></div>
          <div><dt>{tx('ch.f.drawer')}</dt><dd>{fmtMoney(u.drawerTransferCents)}</dd></div>
        </dl>
        {u.reopen ? <div className="fk-note warn" data-testid="reopened-note"><span>{tx('ch.reopenedBy', { who: u.reopen.by ?? '—', at: when(u.reopen.at), n: fmtNumber(u.reopen.count) })} — {u.reopen.reason ?? '—'}</span></div> : null}
        {u.resolutionReason ? <div className="fk-note ok" data-testid="resolution"><span>{tx('ch.resolvedBy', { who: u.resolvedBy ?? '—', at: when(u.resolvedAt) })} — {u.resolutionReason}</span></div> : null}
        <h3 className="fk-h3">{tx('ch.linesTitle')}</h3>
        {d.data.lines.length === 0 ? <div className="fk-hint">{tx('ch.noLines')}</div> :
          <table className="fk-table" data-testid="lines-table"><thead><tr><th>{tx('ch.l.ticket')}</th><th>{tx('ch.l.customer')}</th><th className="num">{tx('ch.l.cash')}</th><th className="num">{tx('ch.l.ticketTotal')}</th><th>{tx('ch.l.confirmed')}</th></tr></thead>
            <tbody>{d.data.lines.map((l: any) => <tr key={l.id}><td>{l.ticketNumber ? <button type="button" className="fk-li-t link" onClick={() => onTicket(l.ticketNumber)}>#{l.ticketNumber}</button> : '—'}{l.tenders > 0 ? <span className="fk-li-s">{tx('ch.l.split', { n: fmtNumber(l.tenders) })}</span> : null}</td>
              <td>{l.customer ? (perms.customer && l.customer.id ? <button type="button" className="fk-li-t link" onClick={() => onCustomer(l.customer.id)}>{l.customer.name ?? '—'}</button> : (l.customer.name ?? '—')) : <span className="fk-muted">{tx('ch.walkIn')}</span>}{l.customer?.phone ? <span className="fk-li-s">{l.customer.phone}</span> : null}</td>
              <td className="num"><b>{fmtMoney(l.amountCents)}</b></td><td className="num">{fmtMoney(l.ticketTotalCents)}</td><td>{when(l.confirmedAt)}{l.confirmedBy ? <span className="fk-li-s">{l.confirmedBy}</span> : null}</td></tr>)}</tbody></table>}
        <div className="fk-hint">{tx('ch.splitNote')}</div>
        <h3 className="fk-h3">{tx('ch.eventsTitle')}</h3>
        {d.data.events.length === 0 ? <div className="fk-hint">{tx('ch.noEvents')}</div> :
          <ul className="fn-notes" data-testid="events">{d.data.events.map((e: any) => <li key={e.id}><span className="fk-li-s">{when(e.at)} · {e.actor ?? '—'}</span>
            <div><b>{codeLabel('ch.event.' + e.type, e.type)}</b>{e.amountCents != null ? ' ' + fmtMoney(e.amountCents) : ''}{e.countedTotalCents != null && e.type !== 'drawer_transfer' ? ' · ' + tx('ch.ev.total', { t: fmtMoney(e.countedTotalCents), d: signed(e.varianceCents) }) : ''}{e.reason ? ` — ${e.reason}` : ''}</div>
            {e.denominations?.length ? <div className="fk-li-s">{e.denominations.map((x: any) => `${fmtMoney(x.denominationCents)} × ${x.quantity}`).join(' · ')}</div> : null}</li>)}</ul>}
        {d.data.drawerMovements.length ? <><h3 className="fk-h3">{tx('ch.drawerTitle')}</h3><ul className="fn-notes">{d.data.drawerMovements.map((m: any) => <li key={m.id}><span className="fk-li-s">{when(m.at)} · {m.register}</span><div>{tx('ch.drawerIn', { a: fmtMoney(m.amountCents) })}{m.voided ? ' · ' + tx('ch.voided') : ''}</div></li>)}</ul></> : null}
        {d.data.audit?.length ? <><h3 className="fk-h3">{tx('ch.auditTitle')}</h3><ul className="fn-notes">{d.data.audit.slice(0, 8).map((a: any, i: number) => <li key={i}><span className="fk-li-s">{when(a.at)} · {a.actor ?? '—'}</span><div>{codeLabel('ch.audit.' + a.action, a.action)}</div></li>)}</ul></> : null}
        {/* extras End-of-Day Cash 02: the shift that day and this technician's earlier hand-offs (server rows; read only) */}
        {Array.isArray(d.data.shifts) ? <><h3 className="fk-h3">{tx('ch.shiftsTitle')}</h3>{d.data.shifts.length ? <ul className="fn-notes" data-testid="unit-shifts">{d.data.shifts.map((x: any) => <li key={x.id}>{when(x.start)} – {x.end ? when(x.end) : tx('ch.shiftOpen')} <span className="fk-li-s">{codeLabel('ch.shift.' + x.status, x.status)}</span></li>)}</ul>
          : <div className="fk-hint" data-testid="unit-no-shift">{tx('ch.noShift')}</div>}</> : null}
        {Array.isArray(d.data.priorHandoffs) ? <><h3 className="fk-h3">{tx('ch.priorTitle')}</h3>{d.data.priorHandoffs.length ? <table className="fk-table" data-testid="unit-prior"><thead><tr><th>{tx('ch.col.date')}</th><th className="num">{tx('ch.col.expected')}</th><th className="num">{tx('ch.col.counted')}</th><th className="num">{tx('ch.col.difference')}</th><th>{tx('pos.status')}</th></tr></thead>
          <tbody>{d.data.priorHandoffs.map((p: any) => <tr key={p.businessDate} data-testid="unit-prior-row"><td>{ymdText(p.businessDate)}</td><td className="num">{fmtMoney(p.expectedCents)}</td><td className="num">{p.countedCents != null ? fmtMoney(p.countedCents) : tx('ch.notCounted')}</td>
            <td className={'num ' + (p.differenceCents == null ? '' : p.differenceCents < 0 ? 'bad' : p.differenceCents > 0 ? 'warn' : 'ok')}>{signed(p.differenceCents)}</td><td><span className={'fk-chip ' + (STATE_TONE[p.state] ?? 'mut')}>{stateLbl(p.state)}</span></td></tr>)}</tbody></table>
          : <div className="fk-hint" data-testid="unit-no-prior">{tx('ch.noPrior')}</div>}</> : null}
        <div className="fk-hint">{tx('ch.custodyNote')}</div>
      </>}
    </FitDialog>
  );
}

/** Count a technician's cash: whole count or a partial hand-off, optional count sheet, the version seen, one key per submission. */
function CountDialog({ techId, date, today, technicians, onClose, onSaved }: { techId?: string; date?: string; today?: string; technicians: { id: string; name: string; active: boolean }[]; onClose: () => void; onSaved: (techId: string, date: string, text: string) => void }) {
  const [who, setWho] = useState(techId ?? ''); const [day, setDay] = useState(date ?? today ?? '');
  const ready = !!who && !!day;
  const u = useLoad(() => (ready ? posCashHandoffApi.unit(who, day) : Promise.resolve(null)), [who, day]);
  const unit: Unit | null = u.data?.unit ?? null; const noCash = !!u.error && (u.error as { status?: number }).status === 404;
  const [mode, setMode] = useState<'replace' | 'add'>('replace'); const [amount, setAmount] = useState(''); const [useSheet, setUseSheet] = useState(false);
  const [qty, setQty] = useState<Record<number, string>>({}); const [notes, setNotes] = useState(''); const [toDrawer, setToDrawer] = useState(false);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null); const [conflict, setConflict] = useState(false);
  const keys = useRef(createIntentKeys());
  const sheetCents = useMemo(() => DENOMS.reduce((a, d) => a + d * (Math.max(0, Math.floor(Number(qty[d] || 0))) || 0), 0), [qty]);
  const cents = useSheet ? sheetCents : centsFromText(amount);
  const prior = unit?.countedCents ?? 0;
  const total = cents == null ? null : mode === 'add' ? prior + cents : cents;
  const estimate = total == null || !unit ? null : total - unit.expectedCents;
  const needsNote = estimate != null && estimate !== 0 && !notes.trim();
  // extras End-of-Day Cash 08 (round 10): a closed hand-off (reconciled / cancelled) is never counted here — it must be reopened
  // first — and the save button always says WHY it is not available (the same conditions that disable it)
  const closed = !!unit && (unit.status === 'reconciled' || unit.status === 'cancelled');
  const valid = !!unit && !closed && cents != null && cents >= 0 && (mode === 'replace' || cents > 0) && !needsNote;
  const why = busy ? 'saving' : !unit ? null : closed ? (unit.status === 'cancelled' ? 'cancelled' : 'closed') : cents == null ? 'amount' : cents < 0 ? 'amount' : mode === 'add' && cents <= 0 ? 'addPositive' : needsNote ? 'note' : null;
  const submit = async () => {
    if (!unit || cents == null) return;
    const body = { countedCents: cents, mode, date: day, notes: notes.trim() || undefined, denominations: useSheet ? DENOMS.filter((d) => Number(qty[d] || 0) > 0).map((d) => ({ denominationCents: d, quantity: Math.floor(Number(qty[d])) })) : null,
      expectedVersion: unit.version, transferToDrawer: toDrawer || undefined };
    const intent = `count:${who}:${day}`;
    setBusy(true); setErr(null); setConflict(false);
    try {
      const r = await posCashHandoffApi.reconcile(who, { ...body, idempotencyKey: keys.current.keyFor(intent, body) });
      keys.current.done(intent);
      const v = r.result.varianceCents;
      onSaved(who, day, v === 0 ? tx('ch.saved.balanced', { who: r.technicianName || '—', a: fmtMoney(r.countedCents ?? 0) }) : tx(v < 0 ? 'ch.saved.short' : 'ch.saved.over', { who: r.technicianName || '—', a: fmtMoney(Math.abs(v)) }));
    } catch (e) { if (isConflict(e)) { setConflict(true); u.reload(); } setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <FitDialog wide title={unit ? tx('ch.countTitle', { who: unit.technician ?? '—' }) : tx('ch.record')} subtitle={unit ? ymdText(unit.businessDate) : tx('ch.recordSub')} onClose={onClose} busy={busy} testId="count-dialog"
      footer={<><button type="button" className="fk-btn" onClick={onClose} disabled={busy}>{tx('pos.cancel')}</button>
        {why ? <span className="fk-hint" data-testid="save-why">{tx('ch.why.' + why)}</span> : null}
        <button type="button" className="fk-btn primary" onClick={submit} disabled={!valid || busy} title={why ? tx('ch.why.' + why) : undefined} data-testid="save-count">{busy ? tx('pos.saving_2') : mode === 'add' ? tx('ch.saveAdd') : tx('ch.saveCount')}</button></>}>
      {!techId ? <div className="ch-pick">
        <label className="fk-field"><span>{tx('ch.technician')}</span><select className="fk-select" value={who} onChange={(e) => setWho(e.target.value)} data-testid="pick-tech"><option value="">{tx('ch.chooseTech')}</option>{technicians.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <DateField label={tx('ch.col.date')} value={day} onChange={setDay} today={today ?? day} max={today} testId="pick-date" required />
      </div> : null}
      {!ready ? <div className="fk-hint">{tx('ch.pickFirst')}</div> : noCash ? <Empty title={tx('ch.noCashThatDay')}><span className="fk-hint">{tx('ch.noCashHint')}</span></Empty>
        : u.error ? <StateBlock error={u.error} onRetry={u.reload} /> : !unit ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
        <dl className="ch-figures" data-testid="count-figures">
          <div><dt>{tx('ch.col.expected')}</dt><dd>{fmtMoney(unit.expectedCents)}</dd></div>
          <div><dt>{tx('ch.f.accepted')}</dt><dd>{unit.countedCents != null ? fmtMoney(unit.countedCents) : tx('ch.notCounted')}</dd></div>
          <div className={estimate == null ? '' : estimate < 0 ? 'bad' : estimate > 0 ? 'warn' : 'ok'} data-testid="estimate"><dt>{tx('ch.f.estimate')}</dt><dd>{signed(estimate)}</dd></div>
        </dl>
        <div className="fk-seg ch-mode" role="radiogroup" aria-label={tx('ch.mode')}>
          <button type="button" role="radio" aria-checked={mode === 'replace'} className={mode === 'replace' ? 'on' : ''} onClick={() => setMode('replace')} data-testid="mode-replace">{unit.countedCents != null ? tx('ch.mode.recount') : tx('ch.mode.full')}</button>
          <button type="button" role="radio" aria-checked={mode === 'add'} className={mode === 'add' ? 'on' : ''} onClick={() => setMode('add')} data-testid="mode-add">{tx('ch.mode.add')}</button>
        </div>
        <div className="fk-hint">{tx(mode === 'add' ? 'ch.mode.addHint' : 'ch.mode.fullHint', { a: fmtMoney(prior) })}</div>
        <label className="ch-sheet-tog"><input type="checkbox" checked={useSheet} onChange={(e) => setUseSheet(e.target.checked)} data-testid="use-sheet" /> {tx('ch.useSheet')}</label>
        {useSheet ? <div className="ch-sheet" data-testid="sheet">{DENOMS.map((d) => <label key={d} className="ch-den"><span>{fmtMoney(d)}</span><input type="number" min="0" step="1" inputMode="numeric" value={qty[d] ?? ''} onChange={(e) => setQty((m) => ({ ...m, [d]: e.target.value }))} aria-label={tx('ch.qtyOf', { d: fmtMoney(d) })} /><span className="fk-li-s">{fmtMoney(d * (Math.floor(Number(qty[d] || 0)) || 0))}</span></label>)}
          <div className="ch-sheet-total"><b>{tx('ch.sheetTotal')}</b> {fmtMoney(sheetCents)}</div></div>
          : <label className="fk-field"><span>{mode === 'add' ? tx('ch.amountAdd') : tx('ch.amountCounted')}</span><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={textFromCents(unit.expectedCents)} data-testid="amount" autoFocus /></label>}
        <label className="fk-field"><span>{needsNote || (estimate != null && estimate !== 0) ? tx('ch.reasonRequired') : tx('pos.note_optional')}</span><textarea rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={tx('pos.e_g_drawer_short_on_count')} data-testid="notes" /></label>
        <label className="ch-sheet-tog"><input type="checkbox" checked={toDrawer} onChange={(e) => setToDrawer(e.target.checked)} data-testid="to-drawer" /> {tx('ch.toDrawer')}</label>
        <div className="fk-hint">{tx('ch.estimateNote')}</div>
        {conflict ? <div className="fk-note bad" role="alert" data-testid="conflict"><span>{tx('ch.conflict', { a: unit.countedCents != null ? fmtMoney(unit.countedCents) : tx('ch.notCounted') })}</span></div> : null}
        {err && !conflict ? <div className="fk-error" role="alert">{err}</div> : null}
      </>}
    </FitDialog>
  );
}

function ResolveDialog({ unit, onClose, onSaved }: { unit: Unit; onClose: () => void; onSaved: (text: string) => void }) {
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const keys = useRef(createIntentKeys());
  const submit = async () => {
    const body = { reason: reason.trim(), date: unit.businessDate!, expectedVersion: unit.version }; const intent = `resolve:${unit.technicianId}:${unit.businessDate}`;
    setBusy(true); setErr(null);
    try { await posCashHandoffApi.resolve(unit.technicianId, body, keys.current.keyFor(intent, body)); keys.current.done(intent); onSaved(tx('ch.saved.resolved', { who: unit.technician ?? '—' })); }
    catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <FitDialog title={tx('ch.resolveTitle', { who: unit.technician ?? '—' })} subtitle={ymdText(unit.businessDate)} onClose={onClose} busy={busy} testId="resolve-dialog"
      footer={<><button type="button" className="fk-btn" onClick={onClose} disabled={busy}>{tx('pos.cancel')}</button><button type="button" className="fk-btn primary" onClick={submit} disabled={busy || !reason.trim()} data-testid="save-resolve">{busy ? tx('pos.saving_2') : tx('ch.resolve')}</button></>}>
      <dl className="ch-figures">
        <div><dt>{tx('ch.col.expected')}</dt><dd>{fmtMoney(unit.expectedCents)}</dd></div>
        <div><dt>{tx('ch.col.counted')}</dt><dd>{unit.countedCents != null ? fmtMoney(unit.countedCents) : '—'}</dd></div>
        <div className={(unit.differenceCents ?? 0) < 0 ? 'bad' : 'warn'}><dt>{tx('ch.col.difference')}</dt><dd>{signed(unit.differenceCents)}</dd></div>
      </dl>
      <label className="fk-field"><span>{tx('ch.resolveReason')}</span><textarea rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="resolve-reason" autoFocus /></label>
      <div className="fk-hint">{tx('ch.resolveNote')}</div>
      {err ? <div className="fk-error" role="alert">{err}</div> : null}
    </FitDialog>
  );
}

/** End-of-Day Cash 17 (Kevin, Nov 12 2026): reopen a CLOSED count — owner / manager, a reason (10+ characters); the figures
 *  stay in its history and it must be counted again, which recomputes the expected cash from the payments. */
function ReopenDialog({ unit, onClose, onSaved }: { unit: Unit; onClose: () => void; onSaved: (text: string) => void }) {
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const keys = useRef(createIntentKeys());
  const ok = reason.trim().length >= 10;
  const submit = async () => {
    const body = { reason: reason.trim(), date: unit.businessDate!, expectedVersion: unit.version }; const intent = `reopen:${unit.technicianId}:${unit.businessDate}`;
    setBusy(true); setErr(null);
    try { await posCashHandoffApi.reopen(unit.technicianId, body, keys.current.keyFor(intent, body)); keys.current.done(intent); onSaved(tx('ch.saved.reopened', { who: unit.technician ?? '—' })); }
    catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <FitDialog title={tx('ch.reopenTitle', { who: unit.technician ?? '—' })} subtitle={ymdText(unit.businessDate)} onClose={onClose} busy={busy} testId="reopen-dialog"
      footer={<><button type="button" className="fk-btn" onClick={onClose} disabled={busy}>{tx('pos.cancel')}</button><button type="button" className="fk-btn primary" onClick={submit} disabled={busy || !ok} data-testid="save-reopen">{busy ? tx('pos.saving_2') : tx('ch.reopen')}</button></>}>
      <dl className="ch-figures">
        <div><dt>{tx('ch.col.expected')}</dt><dd>{fmtMoney(unit.expectedCents)}</dd></div>
        <div><dt>{tx('ch.col.counted')}</dt><dd>{unit.countedCents != null ? fmtMoney(unit.countedCents) : '—'}</dd></div>
        <div><dt>{tx('ch.col.difference')}</dt><dd>{signed(unit.differenceCents)}</dd></div>
      </dl>
      <label className="fk-field"><span>{tx('ch.reopenReason')}</span><textarea rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="reopen-reason" autoFocus /></label>
      <div className="fk-hint">{tx('ch.reopenNote')}</div>
      {err ? <div className="fk-error" role="alert">{err}</div> : null}
    </FitDialog>
  );
}

