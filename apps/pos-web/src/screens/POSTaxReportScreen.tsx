// POSTaxReportScreen.tsx — Reports → Tax (SUNMI batch 9 guide 15, Nov 10 2026). GET /pos/reports/tax (financial).
// Preserved: title, the five cards (Tax Collected, Taxable Sales, Exempt Sales, Tax Rate, Adjustments) and Tax by Category.
// Fixed: the period tabs did nothing (`period` sent, `preset` read); Taxable Sales was ALL net sales and Exempt a constant 0
// — now each line's own taxable flag (sales before discounts); "Tax by category" put a ticket's whole tax under its first
// line's category — tax is recorded per TICKET, so the table now shows taxable / exempt sales per category and the
// period's tax once; Adjustments was a constant 0 — now "not tracked". The configured rate and the effective rate are
// both shown, labelled. Added: custom dates (URL), how it's calculated, and the period's tickets with their tax.
import { useEffect, useState } from 'react';
import { posReportsApi } from '../api/posReportsApi';
import { useReportCadence, money, reportError, useUrlPeriod } from './reportsCommon';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { PeriodBar } from '../components/FinanceKit';
import { useCan } from '../components/usePermissions';
import { TicketExplorer } from './POSSalesReportScreen';

type TaxSummary = {
  taxableSalesCents: number; exemptSalesCents: number; taxCollectedCents: number; taxRatePercent: number;
  byCategory: { category: string; taxCents: number | null; taxableCents?: number; exemptCents?: number }[]; adjustmentsCents: number | null;
  effectiveRatePercent?: number | null; basis?: string;
};
const pct = (n: number | null | undefined) => (n == null ? tx('rpt.na') : `${n.toFixed(2)}%`);

export function POSTaxReportScreen() {
  const { reloadKey } = useReportCadence();
  const { period, setPeriod, query } = useUrlPeriod('month');
  const [t, setT] = useState<TaxSummary | null>(null);
  const [range, setRange] = useState<{ from: string; to: string; timezone?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const can = useCan();
  const key = JSON.stringify(query);
  useEffect(() => {
    let alive = true; setLoading(true); setError(null);
    Promise.all([posReportsApi.tax(query), Promise.resolve(posReportsApi.state(query)).catch(() => null)])
      .then(([d, st]: any[]) => { if (alive) { setT(d as TaxSummary); setRange(st?.dateRange ?? null); } })
      .catch((e: any) => { if (alive) { setT(null); setError(reportError(e, tx('admin.reports.noun.tax'))); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reloadKey]);
  const server = range ? { preset: period.preset, from: range.from, to: range.to, tz: range.timezone ?? '', today: range.to } : null;
  const cats = t?.byCategory || [];
  const label = (c: string) => (c === 'Retail' ? tx('rpt.tax.retail') : c === 'Unmapped' ? tx('rpt.svc.unmapped') : c);
  return (
    <div className="work">
      <div className="vh "><h1>{tx('pos.tax_report')}</h1><div className="sub mb-3">{tx('pos.taxable_sales_and_tax_collected')}</div></div>
      <div className="flex flex-col md:flex-row flex-wrap whitespace-nowrap sm:items-center justify-between gap-2 mb-1">
        <PeriodBar value={period} onChange={setPeriod} server={server} basis="paid" basisOptions={[{ value: 'paid', label: tx('rpt.basisPaid') }]} />
      </div>
      {loading && !t ? <div className="state">{tx('pos.loading_tax_report')}</div> : null}
      {error ? <div className="err" role="alert" style={{ marginTop: 12 }}>{error}</div> : null}
      {t ? (<>
        <div className="kpis">
          <div className="kpi"><div className="l">{tx('pos.tax_collected_2')}</div><div className="v" data-testid="tax-collected">{money(t.taxCollectedCents)}</div></div>
          <div className="kpi"><div className="l">{tx('pos.taxable_sales_2')}</div><div className="v" data-testid="tax-taxable">{money(t.taxableSalesCents)}</div><div className="d flat">{tx('rpt.svc.beforeDiscounts')}</div></div>
          <div className="kpi"><div className="l">{tx('pos.exempt_sales_2')}</div><div className="v" data-testid="tax-exempt">{money(t.exemptSalesCents)}</div></div>
          <div className="kpi"><div className="l">{tx('pos.tax_rate')}</div><div className="v">{pct(t.taxRatePercent)}</div><div className="d flat" data-testid="tax-effective">{tx('rpt.tax.effective', { rate: pct(t.effectiveRatePercent) })}</div></div>
          <div className="kpi"><div className="l">{tx('pos.adjustments')}</div><div className="v" data-testid="tax-adj">{t.adjustmentsCents == null ? '—' : money(t.adjustmentsCents)}</div>{t.adjustmentsCents == null ? <div className="d flat">{tx('rpt.tax.notTracked')}</div> : null}</div>
        </div>
        <div className="s mb-2" data-testid="tax-basis">{tx('rpt.tax.basis')}</div>
        <section className="panel mb-3">
          <div className="p-h">{tx('pos.tax_by_category')}</div>
          {cats.length === 0 ? <div className="state">{tx('pos.no_category_tax_in_this_period')}</div> : (
            <div className="overflow-x-auto w-full"><table className="tbl w-full" data-testid="tax-cats">
              <thead><tr><th>{tx('pos.category')}</th><th style={{ textAlign: 'right' }}>{tx('pos.taxable_sales_2')}</th><th style={{ textAlign: 'right' }}>{tx('pos.exempt_sales_2')}</th></tr></thead>
              <tbody>{cats.map((r, i) => (
                <tr key={i}><td>{label(r.category)}</td><td style={{ textAlign: 'right' }}>{r.taxableCents == null ? money(0) : money(r.taxableCents)}</td><td style={{ textAlign: 'right' }}>{money(r.exemptCents ?? 0)}</td></tr>
              ))}
              <tr><td style={{ fontWeight: 700 }}>{tx('rpt.tax.allCats')}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{money(t.taxableSalesCents)}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{money(t.exemptSalesCents)}</td></tr></tbody>
            </table></div>
          )}
          <div className="s mt-1">{tx('rpt.tax.perTicket', { amount: money(t.taxCollectedCents) })}</div>
        </section>
        {can('pos.reports.financial_view') ? <section className="panel mb-3"><div className="p-h">{tx('rpt.tax.tickets')}</div><TicketExplorer period={query} /></section> : null}
      </>) : null}
    </div>
  );
}
