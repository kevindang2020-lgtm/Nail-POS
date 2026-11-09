// POSAiInventoryScreen.tsx — AI Center → AI Inventory Assistant (§47–48). A tabbed, fully-wired workspace over the
// read-only AI Inventory endpoints: Command Center (branch stock health), Low Stock (predicted shortfalls), Reorder
// (recommendation cards with evidence), and Slow-Moving (dead-stock findings). Everything here is analysis + evidence:
// there are NO mutating actions in this workspace — reorder/transfer/dispose remain authorized human workflows. No fake
// data; nulls render as “—”; cost is shown only when the server includes it (technicians never see it).
import { useCallback, useEffect, useState } from 'react';
import { posAiInventoryApi } from '../api/posAiInventoryApi';
import { money, reportError } from './reportsCommon';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';

import { growthCode } from './growthLabels';
import { InventoryCenterPanel } from './InventoryCenterPanel';
type Tab = 'command' | 'low' | 'reorder' | 'slow';
const TABS = (): [Tab, string][] => [['command', tx('growth.aiInventory.tab.command')], ['low', tx('growth.aiInventory.tab.low')], ['reorder', tx('growth.aiInventory.tab.reorder')], ['slow', tx('growth.aiInventory.tab.slow')]];

const num = (n: number | null | undefined) => (n == null ? '—' : String(n));
const dash = (s: string | null | undefined) => (s && s.trim() ? s : '—');
const titleCase = (s: string) => growthCode(s, ['level', 'stock']);

const SEV_COLOR: Record<string, string> = {
  out_of_stock: '#B85B4D', critical: '#B85B4D', low: '#D09A36',
  dead_stock: '#B85B4D', very_slow: '#C6772E', slow_moving: '#D09A36', new_insufficient_data: 'var(--muted)',
};
function Sev({ value }: { value: string }) {
  const c = SEV_COLOR[value] || 'var(--muted)';
  return <span className="chip" style={{ color: c, borderColor: c }}>{titleCase(value)}</span>;
}
function Conf({ value }: { value: string | null | undefined }) {
  if (!value) return null;
  return <span className="sub">{tx('pos.confidence_4')}{' '}{titleCase(value)}</span>;
}

