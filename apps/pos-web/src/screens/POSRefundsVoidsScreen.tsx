// POSRefundsVoidsScreen.tsx — Payments & Money → Refunds & Voids (/tenant/payments/refunds-voids). Refunds & Voids mandate
// (Oct 29 2026): ONE full-screen page at 100 % zoom — header (Find Original Payment · Refresh · Export Report) · five KPIs from
// the server over the whole scope (Refunds · Voids · Total Reversed · Pending · Needs Review) · one universal search + type /
// status / method / sort · the period bar with its date field (Requested · Completed · Original payment) and processor /
// register · a server-paged ledger, ONE ROW PER REVERSAL, newest first · a detail overlay (the original tender, the ticket's
// other tenders with what each can still return, every refund on that tender, gift-card ledger, settlement link or "not
// linked", tips, loyalty, audit) · the Find Original Payment overlay (captured tenders with refunded / pending / refundable
// and why an action is off) leading to a refund of ONE tender, the ticket refund (split across tenders by the server), or a
// void — all through the existing Checkout routes (claim-first, idempotent, step-up, processor-backed).
// What was wrong: the page read the newest 1,000 reversal payment rows (a void's zero-amount record counted as a void, a
// pending or failed refund never appeared), had no period, search or paging, and a read error looked like $0.00.
import { useEffect, useRef, useState } from 'react';
import { useRealtime } from '../realtime/useRealtime';
import { useNavigate } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { createIntentKeys } from '@aipowersalon/api-client';
import { readSession, writeSession } from '../components/useSessionState';
import { posRefundsVoidsApi } from '../api/posRefundsVoidsApi';
import { posCheckoutApi } from '../api/posCheckoutApi';
import { TicketRefundPanel } from '../components/TicketRefundPanel';
import { useStepUp, isStepUpCancelled } from './access/accessUi';
import { fmtMoney, fmtNumber, fmtInZone } from '../i18n/format';
import { codeLabel } from '../components/peopleLabels';
import { ActionActorLine } from '../components/ActionActorLine';
import { errorTextOf } from '../i18n/error-text';
import { FitDialog, FitPanel, KpiCard, Pager, Empty, useFitRows, useDebounced } from '../components/FitKit';
import { PeriodBar, periodQuery, periodText, useLoad, StateBlock, isForbidden, centsFromText, textFromCents, type PeriodState } from '../components/FinanceKit';

type Rev = { id: string; kind: 'refund' | 'void'; type: string; state: string; rawStatus: string; requestedAt: string | null; completedAt: string | null; paymentId: string; reversalPaymentId: string | null; ticketId: string | null; ticketNumber: string | null;
  customer: { id: string; name: string | null; phone: string | null } | null; originalCents: number; reversedCents: number; method: string; processor: string | null; providerRef: string | null; originalRef: string | null; card: string | null; giftCardLast4: string | null;
  reason: string | null; actor: string | null; reviewReason: string | null; lastError: string | null; settlementId: string | null; branch: string | null; register: string | null; originalAt: string | null; matchedBy?: string | null };
type Tender = { id: string; ticketId: string | null; ticketNumber?: string | null; method: string; amountCents: number; tipCents: number; status: string; captured: boolean; processor: string | null; processorRef: string | null; card: string | null; giftCardLast4: string | null; at: string | null;
  refundedCents: number; pendingCents: number; refundableCents: number; settlementId: string | null; customer?: { id: string; name: string | null; phone: string | null } | null; branch?: string | null;
  eligibility: { refund: boolean; refundWhy: string | null; void: boolean; voidWhy: string | null } };
type Note = { tone: 'ok' | 'bad' | 'warn'; text: string; filtersHide?: boolean } | null;
/** REFUNDS 06 — the server's Escalation Inbox (summary.escalations): grouped, read only */
type RvEscalations = { total: number; stalePendingHours: number; groups: { key: string; count: number; cents: number; oldestAt: string | null;
  items: { id: string; kind: 'refund' | 'void'; ticketNumber: string | null; reversedCents: number; requestedAt: string | null; reviewReason: string | null }[] }[] };

function EscalationInbox({ data, onClose, onOpen }: { data: RvEscalations; onClose: () => void; onOpen: (kind: 'refund' | 'void', id: string) => void }) {
  return (
    <FitDialog title={tx('rv.esc.title')} subtitle={tx('rv.esc.sub')} onClose={onClose} wide testId="rv-esc-dialog">
      {data.total === 0 ? <Empty title={tx('rv.esc.none')} /> : data.groups.map((g) => (
        <section key={g.key} className="rv-esc-group" data-testid={'rv-esc-' + g.key}>
          <h4>{tx('rv.esc.g.' + g.key, { h: data.stalePendingHours })} · {fmtNumber(g.count)}{g.count ? ` · ${fmtMoney(g.cents)}` : ''}</h4>
          <div className="fk-hint">{tx('rv.esc.why.' + g.key)}</div>
          {g.items.length ? <ul className="fk-list">{g.items.map((it) => (
            <li key={it.id}><button type="button" className="fk-btn ghost sm" onClick={() => onOpen(it.kind, it.id)} data-testid="rv-esc-item">
              {it.ticketNumber ? '#' + it.ticketNumber : tx('rv.notLinked')} · {fmtMoney(it.reversedCents)} · {when(it.requestedAt)}{it.reviewReason ? ' · ' + codeLabel('rv.review.' + it.reviewReason, it.reviewReason) : ''}</button></li>
          ))}</ul> : null}
          {g.count > g.items.length ? <div className="fk-hint">{tx('rv.esc.more', { n: fmtNumber(g.count - g.items.length) })}</div> : null}
        </section>
      ))}
      <div className="fk-hint">{tx('rv.esc.readOnly')}</div>
    </FitDialog>
  );
}

const STATE_TONE: Record<string, string> = { completed: 'ok', pending: 'warn', processing: 'warn', failed: 'bad', needs_review: 'bad', cancelled: 'mut' };
const TYPE_TONE: Record<string, string> = { refund: 'warn', partial_refund: 'warn', void: 'bad' };
const TYPES = ['refund', 'partial_refund', 'void'];
const STATES = ['pending', 'processing', 'completed', 'failed', 'cancelled', 'needs_review'];
const METHODS = ['card', 'cash', 'gift_card', 'other'];
const SORTS = ['created_desc', 'created_asc', 'completed_desc', 'amount_desc', 'amount_asc', 'type_asc', 'status_asc'];
const BASES = ['requested', 'completed', 'original'];
const when = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) || '—' : '—');
const day = (iso?: string | null) => (iso ? fmtInZone(iso, { month: 'short', day: 'numeric', year: 'numeric' }) || '—' : '—');
const stateLbl = (s: string) => codeLabel('rv.state.' + s, s);
const typeLbl = (s: string) => codeLabel('rv.type.' + s, s);
const methodLbl = (m: string, last4?: string | null) => codeLabel('rv.method.' + m, m) + (last4 ? ' ••' + last4 : '');
const short = (id: string) => id.replace(/-/g, '').slice(-8).toUpperCase();   // the tail: distinct per record
const errMsg = (e: unknown) => errorTextOf(e, tx('finance.state.loadFailed'));

