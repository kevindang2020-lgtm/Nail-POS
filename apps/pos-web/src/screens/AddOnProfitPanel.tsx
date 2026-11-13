// AddOnProfitPanel.tsx — Extras · ADD-ONS 09 "Service profitability context": sold add-ons and the recipe cost of what was
// sold, for people who may see cost (inventory.cost.view). Every figure is the server's (GET /pos/menu-insights/
// add-on-profitability) and the basis it returns is stated under the table; an add-on with no recipe shows "—", never $0.
import { useState } from 'react';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posCatalogApi } from '../api/posCatalogApi';
import { fmtMoney, fmtNumber } from '../i18n/format';
import { FitPanel, Pager, Empty } from '../components/FitKit';
import { useLoad, StateBlock } from '../components/FinanceKit';

const WINDOWS = [7, 30, 90, 365] as const;
type ProfitRow = { key: string; name: string; unitsSold: number; ticketCount: number; revenueCents: number; recipeUnitCostCents: number | null; recipeCostCents: number | null; contributionCents: number | null };
const money = (c: number | null | undefined) => (c == null ? '—' : fmtMoney(c));

export function AddOnProfitPanel() {
  const [days, setDays] = useState<number>(30); const [page, setPage] = useState(1);
  const r = useLoad(() => posCatalogApi.addOnProfitability({ days, page, pageSize: 10 }), [days, page]);
  const d = r.data;
  return (
    <FitPanel testId="add-on-profit" title={<>{tx('cg.ao.pf.title')}{d ? <span className="fk-muted"> · {tx('cg.ao.pf.window', { n: fmtNumber(d.window.days) })}</span> : null}</>}
      footer={<Pager info={d ? { page: d.page, pageSize: d.pageSize, totalItems: d.totalItems, totalPages: d.totalPages } : null} onPage={setPage} label={tx('cg.ao.pf.title')} />}>
      <label className="fk-field-inline">{tx('cg.ao.pf.days')}{' '}
        <select className="fk-select" value={days} onChange={(e) => { setDays(Number(e.target.value)); setPage(1); }} data-testid="pf-days">
          {WINDOWS.map((w) => <option key={w} value={w}>{tx('cg.ao.pf.window', { n: String(w) })}</option>)}
        </select></label>
      {r.error ? <StateBlock error={r.error} onRetry={r.reload} /> : !d ? <div className="fk-loading">{tx('pos.loading')}</div> : <>
        <div className="mos-totals" data-testid="pf-totals">
          <div><span>{tx('cg.ao.pf.revenue')}</span><b>{fmtMoney(d.totals.revenueCents)}</b></div>
          <div><span>{tx('cg.ao.pf.cost')}</span><b>{fmtMoney(d.totals.recipeCostCents)}</b></div>
          <div><span>{tx('cg.ao.pf.contribution')}</span><b>{fmtMoney(d.totals.contributionCents)}</b></div>
          {d.totals.addOnsWithoutRecipe ? <span className="fk-hint" data-testid="pf-norecipe">{tx('cg.ao.pf.noRecipeN', { n: fmtNumber(d.totals.addOnsWithoutRecipe), v: fmtMoney(d.totals.revenueCents - d.totals.costedRevenueCents) })}</span> : null}
        </div>
        {d.items.length === 0 ? <Empty title={tx('cg.ao.pf.none')} /> : <table className="fk-table fn-table" data-testid="pf-table">
          <thead><tr><th>{tx('cg.ao.pf.addOn')}</th><th className="num">{tx('cg.ao.pf.units')}</th><th className="num">{tx('cg.ao.pf.revenue')}</th><th className="num">{tx('cg.ao.pf.unitCost')}</th><th className="num">{tx('cg.ao.pf.cost')}</th><th className="num">{tx('cg.ao.pf.contribution')}</th></tr></thead>
          <tbody>{(d.items as ProfitRow[]).map((x) => <tr key={x.key} data-testid="pf-row">
            <td>{x.name}<span className="fk-li-s">{tx('cg.ao.pf.tickets', { n: fmtNumber(x.ticketCount) })}</span></td>
            <td className="num">{fmtNumber(x.unitsSold)}</td><td className="num">{fmtMoney(x.revenueCents)}</td>
            <td className="num">{money(x.recipeUnitCostCents)}</td><td className="num">{money(x.recipeCostCents)}</td><td className="num">{money(x.contributionCents)}</td>
          </tr>)}</tbody>
        </table>}
        <div className="fk-hint" data-testid="pf-basis">{tx('cg.ao.pf.basis')}</div>
      </>}
    </FitPanel>
  );
}
