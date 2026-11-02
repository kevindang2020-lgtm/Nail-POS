// POSAIMessageStudioScreen.tsx — AI Center → AI Marketing → Message Studio. Wired to
// POST /pos/ai-marketing/content/draft. Generates an EDITABLE draft (SMS/email/push) and surfaces the server's
// safety validation (invented offer / unknown token / raw URL / length). It never sends — drafting only.
import { useState, type CSSProperties } from 'react';
import { posAIMarketingApi } from '../api/posAIMarketingApi';
import { reportError } from './reportsCommon';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';

import { statusLabel } from '../i18n/status-label';
type Channel = 'sms' | 'email' | 'push';
type Tone = 'friendly' | 'professional' | 'warm' | 'concise';
type Validation = { ok: boolean; requiresRevision: boolean; warnings: string[]; usedTokens: string[] };
type Draft = {
  channel: Channel; text: string; validation: Validation;
  usage: { inputTokens: number; outputTokens: number; provider: string; model: string };
  hasApprovedOffer: boolean; generatedAt: string;
};

const CHANNELS: Channel[] = ['sms', 'email', 'push'];
const TONES: Tone[] = ['friendly', 'professional', 'warm', 'concise'];
const CAMPAIGN_TYPES = ['rebooking', 'inactive_customer', 'birthday', 'new_service', 'membership', 'loyalty', 'gift_card', 'seasonal'];
const LANGS = [['en', 'English'], ['es', 'Español'], ['vi', 'Tiếng Việt']];

const pill: CSSProperties = { display: 'inline-block', padding: '2px 8px', borderRadius: 999, border: '1px solid var(--line, #e6ddcd)', background: 'var(--card, #fff)', fontWeight: 600, fontSize: 12 };
const field: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 160 };
const input: CSSProperties = { padding: '6px 8px', borderRadius: 8, border: '1px solid var(--line, #e6ddcd)', background: '#fff' };

export function POSAIMessageStudioScreen() {
  const [channel, setChannel] = useState<Channel>('sms');
  const [tone, setTone] = useState<Tone>('friendly');
  const [language, setLanguage] = useState('en');
  const [campaignType, setCampaignType] = useState('rebooking');
  const [salonName, setSalonName] = useState('');
  const [serviceName, setServiceName] = useState('');
  const [useOffer, setUseOffer] = useState(false);
  const [offerName, setOfferName] = useState('');

  const [draft, setDraft] = useState<Draft | null>(null);
  const [edited, setEdited] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function generate() {
    if (!salonName.trim()) { setError(tx('pos.enter_your_salon_name_so_the_1u0w')); return; }
    setLoading(true); setError(null);
    try {
      const body: Record<string, unknown> = { channel, tone, language, campaignType, salonName, serviceName: serviceName || null };
      if (useOffer && offerName.trim()) body.offer = { name: offerName.trim() };
      const d = await posAIMarketingApi.generateDraft(body) as Draft;
      setDraft(d); setEdited(d.text || '');
    } catch (e: any) {
      setError(reportError(e, tx('growth.noun.messageStudio')));
    } finally {
      setLoading(false);
    }
  }

  const v = draft?.validation;
  return (
    <div className="work">
      <div className="vh">
        <h1>{tx('pos.message_studio')}</h1>
        <div className="sub mb-3">{tx('pos.draft_an_sms_email_or_push_djac')}</div>
      </div>

      <section className="panel">
        <div className="p-h">{tx('pos.compose')}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <label style={field}>{tx('pos.channel')}
            <select style={input} value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
              {CHANNELS.map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}
            </select>
          </label>
          <label style={field}>{tx('pos.tone')}
            <select style={input} value={tone} onChange={(e) => setTone(e.target.value as Tone)}>
              {TONES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label style={field}>{tx('pos.language')}
            <select style={input} value={language} onChange={(e) => setLanguage(e.target.value)}>
              {LANGS.map(([v2, label]) => <option key={v2} value={v2}>{label}</option>)}
            </select>
          </label>
          <label style={field}>{tx('pos.campaign_type')}
            <select style={input} value={campaignType} onChange={(e) => setCampaignType(e.target.value)}>
              {CAMPAIGN_TYPES.map((t) => <option key={t} value={t}>{statusLabel('campaignType', t)}</option>)}
            </select>
          </label>
          <label style={field}>{tx('pos.salon_name')}
            <input style={input} value={salonName} onChange={(e) => setSalonName(e.target.value)} placeholder={tx('pos.e_g_lotus_nails')} />
          </label>
          <label style={field}>{tx('pos.service_optional')}
            <input style={input} value={serviceName} onChange={(e) => setServiceName(e.target.value)} placeholder={tx('pos.e_g_gel_manicure')} />
          </label>
        </div>

       <div className="flex flex-wrap items-center justify-between gap-2.5 mt-2.5">
          <label style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={useOffer} onChange={(e) => setUseOffer(e.target.checked)} />
            {tx('pos.attach_an_approved_offer')}
          </label>
          {useOffer && (
            <input style={{ ...input, minWidth: 240, maxWidth: '100%' }} value={offerName} onChange={(e) => setOfferName(e.target.value)} placeholder={tx('pos.e_g_10_off_gel_manicure_vq4g')} />
          )}
          <button
            onClick={generate}
            disabled={loading}
            style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--gold, #A96F22)', color: '#fff', fontWeight: 700, cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.6 : 1 }}
          >
            {loading ? tx('pos.generating') : tx('pos.generate_draft')}
          </button>
        </div>
        {error && <div className="err" style={{ marginTop: 10 }}>{error}</div>}
      </section>

      {draft && (
        <section className="panel" style={{ marginTop: 12 }}>
          <div className="p-h" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{tx('pos.draft')}{draft.channel.toUpperCase()})</span>
            <span style={{ ...pill, color: v?.requiresRevision ? '#b3261e' : 'var(--ok)', borderColor: v?.requiresRevision ? '#b3261e' : 'var(--ok)' }}>
              {v?.requiresRevision ? tx('pos.needs_revision') : tx('pos.looks_clean')}
            </span>
          </div>
          <textarea
            value={edited}
            onChange={(e) => setEdited(e.target.value)}
            rows={channel === 'email' ? 10 : 4}
            style={{ ...input, width: '100%', resize: 'vertical', fontFamily: 'inherit' }}
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {draft.hasApprovedOffer && <span style={{ ...pill, color: 'var(--gold)', borderColor: 'var(--gold)' }}>{tx('pos.approved_offer_attached')}</span>}
            {(v?.usedTokens || []).map((t) => <span key={t} style={pill}>{'{{'}{t}{'}}'}</span>)}
            <span style={{ ...pill, color: 'var(--muted)' }}>{draft.usage.provider}/{draft.usage.model} · {draft.usage.inputTokens + draft.usage.outputTokens} {tx('pos.tokens')}</span>
          </div>
          {v && v.warnings.length > 0 && (
            <ul style={{ marginTop: 10, paddingLeft: 18, color: v.requiresRevision ? '#b3261e' : 'var(--muted)' }}>
              {v.warnings.map((w, i) => <li key={i} style={{ fontSize: 13 }}>{w}</li>)}
            </ul>
          )}
          <div className="sub" style={{ marginTop: 8, fontSize: 12 }}>{tx('pos.required_opt_out_text_is_appended_6p4p')}</div>
        </section>
      )}
    </div>
  );
}
