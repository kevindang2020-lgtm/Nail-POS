// POSCustomersReportScreen.tsx — Reports → Customers. Wired to GET /pos/reports/customers
// (permission-gated: financial or pos.reports.customer_view). New vs returning + retention.
import { useRealtime } from '../realtime/useRealtime';
import { useEffect, useState } from 'react';
import { posReportsApi } from '../api/posReportsApi';
import { useReportCadence } from './reportsCommon';
import { PeriodTabs, reportError } from './reportsCommon';
import { useIPadView } from '../components/IPadViewProvider';
import { reportRequest } from '../components/ipad-modules';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';

type CustomerInsights = {
  newCustomers: number; newCustomersTrendPercent: number;
  returningCustomers: number; returningCustomersTrendPercent: number;
  retentionRatePercent: number; retentionRateTrendPercent: number;
};
const pct = (n: number) => `${(n ?? 0).toFixed(1)}%`;
const Delta = ({ t }: { t: number }) => t == null ? null : <div className={`d ${t < 0 ? 'flat' : ''}`}>{t >= 0 ? '▲' : '▼'} {Math.abs(t)}%</div>;

export function POSCustomersReportScreen() {
  const { reloadKey } = useReportCadence();
  // Constitution 9: ticket_paid / customer_profile_updated / loyalty_points_added route to the 'customers' screen.
  const [liveKey, setLiveKey] = useState(0);
  useRealtime('customers', () => setLiveKey((k) => k + 1));
  const [period, setPeriod] = useState('month');
  const [c, setC] = useState<CustomerInsights | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { open: openIPad } = useIPadView();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true; setLoading(true); setError(null);
    posReportsApi.customers({ period })
      .then((d: any) => { if (alive) setC(d as CustomerInsights); })
      .catch((e: any) => { if (alive) setError(reportError(e, 'the customers report')); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [period, reloadKey, liveKey]);

  if (loading && !c) return <div className="work"><div className="state">{tx('pos.loading_customers_report')}</div></div>;
  if (error && !c) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error}</div></div>;
  if (!c) return <div className="work"><div className="state">{tx('pos.no_customer_data')}</div></div>;

  return (
    <div className="work">
      <div className="vh "><h1>{tx('pos.customers_report')}</h1><div className="sub mb-3">{tx('pos.new_vs_returning_customers_and_retention')}</div></div>
      <div className="flex flex-col md:flex-row flex-wrap whitespace-nowrap sm:items-center justify-between gap-2 mb-1"><PeriodTabs period={period} onChange={setPeriod} /><button className="btn ghost w-fit whitespace-nowrap"  title={tx('pos.open_full_ipad_view')} onClick={() => openIPad(reportRequest(tx('pos.customers_report'), { kpis: [{ label: tx('pos.new_customers'), value: c.newCustomers }, { label: tx('pos.returning'), value: c.returningCustomers }, { label: tx('pos.retention'), value: c.retentionRatePercent + '%' }], periodLabel: period }))}>{tx('pos.full_view')}</button></div>
      <div className="kpis">
        <div className="kpi"><div className="l">{tx('pos.new_customers')}</div><div className="v">{c.newCustomers ?? 0}</div><Delta t={c.newCustomersTrendPercent} /></div>
        <div className="kpi"><div className="l">{tx('pos.returning_customers_2')}</div><div className="v">{c.returningCustomers ?? 0}</div><Delta t={c.returningCustomersTrendPercent} /></div>
        <div className="kpi"><div className="l">{tx('pos.retention_rate')}</div><div className="v">{pct(c.retentionRatePercent)}</div><Delta t={c.retentionRateTrendPercent} /></div>
      </div>
      <section className="panel">
        <div className="p-h">{tx('pos.mix')}</div>
        <div className="bars" role="img" aria-label={tx('pos.new_vs_returning')}>
          {[[tx('pos.new'), c.newCustomers || 0], [tx('pos.returning'), c.returningCustomers || 0]].map(([label, v]) => {
            const max = Math.max(1, c.newCustomers || 0, c.returningCustomers || 0);
            return (
              <div className="bar-col" key={label as string} title={`${label}: ${v}`}>
                <div className="bar" style={{ height: `${Math.max(2, Math.round(((v as number) / max) * 140))}px` }} />
                <div className="bar-l">{label as string}</div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
