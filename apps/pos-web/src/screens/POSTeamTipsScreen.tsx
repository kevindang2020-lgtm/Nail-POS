// POSTeamTipsScreen.tsx — Team → Tips (/tenant/team/tips). Team Tips spec (Nov 13 2026, SUNMI FLEX 3 27" 1920×1080).
// Reads the ONE canonical tip read model that Payments → Tips & Gratuity uses (/pos/payments/tips*, posTipsScreenApi) — no
// second tip source, no client-side money math. The old page read /pos/reports/tips, whose cards (each ticket's tip on a
// "carrier" payment row) and technician list (the payroll snapshot of every ticket with any in-period row) came from two
// different populations: the photo's $0.00 cards beside "Vishal verma $9.60" (fixed in the Reports adapter; pinned by
// modules/reports/src/reports/team-tips-discrepancy.pgtest). Here the cards, the leaderboard and the reconciliation are
// computed by the server over the same tickets, so they cannot disagree; anything not yet allocated is shown as such.
// Layout: header · period (Today / This Week / This Month / This Year + Custom From–To month calendars) · four equal KPI cards
// (2×2 narrower) · scoped search + Method / Status filters · Tips by Technician (highest total first) beside Collected vs
// Allocated vs Payable vs Paid · tip transactions newest first with numbered server pages (10 / 25 / 50 / 100). A technician
// row opens a READ-ONLY detail overlay; the Tip accuracy check is read-only. Nothing on this page moves money: a correction
// stays on Payments → Tips (tips.adjust, reasoned, audited). Tips are 100 % the technicians' — no 60/40 on tips.
import './teamTips.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import type { TipsAccuracyResponse, TipsTechnicianEarningsResponse } from '@aipowersalon/api-contracts/tenant';
import { posTipsScreenApi as api } from '../api/posTipsScreenApi';
import { fmtMoney, fmtNumber, fmtInZone } from '../i18n/format';
import { FitDialog, Pager, Empty, useDebounced, type PageInfo } from '../components/FitKit';
import { PeriodBar, periodQuery, periodText, useLoad, StateBlock, isForbidden, type PeriodState, type ServerPeriod } from '../components/FinanceKit';
import { useSessionState } from '../components/useSessionState';
import { useRealtime } from '../realtime/useRealtime';
import { useCan } from '../components/usePermissions';

type TechRef = { id: string; name: string | null };
type TipRow = { ticketId: string; ticketNumber: string | null; collectedAt: string | null; customer: { id: string; name: string | null; phone: string | null } | null; technicians: TechRef[]; method: string;
  amountCents: number; allocatedCents: number; unallocatedCents: number; allocationState: string; reversedCents: number; payout: { state: string; periodLabel: string | null } };
type LeaderRow = { technicianId: string; name: string | null; tickets: number; allocatedCents: number; paidOutCents: number; pendingCents: number };
type Paged<T> = { items: T[]; total: number; page: number; pageSize: number; pageCount: number };
type Summary = {
  kpis: { totalTipsCents: number; cardTipsCents: number; cashTipsCents: number; cashToTechnicianTipsCents?: number; cashDrawerTipsCents?: number; avgTipRatePct: number | null; avgTipPerTippedTicketCents: number | null; tippedTickets: number };
  reconciliation: { collectedCents: number; allocatedCents: number; unallocatedCents: number; reversedCents: number; paidOutCents: number; pendingPayoutCents: number; payableCents?: number; accruedCents?: number; balanced: boolean };
  period: ServerPeriod; permissions?: { customer?: boolean };
};
type Filters = { period: PeriodState; method: string; status: string; pageSize: number; branchId?: string };

