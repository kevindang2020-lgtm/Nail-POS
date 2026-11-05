import { Fragment, useCallback, useEffect, useState } from 'react';
import { posCashHandoffApi, type CashHandoffBoard, type CashHandoff, type HandoffStatus } from '../api/posCashHandoffApi';
import { useRealtime } from '../realtime/useRealtime';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { msg, renderMsg, type Msg } from '../i18n/notice';

// End-of-Day Cash (manager/POS). Each technician's collected cash (from confirmed Skip-the-Line cash payments) for the
// chosen date; the front desk counts the cash and reconciles — exact = reconciled, otherwise a flagged discrepancy.
// Fits the AIPowerSalon desktop-POS shell: header/KPIs stay put, the table scrolls inside its panel at 1920×1080 @100%.
const todayIso = () => new Date().toISOString().slice(0, 10);
const money = (c: number | null | undefined) => '$' + ((c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const STATUS: Record<HandoffStatus, { label: string; color: string; bg: string }> = {
  open: { get label() { return tx('pos.open'); }, color: 'var(--ink-soft, #6b5d49)', bg: 'rgba(0,0,0,.05)' },
  submitted: { get label() { return tx('pos.handed_off'); }, color: '#7a5a12', bg: 'rgba(169,111,34,.14)' },
  reconciled: { get label() { return tx('pos.reconciled'); }, color: '#1f7a4d', bg: 'rgba(31,122,77,.14)' },
  discrepancy: { get label() { return tx('pos.discrepancy'); }, color: '#b3261e', bg: 'rgba(179,38,30,.12)' },
  cancelled: { get label() { return tx('pos.cancelled'); }, color: 'var(--ink-soft, #6b5d49)', bg: 'rgba(0,0,0,.05)' },
};

export function POSCashHandoffScreen() {
  const [date, setDate] = useState(todayIso());
  const [board, setBoard] = useState<CashHandoffBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<Msg | null>(null);   // a KEY, translated at render (WP-D2)
  const [editFor, setEditFor] = useState<string | null>(null);
  const [counted, setCounted] = useState('');
  const [reconNotes, setReconNotes] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    posCashHandoffApi.state(date || undefined)
      .then((d) => { setBoard(d); setError(null); })
      .catch((e: { message?: string }) => setError(e?.message || tx('pos.failed_to_load_the_cash_hand_1x4y')));
  }, [date]);
  useEffect(() => { load(); }, [load]);
  useRealtime('cash-handoffs', load); // tech hand-off / reconcile pushes -> refresh

  const openEditor = (t: CashHandoff) => {
    setEditFor(t.technicianId);
    setCounted(t.countedCents != null ? (t.countedCents / 100).toFixed(2) : (t.expectedCents / 100).toFixed(2));
    setReconNotes(t.notes || '');
    setNote(null); setError(null);
  };
  const submit = async (t: CashHandoff) => {
    const dollars = Number(counted);
    if (!Number.isFinite(dollars) || dollars < 0) { setError(tx('pos.enter_the_counted_cash_amount')); return; }
    const cents = Math.round(dollars * 100);
    setBusy(t.technicianId); setError(null); setNote(null);
    try {
      const r = await posCashHandoffApi.reconcile(t.technicianId, cents, reconNotes.trim() || undefined, date || undefined);
      const v = r.varianceCents ?? 0;
      setNote(r.status === 'reconciled' ? msg('pos.v0_reconciled_matched_countedcents', { v0: r.technicianName || msg('glossary.people.technician'), countedCents: String(money(r.countedCents)) }) : msg('pos.v0_v1_by_v', { v0: r.technicianName || msg('glossary.people.technician'), v1: msg(v > 0 ? 'payment.cash.over' : 'payment.cash.short'), v: String(money(Math.abs(v))) }));
      setEditFor(null); load();
    } catch (e) { setError((e as { message?: string })?.message || tx('pos.could_not_reconcile')); }
    finally { setBusy(null); }
  };

  const rows = board?.technicians ?? [];

  return (
    <div className="work">
      <div className="vh">
        <h1>{tx('pos.end_of_day_cash')}</h1>
        <div className="sub">{tx('pos.cash_handed_off_by_each_technician_6gcv')}</div>
      </div>

     <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5 mb-3.5 mt-2.5">
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{tx('pos.expected_cash')}</div><div className="v">{board ? money(board.totalExpectedCents) : '—'}</div></div>
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{tx('pos.counted')}</div><div className="v">{board ? money(board.totalCountedCents) : '—'}</div></div>
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{tx('pos.technicians')}</div><div className="v">{board ? board.technicianCount : '—'}</div></div>
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{tx('pos.reconciled')}</div><div className="v">{board ? board.reconciledCount : '—'}</div></div>
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{tx('pos.awaiting')}</div><div className="v" style={(board?.openCount ?? 0) > 0 ? { color: 'var(--warn)' } : undefined}>{board ? board.openCount : '—'}</div></div>
      </div>

      {error ? <div className="err" style={{ marginBottom: 12 }}>{error}</div> : null}
      {note ? <div className="muted" style={{ marginBottom: 10 }}>{renderMsg(note)}</div> : null}

      <section className="panel" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <label className="s">{tx('pos.date')}{' '}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ marginLeft: 6, height: 32, border: '1px solid var(--line)', borderRadius: 8, padding: '0 8px', fontFamily: 'inherit', background: '#FFFDF8' }} /></label>
          <button className="btn ghost w-full sm:w-auto sm:ml-auto" style={{ padding: '6px 12px' }} onClick={load}>{tx('pos.refresh')}</button>
        </div>
      </section>

      <section className="panel">
        <h2 style={{ fontSize: 14, margin: '0 0 8px' }}>{tx('pos.technician_cash_hand_offs')}</h2>
        {!board ? <div className="muted">{tx('pos.loading')}</div>
          : rows.length === 0 ? <div className="muted">{tx('pos.no_technician_collected_cash_on_this_1oz2')}</div>
          : (
          <div className="overflow-x-auto">
            <div className="min-w-[800px]">
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--ink-soft, #6b5d49)' }}>
                  <th style={{ padding: '8px 8px' }}>{tx('pos.technician')}</th>
                  <th style={{ padding: '8px 8px', textAlign: 'right' }}>{tx('pos.expected')}</th>
                  <th style={{ padding: '8px 8px', textAlign: 'right' }}>{tx('pos.payments')}</th>
                  <th style={{ padding: '8px 8px', textAlign: 'right' }}>{tx('pos.counted')}</th>
                  <th style={{ padding: '8px 8px', textAlign: 'right' }}>{tx('pos.variance')}</th>
                  <th style={{ padding: '8px 8px' }}>{tx('pos.status')}</th>
                  <th style={{ padding: '8px 8px', textAlign: 'right' }}>{tx('pos.action')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => {
                  const st = STATUS[t.status] || STATUS.open;
                  const v = t.varianceCents;
                  const editing = editFor === t.technicianId;
                  return (
                    <Fragment key={t.technicianId}>
                      <tr style={{ borderTop: '1px solid var(--line)' }}>
                        <td style={{ padding: '10px 8px', fontWeight: 700 }}>{t.technicianName || tx('pos.technician')}</td>
                        <td style={{ padding: '10px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{money(t.expectedCents)}</td>
                        <td style={{ padding: '10px 8px', textAlign: 'right' }}>{t.paymentCount}</td>
                        <td style={{ padding: '10px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{t.countedCents != null ? money(t.countedCents) : '—'}</td>
                        <td style={{ padding: '10px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: v == null ? undefined : v === 0 ? '#1f7a4d' : '#b3261e', fontWeight: v ? 700 : 400 }}>{v == null ? '—' : (v > 0 ? '+' : '') + money(v)}</td>
                        <td style={{ padding: '10px 8px' }}><span style={{ padding: '3px 9px', borderRadius: 999, fontSize: 12, fontWeight: 700, color: st.color, background: st.bg }}>{st.label}</span></td>
                        <td style={{ padding: '10px 8px', textAlign: 'right' }}>
                          <button className={'btn' + (editing ? ' ghost' : '')} style={{ padding: '5px 10px' }} onClick={() => (editing ? setEditFor(null) : openEditor(t))}>{editing ? tx('pos.close') : (t.status === 'reconciled' || t.status === 'discrepancy') ? tx('admin.cash.recount') : tx('admin.cash.count')}</button>
                        </td>
                      </tr>
                      {editing ? (
                        <tr>
                          <td colSpan={7} style={{ padding: '0 8px 12px' }}>
                            <div style={{ background: '#FFFDF8', border: '1px solid var(--line)', borderRadius: 10, padding: 12, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                              <label className="s w-full sm:w-auto">{tx('pos.counted_cash')}
                                <input type="number" min="0" step="0.01" value={counted} onChange={(e) => setCounted(e.target.value)} autoFocus
                                  className="w-full sm:w-[140px]" style={{ display: 'block', marginTop: 4, height: 34, border: '1px solid var(--line)', borderRadius: 8, padding: '0 10px', fontFamily: 'inherit', background: '#fff' }} />
                              </label>
                              <label className="s w-full sm:flex-1" style={{ minWidth: 180 }}>{tx('pos.note_optional')}
                                <input value={reconNotes} onChange={(e) => setReconNotes(e.target.value)} placeholder={tx('pos.e_g_drawer_short_on_count')}
                                  className="w-full" style={{ display: 'block', marginTop: 4, height: 34, border: '1px solid var(--line)', borderRadius: 8, padding: '0 10px', fontFamily: 'inherit', background: '#fff' }} />
                              </label>
                              <div className="muted w-full sm:w-auto" style={{ fontSize: 12, alignSelf: 'center' }}>{tx('pos.expected')}{' '}{money(t.expectedCents)}</div>
                              <button className="btn w-full sm:w-auto" style={{ padding: '7px 14px' }} disabled={busy === t.technicianId} onClick={() => submit(t)}>{busy === t.technicianId ? tx('pos.saving_2') : tx('pos.reconcile')}</button>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
