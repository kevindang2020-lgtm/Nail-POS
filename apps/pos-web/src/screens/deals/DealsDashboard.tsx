// DealsDashboard.tsx — BUILD_PLAN Phase 5: what the deals are doing (deal_daily_stats, kept by the aggregation job):
// live counts, discounts given (net of refunds), redemptions, reversals, the unpaid offers sitting on tickets, a day-by-day
// strip and the top deals with their conversion and budget use.
import { useEffect, useState } from 'react';
import { posDealsApi, type DealsDashboard as Dash } from '../../api/posDealsApi';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { statusLabel, humanizeCode } from '../../i18n/status-label';
const dealKindLabel = (k: string) => { const key = `growth.deals.kind.${k}`; const s = tx(key); return s === key ? humanizeCode(k) : s; };

const money = (c: number) => '$' + ((c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function DealsDashboard() {
  const [days, setDays] = useState(30);
  const [d, setD] = useState<Dash | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const doExport = async () => {
    setExporting(true);
    try {
      const r = await posDealsApi.exportCsv(days);
      const url = URL.createObjectURL(new Blob([r.csv], { type: 'text/csv;charset=utf-8;' }));
      const a = document.createElement('a'); a.href = url; a.download = r.filename || 'deal-redemptions.csv'; a.click(); URL.revokeObjectURL(url);
    } catch (e: any) { setError(e?.message || tx('pos.could_not_export')); }
    finally { setExporting(false); }
  };
  useEffect(() => { posDealsApi.dashboard(days).then((x) => setD(x as Dash)).catch((e) => setError(e?.message || tx('pos.could_not_load_the_dashboard'))); }, [days]);
  if (error) return <div style={{ color: '#B4453C' }}>{error}</div>;
  if (!d) return <div className="sub">{tx('pos.loading')}</div>;
  const max = Math.max(1, ...d.daily.map((x) => x.redemptions));
  const tiles: [string, string][] = [
    [tx('growth.deals.tile.live'), String(d.live.active)], [tx('growth.deals.tile.scheduled'), String(d.live.scheduled)], [tx('growth.deals.tile.awaiting'), String(d.live.pendingApproval)],
    [tx('growth.deals.tile.redemptions'), String(d.totals?.redemptions ?? 0)], [tx('growth.deals.tile.discounts'), money(d.totals?.netDiscountCents ?? 0)], [tx('growth.deals.tile.reversed'), String(d.totals?.reversals ?? 0)],
    [tx('growth.deals.tile.unpaid'), `${d.totals?.openApplications ?? 0} · ${money(d.totals?.openDiscountCents ?? 0)}`], [tx('growth.deals.tile.views'), String(d.totals?.views ?? 0)],
  ];
  return (
    <section className="panel" data-testid="deals-dashboard" style={{ marginBottom: 16 }}>
      <div className="flex justify-between items-center"><div className="p-h">{tx('pos.dashboard')}</div>
        <span className="flex gap-2 items-center"><select aria-label={tx('pos.dashboard_period')} value={days} onChange={(e) => setDays(Number(e.target.value))}><option value={7}>{tx('pos.7_days')}</option><option value={30}>{tx('pos.30_days')}</option><option value={90}>{tx('pos.90_days_2')}</option></select>
        <button className="btn ghost" disabled={exporting} onClick={() => void doExport()}>{exporting ? tx('pos.exporting') : tx('pos.export_csv_2')}</button></span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-2">
        {tiles.map(([l, v]) => <div key={l} style={{ padding: 10, border: '1px solid var(--line)', borderRadius: 8 }}><div className="sub" style={{ fontSize: 11 }}>{l}</div><div style={{ fontWeight: 800, fontSize: 18 }}>{v}</div></div>)}
      </div>
      {d.daily.length > 0 && (
        <div aria-label={tx('pos.redemptions_per_day')} style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 60, marginTop: 12 }}>
          {d.daily.map((x) => <div key={x.day} title={tx('pos.day_redemptions_redeemed_discountedcents', { day: String(x.day), redemptions: String(x.redemptions), discountedCents: String(money(x.discountedCents)) })} style={{ flex: 1, background: 'var(--ok, #2E9E54)', height: `${Math.max(4, (x.redemptions / max) * 100)}%`, borderRadius: 2 }} />)}
        </div>
      )}
      {d.top.length > 0 && (
        <table style={{ width: '100%', marginTop: 12, fontSize: 12 }}>
          <thead><tr><th align="left">{tx('pos.top_deals')}</th><th align="right">{tx('pos.views_2')}</th><th align="right">{tx('pos.redeemed')}</th><th align="right">{tx('pos.conversion')}</th><th align="right">{tx('pos.given')}</th><th align="right">{tx('pos.budget')}</th></tr></thead>
          <tbody>{d.top.map((t) => (
            <tr key={t.dealId}><td>{t.title} <span className="sub">({dealKindLabel(t.kind)}, {statusLabel('deal', t.status)})</span></td><td align="right">{t.views}</td><td align="right">{t.redemptions}{t.maxRedemptions ? ` / ${t.maxRedemptions}` : ''}</td>
              <td align="right">{t.conversion == null ? '—' : `${t.conversion}%`}</td><td align="right">{money(t.discountedCents)}</td><td align="right">{t.budgetCents ? `${money(t.budgetReservedCents)} / ${money(t.budgetCents)}` : '—'}</td></tr>
          ))}</tbody>
        </table>
      )}
      {d.byBranch && d.byBranch.length > 0 && (
        <table style={{ width: '100%', marginTop: 12, fontSize: 12 }} data-testid="deals-by-branch">
          <thead><tr><th align="left">{tx('do.byBranch.title')}</th><th align="right">{tx('do.byBranch.uses')}</th><th align="right">{tx('do.byBranch.customers')}</th><th align="right">{tx('do.byBranch.cost')}</th><th align="right">{tx('do.byBranch.avg')}</th></tr></thead>
          <tbody>{d.byBranch.map((b) => (
            <tr key={b.branchId ?? 'none'} data-testid="deals-branch-row"><td>{b.branchName ?? tx('do.byBranch.noBranch')}</td><td align="right">{b.uses}</td><td align="right">{b.customers}</td>
              <td align="right">{money(b.netDiscountCents)}</td><td align="right">{b.avgDiscountCents == null ? '—' : money(b.avgDiscountCents)}</td></tr>
          ))}</tbody>
        </table>
      )}
      {d.byBranch && d.byBranch.length > 0 && <div className="sub" style={{ fontSize: 11, marginTop: 4 }}>{tx('do.byBranch.note')}</div>}
    </section>
  );
}
