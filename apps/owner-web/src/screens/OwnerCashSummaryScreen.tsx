import { useCallback, useEffect, useState } from 'react';
import { ownerCashSummaryApi, ownerCashDrawerApi, ownerCashHandoffApi, type DailyCashSummary, type CashPoolSummary } from '../api/ownerApi';
import { buildCashReportCsv } from './cashReportCsv';
import { useOwnerNav } from '../shell/nav';
import { useOwnerStream } from '../api/useOwnerStream';

// OwnerCashSummaryScreen — end-of-day total cash position. Combines the front-desk register drawer and the technician
// cash hand-offs into one "did it add up" view. Read-only, salon-wide; the front desk reconciles each pool in the POS.
const money = (c: any) => `$${(Number(c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const todayIso = () => new Date().toISOString().slice(0, 10);
const Back = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--owner-text)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>;

function Pool({ title, p, hint, loading }: { title: string; p: CashPoolSummary; hint: string; loading?: boolean }) {
  const v = p?.varianceCents;
  return (
    <div style={{ border: '1px solid var(--owner-border, #e7ddc9)', borderRadius: 12, padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <div className="owner-serif" style={{ fontWeight: 700, flex: 1 }}>{title}</div>
        <div style={{ fontSize: 12, color: 'var(--owner-text)', opacity: 0.7 }}>
          {loading ? <div className="owner-skel" style={{ width: 60, height: 12, display: 'inline-block' }} /> : `${p.unitCount} ${hint}`}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
        <div><div className="muted" style={{ fontSize: 11.5 }}>Expected</div><div style={{ fontWeight: 700 }}>{loading ? <div className="owner-skel" style={{ width: 60, height: 18 }} /> : money(p.expectedCents)}</div></div>
        <div><div className="muted" style={{ fontSize: 11.5 }}>Counted</div><div style={{ fontWeight: 700 }}>{loading ? <div className="owner-skel" style={{ width: 60, height: 18 }} /> : money(p.countedCents)}</div></div>
        <div><div className="muted" style={{ fontSize: 11.5 }}>Variance</div><div style={{ fontWeight: 700, color: loading ? undefined : (v || 0) === 0 ? '#2e7d32' : '#c0392b' }}>{loading ? <div className="owner-skel" style={{ width: 60, height: 18 }} /> : `${(v || 0) > 0 ? '+' : ''}${money(v)}`}</div></div>
      </div>
      <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
        {loading ? <div className="owner-skel" style={{ width: 180, height: 12 }} /> : `${p.reconciledCount} reconciled · ${p.discrepancyCount} discrepanc${p.discrepancyCount === 1 ? 'y' : 'ies'} · ${p.awaitingCount} awaiting`}
      </div>
    </div>
  );
}

export function OwnerCashSummaryScreen() {
  const { back } = useOwnerNav();
  const [date, setDate] = useState(todayIso());
  const [data, setData] = useState<DailyCashSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [csvBusy, setCsvBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true); setErr(null);
    ownerCashSummaryApi.state(date || undefined)
      .then((d) => setData(d))
      .catch((e: any) => setErr(e?.status === 403 ? 'You do not have access to the cash summary.' : e?.message || 'Could not load the cash summary.'))
      .finally(() => setLoading(false));
  }, [date]);
  useEffect(() => { load(); }, [load]);
  useOwnerStream((ev) => { if (ev === 'reconcile' || ev === 'fallback' || ev.startsWith('cash_drawer') || ev.startsWith('cash_handoff')) load(); });

  const downloadCsv = async () => {
    if (!data) return;
    setCsvBusy(true); setErr(null);
    try {
      const [drawer, hand] = await Promise.all([ownerCashDrawerApi.state(date || undefined), ownerCashHandoffApi.state(date || undefined)]);
      const csv = buildCashReportCsv(data, drawer.branches, hand.technicians);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `cash-close-out-${data.businessDate}.csv`; document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e) { setErr((e as { message?: string })?.message || 'Could not build the report.'); }
    finally { setCsvBusy(false); }
  };

  const tv = data?.total.varianceCents ?? 0;

  return (
    <>
      <header className="owner-header">
        <button className="owner-back" aria-label="Back" onClick={back}><Back /></button>
        <div className="owner-greet" style={{ textAlign: 'center' }}><div className="n owner-serif" style={{ cursor: 'default', justifyContent: 'center' }}>Daily Cash</div></div>
        <div style={{ width: 40 }} />
      </header>

      <div style={{ padding: '0 16px 24px' }}>
        <div className="owner-chartcard" style={{ margin: '8px 0', padding: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <label className="muted" style={{ fontSize: 12.5 }}>Date <input type="date" max={new Date().toISOString().split('T')[0]}  value={date} onChange={(e) => setDate(e.target.value)} className="owner-input" style={{ display: 'inline-block', width: 'auto', marginLeft: 6, padding: '6px 8px' }} /></label>
          <button className="owner-chip" style={{ marginLeft: 'auto', padding: '6px 12px' }} disabled={!data || csvBusy} onClick={downloadCsv}>{csvBusy ? 'Preparing…' : 'Download CSV'}</button>
          <button className="owner-chip" style={{ padding: '6px 12px' }} onClick={load}>Refresh</button>
        </div>

        {err ? <div className="owner-chartcard" role="alert" style={{ margin: '8px 0', padding: 12, color: '#c0392b' }}>{err}</div> : null}

        {/* Failed load with nothing to show: render only the error, not an empty dashboard that dereferences null. */}
        {err && !data ? null : <>
          <div className="owner-chartcard" style={{ margin: '8px 0', padding: 18, textAlign: 'center' }}>
            <div className="muted" style={{ fontSize: 12.5, letterSpacing: 0.4 }}>TOTAL CASH POSITION</div>
            <div className="owner-serif" style={{ fontSize: 30, fontWeight: 700, margin: '4px 0', display: 'flex', justifyContent: 'center', alignItems: 'baseline', gap: 6 }}>
              {loading && !data ? (
                <>
                  <div className="owner-skel" style={{ width: 80, height: 36 }} />
                  <span style={{ fontSize: 15, opacity: 0.55 }}> / <div className="owner-skel" style={{ width: 60, height: 18, display: 'inline-block' }} /></span>
                </>
              ) : data ? (
                <>{money(data.total.countedCents)}<span style={{ fontSize: 15, opacity: 0.55 }}> / {money(data.total.expectedCents)}</span></>
              ) : <span aria-hidden>—</span>}
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: tv === 0 ? '#2e7d32' : '#c0392b' }}>
              {loading && !data ? <div className="owner-skel" style={{ width: 200, height: 18, margin: '0 auto' }} /> : (tv === 0 ? 'Balanced — counted matches expected' : `${tv > 0 ? 'Over' : 'Short'} ${money(Math.abs(tv))}`)}
            </div>
          </div>

          <div style={{ display: 'grid', gap: 10, margin: '12px 0' }}>
            <Pool title="Register drawer" p={data?.register as CashPoolSummary} hint={data ? (data.register.unitCount === 1 ? 'branch' : 'branches') : ''} loading={loading && !data} />
            <Pool title="Technician cash" p={data?.techCash as CashPoolSummary} hint={data ? (data.techCash.unitCount === 1 ? 'technician' : 'technicians') : ''} loading={loading && !data} />
          </div>
          <div className="muted" style={{ fontSize: 11.5, padding: '0 2px' }}>Register drawer = float + cash sales − refunds + cash in − cash out. Technician cash = Skip-the-Line cash collected by techs. Reconcile each in the POS (Cash Drawer and End-of-Day Cash).</div>
        </>}
      </div>
    </>
  );
}
