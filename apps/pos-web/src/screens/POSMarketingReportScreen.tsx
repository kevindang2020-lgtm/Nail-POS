// POSMarketingReportScreen.tsx — Reports → Marketing. A one-glance marketing performance view composed
// from campaigns + promotions + reviews (/pos/marketing-report/state, pos.marketing.view). Read-only;
// deep management lives in each domain's own screen.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { posMarketingReportApi } from '../api/posMarketingReportApi';
import { useReportCadence } from './reportsCommon';
import { money, reportError } from './reportsCommon';
import { useIPadView } from '../components/IPadViewProvider';
import { reportRequest } from '../components/ipad-modules';
import { t } from '@aipowersalon/mobile-sdk/i18n';

type State = {
  headline: { campaignRevenueCents: number; campaignRoi: number | null; activePromotions: number; promotionRedemptions: number; averageRating: number | null; totalReviews: number };
  campaigns: { totalCampaigns: number; activeCampaigns: number; totalSent: number; campaignRevenueCents: number; totalCostCents: number; avgRoi: number; avgOpenRate: number };
  promotions: { total: number; active: number; paused: number; totalRedemptions: number; expiringSoon: number };
  reviews: { totalReviews: number; averageRating: number; fiveStarPercent: number; publicCount: number; hiddenCount: number };
};

const stars = (n: number) => { const full = Math.max(0, Math.min(5, Math.round(n))); return '★★★★★'.slice(0, full) + '☆☆☆☆☆'.slice(0, 5 - full); };
// batch 9 guide 12 (Nov 10 2026): the server sends null for "no reviews" / "no return to measure" — it crashed (toFixed on null)
// or read "nullx ROI"; now N/A, never a made-up 0
const rating = (n: number | null | undefined, reviews: number) => (n == null || !reviews ? t('rpt.na') : n.toFixed(1));

