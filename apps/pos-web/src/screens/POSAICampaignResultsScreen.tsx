// POSAICampaignResultsScreen.tsx — AI Center → AI Marketing → Campaign Results. Lists the tenant's campaigns
// (from the existing Campaign Center state) and, on selection, shows the per-campaign funnel from
// GET /pos/ai-marketing/campaigns/:id/results. Revenue is labeled ASSOCIATED (correlation), and rates/
// cost-per-booking render em-dash when their denominator is zero — matching the honest server contract.
import { useEffect, useState, type CSSProperties } from 'react';
import { posCampaignsApi } from '../api/posCampaignsApi';
import { posAIMarketingApi } from '../api/posAIMarketingApi';
import { reportError, money } from './reportsCommon';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { growthCode } from './growthLabels';

type CampaignLite = { id: string; name: string; status: string; channel: string };
type Results = {
  campaignId: string; name: string; status: string; channel: string; audienceSize: number;
  funnel: { sent: number; opened: number; clicked: number; booked: number };
  rates: { openRate: number | null; clickRate: number | null; bookingRate: number | null };
  costCents: number; associatedRevenueCents: number;
  costPerBookingCents: number | null; revenuePerSentCents: number | null;
  disclaimer: string; generatedAt: string;
};

const n = (x: number) => (x || 0).toLocaleString('en-US');
const rate = (r: number | null) => (r == null ? '—' : `${(r * 100).toFixed(1)}%`);
const cents = (c: number | null) => (c == null ? '—' : money(c));
const row: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', borderRadius: 8, cursor: 'pointer', border: '1px solid var(--line, #e6ddcd)', marginBottom: 6 };

export function POSAICampaignResultsScreen() {
  const [campaigns, setCampaigns] = useState<CampaignLite[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [results, setResults] = useState<Results | null>(null);
  const [resError, setResError] = useState<string | null>(null);
  const [resLoading, setResLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const s = await posCampaignsApi.getState() as { campaigns: CampaignLite[] };
        if (alive) setCampaigns(s.campaigns || []);
      } catch (e: any) {
        if (alive) setListError(reportError(e, t('growth.noun.campaigns')));
      }
    })();
    return () => { alive = false; };
  }, []);

  async function open(id: string) {
    setSelected(id); setResults(null); setResError(null); setResLoading(true);
    try {
      const r = await posAIMarketingApi.campaignResults(id) as Results;
      setResults(r);
    } catch (e: any) {
      setResError(reportError(e, t('growth.noun.campaignResults')));
    } finally {
      setResLoading(false);
    }
  }

  return (
    <div className="work">
      <div className="vh">
        <h1>{t('pos.campaign_results')}</h1>
        <div className="sub mb-3">{t('pos.pick_a_campaign_to_see_its_1cf0')}</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[2fr_1fr] gap-3">
        <section className="panel" style={{ minWidth: 0 }}>
          <div className="p-h">{t('pos.campaigns')}</div>
          {listError && <div className="err">{listError}</div>}
          {!listError && campaigns == null && <div className="state">{t('pos.loading_campaigns')}</div>}
          {campaigns && campaigns.length === 0 && <div className="state">{t('pos.no_campaigns_yet_create_one_from_1xzf')}</div>}
          {campaigns && campaigns.map((c) => (
            <div key={c.id} style={{ ...row, background: selected === c.id ? 'var(--card, #fff)' : 'transparent', borderColor: selected === c.id ? 'var(--gold, #A96F22)' : 'var(--line, #e6ddcd)' }} onClick={() => open(c.id)}>
              <span style={{ fontWeight: 600 }}>{c.name}</span>
              <span className="sub" style={{ fontSize: 12 }}>{growthCode(c.channel).toUpperCase()} · {growthCode(c.status)}</span>
            </div>
          ))}
        </section>

        <section className="panel" style={{ minWidth: 0 }}>
          <div className="p-h">{t('pos.results')}</div>
          {!selected && <div className="state">{t('pos.select_a_campaign_to_view_its_exuc')}</div>}
          {selected && resLoading && <div className="state">{t('pos.loading_results')}</div>}
          {selected && resError && <div className="err">{resError}</div>}
          {selected && results && (
            <>
              <div className="kpis">
                <div className="kpi"><div className="l">{t('pos.sent')}</div><div className="v">{n(results.funnel.sent)}</div></div>
                <div className="kpi"><div className="l">{t('pos.clicked')}</div><div className="v">{n(results.funnel.clicked)}</div></div>
                <div className="kpi"><div className="l">{t('pos.booked')}</div><div className="v">{n(results.funnel.booked)}</div></div>
                <div className="kpi"><div className="l">{t('pos.assoc_revenue')}</div><div className="v">{money(results.associatedRevenueCents)}</div></div>
              </div>
              <div className="overflow-x-auto w-full"><table className="tbl w-full min-w-max" style={{ marginTop: 8 }}>
                <tbody>
                  <tr><td>{t('pos.open_rate')}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{rate(results.rates.openRate)}</td></tr>
                  <tr><td>{t('pos.click_rate')}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{rate(results.rates.clickRate)}</td></tr>
                  <tr><td>{t('pos.booking_rate')}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{rate(results.rates.bookingRate)}</td></tr>
                  <tr><td>{t('pos.cost_booking')}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{cents(results.costPerBookingCents)}</td></tr>
                  <tr><td>{t('pos.message_cost')}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{money(results.costCents)}</td></tr>
                </tbody>
              </table></div>
              <div className="sub" style={{ marginTop: 8, fontSize: 12 }}>{results.disclaimer}</div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