const PAGE_SIZES = [10, 25, 50, 100];
const STATUSES = ['tipped', 'unallocated', 'partial', 'mismatch', 'reversed', 'paid_out', 'pending_payout'];
const ALLOC_TONE: Record<string, string> = { allocated: 'ok', partial: 'warn', unallocated: 'warn', over: 'bad', none: 'mut' };
const PAYOUT_TONE: Record<string, string> = { paid: 'ok', approved: 'info', open: 'warn', none: 'mut' };
const STATUS_ICON: Record<string, string> = { ok: '✓', warn: '!', fail: '✕' };
const when = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) || '—' : '—');
const pageInfo = (d: Paged<unknown> | null | undefined): PageInfo | null => (d ? { page: d.page, pageSize: d.pageSize, totalItems: d.total, totalPages: d.pageCount } : null);
const pct = (n: number | null | undefined) => (n == null ? '—' : `${fmtNumber(n, 1)}%`);
const techNames = (r: TipRow) => (r.technicians.length ? r.technicians.map((t) => t.name ?? '—').join(', ') : tx('tp.noTechnician'));
const DEFAULT_FILTERS: Filters = { period: { preset: 'month' }, method: '', status: '', pageSize: 25, branchId: '' };
/** the CSV is built by the server from the same scope as the page (period, location, search, method, status) — every matching row */
export function downloadCsv(csv: string, name: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' }); const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href);
}

