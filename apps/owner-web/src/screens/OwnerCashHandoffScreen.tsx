import { useCallback, useEffect, useState } from 'react';
import { ownerCashHandoffApi, type OwnerCashHandoffBoard, type OwnerHandoffStatus } from '../api/ownerApi';
import { useOwnerNav } from '../shell/nav';
import { useOwnerStream } from '../api/useOwnerStream';
import { OwnerSkeletonBlocks } from '../components/OwnerSkeleton';

// OwnerCashHandoffScreen — Owner App, read-only end-of-day cash oversight. For the chosen date, each technician's
// collected cash (from confirmed Skip-the-Line cash payments), what the front desk counted, and any over/short.
// Salon-wide, tenant-scoped server-side. The owner reviews; the front desk does the reconciling in the POS.
const money = (c: any) => `$${(Number(c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const todayIso = () => new Date().toISOString().slice(0, 10);
const STATUS: Record<OwnerHandoffStatus, { label: string; color: string }> = {
  open: { label: 'Open', color: 'var(--owner-text)' },
  submitted: { label: 'Handed off', color: '#b8860b' },
  reconciled: { label: 'Reconciled', color: '#2e7d32' },
  discrepancy: { label: 'Discrepancy', color: '#c0392b' },
  cancelled: { label: 'Cancelled', color: 'var(--owner-text)' },
};
const Back = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--owner-text)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>;

export function OwnerCashHandoffScreen() {
  const { back } = useOwnerNav();
  const [date, setDate] = useState(todayIso());
  const [board, setBoard] = useState<OwnerCashHandoffBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true); setErr(null);
    ownerCashHandoffApi.state(date || undefined)
      .then((b) => setBoard(b))
      .catch((e: any) => setErr(e?.status === 403 ? 'You do not have access to cash hand-offs.' : e?.message || 'Could not load cash hand-offs.'))
      .finally(() => setLoading(false));
  }, [date]);
  useEffect(() => { load(); }, [load]);
  useOwnerStream((ev) => { if (ev === 'reconcile' || ev === 'fallback' || ev.startsWith('cash_handoff')) load(); });

  const rows = board?.technicians ?? [];
  const discrepancies = rows.filter((t) => t.status === 'discrepancy').length;
  const netVariance = rows.reduce((a, t) => a + (t.varianceCents || 0), 0);

  return (
    <>
      <header className="owner-header">
        <button className="owner-back" aria-label="Back" onClick={back}><Back /></button>
        <div className="owner-greet" style={{ textAlign: 'center' }}><div className="n owner-serif" style={{ cursor: 'default', justifyContent: 'center' }}>End-of-Day Cash</div></div>
        <div style={{ width: 40 }} />
      </header>

      <div style={{ padding: '0 16px 24px' }}>
        <div className="owner-chartcard" style={{ margin: '8px 0', padding: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <label className="muted" style={{ fontSize: 12.5 }}>Date <input type="date" max={new Date().toISOString().split('T')[0]}  value={date} onChange={(e) => setDate(e.target.value)} className="owner-input" style={{ display: 'inline-block', width: 'auto', marginLeft: 6, padding: '6px 8px' }} /></label>
          <button className="owner-chip" style={{ marginLeft: 'auto', padding: '6px 12px' }} onClick={load}>Refresh</button>
        </div>

        {err ? <div className="owner-chartcard" style={{ margin: '8px 0', padding: 12, color: '#c0392b' }}>{err}</div> : null}

        {loading && !board ? <OwnerSkeletonBlocks count={4} /> : (
          <>
            <div className="owner-kpigrid three" style={{ marginTop: 8 }}>
              <div className="owner-kpi"><div className="label">Expected (cash)</div><div className="val" style={{ fontSize: 16 }}>{board ? money(board.totalExpectedCents) : '—'}</div><div className="sub flat">{board ? `${board.technicianCount} technician${board.technicianCount === 1 ? '' : 's'}` : ''}</div></div>
              <div className="owner-kpi"><div className="label">Counted</div><div className="val" style={{ fontSize: 16 }}>{board ? money(board.totalCountedCents) : '—'}</div><div className={`sub ${netVariance === 0 ? 'flat' : netVariance > 0 ? 'up' : 'down'}`}>{board ? (netVariance === 0 ? 'Balanced' : `${netVariance > 0 ? 'Over' : 'Short'} ${money(Math.abs(netVariance))}`) : ''}</div></div>
              <div className="owner-kpi"><div className="label">Reconciled</div><div className="val">{board ? board.reconciledCount : '—'}</div><div className={`sub ${discrepancies > 0 ? 'down' : 'flat'}`}>{board ? `${discrepancies} discrepanc${discrepancies === 1 ? 'y' : 'ies'} · ${board.openCount} awaiting` : ''}</div></div>
            </div>

            <div className="owner-chartcard" style={{ margin: '12px 0', padding: 16 }}>
              <div className="owner-serif" style={{ fontSize: 16, marginBottom: 10 }}>Technician cash hand-offs</div>
              {!board ? <div className="muted">Loading…</div>
                : rows.length === 0 ? <div className="muted">No technician collected cash on this date.</div>
                : (
                <div style={{ display: 'grid', gap: 10 }}>
                  {rows.map((t) => {
                    const st = STATUS[t.status] || STATUS.open;
                    const v = t.varianceCents;
                    return (
                      <div key={t.technicianId} style={{ borderTop: '1px solid var(--owner-line, #ece3d3)', paddingTop: 10 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                          <div style={{ fontWeight: 600 }}>{t.technicianName || 'Technician'}</div>
                          <span style={{ fontSize: 12, fontWeight: 600, color: st.color }}>{st.label}</span>
                        </div>
                        <div className="muted" style={{ fontSize: 12.5, marginTop: 4, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4 }}>
                          <span>Expected: {money(t.expectedCents)}</span>
                          <span>Counted: {t.countedCents != null ? money(t.countedCents) : '—'}</span>
                          <span style={v ? { color: v > 0 ? '#2e7d32' : '#c0392b', fontWeight: 600 } : undefined}>Variance: {v == null ? '—' : (v > 0 ? '+' : '') + money(v)}</span>
                        </div>
                        <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{t.paymentCount} cash payment{t.paymentCount === 1 ? '' : 's'}{t.notes ? ` · ${t.notes}` : ''}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