// round 10 (REFUNDS VOIDS 13 "Recovery After Browser Reload"): while a refund / void request is on its way, this tab keeps
// a small marker (which tender, the typed amount, and the ONE idempotency key of that request). If the page reloads before
// the answer arrives, the screen reopens the pending state from it, and asking again for the same tender and amount reuses
// that same key — the server answers the first request instead of starting a second payment operation. Cleared on any
// server answer; kept on a lost connection.
export const RV_INFLIGHT = 'aps.rv.inflight';
type Inflight = { kind: 'refund' | 'void'; tenderId: string; intent: string; sig: string; key: string; amountCents: number; ticketNumber: string | null; at: string };
const readInflight = (): Inflight | null => { const v = readSession<Inflight | null>(RV_INFLIGHT, null); return v && typeof v.key === 'string' && typeof v.intent === 'string' ? v : null; };
const clearInflight = () => { try { sessionStorage.removeItem(RV_INFLIGHT); } catch { /* no storage */ } };
/** the key for this request: the held one when the same request was cut off by a reload, otherwise this dialog's own */
function heldKey(keys: ReturnType<typeof createIntentKeys>, intent: string, body: unknown): string {
  const h = readInflight(); const sig = JSON.stringify(body);
  return h && h.intent === intent && h.sig === sig ? h.key : keys.keyFor(intent, body);
}
function holdInflight(kind: Inflight['kind'], tender: Tender, intent: string, body: unknown, key: string, amountCents: number) {
  writeSession(RV_INFLIGHT, { kind, tenderId: tender.id, intent, sig: JSON.stringify(body), key, amountCents, ticketNumber: tender.ticketNumber ?? null, at: new Date().toISOString() } satisfies Inflight);
}
/** a server answer (any HTTP status) settles the request; a lost connection / timeout (status 0) does not */
const serverAnswered = (e: unknown) => { const st = (e as { status?: unknown } | null)?.status; return typeof st === 'number' && st > 0; };

