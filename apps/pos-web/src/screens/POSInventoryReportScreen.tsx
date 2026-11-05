// POSInventoryReportScreen.tsx — Reports → Inventory. An analytics lens over inventory reusing the
// tenant inventory summary + alerts endpoints (inventory.view). Distinct from the operational Inventory
// screen: this is stock health + value + reorder attention, read-only.
import { useCallback, useEffect, useState } from 'react';
import { posInventoryReportApi } from '../api/posInventoryReportApi';
import { useReportCadence } from './reportsCommon';
import { money, reportError } from './reportsCommon';
import { useIPadView } from '../components/IPadViewProvider';
import { reportRequest } from '../components/ipad-modules';
import { t } from '@aipowersalon/mobile-sdk/i18n';

import { statusLabel } from '../i18n/status-label';
type Summary = { totalProducts: number; totalBottles: number; openBottles: number; unopenedBottles: number; lowStock: number; outOfStock: number; expiringSoon: number; pendingReports: number; inventoryValueCents?: number };
type Alert = { productId: string; name: string; colorNumber?: string | null; onHand: number; status: string; suggested?: number };

const statusChip = (status: string) => {
  const map: Record<string, { bg: string; fg: string }> = { out_of_stock: { bg: '#FDEEEE', fg: '#C0392B' }, critical: { bg: '#FDEEEE', fg: '#C0392B' }, low: { bg: '#FFF4E0', fg: '#B5821F' } };
  const m = map[status] || { bg: '#F0F0F0', fg: '#666' };
  const label = statusLabel('stock', status);
  return <span style={{ display: 'inline-block', padding: '2px 9px', borderRadius: 7, fontSize: 11.5, fontWeight: 700, background: m.bg, color: m.fg }}>{label}</span>;
};

export function POSInventoryReportScreen() {
  const { reloadKey } = useReportCadence();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { open: openIPad } = useIPadView();
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [s, a] = await Promise.all([posInventoryReportApi.summary(), posInventoryReportApi.alerts()]);
      setSummary((s as any).summary as Summary); setAlerts((a as any).alerts as Alert[]);
    } catch (e: any) { setError(reportError(e, t('admin.reports.noun.inventory'))); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load, reloadKey]);   // the report cadence's reloadKey re-runs the load

  if (loading && !summary) return <div className="work"><div className="state">{t('pos.loading_inventory_report')}</div></div>;
  if (error && !summary) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error}</div></div>;
  if (!summary) return <div className="work"><div className="state">{t('pos.no_data')}</div></div>;

  const rows = alerts || [];
  return (
    <div className="work">
      <div className="vh "><h1>{t('pos.inventory_report')}</h1><div className="sub mb-3">{t('pos.stock_health_value_and_reorder_attention')}</div></div><div className="flex flex-col md:flex-row flex-wrap whitespace-nowrap sm:items-center justify-between gap-2 mb-1"><button className="btn ghost w-fit whitespace-nowrap"  title={t('pos.open_full_ipad_view')} onClick={() => openIPad(reportRequest(t('pos.inventory_report'), { kpis: [{ label: t('pos.total_products'), value: summary.totalProducts }, { label: t('pos.low_stock'), value: summary.lowStock }, { label: t('pos.out_of_stock_2'), value: summary.outOfStock }, { label: t('pos.inventory_value'), value: money(summary.inventoryValueCents || 0) }] }))}>{t('pos.full_view')}</button></div>

      <div className="kpis">
        <div className="kpi"><div className="l">{t('pos.inventory_value')}</div><div className="v" style={{ color: 'var(--aps-orange)' }}>{summary.inventoryValueCents != null ? money(summary.inventoryValueCents) : '—'}</div></div>
        <div className="kpi"><div className="l">{t('pos.products')}</div><div className="v">{summary.totalProducts}</div><div className="d">{summary.totalBottles} {t('pos.bottles')}</div></div>
        <div className="kpi"><div className="l">{t('pos.low_stock')}</div><div className="v" style={{ color: summary.lowStock ? '#B5821F' : undefined }}>{summary.lowStock}</div></div>
        <div className="kpi"><div className="l">{t('pos.out_of_stock_2')}</div><div className="v" style={{ color: summary.outOfStock ? '#C0392B' : undefined }}>{summary.outOfStock}</div></div>
        <div className="kpi"><div className="l">{t('pos.expiring_soon')}</div><div className="v">{summary.expiringSoon}</div><div className="d">{t('pos.next_30_days')}</div></div>
      </div>

      <section className="panel" style={{ padding: 0, overflow: 'hidden', marginTop: 12 }}>
        <div className="p-h" style={{ padding: '14px 14px 0' }}>{t('pos.reorder_attention')}</div>
        {rows.length === 0 ? <div className="state" style={{ padding: 16 }}>{t('pos.all_products_are_above_their_reorder_a2uq')}</div> : (
          <div className="overflow-x-auto w-full"><table className="tbl w-full min-w-max">
            <thead><tr><th>{t('pos.product')}</th><th style={{ textAlign: 'right' }}>{t('pos.on_hand_2')}</th><th>{t('pos.status')}</th><th style={{ textAlign: 'right' }}>{t('pos.suggested_reorder')}</th></tr></thead>
            <tbody>{rows.map((a) => (
              <tr key={a.productId}>
                <td style={{ fontWeight: 700 }}>{a.name}{a.colorNumber ? <span style={{ color: 'var(--muted)', fontWeight: 400 }}> · {a.colorNumber}</span> : null}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{a.onHand}</td>
                <td>{statusChip(a.status)}</td>
                <td style={{ textAlign: 'right' }}>{a.suggested ? `+${a.suggested}` : <span style={{ color: 'var(--muted)' }}>—</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}
