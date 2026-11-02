import { useCallback, useEffect, useState } from 'react';
import { useOwnerBranch } from '../shell/OwnerBranchContext';
import { useOwnerNav } from '../shell/nav';
import { ownerInventoryApi, type OwnerInventoryOverviewResp } from '../api/ownerApi';
import { OwnerSkeletonCards } from '../components/OwnerSkeleton';
import { formatCurrency } from '@aipowersalon/money';   // BUILD_PLAN Phase 13 E (C6 §99–100): shared money / branch-zone date display

// Inventory & Products — Module 8 (read surface). Stock health + valuation aggregated over the canonical inventory
// tables, scoped to the owner's branches. Valuation shows "—" when the signed-in user lacks finance permission (the
// server nulls it). Reorder list is urgency-sorted (out → critical → low).

const money0 = (c: number | null): string => (c == null ? '—' : formatCurrency(c, { fractionDigits: 0 }));
const num = (v: number): string => new Intl.NumberFormat('en-US').format(v || 0);

const STATUS_LABEL: Record<string, string> = { out_of_stock: 'Out of stock', critical: 'Critical', low: 'Low', in_stock: 'In stock', overstock: 'Overstock' };
function statusColor(s: string): string {
  if (s === 'out_of_stock') return 'var(--owner-danger)';
  if (s === 'critical') return '#C2410C';
  if (s === 'low') return 'var(--owner-primary)';
  return 'var(--owner-success)';
}

export function InventoryProductsScreen() {
  const { back } = useOwnerNav();
  const { effectiveBranchId } = useOwnerBranch();
  const [data, setData] = useState<OwnerInventoryOverviewResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    ownerInventoryApi.overview(effectiveBranchId)
      .then((d) => { setData(d); setLoading(false); })
      .catch((e: any) => { setError(e?.message || 'Could not load inventory.'); setLoading(false); });
  }, [effectiveBranchId]);

  useEffect(() => { load(); }, [load]);
  const allLocations = !effectiveBranchId;

  return (
    <>
      <header className="owner-header">
        <button className="owner-back" aria-label="Back" onClick={back}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--owner-text)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <div className="owner-greet" style={{ textAlign: 'center' }}><div className="n owner-serif" style={{ cursor: 'default', justifyContent: 'center' }}>Inventory &amp; Products</div></div>
        <div style={{ width: 40 }} />
      </header>

      {error && <div className="owner-state" role="alert">{error}</div>}
      {loading && <OwnerSkeletonCards count={3} />}

      {data && (
        <div style={{ padding: '6px 16px 24px' }}>
          <div className="owner-kpigrid three" style={{ marginBottom: 8 }}>
            <div className="owner-kpi"><div className="label">Products</div><div className="val">{num(data.totalProducts)}</div></div>
            <div className="owner-kpi"><div className="label">Needs Reorder</div><div className="val" style={{ color: data.needsReorderCount > 0 ? 'var(--owner-danger)' : undefined }}>{num(data.needsReorderCount)}</div></div>
            <div className="owner-kpi"><div className="label">Stock Value</div><div className="val">{money0(data.stockValueCents)}</div><div className="sub owner-text-muted">retail {money0(data.retailValueCents)}</div></div>
          </div>

          <div className="owner-chartcard" style={{ marginBottom: 12 }}>
            <div className="owner-sechead"><div className="h">Stock Health</div><div className="d">{num(data.stockPositions)} positions</div></div>
            <div className="owner-kpigrid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
              {([['in_stock', data.statusCounts.inStock], ['low', data.statusCounts.low], ['critical', data.statusCounts.critical], ['out_of_stock', data.statusCounts.outOfStock]] as [string, number][]).map(([s, c]) => (
                <div className="owner-kpi" key={s} style={{ padding: '8px 6px' }}>
                  <div className="label" style={{ color: statusColor(s) }}>{STATUS_LABEL[s]}</div>
                  <div className="val" style={{ fontSize: 20 }}>{num(c)}</div>
                </div>
              ))}
            </div>
            <div className="owner-text-muted" style={{ fontSize: 12, marginTop: 8 }}>{num(data.brandsCount)} brands · {num(data.vendorsCount)} vendors · {num(data.categoriesCount)} categories</div>
          </div>

          {data.topCategories.length > 0 && (
            <>
              <div className="owner-sechead"><div className="h">Top Categories</div><div className="d">by value</div></div>
              <div className="owner-drill" style={{ marginBottom: 12 }}>
                {data.topCategories.map((c) => (
                  <div className="owner-drillrow" key={c.category}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700 }}>{c.category}</div>
                      <div className="owner-text-muted" style={{ fontSize: 12 }}>{num(c.products)} product{c.products === 1 ? '' : 's'}</div>
                    </div>
                    <div style={{ fontWeight: 700, marginLeft: 10 }}>{money0(c.stockValueCents)}</div>
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="owner-sechead"><div className="h">Reorder List</div><div className="d">{num(data.needsReorderCount)} need attention</div></div>
          {data.reorderList.length === 0 ? <div className="owner-state">Everything is well stocked.</div>
            : (
              <div className="owner-drill">
                {data.reorderList.map((it) => (
                  <div className="owner-drillrow" key={`${it.productId}-${it.branchId ?? ''}`}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700 }}>{it.name}</div>
                      <div className="owner-text-muted" style={{ fontSize: 12 }}>{allLocations ? `${it.branchName} · ` : ''}{it.onHand} on hand · reorder at {it.reorderLevel}</div>
                    </div>
                    <div style={{ textAlign: 'right', marginLeft: 10 }}>
                      <div className="owner-pill" style={{ color: statusColor(it.status), borderColor: statusColor(it.status), fontSize: 11 }}>{STATUS_LABEL[it.status]}</div>
                      {it.suggestedQty > 0 && <div className="owner-text-muted" style={{ fontSize: 11, marginTop: 3 }}>order +{it.suggestedQty}</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
        </div>
      )}
    </>
  );
}
