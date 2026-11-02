
// POSAIMarketingScreen.tsx — AI Center → AI Marketing Assistant (Command Center). Wired to
// GET /pos/ai-marketing/state (permission-gated pos.marketing.view). Read-only: shows campaign KPIs from real
// data and AI campaign recommendations derived from real audiences. It sends nothing and invents nothing —
// recommendations that need an offer are badged "Needs approved offer"; associated revenue is labeled as
// association, never causation; cost/booking renders em-dash when there are no bookings.
import { useEffect, useState, type CSSProperties } from 'react';
import { displayLocale } from '../i18n/format';
import { posAIMarketingApi } from '../api/posAIMarketingApi';
import { reportError, money } from './reportsCommon';
import { t } from '@aipowersalon/mobile-sdk/i18n';

type Summary = {
  activeCampaigns: number; scheduledCampaigns: number; draftCampaigns: number; completedCampaigns: number;
  messagesSent: number; bookingsAttributed: number; revenueAssociatedCents: number; messageCostCents: number;
  costPerBookingCents: number | null; suppressedContacts: number; optedInSms: number; optedInEmail: number;
  generatedAt: string;
};
type Recommendation = {
  type: string; title: string; goal: string; evidence: string; audienceEstimate: number; suppressedEstimate: number;
  branchScope: 'branch' | 'tenant'; suggestedChannel: 'sms' | 'email' | 'push'; requiresOffer: boolean;
  offer: null; risks: string[]; confidence: 'low' | 'medium' | 'high'; supportingMetric: string;
};
type State = { summary: Summary; recommendations: Recommendation[]; freshness: { generatedAt: string; source: string } };

const n = (v: number) => (v || 0).toLocaleString('en-US');
const fmtDate = (iso?: string) => { if (!iso) return '—'; try { return new Date(iso).toLocaleString(displayLocale(), { month: 'short', day: '2-digit', hour: 'numeric', minute: '2-digit' }); } catch { return iso; } };
const confColor = (c: string) => (c === 'high' ? 'var(--ok)' : c === 'medium' ? 'var(--gold)' : 'var(--muted)');
const pill: CSSProperties = { display: 'inline-block', padding: '2px 8px', borderRadius: 999, border: '1px solid var(--line, #e6ddcd)', background: 'var(--card, #fff)', fontWeight: 600 };

export function POSAIMarketingScreen() {
  const [s, setS] = useState<State | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true; setLoading(true); setError(null);
    (async () => {
      try { const d = await posAIMarketingApi.state() as State; if (alive) setS(d); }
      catch (e: any) { if (alive) setError(reportError(e, t('growth.noun.aiMarketing'))); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  if (loading) return <div className="work"><div className="state">{t('pos.loading_ai_marketing')}</div></div>;
  if (error) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error}</div></div>;
  if (!s) return <div className="work"><div className="state">{t('pos.no_ai_marketing_data')}</div></div>;

  const k = s.summary;
  const recs = s.recommendations || [];
  const costPerBooking = k.costPerBookingCents == null ? '—' : money(k.costPerBookingCents);

  return (
    <div className="work">
      <div className="vh">
        <h1>{t('pos.ai_marketing_assistant')}</h1>
        <div className="sub mb-3">{t('pos.campaign_recommendations_from_your_real_customer_1x3i')}</div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-3 mb-4">
        <div className="panel" style={{ padding: '16px' }}><div className="sub" style={{ fontSize: 12 }}>{t('pos.active_campaigns')}</div><div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{n(k.activeCampaigns)}</div></div>
        <div className="panel" style={{ padding: '16px' }}><div className="sub" style={{ fontSize: 12 }}>{t('pos.scheduled')}</div><div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{n(k.scheduledCampaigns)}</div></div>
        <div className="panel" style={{ padding: '16px' }}><div className="sub" style={{ fontSize: 12 }}>{t('pos.drafts')}</div><div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{n(k.draftCampaigns)}</div></div>
        <div className="panel" style={{ padding: '16px' }}><div className="sub" style={{ fontSize: 12 }}>{t('pos.messages_sent')}</div><div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{n(k.messagesSent)}</div></div>
        <div className="panel" style={{ padding: '16px' }}><div className="sub" style={{ fontSize: 12 }}>{t('pos.bookings_2')}</div><div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{n(k.bookingsAttributed)}</div></div>
        <div className="panel" style={{ padding: '16px' }}><div className="sub" style={{ fontSize: 12 }}>{t('pos.associated_rev')}</div><div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{money(k.revenueAssociatedCents)}</div></div>
        <div className="panel" style={{ padding: '16px' }}><div className="sub" style={{ fontSize: 12 }}>{t('pos.cost_booking_2')}</div><div style={{ fontSize: 24, fontWeight: 800, marginTop: 4 }}>{costPerBooking}</div></div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_2fr] gap-4">
        <section className="panel">
          <div className="p-h">{t('pos.reach_consent')}</div>
          <div className="overflow-x-auto w-full"><table className="tbl w-full min-w-max">
            <tbody>
              <tr><td>{t('pos.opted_in_to_sms')}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{n(k.optedInSms)}</td></tr>
              <tr><td>{t('pos.opted_in_to_email')}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{n(k.optedInEmail)}</td></tr>
              <tr><td>{t('pos.suppressed_opted_out')}</td><td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--muted)' }}>{n(k.suppressedContacts)}</td></tr>
              <tr><td>{t('pos.message_cost_to_date')}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{money(k.messageCostCents)}</td></tr>
            </tbody>
          </table></div>
          <div className="sub" style={{ marginTop: 8, fontSize: 12 }}>{t('pos.as_of')}{' '}{fmtDate(s.freshness?.generatedAt)}{t('pos.revenue_is')}{' '}<em>{t('pos.associated_with')}</em> {t('pos.campaign_bookings_not_a_causal_claim')}</div>
        </section>

        <section className="panel" style={{ minWidth: 0 }}>
          <div className="p-h">{t('pos.recommended_campaigns')}</div>
          {recs.length === 0 ? (
            <div className="state">{t('pos.no_campaign_opportunities_right_now_recommendations_111n')}</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {recs.map((r) => (
                <div key={r.type} className="panel" style={{ padding: 12, background: 'var(--card, #fff)' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                    <div style={{ fontWeight: 800 }}>{r.title}</div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: confColor(r.confidence) }}>{r.confidence} {t('pos.confidence')}</div>
                  </div>
                  <div className="sub" style={{ margin: '4px 0' }}>{r.goal}</div>
                  <div style={{ fontSize: 13 }}>{r.evidence}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8, fontSize: 12 }}>
                    <span style={pill}>{n(r.audienceEstimate)} {t('pos.eligible_2')}</span>
                    <span style={{ ...pill, color: 'var(--muted)' }}>{n(r.suppressedEstimate)} {t('pos.excluded_2')}</span>
                    <span style={pill}>{r.suggestedChannel.toUpperCase()}</span>
                    <span style={pill}>{r.branchScope === 'branch' ? t('pos.this_branch') : t('pos.all_branches_2')}</span>
                    {r.requiresOffer && <span style={{ ...pill, color: 'var(--gold)', fontWeight: 700, borderColor: 'var(--gold)' }}>{t('pos.needs_approved_offer')}</span>}
                  </div>
                  {r.risks && r.risks.length > 0 && (
                    <div className="sub" style={{ marginTop: 6, fontSize: 12 }}>{t('pos.note_2')}{' '}{r.risks.join(' ')}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
