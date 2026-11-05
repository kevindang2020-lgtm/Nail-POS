// POSAICampaignBuilderScreen.tsx — AI Center → AI Marketing → Campaign Builder (spec §39). A guided workflow
// that CONNECTS the existing endpoints: audience preview → draft generation → submit (creates a draft campaign
// + persists the send plan) → approve (schedules it). It never sends — approval only schedules; the gated
// worker sends. Nothing here bypasses consent, invents an offer, or uses free-form audience queries.
import { useState, type CSSProperties } from 'react';
import { posAIMarketingApi } from '../api/posAIMarketingApi';
import { reportError } from './reportsCommon';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { fmtDateTime } from '../i18n/format';
import { growthCode } from './growthLabels';

import { statusLabel } from '../i18n/status-label';
type Channel = 'sms' | 'email' | 'push';
type Preview = { total: number; eligible: number; suppressed: number; breakdown: { missingContact: number; optedOut: number } };
type Draft = { text: string; validation: { requiresRevision: boolean; warnings: string[] } };

const field: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 160 };
const input: CSSProperties = { padding: '6px 8px', borderRadius: 8, border: '1px solid var(--line, #e6ddcd)', background: '#fff' };
const btn = (primary = true): CSSProperties => ({ padding: '8px 16px', borderRadius: 8, border: primary ? 'none' : '1px solid var(--line, #e6ddcd)', background: primary ? 'var(--gold, #A96F22)' : '#fff', color: primary ? '#fff' : 'inherit', fontWeight: 700, cursor: 'pointer' });
const n = (x: number) => (x || 0).toLocaleString('en-US');

const STEPS = (): string[] => [tx('growth.campaign.step.goal'), tx('growth.campaign.step.audience'), tx('growth.campaign.step.message'), tx('growth.campaign.step.offer'), tx('growth.campaign.step.schedule'), tx('growth.campaign.step.review')];

