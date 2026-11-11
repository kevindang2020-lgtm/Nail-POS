// POSAiAnalyticsScreen.tsx — AI → Analytics. An AI performance dashboard reusing GET
// /tenant/ai/center/overview. Every metric is honest: a tracked metric shows its real value (and an "est."
// tag if it's an estimate); an untracked metric shows "Not tracked yet" plus the reason from the backend —
// nothing is fabricated. Values light up as their underlying data (AI calls, bookings, campaigns) accrues.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { posAiCenterApi } from '../api/posAiCenterApi';
import { money, reportError } from './reportsCommon';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { fmtInZone } from '../i18n/format';
import { useUrlPeriod } from './reportsCommon';
import { PeriodBar } from '../components/FinanceKit';   // the location's clock (not the device's)

type Metric = { tracked: boolean; value: number | null; unit?: string; source: string; estimated?: boolean; route?: string };
type Overview = {
  generatedAt: string;
  window?: { from: string; to: string; timezone: string; weekFrom: string } | null;
  kpis: Record<string, Metric>;
  performance: { totalConversations: Metric; aiSuccessRatePct: Metric };
  callIntelligence: { callsHandled: Metric; recovered: Metric; callToBookingRatePct: Metric };
  bookingAssistant: { completed: Metric; aiBookings: Metric; rebookings: Metric };
  campaigns: { sent: Metric; bookings: Metric; revenueCents: Metric; conversionPct: Metric };
};

const fmt = (m: Metric | undefined) => {
  if (!m || !m.tracked || m.value === null) return null;
  if (m.unit === 'cents') return money(m.value);
  if (m.unit === '%') return `${m.value}%`;
  if (m.unit === 'min') return t('pos.v0_min', { v0: String(m.value.toLocaleString('en-US')) });
  if (m.unit === '/5') return `${m.value}/5`;
  return m.value.toLocaleString('en-US');
};

function MetricCard({ label, m }: { label: string; m: Metric | undefined }) {
  const val = fmt(m);
  return (
    <div className="kpi" style={m && !m.tracked ? { opacity: 0.72 } : undefined}>
      <div className="l">{label}</div>
      {val !== null ? (
        <div className="v">{val}{m?.estimated ? <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginLeft: 5 }}>{t('pos.est')}</span> : null}</div>
      ) : (
        <div><div className="v" style={{ fontSize: 15, color: 'var(--muted)' }}>{t('pos.not_tracked_yet')}</div><div className="sub" style={{ fontSize: 11, marginTop: 2 }}>{m?.source || '—'}</div></div>
      )}
    </div>
  );
}

// each section opens the list its numbers come from (the existing screens — nothing new is counted here)
const ListLink = ({ to, testId }: { to: string; testId: string }) => <Link className="link-44" style={{ float: 'right', fontSize: 13, fontWeight: 600 }} to={to} data-testid={testId}>{t('rpt.ai.viewList')}</Link>;

const KPI_LABELS = (): [string, string][] => [
  ['aiCallsHandled', t('growth.aiAnalytics.kpi.aiCallsHandled')], ['bookingsCapturedByAi', t('growth.aiAnalytics.kpi.bookingsCapturedByAi')], ['missedCallsRecovered', t('growth.aiAnalytics.kpi.missedCallsRecovered')],
  ['aiConversationsToday', t('growth.aiAnalytics.kpi.aiConversationsToday')], ['automationSuccessRate', t('growth.aiAnalytics.kpi.automationSuccessRate')], ['customerSentiment', t('growth.aiAnalytics.kpi.customerSentiment')],
  ['suggestedUpsellRevenueCents', t('growth.aiAnalytics.kpi.suggestedUpsellRevenueCents')], ['aiTimeSavedMinutes', t('growth.aiAnalytics.kpi.aiTimeSavedMinutes')],
];

