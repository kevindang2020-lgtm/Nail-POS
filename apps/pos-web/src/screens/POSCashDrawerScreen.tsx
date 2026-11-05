import { AiAssistantPanel } from '../components/AiAssistantPanel';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createIntentKeys } from '@aipowersalon/api-client';
import { posCashDrawerApi, type DrawerState, type DrawerStatus, type CashMovement, type DrawerRegister, type DrawerHistory, type DrawerHistoryRow } from '../api/posCashDrawerApi';
import { useCan } from '../components/usePermissions';
import { useRealtime } from '../realtime/useRealtime';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { msg, renderMsg, type Msg } from '../i18n/notice';

// Cash Drawer (front desk). Register cash for the chosen date = opening float + cash sales − cash refunds. Excludes the
// Skip-the-Line cash-to-technician payments (those reconcile in End-of-Day Cash). Set the float, then count and reconcile.
// Fits the desktop-POS shell: header/KPIs fixed, content scrolls inside .work at 1920×1080 @100%.
// The business date comes from the SERVER (the branch's own day): the browser's UTC date opened TOMORROW's drawer after
// about 8 pm in New York (audit Nov 3 2026). Empty until the first answer names it.
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
  const denomTotal = DENOMS.reduce((a, c) => a + c * (parseInt(denoms[String(c)] || '0', 10) || 0), 0);
  const [signNote, setSignNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [moves, setMoves] = useState<CashMovement[]>([]);
  const [moveAmt, setMoveAmt] = useState('');
  const [moveDir, setMoveDir] = useState<'in' | 'out'>('out');
  const [moveReason, setMoveReason] = useState('');
  // D15 (Nov 4 2026): one drawer per register — the picker shows when the location has registers set up
  const [registers, setRegisters] = useState<DrawerRegister[]>([]);
  const [registerId, setRegisterId] = useState('main');
  useEffect(() => { posCashDrawerApi.registers().then((r) => setRegisters(r.registers || [])).catch(() => setRegisters([])); }, []);

  const load = useCallback(() => {
    posCashDrawerApi.state(date || undefined, registerId)
      .then((s) => { setD(s); setError(null); if (!date && s.businessDate) setDate(s.businessDate); setFloatStr((s.openingFloatCents / 100).toFixed(2)); if (s.countedCents != null) setCountStr((s.countedCents / 100).toFixed(2)); })
      .catch((e: { message?: string }) => setError(e?.message || t('pos.failed_to_load_the_cash_drawer')));
    posCashDrawerApi.movements(date || undefined, registerId).then((m) => setMoves(m.movements)).catch((e: { message?: string }) => setError(e?.message || t('pos.failed_to_load_the_cash_drawer')));
  }, [date, registerId]);
  useEffect(() => { load(); }, [load]);
  useRealtime('cash-drawer', load);

  const keys = useRef(createIntentKeys());
  const setFloat = async () => {
    const dollars = Number(floatStr);
    if (!Number.isFinite(dollars) || dollars < 0) { setError(t('pos.enter_the_opening_float')); return; }
    setBusy('float'); setError(null); setNote(null);
    try { const cents = Math.round(dollars * 100); const s = await posCashDrawerApi.open(cents, date || undefined, keys.current.keyFor('float', { cents, date, registerId }), registerId); keys.current.done('float'); setD(s); setNote(msg('pos.opening_float_set_to_openingfloatcents', { openingFloatCents: String(money(s.openingFloatCents)) })); }
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
      setD(s); setMoveAmt(''); setMoveReason('');
      setNote(msg('pos.recorded_v0_of_v1', { v0: msg(moveDir === 'in' ? 'pos.cash_in_2' : 'pos.cash_out_2'), v1: String(money(Math.round(dollars * 100))) }));
      posCashDrawerApi.movements(date || undefined, registerId).then((m) => setMoves(m.movements)).catch(() => {});
    } catch (e) { setError((e as { message?: string })?.message || t('pos.could_not_record_the_movement')); }
    finally { setBusy(null); }
  };
  const voidMovement = async (movementId: string) => {
    setBusy('void'); setError(null); setNote(null);
    try {
      const s = await posCashDrawerApi.voidMovement(movementId, date || undefined, registerId);
      setD(s); setNote(msg('pos.movement_voided'));
      posCashDrawerApi.movements(date || undefined, registerId).then((m) => setMoves(m.movements)).catch(() => {});
    } catch (e) { setError((e as { message?: string })?.message || t('pos.could_not_void_the_movement')); }
    finally { setBusy(null); }
  };

  const st = d ? (STATUS[d.status] || STATUS.open) : null;
  const v = d?.varianceCents;

  return (
    <div className="work">
      <div className="vh">
        <h1>{t('pos.cash_drawer')}</h1>
        <div className="sub">{t('pos.register_cash_opening_float_cash_sales_1baa')}</div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5 mb-3.5 mt-2.5">
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{t('pos.opening_float')}</div><div className="v">{d ? money(d.openingFloatCents) : '—'}</div></div>
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{t('pos.cash_sales')}</div><div className="v">{d ? money(d.expectedSalesCents) : '—'}</div></div>
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{t('pos.refunds')}</div><div className="v">{d ? '−' + money(d.refundsCents) : '—'}</div></div>
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{t('pos.expected_in_drawer')}</div><div className="v">{d ? money(d.expectedCashCents) : '—'}</div></div>
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{t('pos.variance')}</div><div className="v" style={v == null ? undefined : { color: v === 0 ? '#1f7a4d' : '#b3261e' }}>{v == null ? '—' : (v > 0 ? '+' : '') + money(v)}</div></div>
      </div>

      {error ? <div className="err" style={{ marginBottom: 12 }}>{error}</div> : null}
      {note ? <div className="muted" style={{ marginBottom: 10 }}>{renderMsg(note)}</div> : null}

      <section className="panel" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <label className="s">{t('pos.date')}{' '}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ marginLeft: 6, height: 32, border: '1px solid var(--line)', borderRadius: 8, padding: '0 8px', fontFamily: 'inherit', background: '#FFFDF8' }} /></label>
          {registers.length > 1 ? <label className="s">{t('pos.cash_drawer_register')}{' '}<select aria-label={t('pos.cash_drawer_register')} value={registerId} onChange={(e) => { setRegisterId(e.target.value); setD(null); setMoves([]); setNote(null); setCountStr(''); }} style={{ marginLeft: 6, height: 32, border: '1px solid var(--line)', borderRadius: 8, padding: '0 8px', fontFamily: 'inherit', background: '#FFFDF8' }}>
            {registers.map((r) => <option key={r.registerId} value={r.registerId}>{r.registerId === 'main' ? t('pos.cash_drawer_unassigned') : r.name}</option>)}
          </select></label> : null}
          {st ? <span style={{ marginLeft: 4, padding: '3px 9px', borderRadius: 999, fontSize: 12, fontWeight: 700, color: st.color, background: st.bg }}>{st.label}</span> : null}
          <button className="btn ghost w-full sm:w-auto sm:ml-auto" style={{ padding: '6px 12px' }} onClick={load}>{t('pos.refresh')}</button>
        </div>
      </section>

      <section className="panel" style={{ marginBottom: 14 }}>
        <h2 style={{ fontSize: 14, margin: '0 0 8px' }}>{t('pos.opening_float')}</h2>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label className="s w-full sm:w-auto">{t('pos.float_in_drawer_at_open')}
            <input type="number" min="0" step="0.01" value={floatStr} onChange={(e) => setFloatStr(e.target.value)} className="w-full sm:w-[150px]" style={{ display: 'block', marginTop: 4, height: 34, border: '1px solid var(--line)', borderRadius: 8, padding: '0 10px', fontFamily: 'inherit', background: '#fff' }} />
          </label>
          <button className="btn w-full sm:w-auto" style={{ padding: '7px 14px' }} disabled={busy === 'float'} onClick={setFloat}>{busy === 'float' ? t('pos.saving_2') : t('pos.set_float')}</button>
        </div>
      </section>

      <section className="panel" style={{ marginBottom: 14 }}>
        <h2 style={{ fontSize: 14, margin: '0 0 8px' }}>{t('pos.cash_in_out')}</h2>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>{t('pos.record_cash_added_to_or_removed_1wip')}</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="s w-full sm:w-auto">{t('pos.direction_2')}
            <div className='whitespace-nowrap' style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              <button type="button" className={moveDir === 'in' ? 'btn flex-1' : 'btn ghost flex-1'} style={{ padding: '6px 12px' }} onClick={() => setMoveDir('in')}>{t('pos.cash_in')}</button>
              <button type="button" className={moveDir === 'out' ? 'btn flex-1' : 'btn ghost flex-1'} style={{ padding: '6px 12px' }} onClick={() => setMoveDir('out')}>{t('pos.cash_out')}</button>
            </div>
          </div>
          <label className="s w-full sm:w-auto">{t('pos.amount')}
            <input type="number" min="0" step="0.01" value={moveAmt} onChange={(e) => setMoveAmt(e.target.value)} className="w-full sm:w-[130px]" style={{ display: 'block', marginTop: 4, height: 34, border: '1px solid var(--line)', borderRadius: 8, padding: '0 10px', fontFamily: 'inherit', background: '#fff' }} />
          </label>
          <label className="s w-full sm:flex-1" style={{ minWidth: 160 }}>{t('pos.reason_optional')}
            <input value={moveReason} onChange={(e) => setMoveReason(e.target.value)} placeholder={t('pos.e_g_petty_cash_cash_drop')} className="w-full" style={{ display: 'block', marginTop: 4, height: 34, border: '1px solid var(--line)', borderRadius: 8, padding: '0 10px', fontFamily: 'inherit', background: '#fff' }} />
          </label>
          <button className="btn w-full sm:w-auto" style={{ padding: '7px 14px' }} disabled={busy === 'movement'} onClick={addMovement}>{busy === 'movement' ? t('pos.saving_2') : t('pos.record')}</button>
        </div>
        {moves.length > 0 ? (
          <div style={{ marginTop: 10, display: 'grid', gap: 4 }}>
            {moves.map((m) => (
              <div key={m.id} className="muted" style={{ fontSize: 12.5, display: 'flex', gap: 8, alignItems: 'center', textDecoration: m.voided ? 'line-through' : 'none', opacity: m.voided ? 0.5 : 1 }}>
                <span style={{ fontWeight: 700, color: m.direction === 'in' ? '#1f7a4d' : '#b3261e', minWidth: 70 }}>{m.direction === 'in' ? '+ ' : '− '}{money(m.amountCents)}</span>
                <span>{m.reason || (m.direction === 'in' ? t('pos.cash_in_2') : t('pos.cash_out_2'))}</span>
                {m.note ? <span style={{ opacity: .7 }}>· {m.note}</span> : null}
                {m.voided
                  ? <span style={{ marginLeft: 'auto', fontStyle: 'italic' }}>{t('pos.voided')}</span>
                  : <button className="btn ghost" style={{ marginLeft: 'auto', padding: '2px 9px', fontSize: 11.5 }} disabled={busy === 'void'} onClick={() => voidMovement(m.id)}>{t('pos.void')}</button>}
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className="panel">
        <h2 style={{ fontSize: 14, margin: '0 0 8px' }}>{t('pos.count_reconcile')}</h2>
        <div className="muted" style={{ fontSize: 12.5, marginBottom: 8 }}>{t('pos.expected_in_drawer_2')}{' '}<strong>{d ? money(d.expectedCashCents) : '—'}</strong> {d ? t('pos.float_openingfloatcents_sales_expectedsalescents_refunds_refundscents_lvsv', { openingFloatCents: String(money(d.openingFloatCents)), expectedSalesCents: String(money(d.expectedSalesCents)), refundsCents: String(money(d.refundsCents)), v3: String(d.paidInCents ? t('pos.in_paidincents', { paidInCents: String(money(d.paidInCents)) }) : ''), v4: String(d.paidOutCents ? t('pos.out_paidoutcents', { paidOutCents: String(money(d.paidOutCents)) }) : '') }) : ''}</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label className="s w-full sm:w-auto">{t('pos.counted_cash')}
            <input type="number" min="0" step="0.01" value={byDenom ? (denomTotal / 100).toFixed(2) : countStr} readOnly={byDenom} data-testid="count-input" onChange={(e) => setCountStr(e.target.value)} className="w-full sm:w-[150px]" style={{ display: 'block', marginTop: 4, height: 34, border: '1px solid var(--line)', borderRadius: 8, padding: '0 10px', fontFamily: 'inherit', background: '#fff' }} />
          </label>
          <label className="s w-full sm:flex-1" style={{ minWidth: 180 }}>{t('pos.note_optional')}
            <input value={reconNotes} onChange={(e) => setReconNotes(e.target.value)} placeholder={t('pos.e_g_register_short_on_count')} className="w-full" style={{ display: 'block', marginTop: 4, height: 34, border: '1px solid var(--line)', borderRadius: 8, padding: '0 10px', fontFamily: 'inherit', background: '#fff' }} />
          </label>
          <button className="btn w-full sm:w-auto" style={{ padding: '7px 14px' }} disabled={busy === 'reconcile'} onClick={reconcile}>{busy === 'reconcile' ? t('pos.saving_2') : t('pos.reconcile')}</button>
        </div>
        <label className="s" style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8 }}><input type="checkbox" checked={byDenom} onChange={(e) => setByDenom(e.target.checked)} data-testid="by-denom" />{t('cdr.byDenom')}</label>
        {byDenom ? <div data-testid="denoms" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8, marginTop: 6 }}>
          {DENOMS.map((c) => <label key={c} className="s">{denomLabel(c)}<input inputMode="numeric" value={denoms[String(c)] ?? ''} onChange={(e) => setDenoms({ ...denoms, [String(c)]: e.target.value.replace(/\D/g, '') })} data-testid={'denom-' + c} style={{ display: 'block', marginTop: 4, height: 32, width: '100%', border: '1px solid var(--line)', borderRadius: 8, padding: '0 8px', background: '#fff' }} /></label>)}
        </div> : null}
        {d && d.countedCents != null ? <div className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>{t('pos.counted')}{' '}{money(d.countedCents)} · {d.status === 'reconciled' ? t('pos.matched_exactly') : t((d.varianceCents || 0) > 0 ? 'cdr.over' : 'cdr.short', { amount: money(Math.abs(d.varianceCents || 0)) })}{d.notes ? ` · ${d.notes}` : ''}</div> : null}
        {d?.approvalRequired && !d.approvedAt ? <div role="status" data-testid="needs-review" style={{ fontSize: 12.5, marginTop: 8, color: '#A33' }}>{t('cdr.needsReview')}
          {can('checkout.manage_overrides') ? <span style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}><input value={signNote} onChange={(e) => setSignNote(e.target.value)} placeholder={t('cdr.signNotePh')} data-testid="sign-note" style={{ height: 32, flex: 1, minWidth: 200, border: '1px solid var(--line)', borderRadius: 8, padding: '0 10px', background: '#fff' }} />
            <button className="btn" disabled={busy === 'sign' || signNote.trim().length < 3} onClick={signOff} data-testid="sign-off">{t('cdr.signOff')}</button></span> : null}</div> : null}
        {d?.approvedAt ? <div className="muted" data-testid="signed-off" style={{ fontSize: 12.5, marginTop: 8 }}>{t('cdr.signedOff', { name: d.approvedBy ?? '—' })}{d.approvalNote ? ` · ${d.approvalNote}` : ''}</div> : null}
        {d?.denominations && Object.keys(d.denominations).length ? <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{t('cdr.breakdown')} {DENOMS.filter((c) => d.denominations?.[String(c)]).map((c) => `${denomLabel(c)} × ${d.denominations![String(c)]}`).join(' · ')}</div> : null}
        {d?.changedSinceCount && d.liveExpectedCashCents != null ? <div className="muted" role="status" style={{ fontSize: 12.5, marginTop: 6, color: '#A33' }}>{t('cdr.changedSinceCount', { amount: money(d.liveExpectedCashCents) })}</div> : null}
            </section>

      <section className="panel" data-testid="drawer-history">
        <h2 style={{ fontSize: 14, margin: '0 0 8px' }}>{t('cdr.history')}</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 8 }}>
          <label className="s">{t('cdr.from')}<input type="date" value={hFrom} onChange={(e) => setHFrom(e.target.value)} data-testid="hist-from" style={{ display: 'block', height: 32 }} /></label>
          <label className="s">{t('cdr.to')}<input type="date" value={hTo} onChange={(e) => setHTo(e.target.value)} data-testid="hist-to" style={{ display: 'block', height: 32 }} /></label>
          <label className="s">{t('pos.status')}<select value={hStatus} onChange={(e) => setHStatus(e.target.value)} data-testid="hist-status" style={{ display: 'block', height: 32 }}>
            <option value="">{t('cdr.allStatuses')}</option>{['open', 'reconciled', 'discrepancy', 'needs_review'].map((x) => <option key={x} value={x}>{t('cdr.st.' + x)}</option>)}</select></label>
          <label className="s" style={{ flex: 1, minWidth: 180 }}>{t('cdr.search')}<input type="search" value={hQ} onChange={(e) => setHQ(e.target.value)} placeholder={t('cdr.searchPh')} data-testid="hist-search" style={{ display: 'block', height: 32, width: '100%' }} /></label>
        </div>
        {histErr ? <div role="alert" style={{ color: '#A33', fontSize: 12.5 }}>{histErr}</div> : !hist ? <div className="muted">{t('pos.loading')}</div> : hist.items.length === 0 ? <div className="muted" data-testid="hist-empty">{t('cdr.histEmpty')}</div> : <>
          <table className="fk-table" style={{ width: '100%', fontSize: 12.5 }} data-testid="hist-table"><thead><tr><th>{t('cdr.day')}</th><th>{t('cdr.register')}</th><th>{t('pos.status')}</th><th style={{ textAlign: 'right' }}>{t('cdr.expected')}</th><th style={{ textAlign: 'right' }}>{t('pos.counted')}</th><th style={{ textAlign: 'right' }}>{t('cdr.difference')}</th><th>{t('cdr.countedBy')}</th></tr></thead>
            <tbody>{hist.items.map((r) => <tr key={r.businessDate + r.registerId} data-testid="hist-row" className="inv2-click" style={{ cursor: 'pointer' }} onClick={() => setOpenRow(r)}><td>{r.businessDate}</td><td>{r.register ?? (registers.find((x) => x.registerId === r.registerId)?.name ?? t('cdr.mainRegister'))}</td>
              <td>{STATUS[r.status as DrawerStatus]?.label ?? r.status}{r.approvalRequired ? <span style={{ marginLeft: 6, fontSize: 11 }}>{r.approvedAt ? t('cdr.signedOffShort') : t('cdr.st.needs_review')}</span> : null}</td>
              <td style={{ textAlign: 'right' }}>{r.expectedCashCents == null ? '—' : money(r.expectedCashCents)}</td><td style={{ textAlign: 'right' }}>{r.countedCents == null ? '—' : money(r.countedCents)}</td>
              <td style={{ textAlign: 'right', color: (r.varianceCents ?? 0) < 0 ? '#b3261e' : undefined }}>{r.varianceCents == null ? '—' : (r.varianceCents > 0 ? '+' : r.varianceCents < 0 ? '−' : '') + money(Math.abs(r.varianceCents))}</td>
              <td>{r.countedBy ?? '—'}{r.notes ? <span className="muted" style={{ display: 'block' }}>{r.notes}</span> : null}</td></tr>)}</tbody></table>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 8 }} data-testid="hist-pager">
            {Array.from({ length: hist.pages }, (_, i) => i + 1).slice(0, 20).map((n) => <button key={n} className={'btn' + (n === hist.page ? '' : ' ghost')} style={{ minWidth: 36 }} onClick={() => setHPage(n)} aria-current={n === hist.page ? 'page' : undefined}>{n}</button>)}
          </div></>}
            </section>

      {openRow ? <div className="inv-ov" role="dialog" aria-modal="true" data-testid="hist-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpenRow(null); }}>
        <div className="inv-modal wide">
          <div className="im-h">{t('cdr.dayTitle', { day: openRow.businessDate })} · {openRow.register ?? (registers.find((x) => x.registerId === openRow.registerId)?.name ?? t('cdr.mainRegister'))}</div>
          <div className="im-b" style={{ fontSize: 13 }}>
            <div>{t('pos.status')}: <b>{STATUS[openRow.status as DrawerStatus]?.label ?? openRow.status}</b></div>
            <div>{t('pos.opening_float')}: {money(openRow.openingFloatCents)} · {t('cdr.expected')}: {openRow.expectedCashCents == null ? '—' : money(openRow.expectedCashCents)} · {t('pos.counted')}: {openRow.countedCents == null ? '—' : money(openRow.countedCents)} · {t('cdr.difference')}: {openRow.varianceCents == null ? '—' : money(openRow.varianceCents)}</div>
            <div>{t('cdr.countedBy')}: {openRow.countedBy ?? '—'}{openRow.countedAt ? ` · ${new Date(openRow.countedAt).toLocaleString()}` : ''}{openRow.notes ? ` · ${openRow.notes}` : ''}</div>
            {openRow.denominations && Object.keys(openRow.denominations).length ? <div>{t('cdr.breakdown')} {DENOMS.filter((c) => openRow.denominations?.[String(c)]).map((c) => `${denomLabel(c)} × ${openRow.denominations![String(c)]}`).join(' · ')}</div> : null}
            {openRow.approvalRequired ? <div>{openRow.approvedAt ? `${t('cdr.signedOff', { name: openRow.approvedBy ?? '—' })}${openRow.approvalNote ? ' · ' + openRow.approvalNote : ''}` : t('cdr.st.needs_review')}</div> : null}
            <h3 style={{ fontSize: 13, margin: '10px 0 4px' }}>{t('cdr.movements')}</h3>
            {openMoves == null ? <div className="muted">{t('pos.loading')}</div> : openMoves.length === 0 ? <div className="muted" data-testid="hist-overlay-nomoves">{t('cdr.noMovements')}</div>
              : openMoves.map((m) => <div key={m.id} data-testid="hist-overlay-move">{m.direction === 'in' ? '+ ' : '− '}{money(m.amountCents)} · {m.reason || (m.direction === 'in' ? t('pos.cash_in_2') : t('pos.cash_out_2'))}{m.voided ? ` · ${t('pos.voided')}` : ''}</div>)}
          </div>
          <div className="im-f"><button className="btn primary" onClick={() => setOpenRow(null)} data-testid="hist-overlay-close">{t('pos.close')}</button></div>
        </div>
      </div> : null}

      {/* D15 gaps (Nov 5 2026): the Money Protection check sits at the bottom, under the drawer's own work */}
      <AiAssistantPanel packageCode="ai_fraud_money_protection" cta={t('pos.check_for_anomalies')} action="fraud_scan" buildPrompt={() => "Review the cash drawer activity for anomalies or possible fraud at a nail salon and flag anything unusual. Be brief."} />
    </div>
  );
}