export function POSRefundsVoidsScreen() {
  const nav = useNavigate();
  // round 10 (Finish the Five 04): a link from a commission finding opens this list searched for its ticket (?search=)
  const [search, setSearch] = useState(() => (new URLSearchParams(window.location.search).get('search') ?? '').slice(0, 100)); const q = useDebounced(search.trim(), 300);
  const [type, setType] = useState(''); const [state, setState] = useState(''); const [method, setMethod] = useState(''); const [processor, setProcessor] = useState(''); const [register, setRegister] = useState(''); const [sort, setSort] = useState('created_desc');
  const [period, setPeriod] = useState<PeriodState>({ preset: 'month' }); const [basis, setBasis] = useState('requested');
  const [page, setPage] = useState(1); const [tick, setTick] = useState(0); const [note, setNote] = useState<Note>(null); const [exporting, setExporting] = useState(false);
  const [detail, setDetail] = useState<{ kind: 'refund' | 'void'; id: string } | null>(null); const [finding, setFinding] = useState(false); const [inbox, setInbox] = useState(false);
  const [held, setHeld] = useState<Inflight | null>(() => readInflight());
  const scope = { ...periodQuery(period), dateField: basis, search: q || undefined, type: type || undefined, status: state || undefined, method: method || undefined, processor: processor || undefined, register: register || undefined, sort };
  const key = JSON.stringify(scope); useEffect(() => { setPage(1); }, [key]);
  const fit = useFitRows<HTMLDivElement>(44, { min: 3, max: 18, reserve: 34 });
  const list = useLoad(() => posRefundsVoidsApi.list({ ...scope, page, pageSize: fit.rows }), [key, page, fit.rows, tick]);
  const sum = useLoad(() => posRefundsVoidsApi.summary({ ...periodQuery(period), dateField: basis, method: method || undefined, processor: processor || undefined, register: register || undefined }), [JSON.stringify(period), basis, method, processor, register, tick]);
  const facets = useLoad(() => posRefundsVoidsApi.facets(), []);
  // Extras REFUNDS & VOIDS 08: a confirmed refund / void / payment elsewhere (another register, the owner app) refreshes
  // this ledger in place through the existing realtime routing ("reports": reports_updated / ticket_paid / payment_approved) —
  // events only (no timer), data kept while it reloads
  useRealtime('reports', () => { list.reload(); sum.reload(); }, { intervalMs: 0, hiddenMs: 0 });
  useEffect(() => { if (list.data && list.data.page !== page) setPage(list.data.page); }, [list.data]);   // eslint-disable-line react-hooks/exhaustive-deps
  const esc: RvEscalations | undefined = sum.data?.escalations; const k = sum.data?.kpis; const perms = sum.data?.permissions ?? {}; const rows: Rev[] = list.data?.items ?? [];
  const chips = [...(q ? [{ label: tx('rv.chip.search', { q }), clear: () => setSearch('') }] : []), ...(type ? [{ label: typeLbl(type), clear: () => setType('') }] : []), ...(state ? [{ label: stateLbl(state), clear: () => setState('') }] : []),
    ...(method ? [{ label: methodLbl(method), clear: () => setMethod('') }] : []), ...(processor ? [{ label: processor, clear: () => setProcessor('') }] : []),
    ...(register ? [{ label: (facets.data?.registers ?? []).find((r) => r.id === register)?.name ?? tx('rv.register'), clear: () => setRegister('') }] : [])];
  const clearAll = () => { setSearch(''); setType(''); setState(''); setMethod(''); setProcessor(''); setRegister(''); setSort('created_desc'); setPeriod({ preset: 'month' }); setBasis('requested'); };
  const doExport = async () => {
    setExporting(true);
    try { const csv = await posRefundsVoidsApi.exportCsv(scope); const blob = new Blob([String(csv)], { type: 'text/csv;charset=utf-8' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'refunds-voids.csv'; a.click(); URL.revokeObjectURL(a.href); setNote({ tone: 'ok', text: tx('finance.exported') }); }
    catch (e) { setNote({ tone: 'bad', text: errMsg(e) }); } finally { setExporting(false); }
  };
  /** after the server confirmed an action: page 1 under the default order; a new row only shows when it matches the filters */
  const done = (tone: 'ok' | 'warn', text: string) => { setHeld(readInflight()); setSort('created_desc'); setPage(1); setTick((t) => t + 1); setNote({ tone, text, filtersHide: chips.length > 0 || period.preset !== 'month' }); };
  if (isForbidden(list.error) || isForbidden(sum.error)) return <div className="work fit rv" data-testid="refunds-screen"><h1>{tx('pos.refunds_voids')}</h1><StateBlock error={list.error ?? sum.error} onRetry={list.reload} /></div>;
  return (
    <div className="work fit rv" data-testid="refunds-screen">
      <header className="fk-head">
        <div className="vh" style={{ marginBottom: 0, minWidth: 0 }}><h1>{tx('pos.refunds_voids')}</h1><div className="sub">{tx('rv.subtitle')}</div></div>
        <div className="fk-head-actions">
          <button type="button" className="fk-btn primary" onClick={() => setFinding(true)} data-testid="find-payment">{tx('rv.find')}</button>
          {esc ? <button type="button" className={'fk-btn' + (esc.total > 0 ? ' warn' : '')} onClick={() => setInbox(true)} data-testid="rv-escalations">{tx('rv.esc.open', { n: fmtNumber(esc.total) })}</button> : null}
          <button type="button" className="fk-btn" onClick={() => setTick((t) => t + 1)} data-testid="refresh">{tx('finance.refresh')}</button>
          {perms.export ? <button type="button" className="fk-btn" onClick={doExport} disabled={exporting} data-testid="export">{exporting ? tx('pos.loading') : tx('finance.exportReport')}</button> : null}
        </div>
      </header>
      {note ? <div className={'fk-note ' + note.tone} role="status" data-testid="note"><span>{note.text}</span>{note.filtersHide ? <button type="button" className="fk-link" onClick={clearAll}>{tx('finance.clearFilters')}</button> : null}
        <button type="button" className="fk-x" aria-label={tx('pos.dismiss')} onClick={() => setNote(null)}>✕</button></div> : null}
      {held ? <div className="fk-note warn" role="status" data-testid="rv-inflight">
        <span>{tx('rv.inflight.text', { k: typeLbl(held.kind === 'void' ? 'void' : 'refund'), a: fmtMoney(held.amountCents), t: held.ticketNumber ? '#' + held.ticketNumber : tx('rv.notLinked'), w: when(held.at) })}</span>
        {held.ticketNumber ? <button type="button" className="fk-link" data-testid="rv-inflight-show" onClick={() => { setSearch(held.ticketNumber ?? ''); setState(''); setType(''); }}>{tx('rv.inflight.show')}</button> : null}
        <button type="button" className="fk-link" data-testid="rv-inflight-clear" onClick={() => { clearInflight(); setHeld(null); }}>{tx('rv.inflight.clear')}</button>
      </div> : null}
      <div className="fk-kpis five" data-testid="kpis">
        {sum.error ? <StateBlock error={sum.error} onRetry={sum.reload} /> : <>
          <KpiCard testId="kpi-refunds" tone="gold" label={tx('rv.kpi.refunds')} loading={!k} value={k ? fmtMoney(k.refundedCents) : ''} sub={k ? tx('rv.kpi.refundsSub', { n: fmtNumber(k.refunds), p: fmtNumber(k.partialRefunds) }) : ''} onClick={() => { setType(''); setState('completed'); }} />
          <KpiCard testId="kpi-voids" label={tx('rv.kpi.voids')} loading={!k} value={k ? fmtMoney(k.voidedCents) : ''} sub={k ? tx('rv.kpi.voidsSub', { n: fmtNumber(k.voids) }) : ''} onClick={() => { setState(''); setType('void'); }} />
          <KpiCard testId="kpi-total" label={tx('rv.kpi.total')} loading={!k} value={k ? fmtMoney(k.totalReversedCents) : ''} sub={k ? tx('rv.kpi.totalSub', { n: fmtNumber(k.totalReversed) }) : ''} />
          <KpiCard testId="kpi-pending" tone={k && k.pending > 0 ? 'warn' : undefined} label={tx('rv.kpi.pending')} loading={!k} value={k ? fmtNumber(k.pending) : ''} sub={k ? tx('rv.kpi.pendingSub', { a: fmtMoney(k.pendingCents) }) : ''} onClick={() => setState('pending')} />
          <KpiCard testId="kpi-review" tone={k && k.needsReview > 0 ? 'bad' : undefined} label={tx('rv.kpi.review')} loading={!k} value={k ? fmtNumber(k.needsReview) : ''} sub={k ? tx('rv.kpi.reviewSub', { f: fmtNumber(k.failed), u: fmtNumber(k.unknown) }) : ''} onClick={() => setState('needs_review')} />
        </>}
      </div>
      <div className="fn-tabsrow rv-toolbar">
        <div className="fn-search rv-search"><input className="fk-search wide" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tx('rv.searchPh')} aria-label={tx('rv.searchPh')} data-testid="search" />
          {search ? <button type="button" className="fk-x" aria-label={tx('finance.clearSearch')} onClick={() => setSearch('')}>✕</button> : null}</div>
        <select className="fk-select" value={type} onChange={(e) => setType(e.target.value)} aria-label={tx('rv.type')} data-testid="type"><option value="">{tx('rv.allTypes')}</option>{TYPES.map((s) => <option key={s} value={s}>{typeLbl(s)}</option>)}</select>
        <select className="fk-select" value={state} onChange={(e) => setState(e.target.value)} aria-label={tx('finance.status')} data-testid="status"><option value="">{tx('finance.allStatuses')}</option>{STATES.map((s) => <option key={s} value={s}>{stateLbl(s)}</option>)}</select>
        <select className="fk-select" value={method} onChange={(e) => setMethod(e.target.value)} aria-label={tx('rv.method')} data-testid="method"><option value="">{tx('rv.allMethods')}</option>{METHODS.map((s) => <option key={s} value={s}>{methodLbl(s)}</option>)}</select>
        <select className="fk-select" value={sort} onChange={(e) => setSort(e.target.value)} aria-label={tx('finance.sort')} data-testid="sort">{SORTS.map((s) => <option key={s} value={s}>{tx('rv.sort.' + s)}</option>)}</select>
      </div>
      <div className="fn-tabsrow rv-periodrow">
        <PeriodBar value={period} onChange={setPeriod} server={list.data?.period} allowAll compact basis={basis} basisOptions={BASES.map((b) => ({ value: b, label: tx('rv.basis.' + b) }))} onBasis={setBasis} />
        {(facets.data?.processors.length ?? 0) > 1 ? <select className="fk-select" value={processor} onChange={(e) => setProcessor(e.target.value)} aria-label={tx('finance.processor')} data-testid="processor"><option value="">{tx('finance.allProcessors')}</option>{facets.data!.processors.map((p) => <option key={p} value={p}>{p}</option>)}</select> : null}
        {(facets.data?.registers.length ?? 0) > 1 ? <select className="fk-select" value={register} onChange={(e) => setRegister(e.target.value)} aria-label={tx('rv.register')} data-testid="register"><option value="">{tx('rv.allRegisters')}</option>{facets.data!.registers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select> : null}
        {chips.length ? <span className="fn-chips" data-testid="chips">{chips.map((c) => <span key={c.label} className="fk-chip mut">{c.label}<button type="button" className="fk-chip-x" aria-label={tx('finance.removeFilter', { f: c.label })} onClick={c.clear}>✕</button></span>)}
          <button type="button" className="fk-link" onClick={clearAll} data-testid="clear-all">{tx('finance.clearFilters')}</button></span> : null}
      </div>
      <FitPanel testId="ledger" bodyRef={fit.ref} className="fn-records" title={<span className="fn-chips">{tx('pos.reversal_ledger')}{list.data ? <span className="fk-muted"> · {fmtNumber(list.data.total)}</span> : null}<span className="fk-hint">{tx('rv.dateShown.' + basis)}</span></span>}
        footer={<Pager info={list.data ? { page: list.data.page, pageSize: list.data.pageSize, totalItems: list.data.total, totalPages: list.data.pageCount } : null} onPage={setPage} label={tx('pos.reversal_ledger')} />}>
        {list.error ? <StateBlock error={list.error} onRetry={list.reload} /> : !list.data ? <div className="fk-loading">{tx('pos.loading')}</div>
          : rows.length === 0 ? (chips.length ? <Empty title={tx('rv.noMatches')}><button type="button" className="fk-btn" onClick={clearAll}>{tx('finance.clearFilters')}</button></Empty>
              : <Empty title={tx('pos.no_refunds_or_voids_recorded')}><span className="fk-hint">{tx('rv.emptyHint', { p: periodText(list.data.period) })}</span>
                {period.preset !== 'all' ? <button type="button" className="fk-btn" onClick={() => setPeriod({ preset: 'all' })}>{tx('rv.tryAllTime')}</button> : null}
                <button type="button" className="fk-btn" onClick={() => setFinding(true)}>{tx('rv.find')}</button></Empty>)
          : <table className="fk-table fn-table rv-table" data-testid="ledger-table">
            <thead><tr><th>{tx('rv.col.date')}</th><th>{tx('rv.col.reversal')}</th><th>{tx('rv.col.ticket')}</th><th className="num">{tx('rv.col.original')}</th><th className="num">{tx('rv.col.reversed')}</th><th className="t-opt">{tx('rv.col.method')}</th><th>{tx('finance.status')}</th><th className="t-opt">{tx('rv.col.by')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
            <tbody>{rows.map((r) => {
              const shownAt = basis === 'completed' ? r.completedAt : basis === 'original' ? r.originalAt : r.requestedAt;
              return (
                <tr key={r.kind + r.id} data-testid="reversal-row">
                  <td>{when(shownAt)}</td>
                  <td className="fn-id"><span className={'fk-chip ' + (TYPE_TONE[r.type] ?? 'mut')}>{typeLbl(r.type)}</span><span className="fk-li-s fn-mono">{short(r.id)}{r.matchedBy && q ? ` · ${tx('rv.matched.' + r.matchedBy)}` : ''}</span></td>
                  <td>{r.ticketNumber ? '#' + r.ticketNumber : <span className="fk-muted">{tx('rv.notLinked')}</span>}<span className="fk-li-s">{r.customer?.name ?? tx('rv.walkIn')}{r.customer?.phone ? ' · ' + r.customer.phone : ''}</span></td>
                  <td className="num">{fmtMoney(r.originalCents)}</td>
                  <td className="num"><b>{r.kind === 'void' ? fmtMoney(r.reversedCents) : '−' + fmtMoney(r.reversedCents)}</b></td>
                  <td className="t-opt">{methodLbl(r.method, r.giftCardLast4)}{r.card ? <span className="fk-li-s">{r.card}</span> : null}</td>
                  <td><span className={'fk-chip ' + (STATE_TONE[r.state] ?? 'mut')}>{stateLbl(r.state)}</span></td>
                  <td className="t-opt">{r.actor ?? '—'}{r.reason ? <span className="fk-li-s rv-reason">{r.reason}</span> : null}</td>
                  <td className="fn-acts"><button type="button" className="fk-btn ghost sm" onClick={() => setDetail({ kind: r.kind, id: r.id })}>{tx('finance.view')}</button></td>
                </tr>
              );
            })}</tbody>
          </table>}
      </FitPanel>
      {inbox && esc ? <EscalationInbox data={esc} onClose={() => setInbox(false)} onOpen={(kind, id) => { setInbox(false); setDetail({ kind, id }); }} /> : null}
      {detail ? <ReversalDialog kind={detail.kind} id={detail.id} tick={tick} onClose={() => setDetail(null)} onDone={done}
        onCustomer={(cid) => nav(`/tenant/customers/profiles?customerId=${encodeURIComponent(cid)}`)} onSettlement={() => nav('/tenant/payments/settlements')} /> : null}
      {finding ? <FindDialog onClose={() => setFinding(false)} onDone={(tone, text) => { setFinding(false); done(tone, text); }} /> : null}
    </div>
  );
}

/** One tender's refund position: captured · refunded · pending · still refundable, and why an action is off. */
function TenderPosition({ t, testId }: { t: Tender; testId?: string }) {
  return (
    <dl className="rv-pos" data-testid={testId ?? 'tender-position'}>
      <div><dt>{tx('rv.pos.captured')}</dt><dd>{fmtMoney(t.amountCents)}</dd></div>
      <div><dt>{tx('rv.pos.refunded')}</dt><dd>{t.refundedCents ? '−' + fmtMoney(t.refundedCents) : fmtMoney(0)}</dd></div>
      <div className={t.pendingCents ? 'warn' : ''}><dt>{tx('rv.pos.pending')}</dt><dd>{t.pendingCents ? '−' + fmtMoney(t.pendingCents) : fmtMoney(0)}</dd></div>
      <div className="total"><dt>{tx('rv.pos.refundable')}</dt><dd>{fmtMoney(t.refundableCents)}</dd></div>
    </dl>
  );
}
const whyText = (why: string | null) => (why ? tx('rv.why.' + why) : '');

function ReversalDialog({ kind, id, tick, onClose, onDone, onCustomer, onSettlement }: { kind: 'refund' | 'void'; id: string; tick: number; onClose: () => void; onDone: (tone: 'ok' | 'warn', text: string) => void; onCustomer: (id: string) => void; onSettlement: () => void }) {
  const d = useLoad(() => posRefundsVoidsApi.detail(kind, id), [kind, id, tick]);
  const r: Rev | undefined = d.data?.reversal; const o: Tender | null = d.data?.original ?? null;
  const [action, setAction] = useState<null | 'refund' | 'void' | 'ticket'>(null);
  return (
    <FitDialog wide title={r ? `${typeLbl(r.type)} · ${short(r.id)}` : tx('rv.detailTitle')} subtitle={r ? `${r.ticketNumber ? '#' + r.ticketNumber : tx('rv.notLinked')} · ${r.customer?.name ?? tx('rv.walkIn')} · ${day(r.requestedAt)}` : undefined} onClose={onClose} testId="reversal-dialog"
      footer={r ? <>
        {r.customer?.id && d.data?.permissions?.customer ? <button type="button" className="fk-btn" onClick={() => onCustomer(r.customer!.id)}>{tx('finance.openCustomer')}</button> : null}
        {o?.eligibility.refund ? <button type="button" className="fk-btn" onClick={() => setAction('refund')} data-testid="detail-refund">{tx('rv.refundTender')}</button> : null}
        {(r.state === 'needs_review' || r.state === 'processing') && r.ticketId && d.data?.permissions?.refund ? <button type="button" className="fk-btn" onClick={() => setAction('ticket')} data-testid="detail-settle">{tx('rv.checkStatus')}</button> : null}
        <button type="button" className="fk-btn primary" onClick={onClose}>{tx('pos.close')}</button></> : undefined}>
      {d.error ? <StateBlock error={d.error} onRetry={d.reload} /> : !r ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
        <div className="fn-statusline"><span className={'fk-chip ' + (STATE_TONE[r.state] ?? 'mut')}>{stateLbl(r.state)}</span><span className="fk-hint">{tx('rv.stateNote.' + r.state)}</span></div>
        <RootCausePanel rc={d.data.rootCause} />
        <div className="fn-cols2">
          <dl className="fk-dl" data-testid="reversal-facts">
            <dt>{tx('rv.f.amount')}</dt><dd><b>{fmtMoney(r.reversedCents)}</b> {r.kind === 'void' ? <span className="fk-li-s">{tx('rv.f.faceValue')}</span> : null}</dd>
            <dt>{tx('rv.f.method')}</dt><dd>{methodLbl(r.method, r.giftCardLast4)}{r.card ? ' · ' + r.card : ''}</dd>
            <dt>{tx('rv.f.processor')}</dt><dd>{r.processor ?? (r.method === 'cash' ? tx('rv.f.cashDrawer') : r.method === 'gift_card' ? tx('rv.f.giftLedger') : '—')}</dd>
            <dt>{tx('rv.f.providerRef')}</dt><dd className="fn-mono">{r.providerRef ?? '—'}</dd>
            <dt>{tx('rv.f.requested')}</dt><dd>{when(r.requestedAt)}</dd>
            <dt>{tx('rv.f.completed')}</dt><dd>{r.completedAt ? when(r.completedAt) : tx('rv.f.notYet')}</dd>
            <dt>{tx('finance.reason')}</dt><dd>{r.reason ?? '—'}</dd>
            <dt>{tx('rv.f.by')}</dt><dd>{r.actor ?? '—'}</dd>
            {r.reviewReason || r.lastError ? <><dt>{tx('rv.f.review')}</dt><dd>{codeLabel('rv.review.' + (r.reviewReason ?? ''), r.reviewReason ?? '')}{r.lastError ? <span className="fk-li-s">{tx('rv.f.lastError')}</span> : null}</dd></> : null}
            <dt>{tx('rv.f.settlement')}</dt><dd>{d.data.settlement ? <button type="button" className="fk-li-t link" onClick={onSettlement}>{d.data.settlement.reference ?? short(d.data.settlement.id)} · {codeLabel('rv.settle.' + d.data.settlement.status, d.data.settlement.status)}</button> : <span className="fk-muted">{tx('rv.notLinked')}</span>}</dd>
          </dl>
          {o ? <div><h3 className="fk-h3">{tx('rv.originalTitle')}</h3><div className="fk-li-s">{methodLbl(o.method, o.giftCardLast4)} · {when(o.at)}{o.processorRef ? ' · ' + o.processorRef : ''}</div><TenderPosition t={o} testId="original-position" />
            {!o.eligibility.refund && o.eligibility.refundWhy ? <div className="fk-hint">{tx('rv.refundOff', { why: whyText(o.eligibility.refundWhy) })}</div> : null}
            {r.kind === 'void' ? <div className="fk-hint">{tx('rv.voidNote')}</div> : null}</div> : <div className="fk-hint">{tx('rv.originalMissing')}</div>}
        </div>
        {d.data.tenders.length > 1 ? <><h3 className="fk-h3">{tx('rv.tendersTitle')}</h3>
          <table className="fk-table" data-testid="tenders-table"><thead><tr><th>{tx('rv.col.method')}</th><th className="num">{tx('rv.pos.captured')}</th><th className="num">{tx('rv.pos.held')}</th><th className="num">{tx('rv.pos.refundable')}</th><th>{tx('rv.t.ref')}</th></tr></thead>
            <tbody>{d.data.tenders.map((x: any) => <tr key={x.id} className={x.isOriginal ? 'rv-this' : ''}><td>{methodLbl(x.method, x.giftCardLast4)}{x.isOriginal ? <span className="fk-li-s">{tx('rv.t.thisOne')}</span> : null}</td><td className="num">{fmtMoney(x.amountCents)}</td><td className="num">{x.reservedCents ? '−' + fmtMoney(x.reservedCents) : '—'}</td><td className="num"><b>{fmtMoney(x.refundableCents)}</b></td><td className="fn-mono">{x.processorRef ?? '—'}</td></tr>)}</tbody></table>
          <div className="fk-hint">{tx('rv.splitNote')}</div></> : null}
        {d.data.refunds.length ? <><h3 className="fk-h3">{tx('rv.historyTitle')}</h3><ul className="fn-notes" data-testid="refund-history">{d.data.refunds.map((x: any) => <li key={x.id} className={x.isThis ? 'rv-this' : ''}><span className="fk-li-s">{when(x.at)} · {x.actor ?? '—'} · {codeLabel('rv.raw.' + x.status, x.status)}</span><div>−{fmtMoney(x.amountCents)}{x.reason ? ` — ${x.reason}` : ''}{x.providerRef ? ` · ${x.providerRef}` : ''}</div></li>)}</ul></> : null}
        {d.data.giftLedger.length ? <><h3 className="fk-h3">{tx('rv.giftTitle')}</h3><ul className="fn-notes" data-testid="gift-ledger">{d.data.giftLedger.map((g: any) => <li key={g.id}><span className="fk-li-s">{when(g.at)} · •••• {g.last4 ?? '—'}</span><div>{tx('rv.giftRestored', { a: fmtMoney(g.amountCents), b: g.balanceAfterCents == null ? '—' : fmtMoney(g.balanceAfterCents) })}</div></li>)}</ul></> : null}
        {d.data.tipAllocations.length || d.data.loyalty.length ? <><h3 className="fk-h3">{tx('rv.effectsTitle')}</h3><ul className="fn-notes">
          {d.data.financials?.tipCents ? <li><div>{tx('rv.effect.tip', { t: fmtMoney(d.data.financials.tipCents), who: d.data.tipAllocations.map((a: any) => `${a.name ?? '—'} ${fmtMoney(a.cents)}`).join(' · ') || '—' })}</div></li> : null}
          {d.data.loyalty.map((l: any) => <li key={l.id}><div>{tx('rv.effect.loyalty', { p: fmtNumber(l.points), r: fmtNumber(l.reversedPoints) })}</div></li>)}</ul><div className="fk-hint">{tx('rv.effectsNote')}</div></> : null}
        {d.data.audit?.length ? <><h3 className="fk-h3">{tx('rv.auditTitle')}</h3><ul className="fn-notes">{d.data.audit.slice(0, 8).map((a: any, i: number) => <li key={i}><span className="fk-li-s">{when(a.at)} · {a.actor ?? '—'}</span><div>{codeLabel('rv.audit.' + a.action, a.action)}</div></li>)}</ul></> : null}
      </>}
      {action === 'refund' && o ? <RefundTenderDialog tender={{ ...o, ticketNumber: r?.ticketNumber ?? null, customer: r?.customer ?? null }} onClose={() => setAction(null)} onDone={(tone, text) => { setAction(null); onDone(tone, text); d.reload(); }} /> : null}
      {action === 'ticket' && r?.ticketId ? <FitDialog wide title={tx('rv.checkStatus')} subtitle={r.ticketNumber ? '#' + r.ticketNumber : undefined} onClose={() => { setAction(null); d.reload(); }} testId="ticket-refund-dialog">
        <TicketRefundPanel ticketId={r.ticketId} label={r.customer?.name ?? undefined} onClose={() => { setAction(null); d.reload(); }} onDone={() => onDone('ok', tx('rv.done.ticket'))} /></FitDialog> : null}
    </FitDialog>
  );
}

/** REFUNDS 10 — Exception Root-Cause Advisor: the server's evidence summary for this reversal (detail.rootCause) — the Inbox's
 *  own group, each line naming the record it came from, and the next step for a person. Read only: no retry / settle here. */
interface RvRootCause { exception: boolean; cause: string | null; nextStep: string | null; readOnly: boolean;
  evidence: { code: string; value: string | number | null; sourceType: string; sourceId: string | null }[] }
function rcValue(e: RvRootCause['evidence'][number]): string {
  switch (e.code) {
    case 'raw_status': return codeLabel('rv.raw.' + String(e.value ?? ''), String(e.value ?? ''));
    case 'review_reason': return codeLabel('rv.review.' + String(e.value ?? ''), String(e.value ?? ''));
    case 'stranded_at': return when(e.value == null ? null : String(e.value));
    case 'waiting_hours': return tx('rv.rc.hours', { n: fmtNumber(Number(e.value ?? 0)) });
    case 'provider_ref': return String(e.value ?? '—');
    case 'ticket_link': return '#' + String(e.value ?? '—');
    case 'ledger_reversal': case 'settlement': return e.sourceId ? short(e.sourceId) : '—';
    default: return '';   // missing-* lines and the processor error are named, never echoed
  }
}
function RootCausePanel({ rc }: { rc: RvRootCause | undefined }) {
  if (!rc || !rc.exception) return null;
  return (
    <div className="fk-note warn" data-testid="rv-root-cause"><span>
      <b>{tx('rv.rc.title')}: {codeLabel('rv.rc.cause.' + (rc.cause ?? ''), rc.cause ?? '—')}</b>
      <ul className="tm-reasons">{rc.evidence.map((e, i) => { const v = rcValue(e); return <li key={i} data-testid="rv-rc-ev">{codeLabel('rv.rc.ev.' + e.code, e.code)}{v ? `: ${v}` : ''}</li>; })}</ul>
      {rc.nextStep ? <div data-testid="rv-rc-next"><b>{tx('rv.rc.nextTitle')}</b> {codeLabel('rv.rc.next.' + rc.nextStep, rc.nextStep)}</div> : null}
      <span className="fk-li-s">{tx('rv.rc.readOnly')}</span>
    </span></div>
  );
}

/** Find Original Payment (§6): captured tenders by name / phone / email / ticket / reference / amount, each with its refund position. */
function FindDialog({ onClose, onDone }: { onClose: () => void; onDone: (tone: 'ok' | 'warn', text: string) => void }) {
  const [query, setQuery] = useState(''); const qd = useDebounced(query.trim(), 300); const [period, setPeriod] = useState<PeriodState>({ preset: 'all' });
  const res = useLoad(() => (qd.length >= 2 ? posRefundsVoidsApi.find({ query: qd, ...periodQuery(period) }) : Promise.resolve(null)), [qd, JSON.stringify(period)]);
  const [pick, setPick] = useState<Tender | null>(null); const [act, setAct] = useState<null | 'refund' | 'void' | 'ticket'>(null);
  const items: Tender[] = res.data?.items ?? [];
  return (
    <FitDialog wide title={tx('rv.find')} subtitle={tx('rv.findSub')} onClose={onClose} testId="find-dialog" footer={<button type="button" className="fk-btn primary" onClick={onClose}>{tx('pos.close')}</button>}>
      <div className="fn-search"><input className="fk-search wide" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tx('rv.findPh')} aria-label={tx('rv.findPh')} data-testid="find-query" autoFocus /></div>
      <PeriodBar value={period} onChange={setPeriod} server={res.data?.period} allowAll compact />
      {qd.length < 2 ? <div className="fk-hint">{tx('rv.findHint')}</div> : res.error ? <StateBlock error={res.error} onRetry={res.reload} /> : !res.data ? <div className="fk-loading">{tx('pos.loading')}</div>
        : items.length === 0 ? <Empty title={tx('rv.findNone')}><span className="fk-hint">{tx('rv.findNoneHint')}</span></Empty>
        : <table className="fk-table fn-table rv-find" data-testid="find-results"><thead><tr><th>{tx('rv.col.ticket')}</th><th>{tx('rv.col.method')}</th><th className="num">{tx('rv.pos.captured')}</th><th className="num">{tx('rv.pos.refundable')}</th><th aria-label={tx('finance.actions')} /></tr></thead>
          <tbody>{items.map((t) => <tr key={t.id} data-testid="find-row" className={pick?.id === t.id ? 'rv-this' : ''}>
            <td>{t.ticketNumber ? '#' + t.ticketNumber : tx('rv.notLinked')}<span className="fk-li-s">{t.customer?.name ?? tx('rv.walkIn')}{t.customer?.phone ? ' · ' + t.customer.phone : ''} · {day(t.at)}</span></td>
            <td>{methodLbl(t.method, t.giftCardLast4)}<span className="fk-li-s">{t.card ?? t.processor ?? ''}{t.processorRef ? ' · ' + t.processorRef : ''}</span></td>
            <td className="num">{fmtMoney(t.amountCents)}</td>
            <td className="num"><b>{fmtMoney(t.refundableCents)}</b>{t.refundedCents || t.pendingCents ? <span className="fk-li-s">{tx('rv.pos.line', { r: fmtMoney(t.refundedCents), p: fmtMoney(t.pendingCents) })}</span> : null}</td>
            <td className="fn-acts">
              {t.eligibility.refund ? <button type="button" className="fk-btn sm" onClick={() => { setPick(t); setAct('refund'); }} data-testid="find-refund">{tx('rv.refund')}</button> : <span className="fk-li-s rv-why">{whyText(t.eligibility.refundWhy)}</span>}
              {t.eligibility.void ? <button type="button" className="fk-btn sm" onClick={() => { setPick(t); setAct('void'); }} data-testid="find-void">{tx('rv.void')}</button> : null}
            </td></tr>)}</tbody></table>}
      <div className="fk-hint">{tx('rv.findNote')}</div>
      {act === 'refund' && pick ? <RefundTenderDialog tender={pick} onClose={() => setAct(null)} onDone={onDone} onTicket={pick.ticketId ? () => setAct('ticket') : undefined} /> : null}
      {act === 'void' && pick ? <VoidDialog tender={pick} onClose={() => setAct(null)} onDone={onDone} /> : null}
      {act === 'ticket' && pick?.ticketId ? <FitDialog wide title={tx('rv.wholeTicket')} subtitle={pick.ticketNumber ? '#' + pick.ticketNumber : undefined} onClose={() => setAct(null)} testId="ticket-refund-dialog">
        <TicketRefundPanel ticketId={pick.ticketId} label={pick.customer?.name ?? undefined} onClose={() => setAct(null)} onDone={(r) => onDone(r.complete ? 'ok' : 'warn', r.complete ? tx('rv.done.ticket') : tx('rv.done.ticketPartial'))} /></FitDialog> : null}
    </FitDialog>
  );
}

/** REFUNDS 05 — Refund Receipt Preview: what the customer's refund receipt would say, built only from the tender the server
 *  returned and the amount typed. Shown at the review step; it is a PROPOSAL — nothing is sent, printed or saved, and the
 *  final answer is the server's (refunded / waiting for approval / pending / unknown — held) after Confirm. */
function RefundReceiptPreview({ tender, cents, reason }: { tender: Tender; cents: number; reason: string }) {
  const after = Math.max(0, tender.refundableCents - cents);
  const kind = cents >= tender.refundableCents && tender.refundedCents === 0 && tender.pendingCents === 0 ? 'full' : 'partial';
  return (
    <div className="panel" data-testid="refund-receipt-preview" style={{ padding: 10, margin: '8px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><b>{tx('rv.rcpt.title')}</b><span className="fk-chip warn">{tx('rv.rcpt.proposed')}</span></div>
      <dl className="fk-dl" style={{ marginTop: 6 }}>
        <dt>{tx('rv.rcpt.ticket')}</dt><dd>{tender.ticketNumber ? '#' + tender.ticketNumber : tx('rv.notLinked')}</dd>
        <dt>{tx('rv.rcpt.customer')}</dt><dd>{tender.customer?.name ?? tx('rv.walkIn')}</dd>
        <dt>{tx('rv.rcpt.original')}</dt><dd>{methodLbl(tender.method, tender.giftCardLast4)}{tender.card ? ' · ' + tender.card : ''} · {fmtMoney(tender.amountCents)} · {day(tender.at)}</dd>
        <dt>{tx('rv.rcpt.type')}</dt><dd>{tx('rv.rcpt.kind.' + kind)}</dd>
        <dt>{tx('rv.rcpt.amount')}</dt><dd><b data-testid="rcpt-amount">−{fmtMoney(cents)}</b></dd>
        <dt>{tx('rv.rcpt.to')}</dt><dd>{tx('rv.rcpt.to.' + (tender.method === 'cash' || tender.method === 'gift_card' ? tender.method : 'card'), { m: methodLbl(tender.method, tender.giftCardLast4) })}</dd>
        <dt>{tx('rv.rcpt.left')}</dt><dd data-testid="rcpt-left">{fmtMoney(after)}</dd>
        <dt>{tx('finance.reason')}</dt><dd>{reason || '—'}</dd>
      </dl>
      <div className="fk-hint" data-testid="rcpt-note">{tx('rv.rcpt.note')}</div>
    </div>
  );
}

/** Refund ONE original tender (never a ticket total as one charge): amount ≤ refundable, reason, review, step-up, one key per intent. */
function RefundTenderDialog({ tender, onClose, onDone, onTicket }: { tender: Tender; onClose: () => void; onDone: (tone: 'ok' | 'warn', text: string) => void; onTicket?: () => void }) {
  const [amount, setAmount] = useState(textFromCents(tender.refundableCents)); const [reason, setReason] = useState(''); const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const keys = useRef(createIntentKeys()); const stepUp = useStepUp(tx('rv.stepUp'));
  const cents = centsFromText(amount); const over = cents != null && cents > tender.refundableCents;
  const valid = cents != null && cents > 0 && !over && !!reason.trim();
  const submit = async () => {
    if (cents == null) return;
    const body = { reason: reason.trim(), amountCents: cents }; const intent = `refund:${tender.id}`;
    setBusy(true); setErr(null);
    const key = heldKey(keys.current, intent, body); holdInflight('refund', tender, intent, body, key, cents);
    try {
      const r: any = await stepUp.run(() => posCheckoutApi.refund(tender.id, body, key));
      keys.current.done(intent); clearInflight();
      if (r?.status === 'refunded') onDone('ok', tx('rv.done.refunded', { a: fmtMoney(cents) }));
      else if (r?.status === 'approval_pending') onDone('warn', tx('rv.done.approval'));
      else if (r?.configured === false) setErr(tx('rv.notConfigured'));
      else onDone('warn', tx('rv.done.pending'));
    } catch (e: any) {
      if (isStepUpCancelled(e)) { clearInflight(); return; }
      if (serverAnswered(e)) clearInflight();
      // the processor answer was lost: the amount stays held, NOTHING is sent again; the sweep / a manager settles it
      if (e?.body?.code === 'REFUND_STATUS_UNKNOWN' || e?.code === 'REFUND_STATUS_UNKNOWN' || /REFUND_STATUS_UNKNOWN/.test(String(e?.message))) { keys.current.done(intent); onDone('warn', tx('rv.done.unknown')); return; }
      setErr(errorTextOf(e, tx('pos.something_went_wrong')));
    } finally { setBusy(false); }
  };
  return (
    <FitDialog title={tx('rv.refundTitle', { m: methodLbl(tender.method, tender.giftCardLast4) })} subtitle={`${tender.ticketNumber ? '#' + tender.ticketNumber + ' · ' : ''}${tender.customer?.name ?? tx('rv.walkIn')}`} onClose={onClose} busy={busy} testId="refund-dialog"
      footer={<>{onTicket && !review ? <button type="button" className="fk-btn ghost" onClick={onTicket} disabled={busy} data-testid="refund-by-ticket">{tx('rv.wholeTicket')}</button> : null}
        <button type="button" className="fk-btn" onClick={review ? () => setReview(false) : onClose} disabled={busy}>{review ? tx('rv.back') : tx('pos.cancel')}</button>
        {review ? <button type="button" className="fk-btn primary" onClick={submit} disabled={busy} data-testid="confirm-refund">{busy ? tx('pos.loading') : tx('rv.confirmRefund', { a: fmtMoney(cents ?? 0) })}</button>
          : <button type="button" className="fk-btn primary" onClick={() => setReview(true)} disabled={!valid} data-testid="review-refund">{tx('rv.reviewRefund')}</button>}</>}>
      <TenderPosition t={tender} />
      {review ? <><div className="fk-note warn" data-testid="refund-review"><span>{tx('rv.reviewText', { a: fmtMoney(cents ?? 0), m: methodLbl(tender.method, tender.giftCardLast4), o: fmtMoney(tender.amountCents), r: reason.trim() })}</span></div>
        <ActionActorLine testId="refund-actor" />
        <RefundReceiptPreview tender={tender} cents={cents ?? 0} reason={reason.trim()} /></> : <>
        <label className="fk-field"><span>{tx('rv.amount', { max: fmtMoney(tender.refundableCents) })}</span><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="refund-amount" /></label>
        {over ? <div className="fk-error" role="alert">{tx('rv.overMax', { max: fmtMoney(tender.refundableCents) })}</div> : null}
        <label className="fk-field"><span>{tx('rv.reasonRequired')}</span><textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="refund-reason" /></label>
        <div className="fk-hint">{tx('rv.refundMethodNote.' + (tender.method === 'cash' || tender.method === 'gift_card' ? tender.method : 'card'))}</div>
      </>}
      {err ? <div className="fk-error" role="alert" data-testid="refund-error">{err}</div> : null}
      {stepUp.prompt}
    </FitDialog>
  );
}

/** Void an eligible, unsettled, unrefunded tender (never a silent substitute for a refund). */
function VoidDialog({ tender, onClose, onDone }: { tender: Tender; onClose: () => void; onDone: (tone: 'ok' | 'warn', text: string) => void }) {
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const keys = useRef(createIntentKeys()); const stepUp = useStepUp(tx('rv.stepUp'));
  const submit = async () => {
    const body = { reason: reason.trim() }; const intent = `void:${tender.id}`;
    setBusy(true); setErr(null);
    const key = heldKey(keys.current, intent, body); holdInflight('void', tender, intent, body, key, tender.amountCents);
    try {
      const r: any = await stepUp.run(() => posCheckoutApi.void(tender.id, body, key));
      keys.current.done(intent); clearInflight();
      if (r?.status === 'voided') onDone('ok', tx('rv.done.voided', { a: fmtMoney(tender.amountCents) }));
      else if (r?.configured === false) setErr(tx('rv.notConfigured'));
      else onDone('warn', tx('rv.done.pending'));
    } catch (e: any) { if (isStepUpCancelled(e)) { clearInflight(); return; } if (serverAnswered(e)) clearInflight(); setErr(errorTextOf(e, tx('pos.something_went_wrong'))); } finally { setBusy(false); }
  };
  return (
    <FitDialog title={tx('rv.voidTitle', { a: fmtMoney(tender.amountCents) })} subtitle={`${tender.ticketNumber ? '#' + tender.ticketNumber + ' · ' : ''}${methodLbl(tender.method, tender.giftCardLast4)}${tender.processorRef ? ' · ' + tender.processorRef : ''}`} onClose={onClose} busy={busy} testId="void-dialog"
      footer={<><button type="button" className="fk-btn" onClick={onClose} disabled={busy}>{tx('pos.cancel')}</button><button type="button" className="fk-btn primary" onClick={submit} disabled={busy || !reason.trim()} data-testid="confirm-void">{busy ? tx('pos.loading') : tx('rv.confirmVoid')}</button></>}>
      <div className="fk-note warn"><span>{tx('rv.voidExplain')}</span></div>
      <ActionActorLine testId="void-actor" />
      <label className="fk-field"><span>{tx('rv.reasonRequired')}</span><textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="void-reason" autoFocus /></label>
      {err ? <div className="fk-error" role="alert">{err}</div> : null}
      {stepUp.prompt}
    </FitDialog>
  );
}
