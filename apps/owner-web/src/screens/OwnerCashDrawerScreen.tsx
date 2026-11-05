import { useCallback, useEffect, useState } from 'react';
import { ownerCashDrawerApi, type OwnerDrawerSummary, type OwnerDrawerStatus } from '../api/ownerApi';
import { useOwnerNav } from '../shell/nav';
import { useOwnerStream } from '../api/useOwnerStream';
import { OwnerSkeletonBlocks, OwnerSkeletonCards, OwnerSkeletonList } from '../components/OwnerSkeleton';

// OwnerCashDrawerScreen — Owner App, read-only register-cash oversight. For the chosen date, each branch's front-desk
// drawer: opening float + cash sales − refunds = expected, what was counted, and any over/short. The front desk does the
// reconciling in the POS; the owner reviews salon-wide (tenant-scoped server-side). Excludes cash paid to technicians.
const money = (c: any) => `$${(Number(c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const todayIso = () => new Date().toISOString().slice(0, 10);
const STATUS: Record<OwnerDrawerStatus, { label: string; color: string }> = {
  open: { label: 'Open', color: 'var(--owner-text)' },
  reconciled: { label: 'Reconciled', color: '#2e7d32' },
  discrepancy: { label: 'Discrepancy', color: '#c0392b' },
  cancelled: { label: 'Cancelled', color: 'var(--owner-text)' },
};
const Back = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--owner-text)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>;

export function OwnerCashDrawerScreen() {
  const { back } = useOwnerNav();
  const [date, setDate] = useState(todayIso());
  const [data, setData] = useState<OwnerDrawerSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true); setErr(null);
    ownerCashDrawerApi.state(date || undefined)
      .then((d) => setData(d))
      .catch((e: any) => setErr(e?.status === 403 ? 'You do not have access to the cash drawer.' : e?.message || 'Could not load the cash drawer.'))
      .finally(() => setLoading(false));
  }, [date]);
  useEffect(() => { load(); }, [load]);
  useOwnerStream((ev) => { if (ev === 'reconcile' || ev === 'fallback' || ev.startsWith('cash_drawer')) load(); });

  const rows = data?.branches ?? [];
  const totalExpected = rows.reduce((a, b) => a + (b.expectedCashCents || 0), 0);
  const totalCounted = rows.reduce((a, b) => a + (b.countedCents || 0), 0);
  const netVariance = rows.reduce((a, b) => a + (b.varianceCents || 0), 0);
  const discrepancies = rows.filter((b) => b.status === 'discrepancy').length;
  const reconciled = rows.filter((b) => b.status === 'reconciled').length;
  const counted = rows.filter((b) => b.countedCents != null).length;

  return (
    <>
      <header className="owner-header">
        <button className="owner-back" aria-label="Back" onClick={back}><Back /></button>
        <div className="owner-greet" style={{ textAlign: 'center' }}><div className="n owner-serif" style={{ cursor: 'default', justifyContent: 'center' }}>Cash Drawer</div></div>
        <div style={{ width: 40 }} />
      </header>

      <div style={{ padding: '0 16px 24px' }}>
        <div className="owner-chartcard" style={{ margin: '8px 0', padding: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <label className="muted" style={{ fontSize: 12.5 }}>Date <input type="date" max={new Date().toISOString().split('T')[0]}  value={date} onChange={(e) => setDate(e.target.value)} className="owner-input" style={{ display: 'inline-block', width: 'auto', marginLeft: 6, padding: '6px 8px' }} /></label>
          <button className="owner-chip" style={{ marginLeft: 'auto', padding: '6px 12px' }} onClick={load}>Refresh</button>
        </div>

        {err ? <div className="owner-chartcard" style={{ margin: '8px 0', padding: 12, color: '#c0392b' }}>{err}</div> : null}

          <>
            <div className="owner-kpigrid three" style={{ marginTop: 8 }}>
              <div className="owner-kpi">
                <div className="label">Expected (register)</div>
                <div className="val" style={{ fontSize: 16 }}>
                  {loading && !data ? <div className="owner-skel" style={{ width: 60, height: 20, margin: '0 auto' }} /> : (data ? money(totalExpected) : '—')}
                </div>
                <div className="sub flat">
                  {loading && !data ? <div className="owner-skel" style={{ width: 40, height: 12, margin: '4px auto 0' }} /> : (data ? `${rows.length} branch${rows.length === 1 ? '' : 'es'}` : '')}
                </div>
              </div>
              <div className="owner-kpi">
                <div className="label">Counted</div>
                <div className="val" style={{ fontSize: 16 }}>
                  {loading && !data ? <div className="owner-skel" style={{ width: 60, height: 20, margin: '0 auto' }} /> : (data ? money(totalCounted) : '—')}
                </div>
                <div className={`sub ${netVariance === 0 ? 'flat' : netVariance > 0 ? 'up' : 'down'}`}>
                  {loading && !data ? <div className="owner-skel" style={{ width: 60, height: 12, margin: '4px auto 0' }} /> : (data ? (netVariance === 0 ? 'Balanced' : `${netVariance > 0 ? 'Over' : 'Short'} ${money(Math.abs(netVariance))}`) : '')}
                </div>
              </div>
              <div className="owner-kpi">
                <div className="label">Reconciled</div>
                <div className="val">
                  {loading && !data ? <div className="owner-skel" style={{ width: 30, height: 24, margin: '0 auto' }} /> : (data ? reconciled : '—')}
                </div>
                <div className={`sub ${discrepancies > 0 ? 'down' : 'flat'}`}>
                  {loading && !data ? <div className="owner-skel" style={{ width: 80, height: 12, margin: '4px auto 0' }} /> : (data ? `${discrepancies} discrepanc${discrepancies === 1 ? 'y' : 'ies'} · ${rows.length - counted} awaiting` : '')}
                </div>
              </div>
            </div>

            <div className="owner-chartcard" style={{ margin: '12px 0', padding: 16 }}>
              <div className="owner-serif" style={{ fontSize: 16, marginBottom: 10 }}>Register drawers by branch</div>
              {loading && !data ? <OwnerSkeletonBlocks count={2} /> 
                : !data ? <div className="muted">Loading…</div>
                : rows.length === 0 ? <div className="muted">No active branches for this date.</div>
                : (
                <div style={{ display: 'grid', gap: 10 }}>
                  {rows.map((b) => {
                    const st = STATUS[b.status] || STATUS.open;
                    const v = b.varianceCents;
                    return (
                      <div key={b.branchId} style={{ border: '1px solid var(--owner-border, #e7ddc9)', borderRadius: 12, padding: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div className="owner-serif" style={{ fontWeight: 700, flex: 1 }}>{b.branchName}</div>
                          <span style={{ fontSize: 12, fontWeight: 700, color: st.color }}>{st.label}</span>
                        </div>
                        <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>Expected {money(b.expectedCashCents)} = float {money(b.openingFloatCents)} + sales {money(b.expectedSalesCents)} − refunds {money(b.refundsCents)}{b.paidInCents ? ` + in ${money(b.paidInCents)}` : ''}{b.paidOutCents ? ` − out ${money(b.paidOutCents)}` : ''}</div>
                        <div style={{ marginTop: 6, fontSize: 13 }}>
                          {b.countedCents != null
                            ? <>Counted <strong>{money(b.countedCents)}</strong> · <span style={{ color: (v || 0) === 0 ? '#2e7d32' : '#c0392b' }}>{(v || 0) === 0 ? 'balanced' : `${(v || 0) > 0 ? 'over' : 'short'} ${money(Math.abs(v || 0))}`}</span></>
                            : <span className="muted">Not counted yet</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="muted" style={{ fontSize: 11.5, padding: '0 2px' }}>Register cash excludes cash paid directly to technicians (see End-of-Day Cash). The front desk counts and reconciles each drawer in the POS.</div>
          </>
      </div>
    </>
  );
}
