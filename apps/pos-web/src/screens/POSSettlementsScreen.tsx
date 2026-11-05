// POSSettlementsScreen.tsx — Payments → Settlements. Wired to GET /pos/payments/reconciliation
// (permission-gated pos.reports.view). Processor settlements (gross/fees/net) and refunds for a range.
import { useEffect, useState } from 'react';
import { posPaymentsApi } from '../api/posPaymentsApi';
import { money, PeriodTabs, reportError } from './reportsCommon';
import { t } from '@aipowersalon/mobile-sdk/i18n';

type Recon = {
  from: string | null; to: string | null;
  refunds: { count: number; totalCents: number };
  settlements: { count: number; grossCents: number; feeCents: number; netCents: number };
};

function rangeFor(period: string): { from: string; to: string } {
  const now = new Date();
  const d = new Date(now);
  if (period === 'today') d.setHours(0, 0, 0, 0);
  else if (period === 'week') { d.setDate(d.getDate() - 7); }
  else if (period === 'month') { d.setDate(1); d.setHours(0, 0, 0, 0); }
  else if (period === 'year') { d.setMonth(0, 1); d.setHours(0, 0, 0, 0); }
  return { from: d.toISOString(), to: now.toISOString() };
}

export function POSSettlementsScreen() {
  const [period, setPeriod] = useState('month');
  const [r, setR] = useState<Recon | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true); setError(null);
      try {
        const d = await posPaymentsApi.reconciliation(rangeFor(period));
        if (alive) setR(d as Recon);
      } catch (e: any) {
        if (alive) setError(reportError(e, 'settlements'));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [period]);

  if (loading) return <div className="work"><div className="state">{t('pos.loading_settlements')}</div></div>;
  if (error) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error}</div></div>;
  if (!r) return <div className="work"><div className="state">{t('pos.no_settlement_data')}</div></div>;

  const s = r.settlements || { count: 0, grossCents: 0, feeCents: 0, netCents: 0 };
  const rf = r.refunds || { count: 0, totalCents: 0 };

  return (
    <div className="work">
      <div className="vh" style={{ marginBottom: 10 }}><h1>{t('pos.settlements')}</h1><div className="sub">{t('pos.processor_settlements_and_refunds_for_the_1ua8')}</div></div>
     <div className="overflow-x-auto">
  <div className="min-w-[350px] whitespace-nowrap flex flex-col sm:flex-row justify-between items-stretch sm:items-center mt-3 gap-2"><PeriodTabs period={period} onChange={setPeriod} /></div>
     </div> <div className="kpis">
        <div className="kpi"><div className="l">{t('pos.settlements')}</div><div className="v">{s.count ?? 0}</div></div>
        <div className="kpi"><div className="l">{t('pos.gross_settled')}</div><div className="v">{money(s.grossCents)}</div></div>
        <div className="kpi"><div className="l">{t('pos.processor_fees')}</div><div className="v">{money(s.feeCents)}</div></div>
        <div className="kpi"><div className="l">{t('pos.net_deposited')}</div><div className="v">{money(s.netCents)}</div></div>
        <div className="kpi"><div className="l">{t('pos.refunds')}</div><div className="v">{rf.count ?? 0}</div></div>
        <div className="kpi"><div className="l">{t('pos.refunds_total')}</div><div className="v">{money(rf.totalCents)}</div></div>
      </div>
      <section className="panel">
        <div className="p-h">{t('pos.reconciliation')}</div>
        <table className="tbl">
          <tbody>
            <tr><td>{t('pos.gross_settled_2')}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{money(s.grossCents)}</td></tr>
            <tr><td>{t('pos.less_processor_fees')}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>-{money(s.feeCents)}</td></tr>
            <tr><td>{t('pos.net_deposited_2')}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{money(s.netCents)}</td></tr>
            <tr><td>{t('pos.refunds_issued_2')}{rf.count ?? 0})</td><td style={{ textAlign: 'right', fontWeight: 700 }}>-{money(rf.totalCents)}</td></tr>
          </tbody>
        </table>
      </section>
    </div>
  );
}
