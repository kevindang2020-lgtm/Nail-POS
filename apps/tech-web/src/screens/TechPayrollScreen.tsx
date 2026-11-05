import { useCallback, useEffect, useState } from 'react';
import { techApi, type TechPayroll, type TechPayrollPeriod } from '../api/techApi';
import { useTechNav } from '../shell/nav';
import { TechAgreementsPanel } from './TechAgreementsPanel';
import { useTechStream } from '../lib/useTechStream';

// Payroll & Payouts (technician). The signed-in tech's OWN finalized payroll — GET /tech/payroll derives the technician
// from the session and reads the same payroll_periods/payroll_lines the owner/manager Payroll screen produces (no
// recompute, no fabrication). Paid / Unpaid / Total roll-up + payout history, matching the Tech App design. Honest
// loading / empty / error states.
const Back = () => (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>);
const usd = (cents: number) => '$' + (Number(cents || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const range = (p: TechPayrollPeriod) => {
  const fmt = (iso: string) => { const d = new Date(iso + 'T00:00:00'); return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); };
  return p.label || `${fmt(p.periodStart)} – ${fmt(p.periodEnd)}`;
};

function StatCard({ label, value, tone }: { label: string; value: string; tone: 'ok' | 'warn' | 'plain' }) {
  const color = tone === 'ok' ? 'var(--tech-success,#2E9E54)' : tone === 'warn' ? 'var(--tech-danger,#C0492F)' : 'var(--tech-text,#2C2118)';
  return (
    <div style={{ flex: 1, minWidth: 96, border: '1px solid var(--tech-line,#E7DBC6)', borderRadius: 14, padding: '12px 10px', background: 'var(--tech-surface,#fff)', textAlign: 'center' }}>
      <div className="tech-label" style={{ fontSize: 12, color: 'var(--tech-muted,#7A6C57)' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color, fontFamily: 'Playfair Display, serif', marginTop: 2 }}>{value}</div>
    </div>
  );
}

export function TechPayrollScreen() {
  const nav = useTechNav();
  const [data, setData] = useState<TechPayroll | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    techApi.payroll()
      .then((r) => { setData(r); setError(null); })
      .catch((e: { message?: string }) => setError(e?.message || 'Failed to load your payroll.'));
  }, []);
  useEffect(() => { load(); }, [load]);
  // Live: refresh when the owner finalizes/pays a period or the tech's earnings change (and on the poll fallback).
  useTechStream((ev) => { if (ev === 'owner_payroll_updated' || ev === 'technician_earnings_updated' || ev === 'poll' || ev === 'reconcile') load(); });

  const periods = data?.periods ?? [];

  return (
    <div style={{ paddingBottom: 90 }}>
      <div className="tech-topbar" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
        <button className="tech-iconbtn" onClick={() => nav.back()} aria-label="Back" ><Back /></button>
        <h1 className="t-title" style={{ fontSize: 19, margin: 0, color: 'var(--tech-text,#2C2118)' }}>Payroll</h1>
      </div>
      <div className="tech-main-2">

      {error && <div style={{ color: 'var(--tech-danger,#C0492F)', fontSize: 14, marginBottom: 12 }}>{error}</div>}
      {!data && !error && (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
            {[1, 2, 3].map(i => (
              <div key={i} style={{ flex: 1, minWidth: 96, border: '1px solid var(--tech-line,#E7DBC6)', borderRadius: 14, padding: '12px 10px', background: 'var(--tech-surface,#fff)', textAlign: 'center' }}>
                <div className="tech-skel" style={{ width: 40, height: 14, margin: '0 auto 4px' }} />
                <div className="tech-skel" style={{ width: 60, height: 24, margin: '0 auto' }} />
              </div>
            ))}
          </div>
          <div style={{ fontWeight: 700, fontSize: 15, margin: '0 0 8px', color: 'var(--tech-text,#2C2118)' }}>Payout History</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[1, 2, 3].map(i => (
              <div key={i} style={{ border: '1px solid var(--tech-line,#E7DBC6)', borderRadius: 12, padding: '12px 14px', background: 'var(--tech-surface,#fff)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <div className="tech-skel" style={{ width: '60%', height: 16 }} />
                  <div className="tech-skel" style={{ width: '40%', height: 14, marginTop: 4 }} />
                </div>
                <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                  <div className="tech-skel" style={{ width: 60, height: 20 }} />
                  <div className="tech-skel" style={{ width: 40, height: 14, marginTop: 4 }} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {data && (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 18 }}>
            <StatCard label="Paid" value={usd(data.paidCents)} tone="ok" />
            <StatCard label="Unpaid" value={usd(data.unpaidCents)} tone="warn" />
            <StatCard label="Total" value={usd(data.totalCents)} tone="plain" />
          </div>

          <div style={{ fontWeight: 700, fontSize: 15, margin: '0 0 8px', color: 'var(--tech-text,#2C2118)' }}>Payout History</div>
          {periods.length === 0 ? (
            <div className="tech-muted" style={{ fontSize: 14 }}>No payroll periods yet. Finalized payouts from your salon will appear here.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {periods.map((p) => {
                const paid = p.status === 'paid';
                return (
                  <div key={p.periodId} style={{ border: '1px solid var(--tech-line,#E7DBC6)', borderRadius: 12, padding: '12px 14px', background: 'var(--tech-surface,#fff)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--tech-text,#2C2118)' }}>{range(p)}</div>
                      <div className="tech-muted" style={{ fontSize: 12, marginTop: 2 }}>{p.servicesCount} service{p.servicesCount === 1 ? '' : 's'} · tips {usd(p.tipsCents)}{p.adjustmentCents ? ` · adj ${usd(p.adjustmentCents)}` : ''}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--tech-text,#2C2118)' }}>{usd(p.payableCents)}</div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: paid ? 'var(--tech-success,#2E9E54)' : 'var(--tech-muted,#7A6C57)' }}>
                        {paid ? 'Paid' : p.status === 'finalized' ? 'Pending' : 'Draft'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
        <TechAgreementsPanel />
      </div>
    </div>
  );
}