export function POSTeamTipsScreen() {
  // period / method / status / page size survive leaving and coming back (this tab); the search text is never stored
  const [filters, setFilters] = useSessionState<Filters>('aps.teamTips.filters', DEFAULT_FILTERS);
  const { period, method, status } = filters; const branchId = filters.branchId ?? ''; const pageSize = PAGE_SIZES.includes(filters.pageSize) ? filters.pageSize : 25;
  const [search, setSearch] = useState(''); const q = useDebounced(search.trim(), 300);
  const [page, setPage] = useState(1); const [leaderPage, setLeaderPage] = useState(1);
  const [tick, setTick] = useState(0);
  const [techOpen, setTechOpen] = useState<TechRef | null>(null); const [accOpen, setAccOpen] = useState(false);
  const [fresh, setFresh] = useState(false);   // a newer tip arrived while the user reads page 2+
  const pq = JSON.stringify([period, branchId]);   // the period AND the location scope the cards, leaderboard and lists
  const scope = useMemo(() => ({ ...periodQuery(period), dateField: 'collected', ...(branchId ? { branchId } : {}) }), [pq]);   // eslint-disable-line react-hooks/exhaustive-deps
  const can = useCan(); const canExport = can('pos.reports.export');
  const branches = useLoad(() => api.branches(), []);
  const [exporting, setExporting] = useState(false); const [exportNote, setExportNote] = useState<{ ok: boolean; text: string } | null>(null);
  const listQ = { ...scope, search: q || undefined, method: method || undefined, status: status || undefined, sort: 'collected_desc' };
  // a materially changed scope (period, search, method, status, page size) starts again on page 1
  const scopeKey = JSON.stringify([scope, q, method, status, pageSize]);
  const lastScope = useRef(scopeKey);
  useEffect(() => { if (lastScope.current !== scopeKey) { lastScope.current = scopeKey; setPage(1); setFresh(false); } }, [scopeKey]);
  useEffect(() => { setLeaderPage(1); }, [pq]);

  const sum = useLoad(() => api.summary(scope) as Promise<Summary>, [pq, tick]);
  const leaders = useLoad(() => api.distribution({ ...scope, page: leaderPage, pageSize: 10, sort: 'allocated_desc' }) as Promise<Paged<LeaderRow>>, [pq, leaderPage, tick]);
  const hist = useLoad(() => api.transactions({ ...listQ, page, pageSize }) as Promise<Paged<TipRow>>, [scopeKey, page, tick]);   // scopeKey carries every field of listQ
  const newestSeen = useRef<string | null>(null);
  useEffect(() => { if (page === 1 && hist.data?.items[0]) newestSeen.current = hist.data.items[0].ticketId; }, [page, hist.data]);

  // live: a new verified tip refreshes the cards / leaderboard in place; page 1 of the history reloads, page 2+ only says
  // "New tip activity" (rows never jump under the reader). Server-paced (the shared SSE + safety sync), never a refresh storm.
  const pageRef = useRef(page); pageRef.current = page;
  const listQRef = useRef(listQ); listQRef.current = listQ;
  const onLive = useCallback(async () => {
    if (pageRef.current === 1) { setTick((t) => t + 1); return; }
    sum.reload(); leaders.reload();
    const head = await (api.transactions({ ...listQRef.current, page: 1, pageSize: 1 }) as Promise<Paged<TipRow>>).catch(() => null);
    if (head?.items[0] && newestSeen.current && head.items[0].ticketId !== newestSeen.current) setFresh(true);
  }, [sum, leaders]);
  useRealtime('checkout', onLive, { intervalMs: 60_000 });

  const k = sum.data?.kpis; const rec = sum.data?.reconciliation; const server = sum.data?.period ?? null;
  const canCustomer = !!sum.data?.permissions?.customer;
  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));
  const reset = () => { setSearch(''); setFilters(DEFAULT_FILTERS); };
  const loadingAll = sum.loading && !sum.data;
  const doExport = async () => {
    setExporting(true); setExportNote(null);
    try { downloadCsv(String(await api.exportCsv(listQ)), 'team-tips.csv'); setExportNote({ ok: true, text: tx('tp.team.exported') }); }
    catch (e: any) { setExportNote({ ok: false, text: e?.message || tx('tp.team.exportFailed') }); }
    finally { setExporting(false); }
  };

  if (isForbidden(sum.error)) return <div className="work ttp" data-testid="team-tips"><h1>{tx('pos.team_tips')}</h1><StateBlock error={sum.error} onRetry={sum.reload} /></div>;
  return (
    <div className="work ttp" data-testid="team-tips">
      <div className="ttp-body">
      <header className="ttp-head">
        <div className="ttp-title"><h1>{tx('pos.team_tips')}</h1><div className="sub">{tx('tp.team.subtitle')}</div></div>
        <div className="ttp-actions">
          <button type="button" className="fk-btn" onClick={() => setTick((t) => t + 1)} data-testid="tt-refresh">{tx('finance.refresh')}</button>
          <button type="button" className="fk-btn" onClick={() => setAccOpen(true)} data-testid="tt-accuracy-open">{tx('tp.team.acc.open')}</button>
          {canExport ? <button type="button" className="fk-btn" onClick={() => { void doExport(); }} disabled={exporting} data-testid="tt-export">{tx(exporting ? 'tp.team.exporting' : 'tp.team.export')}</button> : null}
          {exportNote ? <span role="status" className="ttp-note" data-tone={exportNote.ok ? 'ok' : 'bad'} data-testid="tt-export-note">{exportNote.text}</span> : null}
        </div>
      </header>

      <div className="ttp-period">
        <PeriodBar value={period} onChange={(p) => set({ period: p })} server={server} basisOptions={[{ value: 'collected', label: tx('tp.basis.collected') }]} />
        {/* the time basis: tips count on the day the payment was taken (the salon's day), not allocation / payout day */}
        <div className="sub" data-testid="tips-basis">{tx('tips.basis')}</div>
      </div>

      <section className="ttp-kpis" aria-label={tx('pos.team_tips')}>
        {sum.error && !sum.data ? <StateBlock error={sum.error} onRetry={sum.reload} /> : (
          <>
            <Kpi testId="tt-kpi-total" label={tx('tp.kpi.total')} def={tx('tp.team.def.total')} loading={loadingAll} gold
              value={k ? fmtMoney(k.totalTipsCents) : '—'} sub={k ? tx('tp.team.totalSub', { n: fmtNumber(k.tippedTickets) }) : ''} />
            <Kpi testId="tt-kpi-card" label={tx('tp.kpi.card')} def={tx('tp.team.def.card')} loading={loadingAll} value={k ? fmtMoney(k.cardTipsCents) : '—'} sub={tx('tp.team.cardSub')} />
            <Kpi testId="tt-kpi-cash" label={tx('tp.kpi.cash')} def={tx('tp.team.def.cash')} loading={loadingAll} value={k ? fmtMoney(k.cashTipsCents) : '—'}
              sub={k && k.cashDrawerTipsCents != null ? tx('tp.team.cashSub', { d: fmtMoney(k.cashDrawerTipsCents), t: fmtMoney(k.cashToTechnicianTipsCents ?? 0) }) : ''} />
            <Kpi testId="tt-kpi-avg" label={tx('tp.team.avgLabel')} def={tx('tp.team.def.avg')} loading={loadingAll}
              value={k?.avgTipPerTippedTicketCents != null ? fmtMoney(k.avgTipPerTippedTicketCents) : '—'}
              sub={k ? (k.avgTipPerTippedTicketCents != null ? tx('tp.team.avgSub', { r: pct(k.avgTipRatePct) }) : tx('tp.team.avgNone')) : ''} />
          </>
        )}
      </section>

      <div className="ttp-filters" role="search" aria-label={tx('tp.team.filtersLabel')}>
        <div className="ttp-search">
          <input className="fk-search" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tx(canCustomer ? 'tp.team.searchPhCustomer' : 'tp.team.searchPh')}
            aria-label={tx(canCustomer ? 'tp.team.searchPhCustomer' : 'tp.team.searchPh')} data-testid="tips-search" />
          {search ? <button type="button" className="fk-x" aria-label={tx('finance.clearSearch')} onClick={() => setSearch('')} data-testid="tt-search-clear">✕</button> : null}
        </div>
        {(branches.data?.length ?? 0) > 1 ? (
          <select className="fk-select" value={branchId} onChange={(e) => set({ branchId: e.target.value })} aria-label={tx('tp.team.branchLabel')} data-testid="tt-branch">
            <option value="">{tx('tp.team.allBranches')}</option>{branches.data!.map((b) => <option key={b.id} value={b.id}>{b.name || '—'}</option>)}
          </select>
        ) : null}
        <select className="fk-select" value={method} onChange={(e) => set({ method: e.target.value })} aria-label={tx('tp.methodLabel')} data-testid="tt-method">
          <option value="">{tx('tp.allMethods')}</option>{['card', 'cash', 'split'].map((m) => <option key={m} value={m}>{tx('tp.method.' + m)}</option>)}
        </select>
        <select className="fk-select" value={status} onChange={(e) => set({ status: e.target.value })} aria-label={tx('finance.status')} data-testid="tt-status">
          <option value="">{tx('finance.allStatuses')}</option>{STATUSES.map((s) => <option key={s} value={s}>{tx('tp.status.' + s)}</option>)}
        </select>
        <button type="button" className="fk-btn ghost" onClick={reset} data-testid="tt-reset">{tx('tp.team.reset')}</button>
        <span className="ttp-count" aria-live="polite" data-testid="tt-count">{hist.data ? tx('tp.team.results', { n: fmtNumber(hist.data.total) }) : ''}</span>
        <span className="ttp-active" data-testid="tt-active-period">{periodText(server)}</span>
      </div>

      <div className="ttp-row">
        <section className="fk-panel ttp-panel" data-testid="tt-leaderboard">
          <div className="fk-panel-head"><h2>{tx('tp.team.leaderboard')}</h2><span className="ttp-hint">{tx('tp.team.leaderboardHint')}</span></div>
          <div className="ttp-panel-body">
            {leaders.error && !leaders.data ? <StateBlock error={leaders.error} onRetry={leaders.reload} />
              : !leaders.data ? <div className="state">{tx('pos.loading_team_tips')}</div>
              : leaders.data.items.length === 0 ? <div data-testid="tips-empty"><Empty title={tx('pos.no_tips_recorded_in_this_period')} /></div>
              : <LeaderTable rows={leaders.data.items} onOpen={(r) => setTechOpen({ id: r.technicianId, name: r.name })} />}
            {rec && rec.unallocatedCents > 0 ? <div className="ttp-unalloc" data-testid="tt-unallocated"><span>{tx('tp.team.unallocatedRow')}</span><b>{fmtMoney(rec.unallocatedCents)}</b></div> : null}
          </div>
          {leaders.data && leaders.data.pageCount > 1 ? <div className="fk-panel-foot"><Pager compact info={pageInfo(leaders.data)} onPage={setLeaderPage} /></div> : null}
        </section>

        <section className="fk-panel ttp-panel" data-testid="tt-recon">
          <div className="fk-panel-head"><h2>{tx('tp.team.recon')}</h2></div>
          <div className="ttp-panel-body">
            {sum.error && !sum.data ? <StateBlock error={sum.error} onRetry={sum.reload} /> : !rec ? <div className="state">{tx('pos.loading')}</div> : (
              <>
                <dl className="ttp-recon">
                  <div><dt>{tx('tp.recon.collected')}</dt><dd data-testid="tt-rec-collected">{fmtMoney(rec.collectedCents)}</dd></div>
                  <div><dt>{tx('tp.recon.allocated')}</dt><dd data-testid="tt-rec-allocated">{fmtMoney(rec.allocatedCents)}</dd></div>
                  <div><dt>{tx('tp.recon.unallocated')}</dt><dd data-testid="tt-rec-unallocated">{fmtMoney(rec.unallocatedCents)}</dd></div>
                  <div><dt>{tx('tp.team.payable')}</dt><dd data-testid="tt-rec-payable">{rec.payableCents == null ? '—' : fmtMoney(rec.payableCents)}</dd></div>
                  <div><dt>{tx('tp.team.paid')}</dt><dd data-testid="tt-rec-paid">{fmtMoney(rec.paidOutCents)}</dd></div>
                  <div><dt>{tx('tp.team.accrued')}</dt><dd data-testid="tt-rec-accrued">{rec.accruedCents == null ? '—' : fmtMoney(rec.accruedCents)}</dd></div>
                  <div><dt>{tx('tp.recon.reversed')}</dt><dd>{fmtMoney(rec.reversedCents)}</dd></div>
                </dl>
                <div className={'ttp-balance ' + (rec.balanced ? 'ok' : 'bad')} data-testid="tt-balanced"><span aria-hidden>{rec.balanced ? '✓' : '!'}</span> {tx(rec.balanced ? 'tp.team.balanced' : 'tp.team.unbalanced')}</div>
                <p className="ttp-rule">{tx('tp.team.techRule')}</p>
              </>
            )}
          </div>
        </section>
      </div>

      <section className="fk-panel ttp-history" data-testid="tt-history">
        <div className="fk-panel-head"><h2>{tx('tp.team.history')}</h2>
          <label className="ttp-size"><span>{tx('tp.team.pageSize')}</span>
            <select className="fk-select" value={pageSize} onChange={(e) => set({ pageSize: Number(e.target.value) })} data-testid="tt-page-size">{PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}</select>
          </label>
        </div>
        {fresh && page > 1 ? <button type="button" className="ttp-fresh" onClick={() => { setFresh(false); setPage(1); }} data-testid="tt-new-activity">{tx('tp.team.newActivity')}</button> : null}
        <div className="ttp-table-wrap">
          {hist.error && !hist.data ? <StateBlock error={hist.error} onRetry={hist.reload} />
            : !hist.data ? <div className="state">{tx('pos.loading')}</div>
            : hist.data.items.length === 0 ? <Empty title={q || method || status ? tx('tp.noMatches') : tx('tp.team.noTips')}>{tx('tp.team.noTipsHint')}</Empty>
            : (
              <table className="fk-table ttp-table">
                <thead><tr><th scope="col">#</th><th scope="col">{tx('tp.col.collected')}</th><th scope="col">{tx('tp.col.ticket')}</th><th scope="col">{tx('tp.col.technicians')}</th>
                  {canCustomer ? <th scope="col">{tx('tp.col.customer')}</th> : null}<th scope="col">{tx('tp.col.method')}</th><th scope="col" className="num">{tx('tp.col.amount')}</th>
                  <th scope="col">{tx('tp.col.allocation')}</th><th scope="col">{tx('tp.col.payout')}</th></tr></thead>
                <tbody>{hist.data.items.map((r, i) => (
                  <tr key={r.ticketId} data-testid="tt-row">
                    <td className="ttp-n">{fmtNumber((hist.data!.page - 1) * hist.data!.pageSize + i + 1)}</td>
                    <td>{when(r.collectedAt)}</td>
                    <td>{r.ticketNumber ? '#' + r.ticketNumber : '—'}</td>
                    <td title={techNames(r)}>{techNames(r)}</td>
                    {canCustomer ? <td>{r.customer?.name ?? '—'}</td> : null}
                    <td>{tx('tp.method.' + r.method)}</td>
                    <td className="num"><b>{fmtMoney(r.amountCents)}</b>{r.reversedCents ? <span className="ttp-s"> {tx('tp.reversed')} {fmtMoney(r.reversedCents)}</span> : null}</td>
                    <td><span className={'fk-chip ' + (ALLOC_TONE[r.allocationState] ?? 'mut')}>{tx('tp.alloc.' + r.allocationState)}</span></td>
                    <td><span className={'fk-chip ' + (PAYOUT_TONE[r.payout.state] ?? 'mut')}>{tx('tp.payout.' + r.payout.state)}</span></td>
                  </tr>
                ))}</tbody>
              </table>
            )}
        </div>
        {hist.data ? <div className="fk-panel-foot"><Pager info={pageInfo(hist.data)} onPage={setPage} /></div> : null}
      </section>
      </div>

      {techOpen ? <TechnicianOverlay tech={techOpen} scope={scope} onClose={() => setTechOpen(null)} /> : null}
      {accOpen ? <AccuracyOverlay scope={scope} onClose={() => setAccOpen(false)} onShow={(ticketId) => { setAccOpen(false); setSearch(ticketId); }} /> : null}
    </div>
  );
}

