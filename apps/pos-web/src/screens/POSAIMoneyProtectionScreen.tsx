// POSAIMoneyProtectionScreen.tsx — AI Center → AI Money Protection (Protection Command Center). Wired to
// GET /pos/ai-money-protection/state (permission-gated ai_money_protection.view). Read-only, tenant-scoped.
// Honest by design: "value under review" is labelled as under review, NOT confirmed loss; unmodeled numbers
// render as 0/em-dash; nothing here accuses anyone or moves money.
import { useEffect, useState } from 'react';
import { displayLocale } from '../i18n/format';
import { posAIMoneyProtectionApi } from '../api/posAIMoneyProtectionApi';
import { reportError, money } from './reportsCommon';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';

import { growthCode } from './growthLabels';
type State = {
  newAlerts: number; highSeverityAlerts: number; criticalAlerts: number; openInvestigations: number;
  alertsAwaitingReview: number; byType: { type: string; count: number }[]; valueUnderReviewCents: number;
  resolvedFalsePositives: number; dataFreshness: string; generatedAt: string;
};

const n = (v: number) => (v || 0).toLocaleString('en-US');
const label = (t: string) => growthCode(t, 'aiMoneyProtection');
const fmtDate = (iso?: string) => { if (!iso) return '—'; try { return new Date(iso).toLocaleString(displayLocale(), { month: 'short', day: '2-digit', hour: 'numeric', minute: '2-digit' }); } catch { return iso; } };

export function POSAIMoneyProtectionScreen() {
  const [s, setS] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true; setLoading(true); setError(null);
    (async () => {
      try { const d = await posAIMoneyProtectionApi.state() as State; if (alive) setS(d); }
      catch (e: any) { if (alive) setError(reportError(e, tx('growth.noun.aiMoneyProtection'))); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  if (loading) return <div className="work"><div className="state">{tx('pos.loading_money_protection')}</div></div>;
  if (error) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error}</div></div>;
  if (!s) return <div className="work"><div className="state">{tx('pos.no_money_protection_data')}</div></div>;

  const types = s.byType || [];
  return (
    <div className="work">
      <div className="vh">
        <h1>{tx('pos.ai_money_protection')}</h1>
        <div className="sub mb-3">{tx('pos.possible_financial_anomalies_from_your_real_z6vv')}</div>
      </div>

      <div className="kpis">
        <div className="kpi"><div className="l">{tx('pos.new_alerts')}</div><div className="v">{n(s.newAlerts)}</div></div>
        <div className="kpi"><div className="l">{tx('pos.high_severity')}</div><div className="v">{n(s.highSeverityAlerts)}</div></div>
        <div className="kpi"><div className="l">{tx('pos.critical')}</div><div className="v" style={{ color: s.criticalAlerts > 0 ? 'var(--danger, #b3261e)' : undefined }}>{n(s.criticalAlerts)}</div></div>
        <div className="kpi"><div className="l">{tx('pos.awaiting_review')}</div><div className="v">{n(s.alertsAwaitingReview)}</div></div>
        <div className="kpi"><div className="l">{tx('pos.open_investigations')}</div><div className="v">{n(s.openInvestigations)}</div></div>
        <div className="kpi">
          <div className="l">{tx('pos.value_under_review_2')}</div>
          <div className="v">{money(s.valueUnderReviewCents)}</div>
          <div className="hint" style={{ fontSize: 11, color: 'var(--muted)' }}>{tx('pos.under_review_not_confirmed_loss')}</div>
        </div>
        <div className="kpi"><div className="l">{tx('pos.resolved_false_positives')}</div><div className="v">{n(s.resolvedFalsePositives)}</div></div>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="vh"><h2 style={{ fontSize: 16 }}>{tx('pos.open_alerts_by_type')}</h2></div>
        {types.length === 0 ? (
          <div className="state" style={{ padding: 16 }}>{tx('pos.no_open_alerts_nothing_needs_review_10yf')}</div>
        ) : (
          <div className="overflow-x-auto w-full"><table className="tbl w-full min-w-max">
            <thead><tr><th>{tx('pos.anomaly_type')}</th><th style={{ textAlign: 'right' }}>{tx('pos.open')}</th></tr></thead>
            <tbody>
              {types.map((t) => (
                <tr key={t.type}><td>{label(t.type)}</td><td style={{ textAlign: 'right' }}>{n(t.count)}</td></tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>

      <div className="sub" style={{ marginTop: 10, color: 'var(--muted)' }}>
        {tx('pos.data_freshness')}{' '}{s.dataFreshness} {tx('pos.generated')}{' '}{fmtDate(s.generatedAt)}
      </div>
    </div>
  );
}
