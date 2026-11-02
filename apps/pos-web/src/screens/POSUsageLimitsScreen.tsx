// POSUsageLimitsScreen.tsx — Account → Usage & Limits. The tenant's own plan limits and current usage per
// metric (/tenant/account/usage-limits/state, settings.view). Reuses EntitlementsService.getEntitlements.
import { useCallback, useEffect, useState } from 'react';
import { posUsageLimitsApi } from '../api/posUsageLimitsApi';
import { reportError } from './reportsCommon';
import { t } from '@aipowersalon/mobile-sdk/i18n';

import { statusLabelOrNull, humanizeCode } from '../i18n/status-label';
type Evaluation = { status: string; usedPct: number | null; allowed: boolean };
type Limit = { metric: string; planConfigured: boolean; used: number | null; effectiveValue: number | null; effectiveSource: string; enforcement: string; evaluation: Evaluation };
type State = { tenantId: string; plan: { text: string | null; name: string | null; code: string | null }; limits: Limit[] };

const METRIC_LABELS: Record<string, string> = {
  get branches() { return t('growth.usage.metric.branches'); }, get users() { return t('growth.usage.metric.users'); }, get technicians() { return t('growth.usage.metric.technicians'); }, get customers() { return t('growth.usage.metric.customers'); },
  get appointments_monthly() { return t('growth.usage.metric.appointments_monthly'); }, get sms_monthly() { return t('growth.usage.metric.sms_monthly'); }, get email_monthly() { return t('growth.usage.metric.email_monthly'); },
  get ai_minutes_monthly() { return t('growth.usage.metric.ai_minutes_monthly'); }, get ai_receptionist_calls_monthly() { return t('growth.usage.metric.ai_receptionist_calls_monthly'); },
  get storage_gb() { return t('growth.usage.metric.storage_gb'); }, get devices() { return t('growth.usage.metric.devices'); }, get integrations() { return t('growth.usage.metric.integrations'); }, get report_retention_days() { return t('growth.usage.metric.report_retention_days'); },
};
const label = (m: string) => METRIC_LABELS[m] || statusLabelOrNull('usageMetric', m) || humanizeCode(m);
const STATUS: Record<string, { text: string; color: string }> = {
  unlimited: { get text() { return t('pos.unlimited'); }, color: '#2E9E54' }, unconfigured: { get text() { return t('pos.not_set'); }, color: '#9A9A9A' },
  ok: { text: 'OK', color: '#2E9E54' }, advisory: { get text() { return t('pos.advisory'); }, color: '#8A7418' },
  warning: { get text() { return t('pos.near_limit'); }, color: '#B5651D' }, overage: { get text() { return t('pos.over'); }, color: '#C0392B' }, blocked: { get text() { return t('pos.at_limit'); }, color: '#C0392B' },
};
const fmt = (n: number | null) => (n === null || n === undefined ? '—' : n.toLocaleString('en-US'));

export function POSUsageLimitsScreen() {
  const [s, setS] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setS(await posUsageLimitsApi.state() as State); }
    catch (e: any) { setError(reportError(e, t('growth.noun.usageLimits'))); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="work"><div className="state">{t('pos.loading_usage')}</div></div>;
  if (error) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error}</div></div>;
  if (!s) return <div className="work"><div className="state">{t('pos.no_data')}</div></div>;

  const planName = s.plan?.name || (s.plan?.text ? s.plan.text : t('pos.no_plan_assigned'));
  const atRisk = s.limits.filter((l) => ['warning', 'overage', 'blocked'].includes(l.evaluation?.status)).length;

  return (
    <div className="work">
      <div className="vh "><h1>{t('pos.usage_limits')}</h1><div className="sub mb-3">{t('pos.your_plan_allowances_and_current_usage')}</div></div>

      <div className="kpis">
        <div className="kpi"><div className="l">{t('pos.current_plan')}</div><div className="v" style={{ fontSize: 18 }}>{planName}</div></div>
        <div className="kpi"><div className="l">{t('pos.metrics_tracked')}</div><div className="v">{s.limits.length}</div></div>
        <div className="kpi"><div className="l">{t('pos.at_near_limit')}</div><div className="v" style={{ color: atRisk > 0 ? '#C0392B' : undefined }}>{atRisk}</div></div>
      </div>

      <section className="panel mb-3" style={{ padding: 0, overflow: "hidden" }}>
        <div className="overflow-x-auto w-full"><table className="tbl w-full min-w-max">
          <thead><tr><th>{t('pos.resource')}</th><th style={{ textAlign: 'right' }}>{t('pos.used_4')}</th><th style={{ textAlign: 'right' }}>{t('pos.limit')}</th><th style={{ width: 200 }}>{t('pos.usage')}</th><th>{t('pos.status')}</th></tr></thead>
          <tbody>{s.limits.map((l) => {
            const st = STATUS[l.evaluation?.status] || { text: l.evaluation?.status || '—', color: '#666' };
            const unlimited = l.effectiveValue === null;
            const pct = l.evaluation?.usedPct;
            const limitText = unlimited ? (l.planConfigured || l.effectiveSource !== 'none' ? t('growth.usage.unlimited') : '—') : fmt(l.effectiveValue);
            return (
              <tr key={l.metric}>
                <td style={{ fontWeight: 700 }}>{label(l.metric)}</td>
                <td style={{ textAlign: 'right' }}>{fmt(l.used)}</td>
                <td style={{ textAlign: 'right', fontWeight: 700 }}>{limitText}</td>
                <td>
                  {unlimited || pct === null || pct === undefined ? <span className="sub" style={{ fontSize: 12 }}>—</span> : (
                    <div style={{ background: '#EEE6D8', borderRadius: 6, height: 8, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: st.color }} />
                    </div>
                  )}
                </td>
                <td><span style={{ fontSize: 12, fontWeight: 700, color: st.color }}>{st.text}</span></td>
              </tr>
            );
          })}</tbody>
        </table></div>
      </section>
      <div className="sub" style={{ fontSize: 12, marginTop: 8 }}>{t('pos.limits_reflect_your_current_plan_and_o0jf')}</div>
    </div>
  );
}
