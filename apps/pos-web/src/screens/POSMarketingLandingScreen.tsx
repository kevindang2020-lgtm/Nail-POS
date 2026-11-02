// POSMarketingLandingScreen.tsx — Marketing & Growth (/tenant/marketing). Rebuilt in place for the Marketing & Growth
// Complete Build Guide (Oct 30 2026); the Jul 27 home's rule stays: this screen computes no business number itself.
//
// Kept from the photographed screen: title, Refresh, the four sections (Campaigns & Promotions, Loyalty, Referrals, Gift
// Cards) with every tile and its Open action, and the quick actions (Create Campaign, Launch Promo, Issue Gift Card,
// Request Review, Marketing Report, Customer display ads). Each tile still reads the endpoint that owns it:
//   campaign revenue / ROI   Campaign Center overview (code-attributed revenue; ROI only with provider cost — else N/A)
//   promotions / redemptions /pos/discounts/kpis (the redemption ledger the Promotions screen uses)
//   loyalty                  /pos/loyalty/state · referrals /pos/referrals/state · gift cards /pos/gift-cards/state
//   rating / reviews         /pos/marketing-report/state (N/A with no reviews, never "0 ★")
// Added: the KPI strip, one grouped search, the period + branch filter, Data checks (GATE 0 reconciliation), Marketing
// Cost & Profit (owners / managers), the Marketing activity history (numbered pages) and the Customer Marketing Journey
// overlay. The Smart Campaign Assistant opens Campaign Center's assistant — proposals only, approval before any send.
// Sections fail independently: one outage never blanks another, and a failed section says so instead of showing 0.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { posLoyaltyApi } from '../api/posLoyaltyApi';
import { posReferralsApi } from '../api/posReferralsApi';
import { posGiftCardsApi } from '../api/posGiftCardsApi';
import { posMarketingReportApi } from '../api/posMarketingReportApi';
import { posCampaignCenterApi } from '../api/posCampaignCenterApi';
import { posDiscountsApi } from '../api/posDiscountsApi';
import { posMarketingGrowthApi, MG_SCOPES, MG_EVENT_TYPES, type MgScope } from '../api/posMarketingGrowthApi';
import { useCan } from '../components/usePermissions';
import { errorTextOf } from '../i18n/error-text';
import { fmtMoney, fmtNumber, fmtInZone } from '../i18n/format';
import { FitDialog, KpiCard, Pager, Empty, ErrorRetry, useDebounced } from '../components/FitKit';
import { PeriodBar, periodQuery, type PeriodState, type ServerPeriod } from '../components/FinanceKit';

