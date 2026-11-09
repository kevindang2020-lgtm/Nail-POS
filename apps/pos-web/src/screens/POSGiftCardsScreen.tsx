// POSGiftCardsScreen.tsx — Customers → Gift Cards (/tenant/customers/gift-cards). Gift Cards mandate (Oct 29 2026): ONE
// full-screen page at 100 % zoom —
//   header (Check Balance · + Issue Gift Card) · five KPIs from the server over EVERY card (Outstanding Liability and Active
//   Cards as of now · Total Issued and Redeemed Value (net of refunds) for the period · Total Cards all time) · status tabs
//   All / Active / Redeemed / Void · one universal search (card ref / last 4, purchaser or recipient name, phone, email) ·
//   role, sort, more filters, the date-field period bar with chips and Clear All · a server-paged table (newest issued first).
// What was wrong: the page printed raw redeemable codes, counted KPIs from the first 200 rows in the browser, filtered on
// the client only and had no issue / reload / void / ledger. Identifiers are masked everywhere; an exact code is only
// answered by the protected, rate-limited Check Balance. Issue and Reload are payment-first: they open a ticket that
// Checkout pays; the card holds value only after the payment. Void is a manager's reasoned, step-up, ledgered action.
import { authApi } from '../api/authApi';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { posGiftCardsApi, type GiftCardLiabilityReport } from '../api/posGiftCardsApi';
import { posCheckoutApi } from '../api/posCheckoutApi';
import { posCustomersApi } from '../api/posCustomersApi';
import { posSettingsApi } from '../api/posSettingsApi';
import { money } from './reportsCommon';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { codeLabel } from '../components/peopleLabels';   // (full key, code) → label, humanised when the key is missing
import { fmtInZone, fmtMoney, fmtNumber } from '../i18n/format';
import { FitDialog, FitPanel, KpiCard, Pager, Empty, useFitRows, useDebounced, requestId } from '../components/FitKit';
import { PeriodBar, periodQuery, periodText, useLoad, StateBlock, isForbidden, centsFromText, textFromCents, type PeriodState } from '../components/FinanceKit';
import { useStepUp, isStepUpCancelled } from './access/accessUi';