export function POSMarketingReportScreen() {
  const { reloadKey } = useReportCadence();
  const nav = useNavigate();
  const [s, setS] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { open: openIPad } = useIPadView();
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setS(await posMarketingReportApi.state() as State); }
    catch (e: any) { setError(reportError(e, t('admin.reports.noun.marketing'))); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load, reloadKey]);   // the report cadence's reloadKey re-runs the load

  if (loading && !s) return <div className="work"><div className="state">{t('pos.loading_marketing_report')}</div></div>;
  if (error && !s) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error}</div></div>;
  if (!s) return <div className="work"><div className="state">{t('pos.no_data')}</div></div>;

  const h = s.headline;
  return (
    <div className="work">
      <div className="vh "><h1>{t('pos.marketing_report')}</h1><div className="sub mb-3">{t('pos.campaigns_promotions_and_reputation_at_a_qolt')} · <span data-testid="mkt-scope">{t('rpt.mkt.allTime')}</span></div></div><div className="flex flex-col md:flex-row flex-wrap whitespace-nowrap sm:items-center justify-between gap-2 mb-1"><button className="btn ghost w-fit whitespace-nowrap"  title={t('pos.open_full_ipad_view')} onClick={() => openIPad(reportRequest(t('pos.marketing_report'), { kpis: [{ label: t('pos.campaign_revenue'), value: money(s.headline.campaignRevenueCents) }, { label: 'ROI', value: s.headline.campaignRoi == null ? t('rpt.na') : s.headline.campaignRoi + 'x' }, { label: t('pos.active_promotions'), value: s.headline.activePromotions }, { label: t('pos.redemptions'), value: s.headline.promotionRedemptions }, { label: t('pos.avg_rating_2'), value: s.headline.averageRating == null ? t('rpt.na') : s.headline.averageRating + ' \u2605' }, { label: t('pos.reviews_2'), value: s.headline.totalReviews }] }))}>{t('pos.full_view')}</button></div>

      <div className="kpis">
        <div className="kpi"><div className="l">{t('pos.campaign_revenue')}</div><div className="v" style={{ color: 'var(--aps-orange)' }}>{money(h.campaignRevenueCents)}</div><div className="d" data-testid="mkt-roi">{h.campaignRoi == null ? t('rpt.mkt.roiNa') : `${h.campaignRoi}${t('pos.roi')}`}</div></div>
        <div className="kpi"><div className="l">{t('pos.active_promotions')}</div><div className="v">{h.activePromotions}</div><div className="d">{h.promotionRedemptions} {t('pos.redemptions_2')}</div></div>
        <div className="kpi"><div className="l">{t('pos.avg_rating_2')}</div><div className="v" data-testid="mkt-rating">{rating(h.averageRating, h.totalReviews)}</div>{h.averageRating != null && h.totalReviews ? <div className="d" style={{ color: 'var(--aps-orange)' }}>{stars(h.averageRating)}</div> : null}</div>
        <div className="kpi"><div className="l">{t('pos.reviews_2')}</div><div className="v">{h.totalReviews}</div></div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 mb-3">
        <section className="panel">
          <div className="p-h" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>{t('pos.campaigns')}{' '}<button className="btn ghost w-fit whitespace-nowrap" style={{ padding: '2px 8px' }} onClick={() => nav('/tenant/marketing/campaigns')}>{t('pos.open_2')}</button></div>
          <div style={{ fontSize: 14, lineHeight: 2 }}>
            <div>{t('pos.total_2')}{' '}<b>{s.campaigns.totalCampaigns}</b> {t('pos.active_2')}{' '}<b>{s.campaigns.activeCampaigns}</b></div>
            <div>{t('pos.messages_sent_2')}{' '}<b>{s.campaigns.totalSent.toLocaleString()}</b></div>
            <div>{t('pos.revenue_2')}{' '}<b>{money(s.campaigns.campaignRevenueCents)}</b> {t('pos.cost_2')}{' '}<b>{money(s.campaigns.totalCostCents)}</b> <span className="s">{t('rpt.mkt.costEntered')}</span></div>
            <div>{t('pos.avg_open_rate')}{' '}<b>{s.campaigns.avgOpenRate}%</b></div>
          </div>
        </section>
        <section className="panel">
          <div className="p-h" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>{t('pos.promotions')}{' '}<button className="btn ghost w-fit whitespace-nowrap" style={{ padding: '2px 8px' }} onClick={() => nav('/tenant/marketing/promotions')}>{t('pos.open_2')}</button></div>
          <div style={{ fontSize: 14, lineHeight: 2 }}>
            <div>{t('pos.total_2')}{' '}<b>{s.promotions.total}</b> {t('pos.active_2')}{' '}<b>{s.promotions.active}</b> {t('pos.paused_2')}{' '}<b>{s.promotions.paused}</b></div>
            <div>{t('pos.redemptions_3')}{' '}<b>{s.promotions.totalRedemptions}</b></div>
            <div>{t('pos.expiring_soon_2')}{' '}<b>{s.promotions.expiringSoon}</b></div>
          </div>
        </section>
      </div>

      <section className="panel mb-3">
        <div className="p-h" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>{t('pos.reputation')}{' '}<button className="btn ghost w-fit whitespace-nowrap" style={{ padding: '2px 8px' }} onClick={() => nav('/tenant/marketing/reviews')}>{t('pos.open_2')}</button></div>
        <div style={{ fontSize: 14, lineHeight: 2 }}>
          <div>{t('pos.average_rating')}{' '}<b>{rating(s.reviews.averageRating, s.reviews.totalReviews)}</b> {s.reviews.totalReviews ? <span style={{ color: 'var(--aps-orange)' }}>{stars(s.reviews.averageRating)}</span> : null} {t('pos.across')}{' '}<b>{s.reviews.totalReviews}</b> {t('pos.reviews_3')}</div>
          <div>{t('pos.5_star_share')}{' '}<b>{s.reviews.fiveStarPercent}%</b></div>
          <div>{t('pos.public')}{' '}<b>{s.reviews.publicCount}</b> {t('pos.hidden_by_manager')}{' '}<b>{s.reviews.hiddenCount}</b></div>
        </div>
      </section>
    </div>
  );
}
