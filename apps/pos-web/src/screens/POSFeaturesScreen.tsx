// POSFeaturesScreen.tsx — Management → Features. A read-only view of which product features the tenant's
// plan enables (feature flags resolved by the entitlements engine: plan default + account override).
// Reuses GET /tenant/account/usage-limits/state (settings.view), which returns { limits, features }.
// Feature overrides are managed by the platform (super-admin), so this surface is read-only.
import { useCallback, useEffect, useState } from 'react';
import { posUsageLimitsApi } from '../api/posUsageLimitsApi';
import { reportError } from './reportsCommon';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { statusLabelOrNull } from '../i18n/status-label';

type Feature = { featureKey: string; planState: string | null; override: string | null; enabled: boolean; source: string; blocked: boolean };

// a feature key → admin.features.<key>, else a canonical status label, else the key humanised (AI / SMS / API kept upper-case)
const label = (key: string) => { const k = `admin.features.${key}`; const l = t(k); return l !== k ? l : statusLabelOrNull('featureKey', key) ?? humanizeKey(key); };
const humanizeKey = (key: string) => key
  .replace(/_/g, ' ')
  .replace(/\bai\b/gi, 'AI')
  .replace(/\bsms\b/gi, 'SMS')
  .replace(/\bapi\b/gi, 'API')
  .replace(/\b\w/g, (c) => c.toUpperCase());

export function POSFeaturesScreen() {
  const [features, setFeatures] = useState<Feature[] | null>(null);
  const [plan, setPlan] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const s = await posUsageLimitsApi.state();
      setFeatures(((s?.features || []) as Feature[]).slice().sort((a, b) => label(a.featureKey).localeCompare(label(b.featureKey))));
      setPlan(s?.plan?.name || s?.plan?.text || null);
    } catch (e: any) { setError(reportError(e, 'features')); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="work"><div className="state">{t('pos.loading_features')}</div></div>;
  if (error) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error}</div></div>;
  const list = features || [];
  const enabledCount = list.filter((f) => f.enabled).length;

  return (
    <div className="work">
      <div className="vh" style={{ marginBottom: 10 }}><h1>{t('pos.features')}</h1><div className="sub">{t('pos.what_s_included_with_your_plan')}</div></div>

      <div className="kpis">
        <div className="kpi"><div className="l">{t('pos.current_plan')}</div><div className="v" style={{ fontSize: 18 }}>{plan || t('pos.no_plan')}</div></div>
        <div className="kpi"><div className="l">{t('pos.enabled')}</div><div className="v" style={{ color: 'var(--aps-orange)' }}>{enabledCount}</div></div>
        <div className="kpi"><div className="l">{t('pos.available')}</div><div className="v">{list.length}</div></div>
      </div>

      {list.length === 0 ? <div className="state" style={{ marginTop: 12 }}>{t('pos.no_plan_features_are_configured_for_1wd9')}</div> : (
        <section className="panel" style={{ padding: 0, overflow: 'hidden', marginTop: 12 }}>
          <table className="tbl">
            <thead><tr><th>{t('pos.feature')}</th><th>{t('pos.status')}</th><th>{t('pos.source')}</th></tr></thead>
            <tbody>{list.map((f) => (
              <tr key={f.featureKey} style={f.enabled ? undefined : { opacity: 0.6 }}>
                <td style={{ fontWeight: 700 }}>{label(f.featureKey)}</td>
                <td>
                  {f.enabled
                    ? <span style={{ padding: '2px 9px', borderRadius: 7, fontSize: 11.5, fontWeight: 700, background: '#E9F6EC', color: '#2E9E54' }}>{t('pos.on')}</span>
                    : <span style={{ padding: '2px 9px', borderRadius: 7, fontSize: 11.5, fontWeight: 700, background: '#F0F0F0', color: '#777' }}>{t('pos.off')}</span>}
                </td>
                <td className="sub" style={{ fontSize: 12.5 }}>
                  {f.source === 'override' ? (f.override === 'enabled' ? t('pos.enabled_for_your_account') : t('pos.disabled_for_your_account')) : (f.enabled ? t('pos.included_in_your_plan') : t('pos.not_in_your_plan'))}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </section>
      )}
      <div className="sub" style={{ fontSize: 12, marginTop: 8 }}>{t('pos.features_are_set_by_your_plan_b85k')}</div>
    </div>
  );
}