// Functional Decision 31 — gift-card value is the salon's liability; each branch recognizes what it sells and redeems.
// Clearing is per card: when Branch B redeems a card Branch A sold, A holds the payment for B's work, so A owes B. Value
// still on cards is the salon's liability to card holders, not something one branch owes another.
// Reports permission: anyone without it simply doesn't see this panel (the card list above stays available).
export function GiftCardBranchLiability() {
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [r, setR] = useState<GiftCardLiabilityReport | null>(null);
  const [hidden, setHidden] = useState(false); const [error, setError] = useState<string | null>(null);
  const load = async (f?: string, t?: string) => {
    setError(null);
    try { const d = await posGiftCardsApi.liability(f, t); setR(d); if (!from) setFrom(d.from); if (!to) setTo(d.to); }
    catch (e: any) { if (e?.status === 403) setHidden(true); else setError(e?.message || tx('pos.could_not_load_branch_liability')); }
  };
  useEffect(() => { void load(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  if (hidden) return null;
  const clearing = (c: number) => c > 0 ? tx('pos.is_owed_c', { c: String(money(c)) }) : c < 0 ? tx('pos.owes_v0', { v0: String(money(-c)) }) : tx('admin.giftCards.even');   // net = owed − owes
  return (
    <section className="panel" style={{ marginBottom: 14 }} aria-label={tx('pos.branch_gift_card_liability')}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'end', marginBottom: 8 }}>
        <div><h3 style={{ margin: 0 }}>{tx('pos.branch_liability_clearing')}</h3><div className="s muted">{tx('pos.when_a_branch_redeems_a_card_gpu8')}</div></div>
        <label className="s" style={{ marginLeft: 'auto' }}>{tx('pos.from')}{' '}<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="s">{tx('pos.to_2')}{' '}<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <button className="btn ghost" onClick={() => load(from, to)}>{tx('pos.update')}</button>
      </div>
      {error ? <div className="err">{error}</div> : null}
      {r ? (
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th>{tx('pos.branch')}</th><th style={{ textAlign: 'right' }}>{tx('pos.sold')}</th><th style={{ textAlign: 'right' }}>{tx('pos.redeemed')}</th><th style={{ textAlign: 'right' }}>{tx('pos.adjustments')}</th><th style={{ textAlign: 'right' }}>{tx('pos.inter_branch_clearing')}</th></tr></thead>
            <tbody>
              {r.branches.length === 0 ? <tr><td colSpan={5} className="muted">{tx('pos.no_gift_card_activity_in_this_dcys')}</td></tr> : r.branches.map((b) => (
                <tr key={b.branchId ?? 'none'}>
                  <td>{b.branchName}</td>
                  <td style={{ textAlign: 'right' }}>{money(b.soldCents)}</td>
                  <td style={{ textAlign: 'right' }}>{money(b.redeemedCents)}</td>
                  <td style={{ textAlign: 'right' }}>{b.adjustedCents ? money(b.adjustedCents) : '—'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{b.branchId === null ? '—' : clearing(b.netClearingCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {r.transfers?.length ? (
            <div style={{ marginTop: 8 }}>
              <div className="s" style={{ fontWeight: 700 }}>{tx('pos.settle_up_for_this_period')}</div>
              <ul className="s" style={{ margin: '4px 0 0 18px' }}>{r.transfers.map((t) => <li key={t.fromBranchId + t.toBranchId}>{t.fromBranchName} {tx('pos.pays')}{' '}{t.toBranchName} {money(t.amountCents)}</li>)}</ul>
            </div>
          ) : null}
          {r.unclearableRedeemedCents ? <div className="s muted" style={{ marginTop: 4 }}>{money(r.unclearableRedeemedCents)} {tx('pos.redeemed_on_cards_whose_selling_branch_110z')}</div> : null}
          <div className="s" style={{ marginTop: 6 }}>{tx('pos.salon_wide_gift_card_liability_today')}{' '}<b>{money(r.outstandingLiabilityCents)}</b></div>
        </div>
      ) : null}
    </section>
  );
}

/** Gift Cards SUNMI guide (Nov 9 2026) zone C: the Branch Liability & Clearing context ON the page — each branch's net position
 *  for the default period, from the same report as the full table (which opens with its From / To / Update). An internal
 *  obligation, never a bank movement. No reports permission → nothing (the full panel hides itself the same way). */
function GiftCardClearingStrip({ onOpen, tick }: { onOpen: () => void; tick: number }) {
  const [r, setR] = useState<GiftCardLiabilityReport | null>(null); const [hidden, setHidden] = useState(false); const [err, setErr] = useState(false);
  useEffect(() => { setErr(false); posGiftCardsApi.liability().then(setR).catch((e: any) => { if (e?.status === 403) setHidden(true); else setErr(true); }); }, [tick]);
  if (hidden) return null;
  const owed = (c: number) => c > 0 ? tx('pos.is_owed_c', { c: String(money(c)) }) : c < 0 ? tx('pos.owes_v0', { v0: String(money(-c)) }) : tx('admin.giftCards.even');
  const rows = (r?.branches ?? []).filter((b) => b.branchId !== null);
  return (
    <div className="gc-clearing" data-testid="gc-clearing" data-module-id="gc-clearing">
      <b>{tx('pos.branch_liability_clearing')}</b>
      {err ? <span className="fk-muted">{tx('pos.could_not_load_branch_liability')}</span>
        : !r ? <span className="fk-muted">{tx('pos.loading')}</span>
        : rows.length === 0 ? <span className="fk-muted">{tx('pos.no_gift_card_activity_in_this_dcys')}</span>
        : rows.slice(0, 4).map((b) => <span key={b.branchId} className="gc-clr-item">{b.branchName}: <b>{owed(b.netClearingCents)}</b></span>)}
      {r ? <span className="fk-muted">{r.from} → {r.to}</span> : null}
      <button type="button" className="fk-link" onClick={onOpen} data-testid="gc-clearing-open">{tx('gc.clearingOpen')}</button>
    </div>
  );
}

type Person = { id?: string; customerId?: string | null; name: string | null; phone: string | null; email: string | null };
type Card = { id: string; card: string; reference: string | null; status: string; spendable: boolean; originalCents: number; balanceCents: number; issuedAt: string | null; createdAt: string | null;
  lastActivityAt: string | null; lastRedeemedAt: string | null; expiresAt: string | null; purchaser: Person | null; recipient: Person | null; delivery: 'digital' | 'physical'; hasPin: boolean; branch: string | null;
  saleTicketId: string | null; matchedBy?: string | null };
type Group = '' | 'active' | 'redeemed' | 'pending' | 'frozen' | 'void';   // Gift Cards guide (Nov 4 2026): Pending (unpaid sales) and Frozen tabs
type Note = { tone: 'ok' | 'bad'; text: string; actions?: { label: string; run: () => void }[] } | null;
type Dlg = null | { kind: 'detail'; id: string } | { kind: 'issue' } | { kind: 'balance' } | { kind: 'liability' };
type More = { delivery: string; balanceMin: string; balanceMax: string; denomination: string };

const NO_MORE: More = { delivery: '', balanceMin: '', balanceMax: '', denomination: '' };
const STATUS_TONE: Record<string, string> = { active: 'ok', partially_redeemed: 'ok', redeemed: 'mut', pending_payment: 'warn', frozen: 'warn', suspended: 'warn', void: 'bad', canceled: 'bad', refunded: 'mut', expired: 'mut', replaced: 'mut', lost_stolen: 'bad' };
const day = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', year: 'numeric' }) || '—' : '—');
const when = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) || '—' : '—');
const statusLbl = (s: string) => codeLabel('gc.status.' + s, s);
/** a ticket number without the '#' some writers prefix (the label adds its own) */
const tno = (n: unknown) => String(n ?? '').replace(/^#/, '');
const errMsg = (e: unknown) => (e as Error)?.message || tx('finance.state.loadFailed');
const SORTS = ['issued_desc', 'issued_asc', 'activity_desc', 'balance_desc', 'balance_asc', 'name_asc', 'status'];
const BASES = ['issued', 'redemption', 'created', 'activity', 'expiration'];

export function POSGiftCardsScreen() {
  const nav = useNavigate();
  const [group, setGroup] = useState<Group>('');
  const [search, setSearch] = useState(''); const q = useDebounced(search.trim(), 300);
  const [role, setRole] = useState(''); const [sort, setSort] = useState('issued_desc');
  const [period, setPeriod] = useState<PeriodState>({ preset: 'all' as PeriodState['preset'] }); const [basis, setBasis] = useState('issued');
  const [more, setMore] = useState<More>(NO_MORE); const [moreOpen, setMoreOpen] = useState(false);
  const [page, setPage] = useState(1); const [tick, setTick] = useState(0);
  const [note, setNote] = useState<Note>(null); const [dlg, setDlg] = useState<Dlg>(null); const [highlight, setHighlight] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [branchId, setBranchId] = useState('');
  const branches = useLoad(() => authApi.branches().then((r) => (r.branches ?? []).filter((b) => b.isActive)), []);
  const centsOf = (s: string) => (s.trim() ? centsFromText(s) : null);
  const scope = { ...periodQuery(period), dateField: basis, search: q || undefined, status: group || undefined, role: role || undefined, sort, branchId: branchId || undefined,
    delivery: more.delivery || undefined, balanceMin: centsOf(more.balanceMin) ?? undefined, balanceMax: centsOf(more.balanceMax) ?? undefined, denomination: centsOf(more.denomination) ?? undefined };
  const key = JSON.stringify(scope); useEffect(() => setPage(1), [key]);
  const fit = useFitRows<HTMLDivElement>(42, { min: 3, max: 18, reserve: 34 });
  const list = useLoad(() => posGiftCardsApi.list({ ...scope, page, pageSize: fit.rows }), [key, page, fit.rows, tick]);
  const sum = useLoad(() => posGiftCardsApi.summary({ ...periodQuery(period), dateField: basis }), [JSON.stringify(period), basis, tick]);
  useEffect(() => { if (list.data && list.data.page !== page) setPage(list.data.page); }, [list.data]);   // eslint-disable-line react-hooks/exhaustive-deps
  const k = sum.data?.kpis; const perm = sum.data?.permissions ?? {};
  const rows: Card[] = list.data?.items ?? [];
  const chips: { label: string; clear: () => void }[] = [
    ...(q ? [{ label: tx('gc.chip.search', { q }), clear: () => setSearch('') }] : []),
    ...(group ? [{ label: tx('gc.tab.' + group), clear: () => setGroup('') }] : []),
    ...(branchId ? [{ label: branches.data?.find((b) => b.id === branchId)?.name ?? tx('gc.branchLabel'), clear: () => setBranchId('') }] : []),
    ...(role ? [{ label: tx('gc.role.' + role), clear: () => setRole('') }] : []),
    ...(period.preset !== 'all' ? [{ label: tx('gc.chip.date', { basis: tx('gc.basis.' + basis), p: periodText(list.data?.period) }), clear: () => setPeriod({ preset: 'all' as PeriodState['preset'] }) }] : []),
    ...(more.delivery ? [{ label: tx('gc.delivery.' + more.delivery), clear: () => setMore({ ...more, delivery: '' }) }] : []),
    ...(more.balanceMin || more.balanceMax ? [{ label: tx('gc.chip.balance', { a: more.balanceMin || '0', b: more.balanceMax || '∞' }), clear: () => setMore({ ...more, balanceMin: '', balanceMax: '' }) }] : []),
    ...(more.denomination ? [{ label: tx('gc.chip.denomination', { a: more.denomination }), clear: () => setMore({ ...more, denomination: '' }) }] : []),
  ];
  const clearAll = () => { setSearch(''); setGroup(''); setBranchId(''); setRole(''); setPeriod({ preset: 'all' as PeriodState['preset'] }); setMore(NO_MORE); setSort('issued_desc'); };
  const forbidden = isForbidden(list.error) || isForbidden(sum.error);
  const doExport = async () => {
    setExporting(true);
    try { const csv = await posGiftCardsApi.exportCsv(scope); const blob = new Blob([String(csv)], { type: 'text/csv;charset=utf-8' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'gift-cards.csv'; a.click(); URL.revokeObjectURL(a.href); setNote({ tone: 'ok', text: tx('finance.exported') }); }
    catch (e) { setNote({ tone: 'bad', text: errMsg(e) }); }
    finally { setExporting(false); }
  };
  const issued = (r: { cardId: string; ticketId: string; reference: string; filtersHide: boolean }) => {
    setDlg(null); setTick((t) => t + 1);
    if (r.filtersHide) setNote({ tone: 'ok', text: tx('gc.issuedHidden', { ref: r.reference }), actions: [{ label: tx('gc.viewCard'), run: () => setDlg({ kind: 'detail', id: r.cardId }) }, { label: tx('finance.clearFilters'), run: clearAll }] });
    else { setPage(1); setHighlight(r.cardId); setTimeout(() => setHighlight(null), 5000); }
    nav(`/checkout?ticket=${encodeURIComponent(r.ticketId)}`);
  };
  if (forbidden) return <div className="work fit gc" data-testid="gift-cards-screen"><h1>{tx('pos.gift_cards')}</h1><StateBlock error={list.error ?? sum.error} onRetry={list.reload} /></div>;

  return (
    <div className="work fit gc" data-testid="gift-cards-screen">
      <header className="fk-head">
        <div className="vh" style={{ marginBottom: 0, minWidth: 0 }}><h1>{tx('pos.gift_cards')}</h1><div className="sub">{tx('gc.subtitle')}</div></div>
        <div className="fk-head-actions">
          <button type="button" className="fk-btn" onClick={() => setTick((t) => t + 1)}>{tx('finance.refresh')}</button>
          <button type="button" className="fk-btn" onClick={() => setDlg({ kind: 'liability' })} data-testid="open-liability">{tx('gc.branchLiability')}</button>
          {perm.export ? <button type="button" className="fk-btn" onClick={doExport} disabled={exporting} data-testid="export">{exporting ? tx('pos.loading') : tx('finance.exportCsv')}</button> : null}
          {perm.balance ? <button type="button" className="fk-btn" onClick={() => setDlg({ kind: 'balance' })} data-testid="check-balance">{tx('gc.checkBalance')}</button> : null}
          {perm.issue ? <button type="button" className="fk-btn primary" onClick={() => setDlg({ kind: 'issue' })} data-testid="issue">+ {tx('gc.issue')}</button> : null}
        </div>
      </header>
      {note ? <div className={'fk-note ' + note.tone} role="status" data-testid="note"><span>{note.text}</span><span className="fn-note-acts">{note.actions?.map((a) => <button key={a.label} type="button" className="fk-link" onClick={() => { a.run(); setNote(null); }}>{a.label}</button>)}<button type="button" className="fk-x" aria-label={tx('pos.dismiss')} onClick={() => setNote(null)}>✕</button></span></div> : null}

      <div className="fk-kpis five" data-testid="kpis">
        {sum.error ? <StateBlock error={sum.error} onRetry={sum.reload} /> : <>
          <KpiCard testId="kpi-liability" tone="gold" label={tx('gc.kpi.liability')} loading={!k} value={k ? fmtMoney(k.outstandingLiabilityCents) : ''} sub={tx('gc.kpi.liabilitySub')} onClick={() => setGroup('active')} />
          <KpiCard testId="kpi-active" label={tx('gc.kpi.active')} loading={!k} value={k ? fmtNumber(k.activeCards) : ''} sub={tx('gc.kpi.activeSub')} onClick={() => setGroup('active')} />
          <KpiCard testId="kpi-issued" label={tx('gc.kpi.issued')} loading={!k} value={k ? fmtMoney(k.totalIssuedCents) : ''} sub={k ? tx('gc.kpi.issuedSub', { n: fmtNumber(k.issuedCards), p: periodText(sum.data?.period) }) : ''} />
          <KpiCard testId="kpi-redeemed" label={tx('gc.kpi.redeemed')} loading={!k} value={k ? fmtMoney(k.redeemedValueCents) : ''} sub={k ? tx('gc.kpi.redeemedSub', { n: fmtNumber(k.redemptions), r: fmtMoney(k.refundedBackCents) }) : ''} onClick={() => setGroup('redeemed')} />
          <KpiCard testId="kpi-total" label={tx('gc.kpi.total')} loading={!k} value={k ? fmtNumber(k.totalCards) : ''} sub={k ? tx('gc.kpi.totalSub', { p: fmtNumber(k.pendingPaymentCards) }) : ''} onClick={clearAll} />
        </>}
      </div>

      <GiftCardClearingStrip onOpen={() => setDlg({ kind: 'liability' })} tick={tick} />
      <div className="fn-tabsrow gc-toolbar">
        <div className="fk-seg fn-tabs" role="tablist" aria-label={tx('finance.status')} data-module-id="gc-status">
          {(['', 'active', 'redeemed', 'pending', 'frozen', 'void'] as Group[]).map((g) => <button key={g || 'all'} type="button" role="tab" aria-selected={group === g} className={group === g ? 'on' : ''} onClick={() => setGroup(g)} data-testid={'tab-' + (g || 'all')}>{tx('gc.tab.' + (g || 'all'))}</button>)}
        </div>
        <div className="fn-search gc-search">
          <input className="fk-search wide" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tx('gc.searchPh')} aria-label={tx('gc.searchPh')} data-testid="search" />
          {search ? <button type="button" className="fk-x" aria-label={tx('finance.clearSearch')} onClick={() => setSearch('')}>✕</button> : null}
        </div>
        <select className="fk-select" value={role} onChange={(e) => setRole(e.target.value)} aria-label={tx('gc.roleLabel')} data-testid="role"><option value="">{tx('gc.role.all')}</option><option value="purchaser">{tx('gc.role.purchaser')}</option><option value="recipient">{tx('gc.role.recipient')}</option></select>
        {(branches.data?.length ?? 0) > 1 ? <select className="fk-select" value={branchId} onChange={(e) => setBranchId(e.target.value)} aria-label={tx('gc.branchLabel')} data-testid="branch">
          <option value="">{tx('gc.allBranches')}</option>{branches.data!.map((b) => <option key={b.id} value={b.id}>{b.name ?? b.id}</option>)}</select> : null}
        <select className="fk-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label={tx('finance.sort')} data-testid="sort">{SORTS.map((s) => <option key={s} value={s}>{tx('gc.sort.' + s)}</option>)}</select>
      </div>
      <div className="fn-tabsrow gc-periodrow">
        <PeriodBar value={period} onChange={setPeriod} server={list.data?.period} allowAll compact basis={basis} basisOptions={BASES.map((b) => ({ value: b, label: tx('gc.basis.' + b) }))} onBasis={setBasis} />
        {chips.length ? <span className="fn-chips" data-testid="chips">{chips.map((c) => <span key={c.label} className="fk-chip mut">{c.label}<button type="button" className="fk-chip-x" aria-label={tx('finance.removeFilter', { f: c.label })} onClick={c.clear}>✕</button></span>)}
          <button type="button" className="fk-link" onClick={clearAll} data-testid="clear-all">{tx('gc.clearAll')}</button></span> : null}
        <button type="button" className={'fk-btn gc-morebtn' + (moreOpen ? ' on' : '')} aria-expanded={moreOpen} onClick={() => setMoreOpen((o) => !o)} data-testid="more-filters">{tx('gc.moreFilters')}</button>
      </div>
      {moreOpen ? <div className="gc-more" data-testid="more-panel">
        <label className="fk-field"><span>{tx('gc.f.delivery')}</span><select value={more.delivery} onChange={(e) => setMore({ ...more, delivery: e.target.value })}><option value="">{tx('gc.delivery.all')}</option><option value="digital">{tx('gc.delivery.digital')}</option><option value="physical">{tx('gc.delivery.physical')}</option></select></label>
        <label className="fk-field"><span>{tx('gc.f.balanceMin')}</span><input inputMode="decimal" value={more.balanceMin} onChange={(e) => setMore({ ...more, balanceMin: e.target.value })} placeholder="0.00" /></label>
        <label className="fk-field"><span>{tx('gc.f.balanceMax')}</span><input inputMode="decimal" value={more.balanceMax} onChange={(e) => setMore({ ...more, balanceMax: e.target.value })} placeholder="500.00" /></label>
        <label className="fk-field"><span>{tx('gc.f.denomination')}</span><input inputMode="decimal" value={more.denomination} onChange={(e) => setMore({ ...more, denomination: e.target.value })} placeholder="100.00" /></label>
      </div> : null}

      <FitPanel testId="cards" bodyRef={fit.ref} className="fn-records"
        title={<span className="fn-chips">{tx('gc.cards')}{list.data ? <span className="fk-muted"> · {fmtNumber(list.data.total)}</span> : null}</span>}
        footer={<Pager info={list.data ? { page: list.data.page, pageSize: list.data.pageSize, totalItems: list.data.total, totalPages: list.data.pageCount } : null} onPage={setPage} label={tx('gc.cards')} />}>
        {list.error ? <StateBlock error={list.error} onRetry={list.reload} /> : !list.data ? <div className="fk-loading">{tx('pos.loading')}</div>
          : rows.length === 0 ? (chips.length ? <Empty title={tx('finance.noMatches')}><button type="button" className="fk-btn" onClick={clearAll}>{tx('gc.clearAll')}</button></Empty>
            : <Empty title={tx('gc.empty')}><span className="fk-hint">{tx('gc.emptyHint')}</span>{perm.issue ? <button type="button" className="fk-btn primary" onClick={() => setDlg({ kind: 'issue' })}>+ {tx('gc.issue')}</button> : null}</Empty>)
          : <table className="fk-table fn-table" data-testid="cards-table">
            <thead><tr><th>{tx('gc.col.card')}</th><th>{tx('gc.col.purchaser')}</th><th>{tx('gc.col.recipient')}</th><th>{tx('gc.col.issued')}</th><th className="num t-opt">{tx('gc.col.original')}</th><th className="num">{tx('gc.col.balance')}</th><th>{tx('finance.status')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
            <tbody>{rows.map((c) => (
              <tr key={c.id} className={highlight === c.id ? 'fn-new' : ''} data-testid="card-row">
                <td className="fn-id"><button type="button" className="fk-li-t link fn-mono" onClick={() => setDlg({ kind: 'detail', id: c.id })}>{c.card}</button>
                  <span className="fk-li-s">{tx('gc.delivery.' + c.delivery)}{c.matchedBy && q ? ` · ${tx('gc.matched.' + c.matchedBy)}` : ''}</span></td>
                <td>{c.purchaser?.name ?? <span className="fk-muted">{tx('gc.noPurchaser')}</span>}{c.purchaser?.phone ? <span className="fk-li-s">{c.purchaser.phone}</span> : null}</td>
                <td>{c.recipient?.name ?? <span className="fk-muted">{c.recipient ? '—' : tx('gc.sameAsPurchaser')}</span>}{c.recipient?.phone ? <span className="fk-li-s">{c.recipient.phone}</span> : null}</td>
                <td>{day(c.issuedAt ?? c.createdAt)}</td>
                <td className="num t-opt">{fmtMoney(c.originalCents)}</td>
                <td className="num"><b>{fmtMoney(c.balanceCents)}</b></td>
                <td><span className={'fk-chip ' + (STATUS_TONE[c.status] ?? 'mut')}>{statusLbl(c.status)}</span></td>
                <td className="fn-acts"><button type="button" className="fk-btn ghost sm" onClick={() => setDlg({ kind: 'detail', id: c.id })}>{tx('finance.view')}</button></td>
              </tr>))}</tbody>
          </table>}
      </FitPanel>

      {dlg?.kind === 'detail' ? <DetailDialog id={dlg.id} onClose={() => setDlg(null)} onChanged={(t) => { setNote({ tone: 'ok', text: t }); setTick((x) => x + 1); }}
        onCheckout={(ticketId) => nav(`/checkout?ticket=${encodeURIComponent(ticketId)}`)} onCustomer={(cid) => nav(`/tenant/customers/profiles?customerId=${encodeURIComponent(cid)}`)} /> : null}
      {dlg?.kind === 'balance' ? <BalanceDialog onClose={() => setDlg(null)} onOpen={(id) => setDlg({ kind: 'detail', id })} /> : null}
      {dlg?.kind === 'issue' ? <IssueDialog onClose={() => setDlg(null)} onIssued={(r) => issued({ ...r, filtersHide: chips.length > 0 || sort !== 'issued_desc' })} /> : null}
      {dlg?.kind === 'liability' ? <FitDialog wide title={tx('gc.branchLiability')} onClose={() => setDlg(null)} testId="liability-dialog"><GiftCardBranchLiability /></FitDialog> : null}
    </div>
  );
}

function DetailDialog({ id, onClose, onChanged, onCheckout, onCustomer }: { id: string; onClose: () => void; onChanged: (t: string) => void; onCheckout: (ticketId: string) => void; onCustomer: (id: string) => void }) {
  const d = useLoad(() => posGiftCardsApi.detail(id), [id]);
  const [page, setPage] = useState(1); const [tick, setTick] = useState(0);
  const led = useLoad(() => posGiftCardsApi.ledger(id, { preset: 'all', page, pageSize: 6 }), [id, page, tick]);
  const stepUp = useStepUp(tx('gc.stepupVoid'));
  const [mode, setMode] = useState<null | 'reload' | 'void' | 'adjust'>(null); const [adjDir, setAdjDir] = useState<'down' | 'up'>('down'); const [amount, setAmount] = useState(''); const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const reloadKey = useMemo(() => requestId(), [mode]);   // eslint-disable-line react-hooks/exhaustive-deps
  const c: Card | undefined = d.data?.card; const tot = d.data?.totals; const perms = d.data?.permissions ?? {};
  const reloadable = c && ['active', 'partially_redeemed', 'redeemed', 'delivered', 'claimed'].includes(c.status);
  const voidable = c && !['void', 'canceled', 'refunded', 'replaced', 'expired', 'pending_payment'].includes(c.status);
  const doReload = async () => {
    const cents = centsFromText(amount); if (!c || cents == null || cents <= 0) { setErr(tx('gc.enterAmount')); return; }
    setBusy(true); setErr(null);
    try { const r = await posGiftCardsApi.reload(c.id, { amountCents: cents, customerId: c.purchaser?.id, idempotencyKey: reloadKey }); onChanged(tx('gc.reloadStarted', { a: fmtMoney(cents), n: tno(r.ticketNumber) })); onCheckout(r.ticketId); }
    catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  // Gift Cards guide (Nov 4 2026): Adjust balance — a manager's correction (take off) or goodwill credit (add), with a reason
  const adjustable = c && ['active', 'partially_redeemed', 'redeemed', 'frozen', 'suspended', 'delivered', 'claimed'].includes(c.status);
  const doAdjust = async () => {
    const cents = centsFromText(amount); if (!c || cents == null || cents <= 0) { setErr(tx('gc.enterAmount')); return; }
    setBusy(true); setErr(null);
    try { const r = await stepUp.run(() => posGiftCardsApi.adjust(c.id, { amountCents: adjDir === 'down' ? -cents : cents, reason: reason.trim() })); setMode(null); setReason(''); setAmount(''); d.reload(); setTick((t) => t + 1); onChanged(tx('gc.adjusted', { card: c.card, a: fmtMoney(r.afterCents) })); }
    catch (e) { if (!isStepUpCancelled(e)) setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const doVoid = async () => {
    if (!c) return; setBusy(true); setErr(null);
    try { await stepUp.run(() => posGiftCardsApi.voidCard(c.id, reason.trim())); setMode(null); setReason(''); d.reload(); setTick((t) => t + 1); onChanged(tx('gc.voided', { card: c.card })); }
    catch (e) { if (!isStepUpCancelled(e)) setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <FitDialog wide title={c ? c.card : tx('gc.card')} subtitle={c ? `${c.reference ?? ''} · ${tx('gc.delivery.' + c.delivery)}${c.branch ? ' · ' + c.branch : ''}` : undefined} onClose={onClose} busy={busy} testId="detail-dialog"
      footer={c ? <>
        {perms.reload && reloadable ? <button type="button" className="fk-btn" onClick={() => { setMode('reload'); setErr(null); }} disabled={busy} data-testid="reload">{tx('gc.reload')}</button> : null}
        {perms.void && adjustable ? <button type="button" className="fk-btn" onClick={() => { setMode('adjust'); setErr(null); setAmount(''); setReason(''); }} disabled={busy} data-testid="adjust">{tx('gc.adjust')}</button> : null}
        {perms.void && voidable ? <button type="button" className="fk-btn danger" onClick={() => { setMode('void'); setErr(null); }} disabled={busy} data-testid="void">{tx('gc.void')}</button> : null}
        {c.status === 'pending_payment' && c.saleTicketId ? <button type="button" className="fk-btn" onClick={() => onCheckout(c.saleTicketId!)}>{tx('gc.goToCheckout')}</button> : null}
        {c.purchaser?.id ? <button type="button" className="fk-btn" onClick={() => onCustomer(c.purchaser!.id!)}>{tx('finance.openCustomer')}</button> : null}
        <button type="button" className="fk-btn primary" onClick={onClose}>{tx('pos.close')}</button></> : undefined}>
      {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !c || !tot ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
        <div className="gc-balance" data-testid="detail-balance"><span className="fk-li-s">{tx('gc.col.balance')}</span><b>{fmtMoney(c.balanceCents)}</b>
          <span className={'fk-chip ' + (STATUS_TONE[c.status] ?? 'mut')}>{statusLbl(c.status)}</span>
          {!tot.reconciled ? <span className="fk-chip bad" data-testid="not-reconciled">{tx('gc.notReconciled', { a: fmtMoney(tot.ledgerBalanceCents) })}</span> : null}</div>
        {c.status === 'pending_payment' ? <div className="fk-preview bad">{tx('gc.pendingNote')}</div> : null}
        <div className="fn-cols2">
          <dl className="fk-dl">
            <dt>{tx('gc.col.purchaser')}</dt><dd>{c.purchaser ? `${c.purchaser.name ?? '—'}${c.purchaser.phone ? ' · ' + c.purchaser.phone : ''}${c.purchaser.email ? ' · ' + c.purchaser.email : ''}` : tx('gc.noPurchaser')}</dd>
            <dt>{tx('gc.col.recipient')}</dt><dd>{c.recipient ? `${c.recipient.name ?? '—'}${c.recipient.phone ? ' · ' + c.recipient.phone : ''}${c.recipient.email ? ' · ' + c.recipient.email : ''}` : tx('gc.sameAsPurchaser')}</dd>
            <dt>{tx('gc.col.issued')}</dt><dd>{when(c.issuedAt ?? c.createdAt)}</dd>
            <dt>{tx('gc.f.lastActivity')}</dt><dd>{when(c.lastActivityAt)}</dd>
            <dt>{tx('gc.f.expires')}</dt><dd>{c.expiresAt ? day(c.expiresAt) : tx('gc.noExpiry')}</dd>
            <dt>{tx('gc.f.pin')}</dt><dd>{c.hasPin ? tx('gc.pinSet') : tx('gc.noPin')}</dd>
          </dl>
          <dl className="fk-dl">
            <dt>{tx('gc.col.original')}</dt><dd>{fmtMoney(tot.originalCents)}</dd>
            <dt>{tx('gc.t.reloaded')}</dt><dd>{fmtMoney(tot.reloadedCents)}{tot.pendingReloadCents ? ` · ${tx('gc.t.pendingReload', { a: fmtMoney(tot.pendingReloadCents) })}` : ''}</dd>
            <dt>{tx('gc.t.redeemed')}</dt><dd>{fmtMoney(tot.redeemedCents)}{tot.refundedBackCents ? ` · ${tx('gc.t.refundedBack', { a: fmtMoney(tot.refundedBackCents) })}` : ''}</dd>
            {tot.adjustedCents ? <><dt>{tx('gc.t.adjusted')}</dt><dd>{fmtMoney(tot.adjustedCents)}</dd></> : null}
            {tot.transferredCents ? <><dt>{tx('gc.t.transferred')}</dt><dd>{fmtMoney(tot.transferredCents)}</dd></> : null}
            <dt>{tx('gc.t.transactions')}</dt><dd>{fmtNumber(tot.transactions)}</dd>
          </dl>
        </div>
        {mode === 'reload' ? <div className="fk-void" data-testid="reload-form"><label className="fk-field"><span>{tx('gc.reloadAmount')}</span><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="50.00" data-autofocus data-testid="reload-amount" /></label>
          <span className="fk-hint">{tx('gc.reloadNote')}</span>
          <button type="button" className="fk-btn" onClick={() => setMode(null)} disabled={busy}>{tx('pos.cancel')}</button>
          <button type="button" className="fk-btn primary" onClick={doReload} disabled={busy || !amount.trim()} data-testid="reload-submit">{busy ? tx('pos.saving') : tx('gc.reloadToCheckout')}</button></div> : null}
        {mode === 'adjust' ? <div className="fk-void" data-testid="adjust-form"><span>{tx('gc.adjustNow', { a: fmtMoney(c.balanceCents) })}</span>
          <div className="fk-seg" role="radiogroup" aria-label={tx('gc.adjust')}>{(['down', 'up'] as const).map((x) => <button key={x} type="button" role="radio" aria-checked={adjDir === x} className={adjDir === x ? 'on' : ''} onClick={() => setAdjDir(x)} data-testid={'adjust-' + x}>{tx('gc.adjust.' + x)}</button>)}</div>
          <label className="fk-field"><span>{tx('gc.amount')} *</span><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="adjust-amount" /></label>
          <label className="fk-field"><span>{tx('gc.adjustReason')} *</span><input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} data-testid="adjust-reason" /></label>
          <button type="button" className="fk-btn" onClick={() => setMode(null)} disabled={busy}>{tx('pos.cancel')}</button>
          <button type="button" className="fk-btn primary" onClick={doAdjust} disabled={busy || reason.trim().length < 3} data-testid="adjust-submit">{busy ? tx('pos.saving') : tx('gc.adjust')}</button></div> : null}
        {mode === 'void' ? <div className="fk-void" data-testid="void-form"><span>{tx('gc.voidConfirm', { a: fmtMoney(c.balanceCents) })}</span>
          <label className="fk-field"><span>{tx('gc.voidReason')} *</span><input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} data-autofocus data-testid="void-reason" /></label>
          <button type="button" className="fk-btn" onClick={() => setMode(null)} disabled={busy}>{tx('pos.cancel')}</button>
          <button type="button" className="fk-btn danger" onClick={doVoid} disabled={busy || reason.trim().length < 3} data-testid="void-submit">{busy ? tx('pos.saving') : tx('gc.void')}</button></div> : null}
        {err ? <div className="fk-err" role="alert">{err}</div> : null}
        <h3 className="fk-h3">{tx('gc.ledger')}{led.data ? <span className="fk-muted"> · {fmtNumber(led.data.total)}</span> : null}</h3>
        {led.error ? <StateBlock error={led.error} onRetry={led.reload} /> : !led.data ? <div className="fk-loading">{tx('pos.loading')}</div> : led.data.items.length === 0 ? <div className="fk-hint">{tx('gc.noLedger')}</div> :
          <table className="fk-table" data-testid="ledger-table"><thead><tr><th>{tx('gc.l.date')}</th><th>{tx('gc.l.type')}</th><th className="num">{tx('gc.l.amount')}</th><th className="num t-opt">{tx('gc.l.before')}</th><th className="num">{tx('gc.l.after')}</th><th>{tx('gc.l.reference')}</th><th>{tx('finance.status')}</th></tr></thead>
            <tbody>{led.data.items.map((l: any) => <tr key={l.id}><td>{when(l.at)}</td><td>{codeLabel('gc.ltype.' + l.type, l.type)}{l.reason ? <span className="fk-li-s">{l.reason}</span> : null}</td>
              <td className={'num' + (l.amountCents < 0 ? ' neg' : '')}>{l.amountCents > 0 ? '+' : ''}{fmtMoney(l.amountCents)}</td><td className="num t-opt">{l.balanceBeforeCents == null ? '—' : fmtMoney(l.balanceBeforeCents)}</td>
              <td className="num">{l.balanceAfterCents == null ? '—' : fmtMoney(l.balanceAfterCents)}</td><td>{l.ticketNumber ? '#' + tno(l.ticketNumber) : '—'}{l.actor ? <span className="fk-li-s">{l.actor}</span> : null}</td>
              <td><span className={'fk-chip ' + (l.status === 'pending' ? 'warn' : 'ok')}>{tx('gc.lstatus.' + l.status)}</span></td></tr>)}</tbody></table>}
        {led.data && led.data.pageCount > 1 ? <Pager compact info={{ page: led.data.page, pageSize: led.data.pageSize, totalItems: led.data.total, totalPages: led.data.pageCount }} onPage={setPage} label={tx('gc.ledger')} /> : null}
      </>}
      {stepUp.prompt}
    </FitDialog>
  );
}

/** The protected balance check: exact code / number only, rate limited and audited on the server; answers masked. */
function BalanceDialog({ onClose, onOpen }: { onClose: () => void; onOpen: (id: string) => void }) {
  const [input, setInput] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const [r, setR] = useState<Awaited<ReturnType<typeof posCheckoutApi.giftCardLookup>> | null>(null);
  const check = async () => { setBusy(true); setErr(null); setR(null); try { setR(await posCheckoutApi.giftCardLookup(input.trim())); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); } };
  return (
    <FitDialog title={tx('gc.checkBalance')} subtitle={tx('gc.balanceSub')} onClose={onClose} busy={busy} testId="balance-dialog"
      footer={<><button type="button" className="fk-btn" onClick={onClose}>{tx('pos.close')}</button>
        {r?.found && r.cardId ? <button type="button" className="fk-btn" onClick={() => onOpen(r.cardId!)}>{tx('gc.viewCard')}</button> : null}
        <button type="button" className="fk-btn primary" onClick={check} disabled={busy || input.trim().length < 6} data-testid="balance-submit">{busy ? tx('pos.loading') : tx('gc.check')}</button></>}>
      <label className="fk-field"><span>{tx('gc.balanceInput')}</span><input value={input} onChange={(e) => setInput(e.target.value)} autoComplete="off" spellCheck={false} data-autofocus data-testid="balance-input"
        onKeyDown={(e) => { if (e.key === 'Enter' && input.trim().length >= 6) void check(); }} /></label>
      <div className="fk-hint">{tx('gc.balanceNote')}</div>
      {r ? (r.found ? <div className="fk-preview" data-testid="balance-result"><div className="gc-balance"><b>{fmtMoney(r.balanceCents ?? 0)}</b><span className={'fk-chip ' + (STATUS_TONE[r.status ?? ''] ?? 'mut')}>{statusLbl(r.status ?? '')}</span></div>
          <div>{r.cardNumberMasked ?? r.reference}{r.redeemableHere === false ? ` · ${tx('gc.notRedeemableHere')}` : ''}</div></div>
        : <div className="fk-err" role="status" data-testid="balance-notfound">{tx('gc.notFound')}</div>) : null}
      {err ? <div className="fk-err" role="alert">{err}</div> : null}
    </FitDialog>
  );
}

type CustomerHit = { customerId: string; fullName: string; phone?: string };
/** Issue: payment first. The card is created PENDING on its own ticket and activates only when Checkout takes the payment.
 *  One idempotency key per dialog — a double tap, a retry or a lost answer returns the same ticket and card. */
function IssueDialog({ onClose, onIssued }: { onClose: () => void; onIssued: (r: { cardId: string; ticketId: string; reference: string }) => void }) {
  const settings = useLoad(() => posSettingsApi.getCategory('gift-card-settings') as Promise<any>, []);
  const s = settings.data;
  const [cq, setCq] = useState(''); const cqd = useDebounced(cq.trim(), 250); const [hits, setHits] = useState<CustomerHit[]>([]); const [cust, setCust] = useState<CustomerHit | null>(null);
  const [amount, setAmount] = useState(''); const [delivery, setDelivery] = useState<'digital' | 'physical'>('digital'); const [num, setNum] = useState(''); const [pin, setPin] = useState('');
  const [gift, setGift] = useState(false); const [rName, setRName] = useState(''); const [rPhone, setRPhone] = useState(''); const [rEmail, setREmail] = useState(''); const [rMsg, setRMsg] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<null | { cardId: string; ticketId: string; reference: string; ticketNumber: string; cardNumberOnce: string | null; cardNumberMasked: string | null; amountCents: number }>(null);
  const key = useMemo(() => requestId(), []); const sent = useRef(false);
  useEffect(() => {
    if (cust || cqd.length < 2) { setHits([]); return; }
    let live = true; posCustomersApi.quickSearch(cqd).then((r: any) => { if (live) setHits((r?.items ?? []) as CustomerHit[]); }).catch(() => { if (live) setHits([]); });
    return () => { live = false; };
  }, [cqd, cust]);
  const cents = centsFromText(amount);
  const min = s?.minAmountCents ?? 0, max = s?.maxAmountCents ?? 0;
  const amountOk = cents != null && cents > 0 && (!min || cents >= min) && (!max || cents <= max) && (s?.customAmountEnabled !== false || (s?.presetAmountsCents ?? []).includes(cents));
  const ok = !!cust && amountOk && (delivery === 'digital' || /^\d{16}$/.test(num.replace(/\s/g, ''))) && (!gift || rName.trim().length > 0);
  const submit = async () => {
    if (!ok || !cust || cents == null || sent.current) return; sent.current = true; setBusy(true); setErr(null);
    try {
      const r = await posGiftCardsApi.issue({ customerId: cust.customerId, amountCents: cents, delivery, cardNumber: delivery === 'physical' ? num.replace(/\s/g, '') : undefined, pin: delivery === 'physical' && pin.trim() ? pin.trim() : undefined,
        idempotencyKey: key, recipient: gift ? { name: rName.trim(), phone: rPhone.trim() || undefined, email: rEmail.trim() || undefined, message: rMsg.trim() || undefined } : undefined });
      setDone(r);
    } catch (e) { setErr(errMsg(e)); sent.current = false; }
    finally { setBusy(false); }
  };
  if (settings.error) return <FitDialog title={tx('gc.issue')} onClose={onClose} testId="issue-dialog"><StateBlock error={settings.error} onRetry={settings.reload} /></FitDialog>;
  if (s && (!s.enabled || s.posSalesEnabled === false)) return <FitDialog title={tx('gc.issue')} onClose={onClose} testId="issue-dialog"><Empty title={tx('gc.salesOff')}><span className="fk-hint">{tx('gc.salesOffHint')}</span></Empty></FitDialog>;
  if (done) return (
    <FitDialog title={tx('gc.issuedTitle')} subtitle={tx('gc.issuedSub', { n: tno(done.ticketNumber) })} onClose={() => onIssued(done)} testId="issue-done"
      footer={<button type="button" className="fk-btn primary" onClick={() => onIssued(done)} data-testid="go-checkout">{tx('gc.goToCheckout')}</button>}>
      <div className="fk-preview"><b>{fmtMoney(done.amountCents)}</b> · {done.reference}</div>
      {done.cardNumberOnce ? <div className="gc-once" data-testid="card-number-once"><span className="fk-li-s">{tx('gc.numberOnce')}</span><b className="fn-mono">{done.cardNumberOnce.replace(/(\d{4})(?=\d)/g, '$1 ')}</b></div>
        : <div className="fk-hint">{done.cardNumberMasked ?? done.reference}</div>}
      <div className="fk-hint">{tx('gc.pendingNote')}</div>
    </FitDialog>
  );
  return (
    <FitDialog wide title={tx('gc.issue')} subtitle={tx('gc.issueSub')} onClose={onClose} busy={busy} testId="issue-dialog"
      footer={<><button type="button" className="fk-btn" onClick={onClose} disabled={busy}>{tx('pos.cancel')}</button>
        <button type="button" className="fk-btn primary" onClick={submit} disabled={busy || !ok} data-testid="issue-submit">{busy ? tx('pos.saving') : tx('gc.issueToCheckout')}</button></>}>
      {!s ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
        <div className="fk-grid2">
          <div className="fk-field gc-cust"><span>{tx('gc.f.purchaser')} *</span>
            {cust ? <div className="fk-chip mut gc-picked" data-testid="picked-customer">{cust.fullName}{cust.phone ? ` · ${cust.phone}` : ''}<button type="button" className="fk-chip-x" aria-label={tx('gc.changeCustomer')} onClick={() => { setCust(null); setCq(''); }}>✕</button></div>
              : <><input value={cq} onChange={(e) => setCq(e.target.value)} placeholder={tx('gc.customerPh')} data-autofocus data-testid="customer-search" />
                {hits.length ? <ul className="gc-hits" role="listbox">{hits.slice(0, 6).map((h) => <li key={h.customerId}><button type="button" role="option" aria-selected={false} onClick={() => { setCust(h); setHits([]); }}>{h.fullName}<span className="fk-li-s">{h.phone ?? ''}</span></button></li>)}</ul> : null}</>}
          </div>
          <label className="fk-field"><span>{tx('gc.f.amount')} *</span><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="100.00" data-testid="issue-amount" />
            <span className="fk-hint">{min || max ? tx('gc.amountRange', { a: fmtMoney(min), b: max ? fmtMoney(max) : '—' }) : ''}</span></label>
        </div>
        {(s.presetAmountsCents ?? []).length ? <div className="gc-presets">{(s.presetAmountsCents as number[]).map((p) => <button key={p} type="button" className={'fk-btn sm' + (cents === p ? ' on' : '')} onClick={() => setAmount(textFromCents(p))}>{fmtMoney(p, { whole: true })}</button>)}</div> : null}
        {amount && !amountOk ? <div className="fk-err" role="alert">{tx('gc.amountInvalid')}</div> : null}
        <div className="fk-seg" role="radiogroup" aria-label={tx('gc.f.delivery')}>
          {(['digital', 'physical'] as const).map((d) => <button key={d} type="button" role="radio" aria-checked={delivery === d} className={delivery === d ? 'on' : ''} onClick={() => setDelivery(d)} data-testid={'delivery-' + d}>{tx('gc.delivery.' + d)}</button>)}
        </div>
        {delivery === 'physical' ? <div className="fk-grid2">
          <label className="fk-field"><span>{tx('gc.f.cardNumber')} *</span><input inputMode="numeric" autoComplete="off" value={num} onChange={(e) => setNum(e.target.value.replace(/[^\d\s]/g, '').slice(0, 19))} data-testid="issue-number" /></label>
          <label className="fk-field"><span>{tx('gc.f.pin')}</span><input inputMode="numeric" autoComplete="off" type="password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} /></label>
        </div> : null}
        <label className="fk-check"><input type="checkbox" checked={gift} onChange={(e) => setGift(e.target.checked)} data-testid="is-gift" />{tx('gc.isGift')}</label>
        {gift ? <div className="fk-grid2">
          <label className="fk-field"><span>{tx('gc.f.rName')} *</span><input value={rName} onChange={(e) => setRName(e.target.value)} maxLength={200} data-testid="recipient-name" /></label>
          <label className="fk-field"><span>{tx('gc.f.rPhone')}</span><input inputMode="tel" value={rPhone} onChange={(e) => setRPhone(e.target.value)} maxLength={40} /></label>
          <label className="fk-field"><span>{tx('gc.f.rEmail')}</span><input inputMode="email" value={rEmail} onChange={(e) => setREmail(e.target.value)} maxLength={254} /></label>
          <label className="fk-field"><span>{tx('gc.f.rMsg')}</span><input value={rMsg} onChange={(e) => setRMsg(e.target.value)} maxLength={500} /></label>
        </div> : null}
        <div className="fk-hint">{tx('gc.paymentFirst')}</div>
      </>}
      {err ? <div className="fk-err" role="alert" data-testid="issue-error">{err}</div> : null}
    </FitDialog>
  );
}
