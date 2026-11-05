// POSMarketingLandingScreen.tsx — the Marketing & Growth group's home (Jul 27, 2026).
//
// WHY THIS EXISTS. Every other sidebar group lands somewhere real: Management on its Overview, AI on the Command
// Center, Reports on the Daily Summary. Marketing & Growth landed on a bare `<Navigate>` to Campaigns — the one
// group with no home. That mattered because marketing is the one area whose question is inherently cross-cutting:
// "is any of this working?" needs campaign ROI next to loyalty, referrals, gift cards and reputation, and today
// answering it means visiting six screens.
//
// WHAT IT IS NOT. It computes nothing. Every number here is read from an endpoint that already serves a
// dedicated screen — marketing-report (campaigns + promotions + reviews, already composed server-side), loyalty,
// referrals, gift cards. A composite that RE-DERIVES its children's KPIs is a number computed twice, and two
// copies of a number drift. So each tile links to the screen that owns it, and that screen stays the source of
// truth.
//
// Sections that fail load independently: a loyalty outage must not blank the campaign numbers. Anything that
// cannot load says so rather than rendering a zero.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { posMarketingReportApi } from '../api/posMarketingReportApi';
import { posLoyaltyApi } from '../api/posLoyaltyApi';
import { posReferralsApi } from '../api/posReferralsApi';
import { posGiftCardsApi } from '../api/posGiftCardsApi';
import { money } from './reportsCommon';
import { t } from '@aipowersalon/mobile-sdk/i18n';

type Section<T> = { data: T | null; failed: boolean };
const pending = <T,>(): Section<T> => ({ data: null, failed: false });

function Tile({ label, value, sub, to, nav }: { label: string; value: string; sub?: string; to?: string; nav?: (p: string) => void }) {
  const clickable = !!(to && nav);
  return (
    <button
      type="button"
      onClick={clickable ? () => nav!(to!) : undefined}
      disabled={!clickable}
      className="panel hover:border-[var(--aps-gold)] transition-colors"
      style={{
        textAlign: 'left',
        cursor: clickable ? 'pointer' : 'default',
        padding: '16px',
        margin: 0,
        width: '100%',
        height: '100%'
      }}
      title={clickable ? t('pos.open_label', { label: String(label) }) : undefined}
    >
      <div className="sub" style={{ fontSize: 12, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, fontFamily: 'Playfair Display, serif', marginTop: 4, color: 'var(--ink)' }}>{value}</div>
      {sub ? <div className="sub" style={{ fontSize: 12, marginTop: 4 }}>{sub}</div> : null}
    </button>
  );
}

function SectionHead({ title, note, to, nav }: { title: string; note?: string; to?: string; nav?: (p: string) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '14px 0 8px' }}>
      <h2 style={{ margin: 0, fontSize: 15 }}>{title}</h2>
      {note ? <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{note}</span> : null}
      {to && nav ? <button className="btn ghost" style={{ marginLeft: 'auto', padding: '3px 10px', fontSize: 12 }} onClick={() => nav(to)}>{t('pos.open')}</button> : null}
    </div>
  );
}

const Unavailable = ({ what }: { what: string }) => (
  <div style={{ fontSize: 12, color: 'var(--muted)', padding: '6px 2px' }}>{what} {t('pos.could_not_be_loaded_right_now')}</div>
);