export function POSAICampaignBuilderScreen() {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // goal
  const [name, setName] = useState('');
  const [campaignType, setCampaignType] = useState('rebooking');
  // audience
  const [channel, setChannel] = useState<Channel>('sms');
  const [minDays, setMinDays] = useState<number | null>(90);
  const [excludeFuture, setExcludeFuture] = useState(true);
  const [activeOnly, setActiveOnly] = useState(true);
  const [preview, setPreview] = useState<Preview | null>(null);
  // message
  const [salonName, setSalonName] = useState('');
  const [serviceName, setServiceName] = useState('');
  const [draftText, setDraftText] = useState('');
  const [draftWarn, setDraftWarn] = useState<string[]>([]);
  // offer
  const [useOffer, setUseOffer] = useState(false);
  const [offerName, setOfferName] = useState('');
  // schedule
  const [scheduledLocal, setScheduledLocal] = useState('');
  // result
  const [, setSubmitted] = useState<{ id: string; status: string } | null>(null);
  const [approved, setApproved] = useState<{ status: string; scheduledAt: string } | null>(null);

  const audienceDefinition = () => ({ channel: channel === 'push' ? 'sms' : channel, minDaysSinceLastCompletedVisit: minDays, excludeWithFutureAppointment: excludeFuture, requireActiveStatus: activeOnly });
  const audienceLabel = () => [channel.toUpperCase(), minDays == null ? tx('pos.any_recency') : tx('pos.mindays_days', { minDays: String(minDays) }), excludeFuture ? tx('pos.excl_upcoming') : null, activeOnly ? tx('pos.active_only_2') : null].filter(Boolean).join(' · ');

  async function runPreview() {
    setBusy(true); setError(null);
    try { setPreview(await posAIMarketingApi.previewAudience(audienceDefinition()) as Preview); }
    catch (e: any) { setError(reportError(e, tx('growth.noun.audience'))); }
    finally { setBusy(false); }
  }
  async function generate() {
    if (!salonName.trim()) { setError(tx('pos.enter_your_salon_name')); return; }
    setBusy(true); setError(null);
    try {
      const body: Record<string, unknown> = { channel, tone: 'friendly', language: 'en', campaignType, salonName, serviceName: serviceName || null };
      if (useOffer && offerName.trim()) body.offer = { name: offerName.trim() };
      const d = await posAIMarketingApi.generateDraft(body) as Draft;
      setDraftText(d.text || ''); setDraftWarn(d.validation?.warnings || []);
    } catch (e: any) { setError(reportError(e, tx('growth.noun.messageStudio'))); }
    finally { setBusy(false); }
  }
  async function submitAndApprove() {
    setBusy(true); setError(null);
    try {
      const body: Record<string, unknown> = {
        name, channel, draftText, audienceLabel: audienceLabel(), audienceSize: preview?.eligible || 0,
        audienceDefinition: audienceDefinition(), messageVersion: 1,
      };
      if (useOffer && offerName.trim()) body.offer = { name: offerName.trim() };
      const res = await posAIMarketingApi.submitCampaign(body) as { campaign: { id: string; status: string } };
      setSubmitted({ id: res.campaign.id, status: res.campaign.status });
      const iso = new Date(scheduledLocal).toISOString();
      const appr = await posAIMarketingApi.approveCampaign(res.campaign.id, iso) as { status: string; scheduledAt: string };
      setApproved({ status: appr.status, scheduledAt: appr.scheduledAt });
    } catch (e: any) { setError(reportError(e, tx('growth.noun.campaign'))); }
    finally { setBusy(false); }
  }

  const canNext = () => {
    if (step === 0) return name.trim().length > 0;
    if (step === 1) return !!preview && preview.eligible > 0;
    if (step === 2) return draftText.trim().length > 0;
    if (step === 4) return !!scheduledLocal && new Date(scheduledLocal).getTime() > Date.now();
    return true;
  };

  return (
    <div className="work">
      <div className="vh">
        <h1>{tx('pos.campaign_builder')}</h1>
        <div className="sub mb-3">{tx('pos.build_a_campaign_step_by_step_1rqf')}</div>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
        {STEPS().map((s, i) => (
          <span key={s} style={{ padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, background: i === step ? 'var(--gold, #A96F22)' : 'var(--card, #fff)', color: i === step ? '#fff' : 'var(--muted)', border: '1px solid var(--line, #e6ddcd)' }}>{i + 1}. {s}</span>
        ))}
      </div>

      <section className="panel">
        {step === 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <label style={{ ...field, minWidth: 260, maxWidth: '100%' }}>{tx('pos.campaign_name')}
              <input style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder={tx('pos.e_g_july_gel_rebooking')} />
            </label>
            <label style={field}>{tx('pos.goal')}
              <select style={input} value={campaignType} onChange={(e) => setCampaignType(e.target.value)}>
                {['rebooking', 'inactive_customer', 'birthday', 'new_service', 'membership', 'loyalty', 'gift_card', 'seasonal'].map((t) => <option key={t} value={t}>{statusLabel('campaignType', t)}</option>)}
              </select>
            </label>
          </div>
        )}

        {step === 1 && (
          <div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <label style={field}>{tx('pos.channel')}<select style={input} value={channel} onChange={(e) => setChannel(e.target.value as Channel)}><option value="sms">SMS</option><option value="email">{tx('pos.email')}</option><option value="push">{tx('pos.push')}</option></select></label>
              <label style={field}>{tx('pos.last_visit')}<select style={input} value={minDays == null ? '' : String(minDays)} onChange={(e) => setMinDays(e.target.value === '' ? null : Number(e.target.value))}><option value="">{tx('pos.any')}</option><option value="42">{tx('pos.42_days')}</option><option value="60">{tx('pos.60_days')}</option><option value="90">{tx('pos.90_days')}</option><option value="180">{tx('pos.180_days')}</option></select></label>
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 10, flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={excludeFuture} onChange={(e) => setExcludeFuture(e.target.checked)} />{tx('pos.exclude_upcoming_appointments')}</label>
              <label style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />{tx('pos.active_customers_only')}</label>
              <button style={btn(false)} onClick={runPreview} disabled={busy}>{busy ? tx('pos.estimating') : tx('pos.estimate_audience')}</button>
            </div>
            {preview && (
              <div className="kpis" style={{ marginTop: 10 }}>
                <div className="kpi"><div className="l">{tx('pos.eligible')}</div><div className="v" style={{ color: 'var(--ok)' }}>{n(preview.eligible)}</div></div>
                <div className="kpi"><div className="l">{tx('pos.excluded')}</div><div className="v" style={{ color: 'var(--muted)' }}>{n(preview.suppressed)}</div></div>
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <label style={field}>{tx('pos.salon_name')}<input style={input} value={salonName} onChange={(e) => setSalonName(e.target.value)} placeholder={tx('pos.e_g_lotus_nails')} /></label>
              <label style={field}>{tx('pos.service_optional')}<input style={input} value={serviceName} onChange={(e) => setServiceName(e.target.value)} placeholder={tx('pos.e_g_gel_manicure')} /></label>
              <button style={{ ...btn(false), alignSelf: 'end' }} onClick={generate} disabled={busy}>{busy ? tx('pos.generating') : tx('pos.generate_draft')}</button>
            </div>
            <textarea value={draftText} onChange={(e) => setDraftText(e.target.value)} rows={channel === 'email' ? 8 : 4} placeholder={tx('pos.write_or_generate_the_message_use_1w0k')} style={{ ...input, width: '100%', marginTop: 10, resize: 'vertical' }} />
            {draftWarn.length > 0 && <ul style={{ marginTop: 8, paddingLeft: 18, color: 'var(--muted)' }}>{draftWarn.map((w, i) => <li key={i} style={{ fontSize: 12 }}>{w}</li>)}</ul>}
          </div>
        )}

        {step === 3 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={useOffer} onChange={(e) => setUseOffer(e.target.checked)} />{tx('pos.attach_an_approved_offer')}</label>
            {useOffer && <input style={{ ...input, minWidth: 260, maxWidth: '100%' }} value={offerName} onChange={(e) => setOfferName(e.target.value)} placeholder={tx('pos.e_g_10_off_gel_manicure_vq4g')} />}
            {!useOffer && <span className="sub" style={{ fontSize: 12 }}>{tx('pos.no_offer_the_message_will_contain_1k8f')}</span>}
          </div>
        )}

        {step === 4 && (
          <label style={field}>{tx('pos.send_at')}
            <input type="datetime-local" style={input} value={scheduledLocal} onChange={(e) => setScheduledLocal(e.target.value)} />
            <span className="sub" style={{ fontSize: 12 }}>{tx('pos.must_be_in_the_future_quiet_ns4a')}</span>
          </label>
        )}

        {step === 5 && (
          <div>
            {!approved ? (
              <>
                <div className="overflow-x-auto w-full"><table className="tbl w-full min-w-max"><tbody>
                  <tr><td>{tx('pos.name')}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{name || '—'}</td></tr>
                  <tr><td>{tx('pos.audience')}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{audienceLabel()} · {n(preview?.eligible || 0)} {tx('pos.eligible_2')}</td></tr>
                  <tr><td>{tx('pos.channel')}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{channel.toUpperCase()}</td></tr>
                  <tr><td>{tx('pos.offer')}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{useOffer && offerName ? offerName : tx('pos.none')}</td></tr>
                  <tr><td>{tx('pos.send_at')}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{scheduledLocal ? new Date(scheduledLocal).toLocaleString() : '—'}</td></tr>
                </tbody></table></div>
                <div className="sub" style={{ margin: '8px 0', fontSize: 12 }}>{tx('pos.submitting_creates_a_draft_and_schedules_14fh')}</div>
                <button style={btn()} onClick={submitAndApprove} disabled={busy}>{busy ? tx('pos.submitting') : tx('pos.submit_schedule')}</button>
              </>
            ) : (
              <div className="state">
                {tx('pos.campaign')}{' '}<strong>{name}</strong> {tx('pos.is')}{' '}<strong>{growthCode(approved.status)}</strong> {tx('pos.for')}{' '}{fmtDateTime(approved.scheduledAt)}{tx('pos.it_will_send_through_the_gated_it32')}
              </div>
            )}
          </div>
        )}

        {error && <div className="err" style={{ marginTop: 10 }}>{error}</div>}

        {!approved && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14 }}>
            <button style={btn(false)} onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0 || busy}>{tx('pos.back')}</button>
            {step < STEPS().length - 1 && <button style={btn()} onClick={() => canNext() ? setStep((s) => s + 1) : setError(tx('pos.complete_this_step_first'))} disabled={busy}>{tx('pos.next')}</button>}
          </div>
        )}
      </section>
    </div>
  );
}