export function POSAiInventoryScreen() {
  const [tab, setTab] = useState<Tab>('command');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [low, setLow] = useState<any | null>(null);
  const [reorder, setReorder] = useState<any | null>(null);
  const [slow, setSlow] = useState<any | null>(null);

  const load = useCallback((t: Tab) => {
    setLoading(true); setError(null);
    const call =
      t === 'command' ? Promise.resolve()
        : t === 'low' ? posAiInventoryApi.lowStock().then(setLow)
          : t === 'reorder' ? posAiInventoryApi.reorder().then(setReorder)
            : posAiInventoryApi.slowMoving().then(setSlow);
    call.catch((e: any) => setError(reportError(e, tx('growth.noun.aiInventory')))).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(tab); }, [tab, load]);

  return (
    <div className="work">
      <div className="vh flex flex-col xl:flex-row gap-3 justify-between">
        <div>
          <h1>{tx('pos.ai_inventory_assistant')}</h1>
        <div className="sub mb-3">{tx('pos.forecasts_low_stock_reorder_and_slow_1e9j')}</div>
        </div>
      </div>



      <InventoryCenterPanel showDetail={tab === 'command'} actions={TABS().map(([id, label]) => (
        <button className={"btn w-fit whitespace-nowrap " + (tab === id ? "active" : "")} key={id} aria-pressed={tab === id} data-testid={`inv-tab-${id}`}
          onClick={() => setTab(id)}>{label}</button>
      ))} />
      {error && <div className="err" style={{ marginBottom: 12 }}>{error}</div>}
      {loading && tab !== 'command' && <div className="state">{tx('pos.loading')}</div>}

      {!loading && !error && tab === 'low' && low && (
        low.items.length === 0 ? <div className="state">{tx('pos.nothing_below_its_reorder_point_right_1dw9')}</div> : (
          <section className="panel" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="overflow-x-auto w-full"><table className="tbl w-full min-w-max">
              <thead><tr><th>{tx('pos.product')}</th><th>{tx('pos.available')}</th><th>{tx('pos.reorder_pt')}</th><th>{tx('pos.inbound')}</th><th>{tx('pos.severity_2')}</th><th>{tx('pos.vendor')}</th><th>{tx('pos.lead_time')}</th></tr></thead>
              <tbody>
                {low.items.map((i: any) => (
                  <tr key={i.productId}>
                    <td>{i.name}<div className="sub">{dash(i.sku)}{i.categoryName ? ` · ${i.categoryName}` : ''}</div></td>
                    <td>{num(i.sellableAvailable)}</td>
                    <td>{num(i.reorderLevel)}</td>
                    <td>{num(i.confirmedInbound)}</td>
                    <td><Sev value={i.severity} /></td>
                    <td>{dash(i.vendorName)}</td>
                    <td>{i.leadTimeDays == null ? '—' : `${i.leadTimeDays}d`}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </section>
        )
      )}

      {!loading && !error && tab === 'reorder' && reorder && (
        reorder.recommendations.length === 0 ? <div className="state">{tx('pos.no_reorder_recommendations_inbound_orders_cover_lsy1')}</div> : (
          <div style={{ display: 'grid', gap: 10 }}>
            {reorder.recommendations.map((r: any) => (
              <section key={r.productId} className="panel" style={{ padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                  <div style={{ fontWeight: 700 }}>{r.name} <span className="sub">{dash(r.sku)}</span></div>
                  <div style={{ fontWeight: 700, color: 'var(--aps-orange)' }}>{tx('pos.order')}{' '}{r.suggestedQuantity}{r.estimatedCostCents != null ? ` · ${money(r.estimatedCostCents)}` : ''}</div>
                </div>
                <div className="sub" style={{ marginTop: 6 }}>{r.reason}</div>
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8, fontSize: 12.5 }}>
                  <span>{tx('pos.available')}{' '}<b>{num(r.sellableAvailable)}</b></span>
                  <span>{tx('pos.inbound')}{' '}<b>{num(r.confirmedInbound)}</b></span>
                  <span>{tx('pos.reorder_pt')}{' '}<b>{num(r.reorderLevel)}</b></span>
                  <span>{tx('pos.vendor')}{' '}<b>{dash(r.vendorName)}</b></span>
                  <Conf value={r.confidence} />
                </div>
                {r.dataQualityNotes?.length > 0 && (
                  <ul className="sub" style={{ marginTop: 8, paddingLeft: 18 }}>
                    {r.dataQualityNotes.map((n: string, idx: number) => <li key={idx}>{n}</li>)}
                  </ul>
                )}
              </section>
            ))}
          </div>
        )
      )}

      {!loading && !error && tab === 'slow' && slow && (
        slow.items.length === 0 ? <div className="state">{tx('pos.no_slow_moving_or_dead_stock_nb0a')}</div> : (
          <section className="panel" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="overflow-x-auto w-full"><table className="tbl w-full min-w-max">
              <thead><tr><th>{tx('pos.product')}</th><th>{tx('pos.on_hand')}</th><th>{tx('pos.value')}</th><th>{tx('pos.last_activity')}</th><th>{tx('pos.class')}</th><th>{tx('pos.recommendation')}</th></tr></thead>
              <tbody>
                {slow.items.map((i: any) => (
                  <tr key={i.productId}>
                    <td>{i.name}<div className="sub">{dash(i.categoryName)}</div></td>
                    <td>{num(i.onHand)}</td>
                    <td>{i.inventoryValueCents == null ? '—' : money(i.inventoryValueCents)}</td>
                    <td>{i.daysSinceLastActivity == null ? 'never' : tx('pos.dayssincelastactivity_d_ago', { daysSinceLastActivity: String(i.daysSinceLastActivity) })}</td>
                    <td><Sev value={i.classification} />{i.overstock && <span className="sub"> {tx('pos.overstock_2')}</span>}</td>
                    <td><div className="sub">{i.recommendation}</div></td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </section>
        )
      )}
    </div>
  );
}
