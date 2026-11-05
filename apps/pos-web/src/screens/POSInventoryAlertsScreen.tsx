// POSInventoryAlertsScreen.tsx — Inventory → Alerts. The persisted, acknowledgeable stock-threshold
// alert feed (/tenant/inventory/alert-feed, inventory.view). List open alerts by severity, acknowledge
// them, and optionally show already-acknowledged ones.
import { useCallback, useEffect, useState } from 'react';
import { displayLocale } from '../i18n/format';
import { posInventoryAlertsApi } from '../api/posInventoryAlertsApi';
import { reportError } from './reportsCommon';
import { t } from '@aipowersalon/mobile-sdk/i18n';

import { statusLabel } from '../i18n/status-label';
type Alert = { id: string; product_id: string; product_name: string; color_number: string | null; status: string; on_hand: number; created_at: string; acknowledged_at: string | null };

const fmtDate = (iso?: string | null) => { if (!iso) return '—'; try { return new Date(iso).toLocaleDateString(displayLocale(), { month: 'short', day: '2-digit', hour: 'numeric', minute: '2-digit' }); } catch { return iso; } };
const sev = (status: string): { label: string; bg: string; fg: string } => {
  const m: Record<string, { label: string; bg: string; fg: string }> = {
    out_of_stock: { label: t('pos.out_of_stock'), bg: '#FDEEEE', fg: '#C0392B' },
    critical: { label: t('pos.critical'), bg: '#FEF2E7', fg: '#B5651D' },
    low: { label: t('pos.low'), bg: '#FBF7E8', fg: '#8A7418' },
  };
  return m[status] || { label: statusLabel('stock', status), bg: '#F0F0F0', fg: '#666' };
};

export function POSInventoryAlertsScreen() {
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [openCount, setOpenCount] = useState(0);
  const [includeAck, setIncludeAck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (withAck: boolean) => {
    setError(null);
    try { const r = await posInventoryAlertsApi.list(withAck); setAlerts((r?.alerts || []) as Alert[]); setOpenCount(r?.openCount ?? 0); }
    catch (e: any) { setError(reportError(e, t('admin.noun.inventoryAlerts'))); }
  }, []);
  useEffect(() => { load(includeAck); }, [load, includeAck]);

  const acknowledge = async (id: string) => {
    setBusy(id);
    try { await posInventoryAlertsApi.acknowledge(id); await load(includeAck); }
    catch (e: any) { setError(e?.message || t('pos.could_not_acknowledge_the_alert')); }
    finally { setBusy(null); }
  };

  if (error) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error}</div></div>;
  if (!alerts) return <div className="work"><div className="state">{t('pos.loading_alerts')}</div></div>;

  const outCount = alerts.filter((a) => a.status === 'out_of_stock' && !a.acknowledged_at).length;
  const critCount = alerts.filter((a) => a.status === 'critical' && !a.acknowledged_at).length;

  return (
    <div className="work">
      <div className="vh" style={{ marginBottom: 10 }}><h1>{t('pos.stock_alerts')}</h1><div className="sub">{t('pos.products_that_crossed_a_low_stock_klx7')}</div></div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5 mb-3.5 mt-2.5">
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{t('pos.open_alerts')}</div><div className="v" style={{ color: openCount > 0 ? '#C0392B' : undefined }}>{openCount}</div></div>
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{t('pos.out_of_stock_2')}</div><div className="v" style={{ color: outCount > 0 ? '#C0392B' : undefined }}>{outCount}</div></div>
        <div className="kpi" style={{ width: '100%', margin: 0 }}><div className="l">{t('pos.critical')}</div><div className="v" style={{ color: critCount > 0 ? '#B5651D' : undefined }}>{critCount}</div></div>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 13 }}>
        <input type="checkbox" checked={includeAck} onChange={(e) => setIncludeAck(e.target.checked)} />
        {t('pos.show_acknowledged_alerts')}
      </label>

      <section className="panel" style={{ padding: 0, overflow: 'hidden', marginTop: 10 }}>
        {alerts.length === 0 ? <div className="state" style={{ padding: 16 }}>{t('pos.no_open_stock_alerts_inventory_is_1s57')}</div> : (
          <div className="overflow-x-auto">
            <div className="min-w-[800px]">
              <table className="tbl">
                <thead><tr><th>{t('pos.product')}</th><th>{t('pos.severity_2')}</th><th style={{ textAlign: 'right' }}>{t('pos.on_hand_2')}</th><th>{t('pos.raised')}</th><th style={{ width: 150 }}></th></tr></thead>
                <tbody>{alerts.map((a) => {
                  const s = sev(a.status);
                  return (
                    <tr key={a.id} style={a.acknowledged_at ? { opacity: 0.55 } : undefined}>
                      <td style={{ fontWeight: 700 }}>{a.product_name || t('pos.product')}{a.color_number ? <span style={{ color: 'var(--muted)', fontWeight: 400 }}> · #{a.color_number}</span> : null}</td>
                      <td><span style={{ padding: '2px 9px', borderRadius: 7, fontSize: 11.5, fontWeight: 700, background: s.bg, color: s.fg }}>{s.label}</span></td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{a.on_hand ?? 0}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(a.created_at)}</td>
                      <td style={{ textAlign: 'right' }}>
                        {a.acknowledged_at
                          ? <span className="sub" style={{ fontSize: 12, color: '#2E9E54', fontWeight: 700 }}>{t('pos.acknowledged')}</span>
                          : <button className="btn ghost" disabled={busy === a.id} onClick={() => acknowledge(a.id)}>{busy === a.id ? t('pos.saving_2') : t('pos.acknowledge')}</button>}
                      </td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
