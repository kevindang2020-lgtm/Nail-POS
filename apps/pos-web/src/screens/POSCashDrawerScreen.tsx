import { AiAssistantPanel } from '../components/AiAssistantPanel';
import { useCallback, useEffect, useState } from 'react';
import { posCashDrawerApi, type DrawerState, type DrawerStatus, type CashMovement } from '../api/posCashDrawerApi';
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

export function POSCashDrawerScreen() {
  const [date, setDate] = useState('');
  const [d, setD] = useState<DrawerState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<Msg | null>(null);   // a KEY, translated at render (WP-D2)
  const [floatStr, setFloatStr] = useState('');
  const [countStr, setCountStr] = useState('');
  const [reconNotes, setReconNotes] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [moves, setMoves] = useState<CashMovement[]>([]);
  const [moveAmt, setMoveAmt] = useState('');
  const [moveDir, setMoveDir] = useState<'in' | 'out'>('out');
  const [moveReason, setMoveReason] = useState('');

  const load = useCallback(() => {
    posCashDrawerApi.state(date || undefined)
      .then((s) => { setD(s); setError(null); if (!date && s.businessDate) setDate(s.businessDate); setFloatStr((s.openingFloatCents / 100).toFixed(2)); if (s.countedCents != null) setCountStr((s.countedCents / 100).toFixed(2)); })
      .catch((e: { message?: string }) => setError(e?.message || t('pos.failed_to_load_the_cash_drawer')));
    posCashDrawerApi.movements(date || undefined).then((m) => setMoves(m.movements)).catch((e: { message?: string }) => setError(e?.message || t('pos.failed_to_load_the_cash_drawer')));
  }, [date]);
  useEffect(() => { load(); }, [load]);
  useRealtime('cash-drawer', load);

  const setFloat = async () => {
    const dollars = Number(floatStr);
    if (!Number.isFinite(dollars) || dollars < 0) { setError(t('pos.enter_the_opening_float')); return; }
    setBusy('float'); setError(null); setNote(null);
    try { const s = await posCashDrawerApi.open(Math.round(dollars * 100), date || undefined); setD(s); setNote(msg('pos.opening_float_set_to_openingfloatcents', { openingFloatCents: String(money(s.openingFloatCents)) })); }
    catch (e) { setError((e as { message?: string })?.message || t('pos.could_not_set_the_float')); }
    finally { setBusy(null); }
  };
  const reconcile = async () => {
    const dollars = Number(countStr);
    if (!Number.isFinite(dollars) || dollars < 0) { setError(t('pos.enter_the_counted_cash_amount')); return; }
    setBusy('reconcile'); setError(null); setNote(null);
    try {
      const s = await posCashDrawerApi.reconcile(Math.round(dollars * 100), reconNotes.trim() || undefined, date || undefined);
      const v = s.varianceCents ?? 0;
      setNote(s.status === 'reconciled' ? msg('pos.drawer_reconciled_matched_countedcents', { countedCents: String(money(s.countedCents)) }) : msg('pos.drawer_v0_by_v', { v0: msg(v > 0 ? 'payment.cash.over' : 'payment.cash.short'), v: String(money(Math.abs(v))) }));
      setD(s);
    } catch (e) { setError((e as { message?: string })?.message || t('pos.could_not_reconcile')); }
    finally { setBusy(null); }
  };
  const addMovement = async () => {
    const dollars = Number(moveAmt);
    if (!Number.isFinite(dollars) || dollars <= 0) { setError(t('pos.enter_an_amount_greater_than_zero')); return; }
    setBusy('movement'); setError(null); setNote(null);
    try {
      const s = await posCashDrawerApi.movement(moveDir, Math.round(dollars * 100), moveReason.trim() || undefined, undefined, date || undefined);
      setD(s); setMoveAmt(''); setMoveReason('');
      setNote(msg('pos.recorded_v0_of_v1', { v0: msg(moveDir === 'in' ? 'pos.cash_in_2' : 'pos.cash_out_2'), v1: String(money(Math.round(dollars * 100))) }));
      posCashDrawerApi.movements(date || undefined).then((m) => setMoves(m.movements)).catch(() => {});
    } catch (e) { setError((e as { message?: string })?.message || t('pos.could_not_record_the_movement')); }
    finally { setBusy(null); }
  };
  const voidMovement = async (movementId: string) => {
    setBusy('void'); setError(null); setNote(null);
    try {
      const s = await posCashDrawerApi.voidMovement(movementId, date || undefined);
      setD(s); setNote(msg('pos.movement_voided'));
      posCashDrawerApi.movements(date || undefined).then((m) => setMoves(m.movements)).catch(() => {});
    } catch (e) { setError((e as { message?: string })?.message || t('pos.could_not_void_the_movement')); }
    finally { setBusy(null); }
  };

  const st = d ? (STATUS[d.status] || STATUS.open) : null;
  const v = d?.varianceCents;

  return (
    <div className="work">
      <AiAssistantPanel packageCode="ai_fraud_money_protection" cta={t('pos.check_for_anomalies')} action="fraud_scan" buildPrompt={() => "Review the cash drawer activity for anomalies or possible fraud at a nail salon and flag anything unusual. Be brief."} />
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
            <input type="number" min="0" step="0.01" value={countStr} onChange={(e) => setCountStr(e.target.value)} className="w-full sm:w-[150px]" style={{ display: 'block', marginTop: 4, height: 34, border: '1px solid var(--line)', borderRadius: 8, padding: '0 10px', fontFamily: 'inherit', background: '#fff' }} />
          </label>
          <label className="s w-full sm:flex-1" style={{ minWidth: 180 }}>{t('pos.note_optional')}
            <input value={reconNotes} onChange={(e) => setReconNotes(e.target.value)} placeholder={t('pos.e_g_register_short_on_count')} className="w-full" style={{ display: 'block', marginTop: 4, height: 34, border: '1px solid var(--line)', borderRadius: 8, padding: '0 10px', fontFamily: 'inherit', background: '#fff' }} />
          </label>
          <button className="btn w-full sm:w-auto" style={{ padding: '7px 14px' }} disabled={busy === 'reconcile'} onClick={reconcile}>{busy === 'reconcile' ? t('pos.saving_2') : t('pos.reconcile')}</button>
        </div>
        {d && d.countedCents != null ? <div className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>{t('pos.counted')}{' '}{money(d.countedCents)} · {d.status === 'reconciled' ? t('pos.matched_exactly') : t((d.varianceCents || 0) > 0 ? 'cdr.over' : 'cdr.short', { amount: money(Math.abs(d.varianceCents || 0)) })}{d.notes ? ` · ${d.notes}` : ''}</div> : null}
        {d?.changedSinceCount && d.liveExpectedCashCents != null ? <div className="muted" role="status" style={{ fontSize: 12.5, marginTop: 6, color: '#A33' }}>{t('cdr.changedSinceCount', { amount: money(d.liveExpectedCashCents) })}</div> : null}
      </section>
    </div>
  );
}
