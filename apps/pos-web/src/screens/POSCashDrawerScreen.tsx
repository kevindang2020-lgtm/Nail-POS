import { AiAssistantPanel } from '../components/AiAssistantPanel';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createIntentKeys } from '@aipowersalon/api-client';
import { posCashDrawerApi, type DrawerState, type DrawerStatus, type CashMovement, type DrawerRegister, type DrawerHistory, type DrawerHistoryRow, type DrawerActivity, type DrawerActivityRow } from '../api/posCashDrawerApi';
import { useCan } from '../components/usePermissions';
import { useRealtime } from '../realtime/useRealtime';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { msg, renderMsg, type Msg } from '../i18n/notice';
import { fmtInZone } from '../i18n/format';   // the location's clock (not the device's)
import { FitDialog, FitPanel, KpiCard, Pager, Empty, useDebounced, useFitRows, downloadCsv } from '../components/FitKit';
import { PeriodBar, type PeriodState } from '../components/FinanceKit';

// Cash Drawer (front desk). Register cash for the chosen date = opening float + cash sales − cash refunds ± cash in / out.
// Excludes the Skip-the-Line cash-to-technician payments (those reconcile in End-of-Day Cash).
// The business date comes from the SERVER (the branch's own day): the browser's UTC date opened TOMORROW's drawer after
// about 8 pm in New York (audit Nov 3 2026). Empty until the first answer names it.
//
// SUNMI FLEX 3 Cash Drawer addendum (Nov 7 2026) — ONE screen at 100 % zoom, nothing removed:
//   header (title · Date · Register · status · Refresh · Export) · five equal KPI cards (Variance reads "Pending count"
//   until a count exists — never a verified $0.00) · three equal operational cards: Opening Float | Cash In / Cash Out |
//   Count & Reconcile (bills and coins in their own dialog; the manager sign-off stays in the card) · Cash Drawer
//   Activity — every cash event of the register (float, cash sales, refunds, cash in / out) with Business Date ·
//   Movement / Reference · Customer or Employee · Ticket / Session · Cash In · Cash Out · Status / Actions, ONE search box
//   (customer, phone, #ticket, employee, reason), the drawer's day or Today / Week / Month / Year / Custom, server pages
//   newest first sized to the room left, a detail overlay; Drawer History (past counts) beside it as a tab · AI Fraud /
//   Money Protection at the bottom, after the activity. The ledger reads the same rows as the drawer's math, so its
//   cash in − cash out equals Expected in Drawer for the drawer's day.
const money = (c: number | null | undefined) => '$' + ((c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const STATUS: Record<DrawerStatus, { label: string; color: string; bg: string }> = {
  open: { get label() { return t('pos.open'); }, color: '#7a5a12', bg: 'rgba(169,111,34,.14)' },
  reconciled: { get label() { return t('pos.reconciled'); }, color: '#1f7a4d', bg: 'rgba(31,122,77,.14)' },
  discrepancy: { get label() { return t('pos.discrepancy'); }, color: '#b3261e', bg: 'rgba(179,38,30,.12)' },
  cancelled: { get label() { return t('pos.cancelled'); }, color: 'var(--ink-soft, #6b5d49)', bg: 'rgba(0,0,0,.05)' },
};

// D15 gaps (Nov 5 2026): bills and coins, in cents (the server checks the same list)
const DENOMS = [10000, 5000, 2000, 1000, 500, 200, 100, 50, 25, 10, 5, 1];
const denomLabel = (c: number) => (c >= 100 ? '$' + c / 100 : c + '¢');
const KINDS = ['sale', 'refund', 'cash_in', 'cash_out', 'float'] as const;
type LedgerPeriod = PeriodState | { preset: 'session' };

export function POSCashDrawerScreen() {
  const can = useCan();
  const [date, setDate] = useState('');
  const [d, setD] = useState<DrawerState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<Msg | null>(null);   // a KEY, translated at render (WP-D2)
  const [floatStr, setFloatStr] = useState('');
  const [countStr, setCountStr] = useState('');
  const [reconNotes, setReconNotes] = useState('');
  const [byDenom, setByDenom] = useState(false); const [denoms, setDenoms] = useState<Record<string, string>>({});
  const [denomOpen, setDenomOpen] = useState(false);
  const denomTotal = DENOMS.reduce((a, c) => a + c * (parseInt(denoms[String(c)] || '0', 10) || 0), 0);
  const [signNote, setSignNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [moveAmt, setMoveAmt] = useState('');
  const [moveDir, setMoveDir] = useState<'in' | 'out'>('out');
  const [moveReason, setMoveReason] = useState('');
  // D15 (Nov 4 2026): one drawer per register — the picker shows when the location has registers set up
  const [registers, setRegisters] = useState<DrawerRegister[]>([]);
  const [registerId, setRegisterId] = useState('main');
  useEffect(() => { posCashDrawerApi.registers().then((r) => setRegisters(r.registers || [])).catch(() => setRegisters([])); }, []);

  // Cash Drawer Activity (the ledger) + Drawer History (past counts) — one panel, two tabs
  const [tab, setTab] = useState<'activity' | 'history'>('activity');
  const [aPeriod, setAPeriod] = useState<LedgerPeriod>({ preset: 'session' });
  const [aKind, setAKind] = useState(''); const [aSearch, setASearch] = useState(''); const aQ = useDebounced(aSearch.trim(), 300);
  const [aPage, setAPage] = useState(1); const [act, setAct] = useState<DrawerActivity | null>(null); const [actErr, setActErr] = useState<string | null>(null);
  const [actTick, setActTick] = useState(0); const [openAct, setOpenAct] = useState<DrawerActivityRow | null>(null);
  const fit = useFitRows<HTMLDivElement>(42, { min: 3, max: 12, reserve: 34 });
  const pageSize = [3, 4, 5, 6, 8, 10].reduce((best, n) => (n <= fit.rows ? n : best), 3);

  const load = useCallback(() => {
    posCashDrawerApi.state(date || undefined, registerId)
      .then((s) => { setD(s); setError(null); if (!date && s.businessDate) setDate(s.businessDate); setFloatStr((s.openingFloatCents / 100).toFixed(2)); if (s.countedCents != null) setCountStr((s.countedCents / 100).toFixed(2)); })
      .catch((e: { message?: string }) => setError(e?.message || t('pos.failed_to_load_the_cash_drawer')));
    setActTick((n) => n + 1);
  }, [date, registerId]);
  useEffect(() => { load(); }, [load]);
  useRealtime('cash-drawer', load);

  // the ledger's period as plain values (the drawer's own day, a preset, or a custom range)
  const aPreset = aPeriod.preset; const aFrom = aPeriod.preset === 'custom' ? (aPeriod as PeriodState).from ?? '' : ''; const aTo = aPeriod.preset === 'custom' ? (aPeriod as PeriodState).to ?? '' : '';
  useEffect(() => { setAPage(1); }, [aPreset, aFrom, aTo, aKind, aQ, registerId, date, pageSize]);
  useEffect(() => {
    if (!date) return;
    let live = true;
    posCashDrawerApi.activity({ registerId, ...periodParams(aPreset, aFrom, aTo, date), kind: aKind || undefined, q: aQ || undefined, page: aPage, pageSize })
      .then((a) => { if (live) { setAct(a); setActErr(null); } }).catch((e: { message?: string }) => { if (live) setActErr(e?.message || t('cdr.act.failed')); });
    return () => { live = false; };
  }, [date, registerId, aPreset, aFrom, aTo, aKind, aQ, aPage, pageSize, actTick]);

  const keys = useRef(createIntentKeys());
  const setFloat = async () => {
    const dollars = Number(floatStr);
    if (!Number.isFinite(dollars) || dollars < 0) { setError(t('pos.enter_the_opening_float')); return; }
    setBusy('float'); setError(null); setNote(null);
    try { const cents = Math.round(dollars * 100); const s = await posCashDrawerApi.open(cents, date || undefined, keys.current.keyFor('float', { cents, date, registerId }), registerId); keys.current.done('float'); setD(s); setActTick((n) => n + 1); setNote(msg('pos.opening_float_set_to_openingfloatcents', { openingFloatCents: String(money(s.openingFloatCents)) })); }
    catch (e) { setError((e as { message?: string })?.message || t('pos.could_not_set_the_float')); }
    finally { setBusy(null); }
  };
  const reconcile = async () => {
    const dollars = byDenom ? denomTotal / 100 : Number(countStr);
    if (!Number.isFinite(dollars) || dollars < 0) { setError(t('pos.enter_the_counted_cash_amount')); return; }
    setBusy('reconcile'); setError(null); setNote(null);
    try {
      const denominations = byDenom ? Object.fromEntries(DENOMS.map((c) => [String(c), parseInt(denoms[String(c)] || '0', 10) || 0]).filter(([, n]) => (n as number) > 0)) : undefined;
      const body = { cents: byDenom ? denomTotal : Math.round(dollars * 100), notes: reconNotes.trim() || undefined, date, registerId, denominations, expectedCashCents: d ? (d.liveExpectedCashCents ?? d.expectedCashCents) : undefined };
      const s = await posCashDrawerApi.reconcile(body.cents, body.notes, date || undefined, keys.current.keyFor('reconcile', body), registerId, { expectedCashCents: body.expectedCashCents, denominations }); keys.current.done('reconcile');
      setHistTick((n) => n + 1);
      const v = s.varianceCents ?? 0;
      setNote(s.status === 'reconciled' ? msg('pos.drawer_reconciled_matched_countedcents', { countedCents: String(money(s.countedCents)) }) : msg('pos.drawer_v0_by_v', { v0: msg(v > 0 ? 'payment.cash.over' : 'payment.cash.short'), v: String(money(Math.abs(v))) }));
      setD(s);
    } catch (e) { setError((e as { message?: string })?.message || t('pos.could_not_reconcile')); }
    finally { setBusy(null); }
  };
  const signOff = async () => {
    setBusy('sign'); setError(null);
    try { const body = { note: signNote.trim(), date, registerId }; const s = await posCashDrawerApi.approve(body.note, date || undefined, keys.current.keyFor('sign', body), registerId); keys.current.done('sign'); setD(s); setSignNote(''); setHistTick((n) => n + 1); }
    catch (e) { setError((e as { message?: string })?.message || t('pos.could_not_reconcile')); }
    finally { setBusy(null); }
  };
  // D15 gaps (Nov 5 2026): drawer history — date range, status, search, server pages
  const [hFrom, setHFrom] = useState(''); const [hTo, setHTo] = useState(''); const [hStatus, setHStatus] = useState(''); const [hQ, setHQ] = useState(''); const [hPage, setHPage] = useState(1); const [histTick, setHistTick] = useState(0);
  const [hist, setHist] = useState<DrawerHistory | null>(null); const [openRow, setOpenRow] = useState<DrawerHistoryRow | null>(null);
  const [openMoves, setOpenMoves] = useState<CashMovement[] | null>(null);
  useEffect(() => { if (!openRow) { setOpenMoves(null); return; } posCashDrawerApi.movements(openRow.businessDate, openRow.registerId).then((m) => setOpenMoves(m.movements)).catch(() => setOpenMoves([])); }, [openRow]); const [histErr, setHistErr] = useState<string | null>(null);
  useEffect(() => { setHPage(1); }, [hFrom, hTo, hStatus, hQ, registerId]);
  useEffect(() => {
    let live = true;
    const tm = setTimeout(() => { posCashDrawerApi.history({ from: hFrom || undefined, to: hTo || undefined, status: hStatus || undefined, q: hQ.trim() || undefined, registerId, page: hPage, pageSize: 10 })
      .then((h) => { if (live) { setHist(h); setHistErr(null); } }).catch((e: { message?: string }) => { if (live) setHistErr(e?.message || t('cdr.histFailed')); }); }, 250);
    return () => { live = false; clearTimeout(tm); };
  }, [hFrom, hTo, hStatus, hQ, hPage, registerId, histTick]);
  const addMovement = async () => {
    const dollars = Number(moveAmt);
    if (!Number.isFinite(dollars) || dollars <= 0) { setError(t('pos.enter_an_amount_greater_than_zero')); return; }
    setBusy('movement'); setError(null); setNote(null);
    try {
      const body = { moveDir, cents: Math.round(dollars * 100), reason: moveReason.trim() || undefined, date, registerId };
      // one key per cash in/out until it is recorded: a double tap or a retry after a dropped connection records it once
      const s = await posCashDrawerApi.movement(moveDir, body.cents, body.reason, undefined, date || undefined, keys.current.keyFor('movement', body), registerId); keys.current.done('movement');
      setD(s); setMoveAmt(''); setMoveReason(''); setActTick((n) => n + 1);
      setNote(msg('pos.recorded_v0_of_v1', { v0: msg(moveDir === 'in' ? 'pos.cash_in_2' : 'pos.cash_out_2'), v1: String(money(Math.round(dollars * 100))) }));
    } catch (e) { setError((e as { message?: string })?.message || t('pos.could_not_record_the_movement')); }
    finally { setBusy(null); }
  };
  const voidMovement = async (movementId: string) => {
    setBusy('void'); setError(null); setNote(null);
    try {
      const s = await posCashDrawerApi.voidMovement(movementId, date || undefined, registerId);
      setD(s); setNote(msg('pos.movement_voided')); setOpenAct(null); setActTick((n) => n + 1);
    } catch (e) { setError((e as { message?: string })?.message || t('pos.could_not_void_the_movement')); }
    finally { setBusy(null); }
  };
  // Export: the ledger as listed (same filters), every page, as CSV — no phone numbers
  const exportLedger = async () => {
    setBusy('export'); setError(null);
    try {
      const rows: DrawerActivityRow[] = []; let page = 1, pages = 1;
      do { const a = await posCashDrawerApi.activity({ registerId, ...periodParams(aPreset, aFrom, aTo, date), kind: aKind || undefined, q: aQ || undefined, page, pageSize: 50 }); rows.push(...a.items); pages = a.pages; page++; } while (page <= pages && page <= 200);
      downloadCsv(`cash-drawer-${date}.csv`, ['businessDate', 'time', 'movement', 'reference', 'customer', 'employee', 'ticket', 'cashIn', 'cashOut', 'status'].map((k) => t('cdr.csv.' + k)),
        rows.map((r) => [r.businessDate, r.at ? fmtInZone(r.at, { hour: 'numeric', minute: '2-digit' }) : '', t('cdr.kind.' + r.kind), r.reason ?? '', r.customer ?? '', r.employee ?? '', r.ticketNumber ? '#' + r.ticketNumber : '',
          (r.cashInCents / 100).toFixed(2), (r.cashOutCents / 100).toFixed(2), t('cdr.state.' + stateKey(r))]));
      setNote(msg('cdr.exported', { n: String(rows.length) }));
    } catch (e) { setError((e as { message?: string })?.message || t('cdr.act.failed')); }
    finally { setBusy(null); }
  };

  const st = d ? (STATUS[d.status] || STATUS.open) : null;
  const v = d?.varianceCents;
  const canTake = can('checkout.process_payment');
  // 'main' is the location's one drawer (or the cash with no station, when stations exist) — said in the POS language
  const regName = (id: string, named?: string | null) => (id === 'main' ? (registers.length > 1 ? t('pos.cash_drawer_unassigned') : t('cdr.mainRegister')) : named ?? (registers.find((x) => x.registerId === id)?.name ?? t('cdr.register')));
  const isDay = aPeriod.preset === 'session';

  return (
    <div className="work fit cdr" data-testid="cash-drawer-screen">
      <header className="fk-head cdr-head">
        <div className="vh" style={{ marginBottom: 0, minWidth: 0 }}><h1>{t('pos.cash_drawer')}</h1><div className="sub">{t('pos.register_cash_opening_float_cash_sales_1baa')}</div></div>
        <div className="fk-head-actions cdr-session" data-module-id="cdr-session">
          <label className="cdr-field">{t('pos.date')}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="fk-select" /></label>
          {registers.length > 1 ? <label className="cdr-field">{t('pos.cash_drawer_register')}<select className="fk-select" aria-label={t('pos.cash_drawer_register')} value={registerId} onChange={(e) => { setRegisterId(e.target.value); setD(null); setAct(null); setNote(null); setCountStr(''); }}>
            {registers.map((r) => <option key={r.registerId} value={r.registerId}>{r.registerId === 'main' ? t('pos.cash_drawer_unassigned') : r.name}</option>)}
          </select></label> : null}
          {st ? <span className="cdr-chip" style={{ color: st.color, background: st.bg }} data-testid="drawer-status">{st.label}</span> : null}
          <button type="button" className="fk-btn" onClick={load} data-testid="refresh">{t('pos.refresh')}</button>
          <button type="button" className="fk-btn ghost" onClick={exportLedger} disabled={busy === 'export' || !act || act.total === 0} title={act && act.total === 0 ? t('cdr.exportNothing') : undefined} data-testid="export">{busy === 'export' ? t('pos.loading') : t('cdr.export')}</button>
        </div>
      </header>
      {error || note ? <div className={'fk-note ' + (error ? 'bad' : 'ok')} role={error ? 'alert' : 'status'} data-testid="note"><span>{error ?? (note ? renderMsg(note) : '')}</span><button type="button" className="fk-x" aria-label={t('pos.dismiss')} onClick={() => { setError(null); setNote(null); }}>✕</button></div> : null}

      <div className="fk-kpis five" data-testid="kpis">
        <KpiCard testId="kpi-float" label={t('pos.opening_float')} value={d ? money(d.openingFloatCents) : '—'} loading={!d && !error} sub={d ? t('cdr.kpi.floatSub', { day: d.businessDate ?? date }) : undefined} />
        <KpiCard testId="kpi-sales" label={t('pos.cash_sales')} value={d ? money(d.expectedSalesCents) : '—'} loading={!d && !error} sub={t('cdr.kpi.salesSub')} />
        <KpiCard testId="kpi-refunds" label={t('pos.refunds')} value={d ? (d.refundsCents ? '−' + money(d.refundsCents) : money(0)) : '—'} loading={!d && !error} sub={t('cdr.kpi.refundsSub')} />
        <KpiCard testId="kpi-expected" tone="gold" label={t('pos.expected_in_drawer')} value={d ? money(d.expectedCashCents) : '—'} loading={!d && !error}
          sub={d && (d.paidInCents || d.paidOutCents) ? t('cdr.kpi.expectedMoves', { in: money(d.paidInCents), out: money(d.paidOutCents) }) : t('cdr.kpi.expectedSub')} />
        <KpiCard testId="kpi-variance" tone={v == null ? undefined : v === 0 ? 'ok' : 'bad'} label={t('pos.variance')} loading={!d && !error}
          value={!d ? '—' : v == null ? t('cdr.pendingCount') : (v > 0 ? '+' : v < 0 ? '−' : '') + money(Math.abs(v))} sub={!d ? undefined : v == null ? t('cdr.kpi.varianceSub') : t('cdr.kpi.countedSub', { amount: money(d.countedCents) })} />
      </div>

      <div className="fk-row three cdr-ops">
        <FitPanel testId="panel-float" title={t('pos.opening_float')}>
          <div className="cdr-card">
            <div className="fk-hint">{t('cdr.floatHint', { register: regName(registerId), day: d?.businessDate ?? date })}</div>
            <div className="cdr-line">
              <label className="cdr-field grow">{t('pos.float_in_drawer_at_open')}<input type="number" min="0" step="0.01" value={floatStr} onChange={(e) => setFloatStr(e.target.value)} className="fk-search" /></label>
              <button type="button" className="fk-btn primary" disabled={busy === 'float' || !canTake} title={!canTake ? t('people.fit.noPermission') : undefined} onClick={setFloat}>{busy === 'float' ? t('pos.saving_2') : t('pos.set_float')}</button>
            </div>
          </div>
        </FitPanel>
        <FitPanel testId="panel-moves" title={t('pos.cash_in_out')}>
          <div className="cdr-card">
            <div className="fk-hint">{t('pos.record_cash_added_to_or_removed_1wip')}</div>
            <div className="cdr-line">
              <div className="cdr-field">{t('pos.direction_2')}
                <div className="fk-seg cdr-dir">
                  <button type="button" className={moveDir === 'in' ? 'on' : ''} aria-pressed={moveDir === 'in'} onClick={() => setMoveDir('in')}>{t('pos.cash_in')}</button>
                  <button type="button" className={moveDir === 'out' ? 'on' : ''} aria-pressed={moveDir === 'out'} onClick={() => setMoveDir('out')}>{t('pos.cash_out')}</button>
                </div>
              </div>
              <label className="cdr-field amt">{t('pos.amount')}<input type="number" min="0" step="0.01" value={moveAmt} onChange={(e) => setMoveAmt(e.target.value)} className="fk-search" /></label>
            </div>
            <div className="cdr-line">
              <label className="cdr-field grow">{t('pos.reason_optional')}<input value={moveReason} onChange={(e) => setMoveReason(e.target.value)} placeholder={t('pos.e_g_petty_cash_cash_drop')} className="fk-search" /></label>
              <button type="button" className="fk-btn primary" disabled={busy === 'movement' || !canTake} title={!canTake ? t('people.fit.noPermission') : undefined} onClick={addMovement}>{busy === 'movement' ? t('pos.saving_2') : t('pos.record')}</button>
            </div>
          </div>
        </FitPanel>
        <FitPanel testId="panel-count" title={t('pos.count_reconcile')}>
          <div className="cdr-card">
            <div className="fk-hint">{t('pos.expected_in_drawer_2')}{' '}<strong>{d ? money(d.expectedCashCents) : '—'}</strong> {d ? t('pos.float_openingfloatcents_sales_expectedsalescents_refunds_refundscents_lvsv', { openingFloatCents: String(money(d.openingFloatCents)), expectedSalesCents: String(money(d.expectedSalesCents)), refundsCents: String(money(d.refundsCents)), v3: String(d.paidInCents ? t('pos.in_paidincents', { paidInCents: String(money(d.paidInCents)) }) : ''), v4: String(d.paidOutCents ? t('pos.out_paidoutcents', { paidOutCents: String(money(d.paidOutCents)) }) : '') }) : ''}</div>
            <div className="cdr-line">
              <label className="cdr-field amt">{t('pos.counted_cash')}<input type="number" min="0" step="0.01" value={byDenom ? (denomTotal / 100).toFixed(2) : countStr} readOnly={byDenom} data-testid="count-input" onChange={(e) => setCountStr(e.target.value)} className="fk-search" /></label>
              <label className="cdr-field grow">{t('pos.note_optional')}<input value={reconNotes} onChange={(e) => setReconNotes(e.target.value)} placeholder={t('pos.e_g_register_short_on_count')} className="fk-search" /></label>
            </div>
            <div className="cdr-line">
              <button type="button" className="fk-btn ghost" onClick={() => setDenomOpen(true)} data-testid="by-denom">{byDenom ? t('cdr.byDenomOn', { amount: money(denomTotal) }) : t('cdr.byDenom')}</button>
              <button type="button" className="fk-btn primary cdr-push" disabled={busy === 'reconcile' || !canTake} title={!canTake ? t('people.fit.noPermission') : undefined} onClick={reconcile}>{busy === 'reconcile' ? t('pos.saving_2') : t('pos.reconcile')}</button>
            </div>
            {d && d.countedCents != null ? <div className="fk-hint" data-testid="count-result">{t('pos.counted')}{' '}{money(d.countedCents)} · {d.status === 'reconciled' ? t('pos.matched_exactly') : t((d.varianceCents || 0) > 0 ? 'cdr.over' : 'cdr.short', { amount: money(Math.abs(d.varianceCents || 0)) })}{d.notes ? ` · ${d.notes}` : ''}</div> : null}
            {d?.approvalRequired && !d.approvedAt ? <div role="status" data-testid="needs-review" className="cdr-review">{t('cdr.needsReview')}
              {can('checkout.manage_overrides') ? <span className="cdr-line"><input value={signNote} onChange={(e) => setSignNote(e.target.value)} placeholder={t('cdr.signNotePh')} data-testid="sign-note" className="fk-search" />
                <button type="button" className="fk-btn" disabled={busy === 'sign' || signNote.trim().length < 3} onClick={signOff} data-testid="sign-off">{t('cdr.signOff')}</button></span> : null}</div> : null}
            {d?.approvedAt ? <div className="fk-hint" data-testid="signed-off">{t('cdr.signedOff', { name: d.approvedBy ?? '—' })}{d.approvalNote ? ` · ${d.approvalNote}` : ''}</div> : null}
            {d?.denominations && Object.keys(d.denominations).length ? <div className="fk-hint">{t('cdr.breakdown')} {DENOMS.filter((c) => d.denominations?.[String(c)]).map((c) => `${denomLabel(c)} × ${d.denominations![String(c)]}`).join(' · ')}</div> : null}
            {d?.changedSinceCount && d.liveExpectedCashCents != null ? <div className="fk-hint cdr-warn" role="status">{t('cdr.changedSinceCount', { amount: money(d.liveExpectedCashCents) })}</div> : null}
          </div>
        </FitPanel>
      </div>

      <FitPanel testId="drawer-activity" className="cdr-ledger" bodyRef={fit.ref}
        title={<span className="fk-seg cdr-tabs" role="tablist" aria-label={t('cdr.tabs')}>
          <button type="button" role="tab" aria-selected={tab === 'activity'} className={tab === 'activity' ? 'on' : ''} onClick={() => setTab('activity')} data-testid="tab-activity">{t('cdr.activity')}</button>
          <button type="button" role="tab" aria-selected={tab === 'history'} className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')} data-testid="tab-history">{t('cdr.history')}</button>
        </span>}
        actions={tab === 'activity' ? <div className="cdr-tools" data-testid="activity-tools">
          <input type="search" className="fk-search" value={aSearch} onChange={(e) => setASearch(e.target.value)} placeholder={t('cdr.act.searchPh')} aria-label={t('cdr.act.searchPh')} data-testid="act-search" />
          <select className="fk-select" value={aKind} onChange={(e) => setAKind(e.target.value)} aria-label={t('cdr.act.kind')} data-testid="act-kind"><option value="">{t('cdr.act.allKinds')}</option>{KINDS.map((k) => <option key={k} value={k}>{t('cdr.kind.' + k)}</option>)}</select>
          <span className="fk-seg"><button type="button" className={isDay ? 'on' : ''} aria-pressed={isDay} onClick={() => setAPeriod({ preset: 'session' })} data-testid="act-day">{t('cdr.act.drawerDay')}</button></span>
          <PeriodBar compact value={(isDay ? { preset: 'session' as never } : aPeriod) as PeriodState} onChange={(p) => setAPeriod(p)} server={act ? { preset: (act.preset === 'session' ? 'today' : act.preset) as PeriodState['preset'], from: act.from, to: act.to, tz: '', today: d?.businessDate ?? date } : null} />
        </div> : <div className="cdr-tools">
          <label className="cdr-field">{t('cdr.from')}<input type="date" value={hFrom} onChange={(e) => setHFrom(e.target.value)} data-testid="hist-from" className="fk-select" /></label>
          <label className="cdr-field">{t('cdr.to')}<input type="date" value={hTo} onChange={(e) => setHTo(e.target.value)} data-testid="hist-to" className="fk-select" /></label>
          <select className="fk-select" value={hStatus} onChange={(e) => setHStatus(e.target.value)} data-testid="hist-status" aria-label={t('pos.status')}>
            <option value="">{t('cdr.allStatuses')}</option>{['open', 'reconciled', 'discrepancy', 'needs_review'].map((x) => <option key={x} value={x}>{t('cdr.st.' + x)}</option>)}</select>
          <input type="search" className="fk-search" value={hQ} onChange={(e) => setHQ(e.target.value)} placeholder={t('cdr.searchPh')} aria-label={t('cdr.search')} data-testid="hist-search" />
        </div>}
        footer={tab === 'activity'
          ? <div className="cdr-foot">{act ? <span className="fk-hint" data-testid="act-totals">{t('cdr.act.totals', { from: act.from, to: act.to, in: money(act.totals.cashInCents), out: money(act.totals.cashOutCents), net: money(act.totals.cashInCents - act.totals.cashOutCents) })}</span> : <span />}
            <Pager compact info={act ? { page: act.page, pageSize: act.pageSize, totalItems: act.total, totalPages: act.pages } : null} onPage={setAPage} /></div>
          : <div data-testid="hist-pager"><Pager compact info={hist ? { page: hist.page, pageSize: hist.pageSize, totalItems: hist.total, totalPages: hist.pages } : null} onPage={setHPage} /></div>}>
        {tab === 'activity' ? (actErr ? <div className="fk-error" role="alert"><span>{actErr}</span><button type="button" className="fk-btn ghost" onClick={() => setActTick((n) => n + 1)}>{t('pos.retry')}</button></div>
          : !act ? <div className="fk-loading">{t('pos.loading')}</div>
          : act.items.length === 0 ? <Empty title={aQ ? t('cdr.act.noMatch', { q: aQ }) : t('cdr.act.empty')}>{aQ || aKind || !isDay ? <button type="button" className="fk-btn" onClick={() => { setASearch(''); setAKind(''); setAPeriod({ preset: 'session' }); }}>{t('finance.clearFilters')}</button> : null}</Empty>
          : <table className="fk-table fn-table cdr-table" data-testid="act-table"><thead><tr>
              <th>{t('cdr.col.date')}</th><th>{t('cdr.col.movement')}</th><th>{t('cdr.col.who')}</th><th>{t('cdr.col.ticket')}</th><th className="num">{t('cdr.col.in')}</th><th className="num">{t('cdr.col.out')}</th><th>{t('cdr.col.status')}</th></tr></thead>
            <tbody>{act.items.map((r) => <tr key={r.kind + r.id} data-testid="act-row" className={'inv2-click' + (r.state === 'voided' ? ' cdr-void' : '')} onClick={() => setOpenAct(r)}>
              <td><span className="fk-li-t">{r.businessDate}</span><span className="fk-li-s">{r.at ? fmtInZone(r.at, { hour: 'numeric', minute: '2-digit' }) : ''}</span></td>
              <td><span className="fk-li-t">{t('cdr.kind.' + r.kind)}</span><span className="fk-li-s">{r.reason ?? (r.kind === 'float' ? regName(registerId) : '—')}</span></td>
              <td><span className="fk-li-t">{r.customer ?? (r.kind === 'sale' || r.kind === 'refund' ? t('cdr.noCustomer') : '—')}</span><span className="fk-li-s">{r.employee ?? t('cdr.unknownEmployee')}</span></td>
              <td>{r.ticketNumber ? '#' + r.ticketNumber : r.kind === 'float' || r.kind === 'cash_in' || r.kind === 'cash_out' ? t('cdr.session', { day: r.businessDate }) : '—'}</td>
              <td className="num">{r.cashInCents ? money(r.cashInCents) : ''}</td><td className="num">{r.cashOutCents ? '−' + money(r.cashOutCents) : ''}</td>
              <td><span className="fk-chip">{t('cdr.state.' + stateKey(r))}</span>
                {(r.kind === 'cash_in' || r.kind === 'cash_out') && r.state !== 'voided' && canTake && r.businessDate === date ? <button type="button" className="fk-link" disabled={busy === 'void'} onClick={(e) => { e.stopPropagation(); voidMovement(r.id); }} data-testid="act-void">{t('pos.void')}</button> : null}</td>
            </tr>)}</tbody></table>)
          : (histErr ? <div className="fk-error" role="alert"><span>{histErr}</span><button type="button" className="fk-btn ghost" onClick={() => setHistTick((n) => n + 1)}>{t('pos.retry')}</button></div>
            : !hist ? <div className="fk-loading">{t('pos.loading')}</div> : hist.items.length === 0 ? <Empty title={t('cdr.histEmpty')} />
            : <table className="fk-table fn-table cdr-table" data-testid="hist-table"><thead><tr><th>{t('cdr.day')}</th><th>{t('cdr.register')}</th><th>{t('pos.status')}</th><th className="num">{t('cdr.expected')}</th><th className="num">{t('pos.counted')}</th><th className="num">{t('cdr.difference')}</th><th>{t('cdr.countedBy')}</th></tr></thead>
              <tbody>{hist.items.map((r) => <tr key={r.businessDate + r.registerId} data-testid="hist-row" className="inv2-click" onClick={() => setOpenRow(r)}><td>{r.businessDate}</td><td>{regName(r.registerId, r.register)}</td>
                <td>{STATUS[r.status as DrawerStatus]?.label ?? r.status}{r.approvalRequired ? <span className="fk-li-s">{r.approvedAt ? t('cdr.signedOffShort') : t('cdr.st.needs_review')}</span> : null}</td>
                <td className="num">{r.expectedCashCents == null ? '—' : money(r.expectedCashCents)}</td><td className="num">{r.countedCents == null ? '—' : money(r.countedCents)}</td>
                <td className="num" style={{ color: (r.varianceCents ?? 0) < 0 ? '#b3261e' : undefined }}>{r.varianceCents == null ? '—' : (r.varianceCents > 0 ? '+' : r.varianceCents < 0 ? '−' : '') + money(Math.abs(r.varianceCents))}</td>
                <td>{r.countedBy ?? '—'}{r.notes ? <span className="fk-li-s">{r.notes}</span> : null}</td></tr>)}</tbody></table>)}
      </FitPanel>

      {/* Original guide + SUNMI addendum §10: the Money Protection check sits at the bottom, after the activity and its pages */}
      <div className="cdr-ai" data-module-id="cdr-ai"><AiAssistantPanel packageCode="ai_fraud_money_protection" cta={t('pos.check_for_anomalies')} action="fraud_scan" buildPrompt={() => "Review the cash drawer activity for anomalies or possible fraud at a nail salon and flag anything unusual. Be brief."} /></div>

      {denomOpen ? <FitDialog title={t('cdr.byDenom')} subtitle={t('cdr.denomTotal', { amount: money(denomTotal) })} onClose={() => setDenomOpen(false)} testId="dlg-denoms"
        footer={<><button type="button" className="fk-btn ghost" onClick={() => { setByDenom(false); setDenomOpen(false); }}>{t('cdr.denomTypeInstead')}</button>
          <button type="button" className="fk-btn primary" onClick={() => { setByDenom(true); setDenomOpen(false); }} data-testid="denom-use">{t('cdr.denomUse')}</button></>}>
        <div data-testid="denoms" className="cdr-denoms">
          {DENOMS.map((c) => <label key={c} className="cdr-field">{denomLabel(c)}<input inputMode="numeric" value={denoms[String(c)] ?? ''} onChange={(e) => setDenoms({ ...denoms, [String(c)]: e.target.value.replace(/\D/g, '') })} data-testid={'denom-' + c} className="fk-search" /></label>)}
        </div>
      </FitDialog> : null}

      {openAct ? <FitDialog title={t('cdr.kind.' + openAct.kind)} subtitle={`${openAct.businessDate}${openAct.at ? ' · ' + fmtInZone(openAct.at, { hour: 'numeric', minute: '2-digit' }) : ''}`} onClose={() => setOpenAct(null)} testId="act-overlay"
        footer={<>{(openAct.kind === 'cash_in' || openAct.kind === 'cash_out') && openAct.state !== 'voided' && canTake && openAct.businessDate === date
          ? <button type="button" className="fk-btn danger" disabled={busy === 'void'} onClick={() => voidMovement(openAct.id)}>{t('pos.void')}</button> : null}
          <button type="button" className="fk-btn primary" onClick={() => setOpenAct(null)}>{t('pos.close')}</button></>}>
        <dl className="cdr-dl">
          <dt>{t('cdr.col.in')}</dt><dd>{openAct.cashInCents ? money(openAct.cashInCents) : '—'}</dd>
          <dt>{t('cdr.col.out')}</dt><dd>{openAct.cashOutCents ? '−' + money(openAct.cashOutCents) : '—'}</dd>
          <dt>{t('cdr.col.status')}</dt><dd>{t('cdr.state.' + stateKey(openAct))}</dd>
          <dt>{t('cdr.col.ticket')}</dt><dd>{openAct.ticketNumber ? '#' + openAct.ticketNumber : t('cdr.session', { day: openAct.businessDate })}</dd>
          <dt>{t('cdr.customer')}</dt><dd>{openAct.customer ?? t('cdr.noCustomerLinked')}</dd>
          <dt>{t('cdr.employee')}</dt><dd>{openAct.employee ?? t('cdr.unknownEmployee')}</dd>
          <dt>{t('cdr.register')}</dt><dd>{regName(registerId)}</dd>
          {openAct.reason ? <><dt>{t('cdr.reason')}</dt><dd>{openAct.reason}</dd></> : null}
          <dt>{t('cdr.reference')}</dt><dd className="cdr-ref">{openAct.id}</dd>
        </dl>
        <div className="fk-hint">{t('cdr.kindHint.' + openAct.kind)}</div>
      </FitDialog> : null}

      {openRow ? <FitDialog title={t('cdr.dayTitle', { day: openRow.businessDate }) + ' · ' + regName(openRow.registerId, openRow.register)} onClose={() => setOpenRow(null)} testId="hist-overlay" wide
        footer={<button type="button" className="fk-btn primary" onClick={() => setOpenRow(null)} data-testid="hist-overlay-close">{t('pos.close')}</button>}>
        <div className="cdr-hist">
          <div>{t('pos.status')}: <b>{STATUS[openRow.status as DrawerStatus]?.label ?? openRow.status}</b></div>
          <div>{t('pos.opening_float')}: {money(openRow.openingFloatCents)} · {t('cdr.expected')}: {openRow.expectedCashCents == null ? '—' : money(openRow.expectedCashCents)} · {t('pos.counted')}: {openRow.countedCents == null ? '—' : money(openRow.countedCents)} · {t('cdr.difference')}: {openRow.varianceCents == null ? '—' : money(openRow.varianceCents)}</div>
          <div>{t('cdr.countedBy')}: {openRow.countedBy ?? '—'}{openRow.countedAt ? ` · ${fmtInZone(openRow.countedAt, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}{openRow.notes ? ` · ${openRow.notes}` : ''}</div>
          {openRow.denominations && Object.keys(openRow.denominations).length ? <div>{t('cdr.breakdown')} {DENOMS.filter((c) => openRow.denominations?.[String(c)]).map((c) => `${denomLabel(c)} × ${openRow.denominations![String(c)]}`).join(' · ')}</div> : null}
          {openRow.approvalRequired ? <div>{openRow.approvedAt ? `${t('cdr.signedOff', { name: openRow.approvedBy ?? '—' })}${openRow.approvalNote ? ' · ' + openRow.approvalNote : ''}` : t('cdr.st.needs_review')}</div> : null}
          <h3>{t('cdr.movements')}</h3>
          {openMoves == null ? <div className="fk-loading">{t('pos.loading')}</div> : openMoves.length === 0 ? <div className="fk-hint" data-testid="hist-overlay-nomoves">{t('cdr.noMovements')}</div>
            : openMoves.map((m) => <div key={m.id} data-testid="hist-overlay-move">{m.direction === 'in' ? '+ ' : '− '}{money(m.amountCents)} · {m.reason || (m.direction === 'in' ? t('pos.cash_in_2') : t('pos.cash_out_2'))}{m.voided ? ` · ${t('pos.voided')}` : ''}</div>)}
        </div>
      </FitDialog> : null}
    </div>
  );
}

/** The ledger's period as query parameters: the drawer's own day, a preset, or a custom range. */
function periodParams(preset: string, from: string, to: string, date: string): { preset: string; date?: string; from?: string; to?: string } {
  return preset === 'session' ? { preset, date } : preset === 'custom' ? { preset, from, to } : { preset };
}

/** The status a ledger row shows: a voided movement, the drawer's state for its float, otherwise the payment / movement state. */
function stateKey(r: DrawerActivityRow): string {
  if (r.state === 'voided') return 'voided';
  if (r.kind === 'float') return ['reconciled', 'discrepancy', 'cancelled'].includes(r.state) ? r.state : 'open';
  if (r.kind === 'refund') return 'refunded';
  if (r.kind === 'sale') return r.state === 'partial' ? 'partial' : 'paid';
  return 'recorded';
}