export function POSMarketingLandingScreen() {
  const nav = useNavigate();
  const [report, setReport] = useState<Section<any>>(pending());
  const [loyalty, setLoyalty] = useState<Section<any>>(pending());
  const [referrals, setReferrals] = useState<Section<any>>(pending());
  const [gift, setGift] = useState<Section<any>>(pending());

  const load = useCallback(() => {
    // Independent loads: one failing section must not blank the others.
    posMarketingReportApi.state().then((d: any) => setReport({ data: d, failed: false })).catch(() => setReport({ data: null, failed: true }));
    posLoyaltyApi.state().then((d: any) => setLoyalty({ data: d, failed: false })).catch(() => setLoyalty({ data: null, failed: true }));
    posReferralsApi.state().then((d: any) => setReferrals({ data: d, failed: false })).catch(() => setReferrals({ data: null, failed: true }));
    posGiftCardsApi.state().then((d: any) => setGift({ data: d, failed: false })).catch(() => setGift({ data: null, failed: true }));
  }, []);
  useEffect(() => { load(); }, [load]);

  const h = report.data?.headline;
  const lk = loyalty.data?.kpis;
  const rk = referrals.data?.kpis;
  const gk = gift.data?.kpis ?? gift.data;

  return (
    <div className="work">
      <div className="vh" style={{ display: 'flex', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <h1>{t('pos.marketing_growth')}</h1>
          <div className="sub">{t('pos.campaigns_loyalty_referrals_gift_cards_and_ho3q')}</div>
        </div>
        <button className="btn ghost" onClick={load}>{t('pos.refresh')}</button>
      </div>

      <SectionHead title={t('pos.campaigns_promotions')} note={t('pos.from_the_marketing_report')} to="/tenant/marketing/campaigns" nav={nav} />
      {report.failed ? <Unavailable what={t('pos.campaign_and_promotion_performance')} /> : !h ? <div className="state">{t('pos.loading')}</div> : (
        <div className="grid grid-cols-2 md:grid-cols-3  lg:grid-cols-4 xl:grid-cols-5 gap-3">
          <Tile label={t('pos.campaign_revenue')} value={money(h.campaignRevenueCents ?? 0)} to="/tenant/marketing/campaigns" nav={nav} />
          <Tile label={t('pos.campaign_roi')} value={`${h.campaignRoi ?? 0}x`} sub={t('pos.revenue_cost')} to="/tenant/marketing/campaigns" nav={nav} />
          <Tile label={t('pos.active_promotions')} value={String(h.activePromotions ?? 0)} to="/tenant/marketing/promotions" nav={nav} />
          <Tile label={t('pos.redemptions')} value={String(h.promotionRedemptions ?? 0)} to="/tenant/marketing/promotions" nav={nav} />
          <Tile label={t('pos.avg_rating_2')} value={`${h.averageRating ?? 0} ★`} sub={t('pos.v0_reviews', { v0: String(h.totalReviews ?? 0) })} to="/tenant/marketing/reviews" nav={nav} />
        </div>
      )}

      <SectionHead title={t('pos.loyalty')} to="/tenant/customers/loyalty" nav={nav} />
      {loyalty.failed ? <Unavailable what={t('pos.loyalty')} /> : !lk ? <div className="state">{t('pos.loading')}</div> : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          <Tile label={t('pos.members')} value={String(lk.memberCount ?? 0)} to="/tenant/customers/loyalty" nav={nav} />
          {/* Outstanding points are a real liability, not a vanity metric — the salon owes these. */}
          <Tile label={t('pos.points_outstanding')} value={String(lk.pointsOutstanding ?? 0)} sub={t('pos.program_liability')} to="/tenant/customers/loyalty" nav={nav} />
          <Tile label={t('pos.redemptions')} value={String(lk.redemptionCount ?? 0)} sub={t('pos.v0_points_spent', { v0: String(lk.pointsRedeemed ?? 0) })} to="/tenant/customers/loyalty" nav={nav} />
          <Tile label={t('pos.active_rewards')} value={String(lk.activeRewards ?? 0)} to="/tenant/customers/loyalty" nav={nav} />
        </div>
      )}

      <SectionHead title={t('pos.referrals')} to="/tenant/marketing/referrals" nav={nav} />
      {referrals.failed ? <Unavailable what={t('pos.referrals')} /> : !rk ? <div className="state">{t('pos.loading')}</div> : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          <Tile label={t('pos.codes_issued')} value={String(rk.codesIssued ?? 0)} to="/tenant/marketing/referrals" nav={nav} />
          <Tile label={t('pos.referrals')} value={String(rk.totalReferrals ?? 0)} sub={t('pos.v0_pending', { v0: String(rk.pendingReferrals ?? 0) })} to="/tenant/marketing/referrals" nav={nav} />
          <Tile label={t('pos.rewarded')} value={String(rk.rewardedReferrals ?? 0)} to="/tenant/marketing/referrals" nav={nav} />
          <Tile label={t('pos.reward_value')} value={money(rk.rewardValueCents ?? 0)} sub={t('pos.paid_out')} to="/tenant/marketing/referrals" nav={nav} />
        </div>
      )}

      <SectionHead title={t('pos.gift_cards')} to="/tenant/customers/gift-cards" nav={nav} />
      {gift.failed ? <Unavailable what={t('pos.gift_cards_2')} /> : !gk ? <div className="state">{t('pos.loading')}</div> : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Tile label={t('pos.active_cards')} value={String(gk.activeCards ?? gk.active ?? 0)} to="/tenant/customers/gift-cards" nav={nav} />
          {/* Unredeemed balance is money already collected and still owed in service. */}
          <Tile label={t('pos.outstanding_balance')} value={money(gk.outstandingBalanceCents ?? gk.balanceCents ?? 0)} sub={t('pos.owed_in_service')} to="/tenant/customers/gift-cards" nav={nav} />
        </div>
      )}

      <div className="flex flex-wrap gap-2 mt-6">
        <button className="btn" onClick={() => nav('/tenant/marketing/campaigns')}>{t('pos.create_campaign')}</button>
        <button className="btn ghost" onClick={() => nav('/tenant/marketing/promotions')}>{t('pos.launch_promo')}</button>
        <button className="btn ghost" onClick={() => nav('/tenant/customers/gift-cards')}>{t('pos.issue_gift_card')}</button>
        <button className="btn ghost" onClick={() => nav('/tenant/marketing/reviews')}>{t('pos.request_review')}</button>
        <button className="btn ghost" onClick={() => nav('/tenant/reports/marketing')}>{t('pos.marketing_report')}</button>
        <button className="btn ghost" onClick={() => nav('/tenant/marketing/display-ads')}>{t('pos.customer_display_ads')}</button>
      </div>
    </div>
  );
}