type Section<T> = { data: T | null; failed: boolean };
const pending = <T,>(): Section<T> => ({ data: null, failed: false });
const SIZES = [10, 20, 50] as const;
const GOALS = ['inactive', 'slow_weekdays', 'new_service', 'repeat_visits'] as const;
const money = (c: number | null | undefined) => (c == null ? tx('mg.na') : fmtMoney(c));
const nf = (n: number | null | undefined) => (n == null ? tx('mg.na') : fmtNumber(n));
const when = (iso: string | null | undefined) => (iso ? fmtInZone(iso, { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const errText = (e: unknown) => errorTextOf(e, tx('mg.failed'));

function Tile({ label, value, sub, to, nav, testId }: { label: string; value: string; sub?: string; to?: string; nav?: (p: string) => void; testId?: string }) {
  const clickable = !!(to && nav);
  return (
    <button type="button" onClick={clickable ? () => nav!(to!) : undefined} disabled={!clickable} className="panel mg-tile" data-testid={testId}
      title={clickable ? tx('pos.open_label', { label: String(label) }) : undefined}>
      <div className="mg-tl">{label}</div>
      <div className="mg-tv">{value}</div>
      {sub ? <div className="mg-ts">{sub}</div> : null}
    </button>
  );
}
function SectionHead({ title, note, to, nav, testId }: { title: string; note?: string; to?: string; nav?: (p: string) => void; testId?: string }) {
  return (
    <div className="mg-sh" data-testid={testId}>
      <h2>{title}</h2>{note ? <span className="mg-shn">{note}</span> : null}
      {to && nav ? <button type="button" className="fk-btn ghost mg-open" onClick={() => nav(to)}>{tx('mg.open')}</button> : null}
    </div>
  );
}
const Unavailable = ({ what }: { what: string }) => <div className="mg-unavail">{tx('mg.unavailable', { what })}</div>;
const Loading = () => <div className="state">{tx('pos.loading')}</div>;

export function POSMarketingLandingScreen() {
  const nav = useNavigate();
  const can = useCan();
  const canManage = can('marketing.manage');
  const [sp, setSp] = useSearchParams();
  const setView = useCallback((patch: Record<string, string | number | null>, resetPage = true) => {
    const next = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === '' || v === undefined) next.delete(k); else next.set(k, String(v)); }
    if (resetPage && !('page' in patch)) next.delete('page');
    setSp(next, { replace: true });
  }, [sp, setSp]);
  // view state lives in the URL (never a customer's name, phone or e-mail — only ids, scopes and dates)
  const scope = ((MG_SCOPES as readonly string[]).includes(sp.get('scope') ?? '') ? sp.get('scope') : 'all') as MgScope;
  const page = Math.max(1, Number(sp.get('page')) || 1);
  const size = (SIZES as readonly number[]).includes(Number(sp.get('size'))) ? Number(sp.get('size')) : 10;
  const type = (MG_EVENT_TYPES as readonly string[]).includes(sp.get('type') ?? '') ? String(sp.get('type')) : '';
  const branch = sp.get('branch') ?? '';
  const journeyId = sp.get('journey');
  const period: PeriodState = sp.get('preset') === 'custom' && sp.get('from') && sp.get('to') ? { preset: 'custom', from: sp.get('from')!, to: sp.get('to')! } as PeriodState
    : { preset: (['today', 'week', 'month', 'year', 'all'].includes(sp.get('preset') ?? '') ? sp.get('preset') : 'month') as PeriodState['preset'] } as PeriodState;
  const pq = periodQuery(period);
  const pkey = JSON.stringify(pq);

  // the search text is NOT kept in the URL (it may be a name or a phone number)
  const [text, setText] = useState('');
  const q = useDebounced(text.trim(), 350);

  const [report, setReport] = useState<Section<any>>(pending());
  const [cc, setCc] = useState<Section<any>>(pending());
  const [disc, setDisc] = useState<Section<any>>(pending());
  const [loyalty, setLoyalty] = useState<Section<any>>(pending());
  const [referrals, setReferrals] = useState<Section<any>>(pending());
  const [gift, setGift] = useState<Section<any>>(pending());
  const [recon, setRecon] = useState<Section<any>>(pending());
  const [econ, setEcon] = useState<Section<any>>(pending());
  const [act, setAct] = useState<Section<any>>(pending());
  const [actErr, setActErr] = useState<string | null>(null);
  const [res, setRes] = useState<any>(null); const [resErr, setResErr] = useState<string | null>(null);
  const [updated, setUpdated] = useState<string | null>(null);
  const [assist, setAssist] = useState(false);
  const [openCheck, setOpenCheck] = useState<string | null>(null);

  const loadSections = useCallback(() => {
    // independent loads — one failing section must not blank the others
    const one = <T,>(p: Promise<T>, set: (s: Section<T>) => void) => { set(pending()); p.then((d) => set({ data: d, failed: false })).catch(() => set({ data: null, failed: true })); };
    one(posMarketingReportApi.state(), setReport);
    one(posCampaignCenterApi.overview({ preset: 'all' }), setCc);
    one(posDiscountsApi.kpis(), setDisc);
    one(posLoyaltyApi.state(), setLoyalty);
    one(posReferralsApi.state(), setReferrals);
    one(posGiftCardsApi.state(), setGift);
    one(posMarketingGrowthApi.reconciliation(pq), setRecon);
    if (canManage) one(posMarketingGrowthApi.economics(pq), setEcon);
    setUpdated(new Date().toISOString());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pkey, canManage]);
  useEffect(() => { loadSections(); }, [loadSections]);

  const loadActivity = useCallback(() => {
    setActErr(null);
    posMarketingGrowthApi.activity({ ...pq, type: type || undefined, branch: branch || undefined, page, pageSize: size })
      .then((d) => setAct({ data: d, failed: false })).catch((e) => { setAct({ data: null, failed: true }); setActErr(errText(e)); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pkey, type, branch, page, size]);
  useEffect(() => { loadActivity(); }, [loadActivity]);

  useEffect(() => {
    if (q.length < 2) { setRes(null); setResErr(null); return; }
    let live = true;
    posMarketingGrowthApi.search({ q, scope, branch: branch || undefined, page: scope === 'all' ? 1 : page, pageSize: size })
      .then((d) => { if (live) { setRes(d); setResErr(null); } }).catch((e) => { if (live) { setRes(null); setResErr(errText(e)); } });
    return () => { live = false; };
  }, [q, scope, branch, page, size]);

  const refresh = () => { loadSections(); loadActivity(); };
  const h = report.data?.headline; const ck = cc.data?.kpis; const dk = disc.data;
  const lk = loyalty.data?.kpis; const rk = referrals.data?.kpis; const gk = gift.data?.kpis ?? gift.data;
  const serverPeriod: ServerPeriod | null = act.data?.period ? { preset: act.data.period.preset, from: act.data.period.from, to: act.data.period.to, tz: act.data.period.tz, today: act.data.period.today } : null;
  const branches: { branchId: string; name: string }[] = act.data?.scope?.branches ?? [];
  const rating = h ? (h.averageRating == null || !h.totalReviews ? tx('mg.na') : `${h.averageRating} ★`) : '';

  return (
    <div className="work mg" data-testid="mg-screen">
      <div className="vh mg-head">
        <div className="mg-hl">
          <h1>{tx('pos.marketing_growth')}</h1>
          <div className="sub">{tx('mg.sub')}</div>
          {updated ? <div className="fk-hint" data-testid="mg-updated">{tx('mg.updated', { time: when(updated) })}</div> : null}
        </div>
        <div className="mg-ha">
          <button type="button" className="fk-btn ghost" onClick={refresh} data-testid="mg-refresh">{tx('mg.refresh')}</button>
          <button type="button" className="fk-btn ghost" onClick={() => setAssist(true)} data-testid="mg-assistant">{tx('mg.assistant')}</button>
          <button type="button" className="fk-btn ghost" onClick={() => nav('/tenant/reports/marketing')}>{tx('mg.report')}</button>
          <button type="button" className="fk-btn primary" onClick={() => nav('/tenant/marketing/campaigns')}>{tx('mg.createCampaign')}</button>
        </div>
      </div>

      {/* KPI strip — verified revenue, ROI, promotions, loyalty members, referrals, gift-card liability */}
      <div className="mg-kpis" data-testid="mg-kpis">
        <KpiCard testId="mg-kpi-revenue" label={tx('mg.kpi.revenue')} loading={!ck && !cc.failed} value={cc.failed ? tx('mg.na') : money(ck?.campaignRevenueCents)} sub={tx('mg.kpi.revenueSub')} onClick={() => nav('/tenant/marketing/campaigns')} />
        <KpiCard testId="mg-kpi-roi" label={tx('mg.kpi.roi')} loading={!ck && !cc.failed} value={ck?.avgRoi == null ? tx('mg.na') : `${ck.avgRoi}x`} sub={ck?.avgRoi == null ? tx('mg.kpi.roiNa') : tx('mg.kpi.roiSub')} onClick={() => nav('/tenant/marketing/campaigns')} />
        <KpiCard testId="mg-kpi-promotions" label={tx('mg.kpi.promotions')} loading={!dk && !disc.failed} value={disc.failed ? tx('mg.na') : nf(dk?.activeDiscounts)} sub={dk ? tx('mg.kpi.promotionsSub', { n: nf(dk.ledger?.confirmedEvents) }) : undefined} onClick={() => nav('/tenant/marketing/promotions')} />
        <KpiCard testId="mg-kpi-loyalty" label={tx('mg.kpi.loyalty')} loading={!lk && !loyalty.failed} value={loyalty.failed ? tx('mg.na') : nf(lk?.memberCount)} sub={lk ? tx('mg.kpi.loyaltySub', { n: nf(lk.pointsOutstanding) }) : undefined} onClick={() => nav('/tenant/customers/loyalty')} />
        <KpiCard testId="mg-kpi-referrals" label={tx('mg.kpi.referrals')} loading={!rk && !referrals.failed} value={referrals.failed ? tx('mg.na') : nf(rk?.totalReferrals)} sub={rk ? tx('mg.kpi.referralsSub', { n: nf(rk.rewardedReferrals) }) : undefined} onClick={() => nav('/tenant/marketing/referrals')} />
        <KpiCard testId="mg-kpi-gift" label={tx('mg.kpi.giftLiability')} loading={!gk && !gift.failed} value={gift.failed ? tx('mg.na') : money(gk?.outstandingCents ?? gk?.outstandingBalanceCents)} sub={gk ? tx('mg.kpi.giftLiabilitySub', { n: nf(gk.activeCards ?? gk.active) }) : undefined} onClick={() => nav('/tenant/customers/gift-cards')} />
      </div>

      {/* one search box + scope tabs; period / branch / type below */}
      <section className="panel mg-filters" data-testid="mg-filters">
        <input className="fk-input mg-search" value={text} onChange={(e) => { setText(e.target.value); if (page !== 1) setView({ page: null }, false); }}
          placeholder={tx('mg.search.placeholder')} aria-label={tx('mg.search.placeholder')} data-testid="mg-search" />
        <div className="rt-chips" role="tablist">{MG_SCOPES.map((s) => (
          <button type="button" role="tab" aria-selected={scope === s} key={s} className={'rt-chip' + (scope === s ? ' on' : '')} onClick={() => setView({ scope: s === 'all' ? null : s })} data-testid={'mg-scope-' + s}>{tx('mg.search.scope.' + s)}</button>
        ))}</div>
        <div className="mg-frow">
          <PeriodBar compact allowAll value={period} server={serverPeriod}
            onChange={(p) => setView(p.preset === 'custom' ? { preset: 'custom', from: p.from ?? null, to: p.to ?? null } : { preset: p.preset === 'month' ? null : p.preset, from: null, to: null })} />
          {branches.length > 1 ? (
            <select className="fk-select" value={branch} onChange={(e) => setView({ branch: e.target.value || null })} data-testid="mg-branch" aria-label={tx('mg.branch.all')}>
              <option value="">{tx('mg.branch.all')}</option>
              {branches.map((b) => <option key={b.branchId} value={b.branchId}>{b.name}</option>)}
            </select>
          ) : null}
          {(text || scope !== 'all' || branch || type || sp.get('preset')) ? <button type="button" className="fk-btn ghost" onClick={() => { setText(''); setSp(new URLSearchParams(), { replace: true }); }} data-testid="mg-clear">{tx('mg.search.clear')}</button> : null}
        </div>
        {scope === 'gift_cards' ? <div className="fk-hint">{tx('mg.search.giftHint')}</div> : null}
        {text.trim().length > 0 ? <SearchResults q={q} res={res} err={resErr} scope={scope} size={size} onScope={(s) => setView({ scope: s })} onPage={(p) => setView({ page: p > 1 ? p : null }, false)}
          onJourney={(id) => setView({ journey: id }, false)} nav={nav} /> : null}
      </section>

      {/* the photographed sections — every tile and Open kept */}
      <SectionHead title={tx('mg.section.campaigns')} note={tx('mg.section.campaignsNote')} to="/tenant/marketing/campaigns" nav={nav} testId="mg-sec-campaigns" />
      {cc.failed && report.failed ? <Unavailable what={tx('pos.campaign_and_promotion_performance')} /> : (!ck && !cc.failed) ? <Loading /> : (
        <div className="mg-grid5">
          <Tile testId="mg-t-revenue" label={tx('pos.campaign_revenue')} value={cc.failed ? tx('mg.na') : money(ck?.campaignRevenueCents)} sub={tx('mg.kpi.revenueSub')} to="/tenant/marketing/campaigns" nav={nav} />
          <Tile testId="mg-t-roi" label={tx('pos.campaign_roi')} value={ck?.avgRoi == null ? tx('mg.na') : `${ck.avgRoi}x`} sub={ck?.avgRoi == null ? tx('mg.kpi.roiNa') : tx('mg.kpi.roiSub')} to="/tenant/marketing/campaigns" nav={nav} />
          <Tile testId="mg-t-promos" label={tx('pos.active_promotions')} value={disc.failed ? tx('mg.na') : nf(dk?.activeDiscounts)} to="/tenant/marketing/promotions" nav={nav} />
          <Tile testId="mg-t-redemptions" label={tx('pos.redemptions')} value={disc.failed ? tx('mg.na') : nf(dk?.ledger?.confirmedEvents)} to="/tenant/marketing/promotions" nav={nav} />
          <Tile testId="mg-t-rating" label={tx('mg.tile.rating')} value={report.failed ? tx('mg.na') : rating} sub={h ? (h.totalReviews ? tx('mg.tile.reviews', { n: nf(h.totalReviews) }) : tx('mg.tile.noReviews')) : undefined} to="/tenant/marketing/reviews" nav={nav} />
        </div>
      )}

      <SectionHead title={tx('mg.section.loyalty')} to="/tenant/customers/loyalty" nav={nav} testId="mg-sec-loyalty" />
      {loyalty.failed ? <Unavailable what={tx('pos.loyalty')} /> : !lk ? <Loading /> : (
        <div className="mg-grid4">
          <Tile testId="mg-t-members" label={tx('pos.members')} value={nf(lk.memberCount)} to="/tenant/customers/loyalty" nav={nav} />
          <Tile testId="mg-t-points" label={tx('pos.points_outstanding')} value={nf(lk.pointsOutstanding)} sub={tx('pos.program_liability')} to="/tenant/customers/loyalty" nav={nav} />
          <Tile label={tx('pos.redemptions')} value={nf(lk.redemptionCount)} sub={tx('pos.v0_points_spent', { v0: nf(lk.pointsRedeemed) })} to="/tenant/customers/loyalty" nav={nav} />
          <Tile label={tx('pos.active_rewards')} value={nf(lk.activeRewards)} to="/tenant/customers/loyalty" nav={nav} />
        </div>
      )}

      <SectionHead title={tx('mg.section.referrals')} to="/tenant/marketing/referrals" nav={nav} testId="mg-sec-referrals" />
      {referrals.failed ? <Unavailable what={tx('pos.referrals')} /> : !rk ? <Loading /> : (
        <div className="mg-grid4">
          <Tile label={tx('pos.codes_issued')} value={nf(rk.codesIssued)} to="/tenant/marketing/referrals" nav={nav} />
          <Tile label={tx('pos.referrals')} value={nf(rk.totalReferrals)} sub={tx('pos.v0_pending', { v0: nf(rk.pendingReferrals) })} to="/tenant/marketing/referrals" nav={nav} />
          <Tile label={tx('pos.rewarded')} value={nf(rk.rewardedReferrals)} to="/tenant/marketing/referrals" nav={nav} />
          <Tile label={tx('pos.reward_value')} value={money(rk.rewardValueCents)} sub={tx('pos.paid_out')} to="/tenant/marketing/referrals" nav={nav} />
        </div>
      )}

      <SectionHead title={tx('mg.section.gift')} to="/tenant/customers/gift-cards" nav={nav} testId="mg-sec-gift" />
      {gift.failed ? <Unavailable what={tx('pos.gift_cards_2')} /> : !gk ? <Loading /> : (
        <div className="mg-grid2">
          <Tile testId="mg-t-giftactive" label={tx('pos.active_cards')} value={nf(gk.activeCards ?? gk.active)} to="/tenant/customers/gift-cards" nav={nav} />
          <Tile testId="mg-t-giftowed" label={tx('pos.outstanding_balance')} value={money(gk.outstandingCents ?? gk.outstandingBalanceCents)} sub={tx('pos.owed_in_service')} to="/tenant/customers/gift-cards" nav={nav} />
        </div>
      )}

      {/* GATE 0 — data checks */}
      <section className="panel mg-panel" data-testid="mg-checks">
        <div className="mg-ph"><h2>{tx('mg.checks.title')}</h2>{recon.data ? <StatusBadge s={recon.data.overall} testId="mg-checks-overall" /> : null}</div>
        <div className="fk-hint">{tx('mg.checks.sub')}</div>
        {recon.failed ? <ErrorRetry message={tx('mg.unavailable', { what: tx('mg.checks.title') })} onRetry={loadSections} /> : !recon.data ? <Loading /> : (
          <ul className="mg-checks">{recon.data.sections.map((s: any) => (
            <li key={s.key} data-testid={'mg-check-' + s.key}>
              <div className="mg-crow">
                <StatusBadge s={s.status} />
                <b className="mg-ct">{s.title}</b>
                <span className="fk-muted">{s.defects.length ? tx('mg.checks.defects', { n: String(s.defects.length) }) : tx('mg.checks.noDefects')}</span>
                <button type="button" className="fk-btn ghost mg-open" onClick={() => setOpenCheck(openCheck === s.key ? null : s.key)} data-testid={'mg-check-open-' + s.key}>{openCheck === s.key ? tx('mg.checks.hide') : tx('mg.checks.details')}</button>
              </div>
              {openCheck === s.key ? <CheckDetail s={s} /> : null}
            </li>
          ))}</ul>
        )}
      </section>

      {/* Marketing Cost & Profit */}
      <section className="panel mg-panel" data-testid="mg-econ">
        <div className="mg-ph"><h2>{tx('mg.econ.title')}</h2>{econ.data ? <span className={'mg-badge ' + (econ.data.reconciliation.reconciled ? 'ok' : 'bad')} data-testid="mg-econ-rec">{econ.data.reconciliation.reconciled ? tx('mg.econ.reconciled') : tx('mg.econ.notReconciled')}</span> : null}</div>
        <div className="fk-hint">{tx('mg.econ.sub')}</div>
        {!canManage ? <Empty title={tx('mg.econ.ownerOnly')} /> : econ.failed ? <ErrorRetry message={tx('mg.unavailable', { what: tx('mg.econ.title') })} onRetry={loadSections} /> : !econ.data ? <Loading /> : <Economics e={econ.data} />}
      </section>

      {/* marketing activity history */}
      <section className="panel mg-panel" data-testid="mg-activity">
        <div className="mg-ph"><h2>{tx('mg.act.title')}</h2>
          <select className="fk-select" value={type} onChange={(e) => setView({ type: e.target.value || null })} data-testid="mg-type" aria-label={tx('mg.act.type')}>
            <option value="">{tx('mg.act.allTypes')}</option>
            {MG_EVENT_TYPES.map((x) => <option key={x} value={x}>{tx('mg.act.type.' + x)}</option>)}
          </select>
        </div>
        <div className="fk-hint">{tx('mg.act.sub')}</div>
        {act.failed ? <ErrorRetry message={actErr ?? tx('mg.unavailable', { what: tx('mg.act.title') })} onRetry={loadActivity} /> : !act.data ? <Loading /> : act.data.items.length === 0 ? <Empty title={tx('mg.act.empty')} /> : (
          <ActivityTable items={act.data.items} onJourney={(id) => setView({ journey: id }, false)} />
        )}
        {act.data ? (
          <footer className="mg-foot">
            <select className="fk-select" value={size} onChange={(e) => setView({ size: Number(e.target.value) === 10 ? null : e.target.value })} data-testid="mg-size" aria-label={tx('mg.rows', { n: String(size) })}>
              {SIZES.map((n) => <option key={n} value={n}>{tx('mg.rows', { n: String(n) })}</option>)}
            </select>
            <Pager info={act.data.pagination} onPage={(p) => setView({ page: p > 1 ? p : null }, false)} />
          </footer>
        ) : null}
      </section>

      {/* quick actions — kept as photographed, each to the module that owns the action */}
      <div className="mg-qa" data-testid="mg-quick">
        <button type="button" className="fk-btn primary" onClick={() => nav('/tenant/marketing/campaigns')}>{tx('pos.create_campaign')}</button>
        <button type="button" className="fk-btn ghost" onClick={() => nav('/tenant/marketing/promotions')}>{tx('pos.launch_promo')}</button>
        <button type="button" className="fk-btn ghost" onClick={() => nav('/tenant/customers/gift-cards')}>{tx('pos.issue_gift_card')}</button>
        <button type="button" className="fk-btn ghost" onClick={() => nav('/tenant/marketing/reviews')}>{tx('pos.request_review')}</button>
        <button type="button" className="fk-btn ghost" onClick={() => nav('/tenant/reports/marketing')}>{tx('pos.marketing_report')}</button>
        <button type="button" className="fk-btn ghost" onClick={() => nav('/tenant/marketing/display-ads')}>{tx('mg.qa.ads')}</button>
      </div>

      {journeyId ? <JourneyDialog id={journeyId} onClose={() => setView({ journey: null }, false)} nav={nav} /> : null}
      {assist ? (
        <FitDialog title={tx('mg.a.title')} subtitle={tx('mg.a.sub')} onClose={() => setAssist(false)} testId="mg-assist"
          footer={<button type="button" className="fk-btn ghost" onClick={() => setAssist(false)}>{tx('mg.j.close')}</button>}>
          <div className="mg-goals">{GOALS.map((g) => (
            <button type="button" key={g} className="fk-btn ghost mg-goal" onClick={() => nav(`/tenant/marketing/campaigns?assistant=${g}`)} data-testid={'mg-goal-' + g}>
              <b>{tx('mg.a.goal.' + g)}</b><span className="fk-muted">{tx('mg.a.open')}</span>
            </button>
          ))}</div>
        </FitDialog>
      ) : null}
    </div>
  );
}

function StatusBadge({ s, testId }: { s: string; testId?: string }) {
  const tone = s === 'ready' ? 'ok' : s === 'failed' ? 'bad' : s === 'attention_required' ? 'warn' : 'muted';
  return <span className={'mg-badge ' + tone} data-testid={testId}>{tx('mg.checks.status.' + s)}</span>;
}

function CheckDetail({ s }: { s: any }) {
  const rf = s.rollForward;
  return (
    <div className="mg-cd" data-testid={'mg-check-detail-' + s.key}>
      <div><b>{tx('mg.checks.formula')}</b> {s.formula}</div>
      <div className="mg-cvals">{Object.entries(s.values ?? {}).map(([k, v]) => <span key={k} className="mg-cv">{k}: <b>{v == null ? tx('mg.na') : String(v)}</b></span>)}</div>
      {rf ? <div data-testid="mg-roll">{tx('mg.checks.roll', { o: nf(rf.opening), e: nf(rf.earned), r: nf(rf.redeemed), v: nf(rf.reversed), a: nf(rf.adjusted), m: nf(rf.merged), c: nf(rf.closing) })}</div> : null}
      {s.caveats?.length ? <div><b>{tx('mg.checks.caveats')}</b><ul>{s.caveats.map((c: string, i: number) => <li key={i}>{c}</li>)}</ul></div> : null}
      {s.defects.length ? (
        <table className="tbl mg-dtbl"><thead><tr><th>{tx('mg.checks.details')}</th><th>{tx('mg.checks.amount')}</th><th>{tx('mg.checks.source')}</th><th>{tx('mg.checks.owner')}</th><th>{tx('mg.checks.remediation')}</th></tr></thead>
          <tbody>{s.defects.map((d: any) => (
            <tr key={d.code} data-testid={'mg-defect-' + d.code}><td>{d.detail}</td><td>{d.amount == null ? '—' : d.unit === 'cents' ? fmtMoney(d.amount) : `${fmtNumber(d.amount)} ${d.unit}`}</td><td className="fk-muted">{d.source}</td><td>{d.owner}</td><td>{d.remediation}</td></tr>
          ))}</tbody></table>
      ) : null}
    </div>
  );
}

function Economics({ e }: { e: any }) {
  const tt = e.totals; const pc = e.programCosts;
  return (
    <>
      <div className="mg-kpis small">
        <KpiCard testId="mg-econ-spend" label={tx('mg.econ.spend')} value={money(tt.spendCents)} sub={tt.campaignsMissingCost ? tx('mg.econ.spendMissing', { n: String(tt.campaignsMissingCost) }) : undefined} tone={tt.spendCents == null ? 'warn' : undefined} />
        <KpiCard testId="mg-econ-revenue" label={tx('mg.econ.revenue')} value={money(tt.attributedRevenueCents)} />
        <KpiCard testId="mg-econ-roi" label={tx('mg.econ.roi')} value={tt.roi == null ? tx('mg.na') : `${tt.roi}x`} />
        <KpiCard testId="mg-econ-roas" label={tx('mg.econ.roas')} value={tt.roas == null ? tx('mg.na') : `${tt.roas}x`} />
        <KpiCard testId="mg-econ-discount" label={tx('mg.econ.discount')} value={money(pc.promotionDiscountCents)} />
        <KpiCard testId="mg-econ-referral" label={tx('mg.econ.referral')} value={money(pc.referralRewardCents)} />
      </div>
      {e.campaigns.length ? (
        <div className="mg-tw"><table className="tbl" data-testid="mg-econ-table">
          <thead><tr><th>{tx('mg.econ.campaign')}</th><th>{tx('mg.econ.sent')}</th><th>{tx('mg.econ.cost')}</th><th>{tx('mg.econ.discount')}</th><th>{tx('mg.econ.revenue')}</th><th>{tx('mg.econ.roi')}</th></tr></thead>
          <tbody>{e.campaigns.slice(0, 10).map((c: any) => (
            <tr key={c.id}><td>{c.name}</td><td>{fmtNumber(c.sent)}</td>
              <td>{c.costState === 'recorded' ? fmtMoney(c.spendCents) : tx('mg.econ.cost.' + c.costState)}</td>
              <td>{fmtMoney(c.discountCents)}</td><td>{fmtMoney(c.attributedRevenueCents)}</td><td>{c.roi == null ? tx('mg.na') : `${c.roi}x`}</td></tr>
          ))}</tbody></table></div>
      ) : null}
      <details className="mg-formulas"><summary>{tx('mg.econ.formulas')}</summary><ul>{Object.values(e.formulas as Record<string, string>).map((f, i) => <li key={i}>{f}</li>)}<li>{pc.note}</li>{e.excludes.map((x: string, i: number) => <li key={'x' + i}>{x}</li>)}</ul></details>
    </>
  );
}

function ActivityTable({ items, onJourney }: { items: any[]; onJourney: (id: string) => void }) {
  return (
    <div className="mg-tw"><table className="tbl" data-testid="mg-act-table">
      <thead><tr><th>{tx('mg.act.when')}</th><th>{tx('mg.act.type')}</th><th>{tx('mg.act.what')}</th><th>{tx('mg.act.customer')}</th><th>{tx('mg.act.detail')}</th><th>{tx('mg.act.amount')}</th></tr></thead>
      <tbody>{items.map((r: any) => (
        <tr key={r.id} data-testid="mg-act-row">
          <td className="fk-muted">{when(r.at)}</td><td>{tx('mg.act.type.' + r.type)}</td><td>{r.title}</td>
          <td>{r.customerId ? <button type="button" className="fk-link" onClick={() => onJourney(r.customerId)} data-testid="mg-act-customer">{r.customerName ?? '—'}</button> : '—'}</td>
          <td className="fk-muted">{r.detail ?? ''}</td>
          <td>{r.amountCents != null ? fmtMoney(r.amountCents) : r.points != null ? tx('mg.act.points', { n: fmtNumber(r.points) }) : ''}</td>
        </tr>
      ))}</tbody></table></div>
  );
}

function SearchResults({ q, res, err, scope, size, onScope, onPage, onJourney, nav }: { q: string; res: any; err: string | null; scope: MgScope; size: number;
  onScope: (s: MgScope) => void; onPage: (p: number) => void; onJourney: (id: string) => void; nav: (p: string) => void }) {
  if (q.length < 2) return <div className="fk-hint">{tx('mg.search.hint')}</div>;
  if (err) return <div className="fk-error" data-testid="mg-search-error">{err}</div>;
  if (!res) return <Loading />;
  if (!res.total) return <Empty title={tx('mg.search.none', { q })} />;
  void size;
  const open = (it: any) => (it.link?.kind === 'journey' ? onJourney(it.link.customerId) : it.link?.to ? nav(it.link.to) : undefined);
  return (
    <div className="mg-results" data-testid="mg-results">
      <div className="fk-hint" data-testid="mg-search-count">{tx('mg.search.matches', { n: fmtNumber(res.total) })}</div>
      {res.groups.filter((g: any) => g.count > 0).map((g: any) => (
        <div key={g.scope} className="mg-rg" data-testid={'mg-group-' + g.scope}>
          <div className="mg-rgh"><b>{tx('mg.search.scope.' + g.scope)}</b> <span className="fk-muted">{fmtNumber(g.count)}</span>
            {scope === 'all' && g.count > g.items.length ? <button type="button" className="fk-link" onClick={() => onScope(g.scope)}>{tx('mg.search.more', { n: fmtNumber(g.count) })}</button> : null}</div>
          <ul>{g.items.map((it: any) => (
            <li key={it.id}><button type="button" className="fk-link mg-ri" onClick={() => open(it)} data-testid="mg-result">{it.title}</button> <span className="fk-muted">{it.sub}</span></li>
          ))}</ul>
          {g.pagination ? <Pager compact info={g.pagination} onPage={onPage} /> : null}
        </div>
      ))}
    </div>
  );
}

function JourneyDialog({ id, onClose, nav }: { id: string; onClose: () => void; nav: (p: string) => void }) {
  const [d, setD] = useState<any>(null); const [err, setErr] = useState<string | null>(null); const [page, setPage] = useState(1);
  useEffect(() => { setErr(null); posMarketingGrowthApi.journey(id, { page, pageSize: 10 }).then(setD).catch((e) => setErr(errText(e))); }, [id, page]);
  const c = d?.customer;
  const consent = (k: 'sms' | 'email') => (d ? tx('mg.j.consent.' + d.consent[k]) : '');
  const facts: ReactNode[] = useMemo(() => (!c ? [] : [
    tx('mg.j.segment.' + c.segment), c.vip ? tx('mg.j.vip') : null, c.loyaltyTier, tx('mg.j.visits', { n: fmtNumber(c.visits) }),
    c.lastVisitAt ? tx('mg.j.lastVisit', { d: when(c.lastVisitAt) }) : null, tx('mg.j.birthday.' + c.birthday),
  ].filter(Boolean)), [c]);
  return (
    <FitDialog wide side title={c ? `${tx('mg.j.title')} · ${c.name}` : tx('mg.j.title')} subtitle={c ? [c.phone, c.email].filter(Boolean).join(' · ') : undefined} onClose={onClose} testId="mg-journey"
      footer={<>
        <button type="button" className="fk-btn ghost" onClick={onClose} data-testid="mg-j-close">{tx('mg.j.close')}</button>
        {d ? <button type="button" className="fk-btn primary" onClick={() => nav(d.booking.route)} data-testid="mg-j-book">{tx('mg.j.openBooking')}</button> : null}
      </>}>
      {err ? <div className="fk-error">{err}</div> : !d ? <Loading /> : <>
        <div className="mg-jfacts" data-testid="mg-j-facts">{facts.map((f, i) => <span key={i} className="mg-badge muted">{f}</span>)}</div>
        <div data-testid="mg-j-consent"><b>{tx('mg.j.consent')}</b> {tx('mg.j.sms')}: {consent('sms')} · {tx('mg.j.email')}: {consent('email')}</div>
        <div className="fk-hint">{d.consent.note}</div>
        {d.privacy ? <div className="fk-note" data-testid="mg-j-privacy">{d.privacy}</div> : null}
        <div className="fk-hint">{tx('mg.j.causation')}</div>
        {d.timeline.items.length === 0 ? <Empty title={tx('mg.act.empty')} /> : (
          <ul className="mg-tl-list" data-testid="mg-j-timeline">{d.timeline.items.map((r: any) => (
            <li key={r.id}><span className="fk-muted">{when(r.at)}</span> <b>{tx('mg.act.type.' + r.type)}</b> {r.title} <span className="fk-muted">{r.detail ?? ''}</span>
              {r.amountCents != null ? <span> · {fmtMoney(r.amountCents)}</span> : r.points != null ? <span> · {tx('mg.act.points', { n: fmtNumber(r.points) })}</span> : null}
              <span className="fk-muted mg-src"> · {r.source}</span></li>
          ))}</ul>
        )}
        <Pager compact info={d.timeline.pagination} onPage={setPage} />
      </>}
    </FitDialog>
  );
}
