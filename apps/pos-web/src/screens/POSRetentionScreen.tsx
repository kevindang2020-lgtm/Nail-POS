// POSRetentionScreen.tsx — Customers → Retention. A churn/at-risk lens reusing the customers state
// (retention KPIs, computed from the shared classifyRetention source of truth) and the customers list
// filtered by inactiveDays for a win-back list. pos.customers.view. Read-only.
import { useCallback, useEffect, useState } from 'react';
import { displayLocale } from '../i18n/format';
import { posCustomersApi } from '../api/posCustomersApi';
import { money, reportError } from './reportsCommon';
import { t } from '@aipowersalon/mobile-sdk/i18n';

type Kpis = { totalCustomers?: number; returningRatePercent?: number; returningCustomers?: number; newThisMonth?: number; inactiveCustomers?: number };
type LapsedRow = { customerId: string; fullName: string; phone?: string; visitsCount: number; lastVisitDate?: string; totalSpendCents?: number; loyaltyTier?: string };

const INACTIVE_DAYS = 60; // matches backend customer-segments.INACTIVE_DAYS
const fmtDate = (iso?: string | null) => { if (!iso) return t('admin.date.never'); try { return new Date(iso).toLocaleDateString(displayLocale(), { month: 'short', day: '2-digit', year: 'numeric' }); } catch { return iso; } };
const daysSince = (iso?: string | null) => { if (!iso) return null; const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000); return isFinite(d) ? d : null; };

export function POSRetentionScreen() {
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [lapsed, setLapsed] = useState<LapsedRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [state, atRisk] = await Promise.all([posCustomersApi.state(), posCustomersApi.atRisk(INACTIVE_DAYS)]);
      setKpis((state?.kpisFull || state?.kpis || {}) as Kpis);
      setLapsed(((atRisk?.items || []) as LapsedRow[]).slice().sort((a, b) => (daysSince(b.lastVisitDate) ?? 1e9) - (daysSince(a.lastVisitDate) ?? 1e9)));
    } catch (e: any) { setError(reportError(e, t('admin.noun.retention'))); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="work"><div className="state">{t('pos.loading_retention')}</div></div>;
  if (error) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error}</div></div>;

  const k = kpis || {};
  const rows = lapsed || [];
  const lapsedValue = rows.reduce((a, r) => a + (r.totalSpendCents || 0), 0);

  return (
    <div className="work">
      <div className="vh" style={{ marginBottom: 10 }}><h1>{t('pos.customer_retention')}</h1><div className="sub">{t('pos.returning_new_and_at_risk_customers')}</div></div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
        <div className="panel" style={{ padding: '16px' }}><div className="sub" style={{ fontSize: 12 }}>{t('pos.returning_rate')}</div><div style={{ fontSize: 24, fontWeight: 800, marginTop: 4, color: 'var(--gold)' }}>{k.returningRatePercent ?? 0}%</div></div>
        <div className="panel" style={{ padding: '16px' }}><div className="sub" style={{ fontSize: 12 }}>{t('pos.returning')}</div><div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{k.returningCustomers ?? '—'}</div></div>
        <div className="panel" style={{ padding: '16px' }}><div className="sub" style={{ fontSize: 12 }}>{t('pos.new_this_month')}</div><div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{k.newThisMonth ?? 0}</div></div>
        <div className="panel" style={{ padding: '16px' }}><div className="sub" style={{ fontSize: 12 }}>{t('pos.at_risk')}</div><div style={{ fontSize: 24, fontWeight: 800, marginTop: 4, color: (k.inactiveCustomers || 0) > 0 ? '#C0392B' : undefined }}>{k.inactiveCustomers ?? rows.length}</div><div className="sub" style={{ fontSize: 13, marginTop: 4 }}>{INACTIVE_DAYS}{t('pos.days_lapsed')}</div></div>
        <div className="panel" style={{ padding: '16px' }}><div className="sub" style={{ fontSize: 12 }}>{t('pos.lapsed_value')}</div><div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{money(lapsedValue)}</div><div className="sub" style={{ fontSize: 13, marginTop: 4 }}>{t('pos.lifetime_spend_at_risk')}</div></div>
      </div>

      <section className="panel" style={{ padding: 0, overflow: 'hidden', marginTop: 12 }}>
        <div className="p-h" style={{ padding: '14px 14px 0' }}>{t('pos.win_back_list_not_seen_in')}{' '}{INACTIVE_DAYS}{t('pos.days_3')}</div>
        {rows.length === 0 ? <div className="state" style={{ padding: 16 }}>{t('pos.no_lapsed_customers_retention_is_healthy')}</div> : (
         <div className="w-full overflow-x-auto">
  <table className="tbl min-w-[800px]">
            <thead><tr><th>{t('pos.customer')}</th><th>{t('pos.phone')}</th><th>{t('pos.last_visit_3')}</th><th style={{ textAlign: 'right' }}>{t('pos.days_2')}</th><th style={{ textAlign: 'right' }}>{t('pos.visits')}</th><th style={{ textAlign: 'right' }}>{t('pos.lifetime')}</th></tr></thead>
            <tbody>{rows.map((c) => {
              const d = daysSince(c.lastVisitDate);
              return (
                <tr key={c.customerId}>
                  <td style={{ fontWeight: 700 }}>{c.fullName || t('pos.unnamed')}{c.loyaltyTier && c.loyaltyTier !== 'Regular' ? <span style={{ color: 'var(--muted)', fontWeight: 400 }}> · {c.loyaltyTier}</span> : null}</td>
                  <td>{c.phone || <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(c.lastVisitDate)}</td>
                  <td style={{ textAlign: 'right', color: '#C0392B', fontWeight: 700 }}>{d ?? '—'}</td>
                  <td style={{ textAlign: 'right' }}>{c.visitsCount ?? 0}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700 }}>{money(c.totalSpendCents || 0)}</td>
                </tr>
              );
            })}</tbody>
          </table>
          </div>
        )}
      </section>
    </div>
  );
}
