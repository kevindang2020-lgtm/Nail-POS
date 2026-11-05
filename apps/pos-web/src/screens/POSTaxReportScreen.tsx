// POSTaxReportScreen.tsx — Reports → Tax. Wired to GET /pos/reports/tax
// (permission-gated: financial). Taxable/exempt sales, tax collected, by-category breakdown.
import { useEffect, useState } from 'react';
import { posReportsApi } from '../api/posReportsApi';
import { useReportCadence } from './reportsCommon';
import { money, PeriodTabs, reportError } from './reportsCommon';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';

type TaxSummary = {
  taxableSalesCents: number; exemptSalesCents: number; taxCollectedCents: number; taxRatePercent: number;
  byCategory: { category: string; taxCents: number }[]; adjustmentsCents: number;
};
const pct = (n: number) => `${(n ?? 0).toFixed(2)}%`;

export function POSTaxReportScreen() {
  const { reloadKey } = useReportCadence();
  const [period, setPeriod] = useState('month');
  const [t, setT] = useState<TaxSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true; setLoading(true); setError(null);
    posReportsApi.tax({ period })
      .then((d: any) => { if (alive) setT(d as TaxSummary); })
      .catch((e: any) => { if (alive) setError(reportError(e, tx('admin.reports.noun.tax'))); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [period, reloadKey]);

  if (loading && !t) return <div className="work"><div className="state">{tx('pos.loading_tax_report')}</div></div>;
  if (error && !t) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error}</div></div>;
  if (!t) return <div className="work"><div className="state">{tx('pos.no_tax_data')}</div></div>;

  const cats = t.byCategory || [];

  return (
    <div className="work">
      <div className="vh "><h1>{tx('pos.tax_report')}</h1><div className="sub mb-3">{tx('pos.taxable_sales_and_tax_collected')}</div></div>
      <div className="flex flex-col md:flex-row flex-wrap whitespace-nowrap sm:items-center justify-between gap-2 mb-1"><PeriodTabs period={period} onChange={setPeriod} /></div>
      <div className="kpis">
        <div className="kpi"><div className="l">{tx('pos.tax_collected_2')}</div><div className="v">{money(t.taxCollectedCents)}</div></div>
        <div className="kpi"><div className="l">{tx('pos.taxable_sales_2')}</div><div className="v">{money(t.taxableSalesCents)}</div></div>
        <div className="kpi"><div className="l">{tx('pos.exempt_sales_2')}</div><div className="v">{money(t.exemptSalesCents)}</div></div>
        <div className="kpi"><div className="l">{tx('pos.tax_rate')}</div><div className="v">{pct(t.taxRatePercent)}</div></div>
        <div className="kpi"><div className="l">{tx('pos.adjustments')}</div><div className="v">{money(t.adjustmentsCents)}</div></div>
      </div>
      <section className="panel">
        <div className="p-h">{tx('pos.tax_by_category')}</div>
        {cats.length === 0 ? <div className="state">{tx('pos.no_category_tax_in_this_period')}</div> : (
          <div className="overflow-x-auto w-full"><table className="tbl w-full min-w-max">
            <thead><tr><th>{tx('pos.category')}</th><th style={{ textAlign: 'right' }}>{tx('pos.tax_collected_2')}</th></tr></thead>
            <tbody>{cats.map((r, i) => (
              <tr key={i}><td>{r.category}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{money(r.taxCents)}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}