export function POSAiAnalyticsScreen() {
  const [o, setO] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // SUNMI batch 9 guide 14 (Nov 10 2026): the period is chosen (today by default, as before) and every "in the period"
  // figure + the 7-day panel follow it; the window the server used is shown, not assumed
  const { period, setPeriod, query } = useUrlPeriod('today');
  const key = JSON.stringify(query);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setO(await posAiCenterApi.overview(query) as Overview); }
    catch (e: any) { setO(null); setError(reportError(e, t('growth.noun.aiAnalytics'))); }
    finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => { load(); }, [load]);

  const w = o?.window ?? null;
  const server = w ? { preset: period.preset, from: w.from, to: w.to, tz: w.timezone, today: w.to } : null;
  const bar = <PeriodBar value={period} onChange={setPeriod} server={server} />;
  if (loading && !o) return <div className="work">{bar}<div className="state">{t('pos.loading_ai_analytics')}</div></div>;
  if (error) return <div className="work">{bar}<div className="err" style={{ marginTop: 12 }}>{error}</div></div>;
  if (!o) return <div className="work">{bar}<div className="state">{t('pos.no_data')}</div></div>;

  const trackedCount = Object.values(o.kpis).filter((m) => m.tracked).length;

  return (
    <div className="work">
      <div className="vh"><h1>{t('pos.ai_analytics')}</h1>
        <div className="sub mb-3" data-testid="ai-caption">{w && w.from !== w.to ? t('rpt.ai.caption', { from: w.from, to: w.to }) : t('pos.how_your_ai_assistants_are_performing_1qyq')}</div></div>
      {bar}

      <div className="kpis kpis grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3" >
        {KPI_LABELS().map(([key, label]) => <MetricCard key={key} label={label} m={o.kpis[key]} />)}
      </div>

      <section className="panel" style={{ marginTop: 14 }}>
        <div className="p-h">{t('pos.call_intelligence_2')}<ListLink to="/tenant/ai/receptionist/calls" testId="ai-link-calls" /></div>
        <div className="kpis kpis grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3" style={{ marginTop: 8,  }}>
          <MetricCard label={t('pos.calls_handled')} m={o.callIntelligence?.callsHandled} />
          <MetricCard label={t('pos.recovered_2')} m={o.callIntelligence?.recovered} />
          <MetricCard label={t('pos.call_booking')} m={o.callIntelligence?.callToBookingRatePct} />
        </div>
      </section>

      <section className="panel" style={{ marginTop: 12 }}>
        <div className="p-h">{t('pos.booking_assistant')}<ListLink to="/tenant/ai/receptionist/follow-ups" testId="ai-link-followups" /></div>
        <div className="kpis kpis grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3" style={{ marginTop: 8,  }}>
          <MetricCard label={t('pos.completed_2')} m={o.bookingAssistant?.completed} />
          <MetricCard label={t('pos.ai_bookings')} m={o.bookingAssistant?.aiBookings} />
          <MetricCard label={t('pos.rebookings')} m={o.bookingAssistant?.rebookings} />
        </div>
      </section>

      <section className="panel" style={{ marginTop: 12 }}>
        <div className="p-h">{t('pos.campaign_performance')} <span className="s">· {t('rpt.ai.allCampaigns')}</span><ListLink to="/tenant/ai/marketing/results" testId="ai-link-campaigns" /></div>
        <div className="kpis kpis grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3" style={{ marginTop: 8,  }}>
          <MetricCard label={t('pos.sent')} m={o.campaigns?.sent} />
          <MetricCard label={t('pos.bookings_2')} m={o.campaigns?.bookings} />
          <MetricCard label={t('pos.revenue')} m={o.campaigns?.revenueCents} />
          <MetricCard label={t('pos.conversion')} m={o.campaigns?.conversionPct} />
        </div>
      </section>

      <section className="panel" style={{ marginTop: 12 }}>
        <div className="p-h">{t('pos.7_day_performance')}{w ? <span className="s" data-testid="ai-week"> · {t('rpt.ai.week', { from: w.weekFrom, to: w.to })}</span> : null}</div>
        <div className="kpis kpis grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3" style={{ marginTop: 8,  }}>
          <MetricCard label={t('pos.total_conversations')} m={o.performance?.totalConversations} />
          <MetricCard label={t('pos.ai_success_rate')} m={o.performance?.aiSuccessRatePct} />
        </div>
      </section>

      <div className="sub" style={{ fontSize: 12, marginTop: 10 }}>
        {trackedCount} {t('pos.of')}{' '}{Object.keys(o.kpis).length} {t('pos.metrics_are_actively_tracked_untracked_metrics_vp30')}{' '}{fmtInZone(o.generatedAt, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}.
      </div>
    </div>
  );
}