function Kpi({ label, value, sub, def, loading, gold, testId }: { label: string; value: string; sub: string; def: string; loading: boolean; gold?: boolean; testId: string }) {
  return (
    <div className={'ttp-kpi' + (gold ? ' gold' : '')} data-testid={testId} title={def}>
      <div className="ttp-kpi-l">{label}</div>
      <div className="ttp-kpi-v">{loading ? <span className="fk-skel" aria-hidden /> : value}</div>
      <div className="ttp-kpi-s">{sub}</div>
      <div className="ttp-kpi-d">{def}</div>
    </div>
  );
}

function LeaderTable({ rows, onOpen }: { rows: LeaderRow[]; onOpen: (r: LeaderRow) => void }) {
  const max = Math.max(1, ...rows.map((r) => r.allocatedCents));
  return (
    <table className="fk-table ttp-leaders">
      <thead><tr><th scope="col">{tx('pos.technician')}</th><th scope="col" className="num">{tx('pos.tips')}</th><th scope="col" className="ttp-barcol"><span className="sr-only">{tx('tp.d.share')}</span></th></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.technicianId} className="ttp-click" tabIndex={0} role="button" aria-label={`${r.name ?? tx('pos.unknown')}: ${fmtMoney(r.allocatedCents)}`}
          onClick={() => onOpen(r)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(r); } }} data-testid="tt-leader">
          <td>{r.name || <span className="ttp-s">{tx('pos.unknown')}</span>}<span className="ttp-s"> · {tx('tp.ticketsN', { n: fmtNumber(r.tickets) })}</span></td>
          <td className="num"><b>{fmtMoney(r.allocatedCents)}</b></td>
          <td className="ttp-barcol"><div className="ttp-bar"><div style={{ width: `${Math.round((r.allocatedCents / max) * 100)}%` }} /></div></td>
        </tr>
      ))}</tbody>
    </table>
  );
}

/** Read-only technician detail: this technician's share per ticket, method, allocation basis and payroll state. */
function TechnicianOverlay({ tech, scope, onClose }: { tech: TechRef; scope: Record<string, unknown>; onClose: () => void }) {
  const [page, setPage] = useState(1);
  const d = useLoad(() => api.technicianEarnings(tech.id, { ...scope, page, pageSize: 10 }), [tech.id, JSON.stringify(scope), page]);
  const e: TipsTechnicianEarningsResponse | null = d.data;
  const accrued = e ? e.totals.openCents + e.totals.unscheduledCents : 0;
  return (
    <FitDialog wide title={tx('tp.earn.title', { n: e?.technician.name ?? tech.name ?? tx('pos.technician') })} subtitle={e ? `${periodText(e.period as ServerPeriod)} · ${tx('tp.earn.sub', { t: fmtNumber(e.totals.tickets) })}` : undefined} onClose={onClose} testId="tt-tech-overlay"
      footer={<button type="button" className="fk-btn" onClick={onClose}>{tx('pos.close')}</button>}>
      {d.error && !e ? <StateBlock error={d.error} onRetry={d.reload} /> : !e ? <div className="state">{tx('pos.loading')}</div> : (
        <div className="ttp-ov">
          <div className="ttp-ov-totals" data-testid="tt-ov-totals">{tx('tp.team.overlayTotals', { a: fmtMoney(e.totals.allocatedCents), p: fmtMoney(e.totals.paidCents), y: fmtMoney(e.totals.approvedCents), o: fmtMoney(accrued) })}
            {e.totals.manualCorrectionCents || e.totals.reversedCents ? <span> · {tx('tp.d.corrections')} {fmtMoney(e.totals.manualCorrectionCents + e.totals.reversedCents)} · {tx('tp.earn.net')} {fmtMoney(e.totals.netCents)}</span> : null}</div>
          <p className="ttp-s" data-testid="tt-ov-readonly">{tx('tp.team.readOnly')}</p>
          {e.items.length === 0 ? <Empty title={tx('tp.team.noTips')} /> : (
            <table className="fk-table ttp-table" data-testid="tt-ov-tickets">
              <thead><tr><th scope="col">{tx('tp.earn.ticket')}</th><th scope="col">{tx('tp.earn.when')}</th><th scope="col">{tx('tp.team.col.method')}</th><th scope="col" className="num">{tx('tp.team.col.ticketTip')}</th>
                <th scope="col" className="num">{tx('tp.earn.share')}</th><th scope="col">{tx('tp.team.col.basis')}</th><th scope="col">{tx('finance.status')}</th><th scope="col">{tx('tp.earn.period')}</th></tr></thead>
              <tbody>{e.items.map((it) => (
                <tr key={it.ticketId} data-testid="tt-ov-row">
                  <td>{it.ticketNumber ? '#' + it.ticketNumber : '—'}</td><td>{when(it.collectedAt)}</td>
                  <td>{it.method ? tx('tp.method.' + it.method) : '—'}</td>
                  <td className="num">{fmtMoney(it.ticketTipCents)}</td>
                  <td className="num"><b>{fmtMoney(it.allocatedCents)}</b>{it.sharedWith ? <span className="ttp-s"> {tx('tp.earn.ofShared', { a: fmtMoney(it.ticketTipCents), n: fmtNumber(it.sharedWith) })}</span> : null}</td>
                  <td>{it.allocationBasis ? tx('tp.team.basis.' + it.allocationBasis) : '—'}{it.corrected ? <span className="ttp-s"> · {tx('tp.team.corrected')}</span> : null}</td>
                  <td><span className={'fk-chip ' + (PAYOUT_TONE[it.payoutState] ?? 'mut')}>{tx('tp.earn.state.' + it.payoutState)}</span></td>
                  <td>{it.period?.label ?? '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
          <Pager info={pageInfo(e)} onPage={setPage} />
        </div>
      )}
    </FitDialog>
  );
}

/** The One-Click Tip Accuracy check — read-only findings over the same scope as the cards. */
function AccuracyOverlay({ scope, onClose, onShow }: { scope: Record<string, unknown>; onClose: () => void; onShow: (ticketId: string) => void }) {
  const d = useLoad(() => api.accuracy(scope), [JSON.stringify(scope)]);
  const a: TipsAccuracyResponse | null = d.data;
  return (
    <FitDialog wide title={tx('tp.team.acc.title')} subtitle={a ? periodText(a.period as ServerPeriod) : undefined} onClose={onClose} testId="tt-accuracy"
      footer={<button type="button" className="fk-btn" onClick={onClose}>{tx('pos.close')}</button>}>
      {d.error && !a ? <StateBlock error={d.error} onRetry={d.reload} /> : !a ? <div className="state">{tx('pos.loading')}</div> : (
        <div className="ttp-ov">
          <p className="ttp-s" data-testid="tt-acc-readonly">{tx('tp.team.acc.readOnly')}</p>
          <div className={'ttp-balance ' + (a.overall === 'ok' ? 'ok' : a.overall === 'warn' ? 'warn' : 'bad')} data-testid="tt-acc-overall"><span aria-hidden>{STATUS_ICON[a.overall]}</span> {tx('tp.team.acc.overall', { s: tx('tp.team.acc.s.' + a.overall) })}</div>
          <div className="ttp-s">{tx('tp.team.acc.totals', { c: fmtMoney(a.totals.collectedCents), a: fmtMoney(a.totals.allocatedCents), u: fmtMoney(a.totals.unallocatedCents), t: fmtMoney(a.totals.technicianSumCents) })}</div>
          <ul className="ttp-checks">{a.checks.map((c) => (
            <li key={c.key} className={'ttp-check ' + c.status} data-testid={'tt-acc-' + c.key}>
              <span className="ttp-check-i" aria-hidden>{STATUS_ICON[c.status]}</span>
              <span className="ttp-check-t">{tx('tp.team.acc.k.' + c.key)}</span>
              <span className="ttp-check-s">{tx('tp.team.acc.s.' + c.status)}</span>
              <span className="ttp-check-n">{tx('tp.team.acc.count', { n: fmtNumber(c.count) })}{c.cents ? ` · ${fmtMoney(c.cents)}` : ''}</span>
              {c.samples[0] ? <button type="button" className="fk-link" onClick={() => onShow(c.samples[0])}>{tx('tp.team.acc.show')}</button> : <span />}
            </li>
          ))}</ul>
        </div>
      )}
    </FitDialog>
  );
}
