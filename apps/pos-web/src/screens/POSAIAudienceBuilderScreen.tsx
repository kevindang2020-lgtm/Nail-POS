// POSAIAudienceBuilderScreen.tsx — AI Center → AI Marketing → Audience Builder. Wired to
// POST /pos/ai-marketing/audience/preview. AGGREGATE-ONLY: it shows how many customers match (eligible) and how
// many are excluded and why (opted out / no usable contact) — never a list of customer rows. Only the approved
// audience dimensions are offered; there is no free-form query.
import { useState, type CSSProperties } from 'react';
import { posAIMarketingApi } from '../api/posAIMarketingApi';
import { reportError } from './reportsCommon';
import { t } from '@aipowersalon/mobile-sdk/i18n';
import { displayLocale } from '../i18n/format';

type Channel = 'sms' | 'email';
type Preview = {
  channel: Channel; total: number; eligible: number; suppressed: number;
  breakdown: { missingContact: number; optedOut: number };
  definitionEcho: Record<string, unknown>; generatedAt: string;
};

// option labels translate when read; month names come from the POS language (Intl)
const RECENCY = (): [string, number | null][] => [[t('growth.audience.recency.any'), null], ...[42, 60, 90, 180].map((n) => [t('growth.audience.recency.days', { n: String(n) }), n] as [string, number])];
const MONTHS = (): string[] => [t('growth.audience.month.none'), t('growth.audience.month.current'), ...Array.from({ length: 12 }, (_, i) => new Intl.DateTimeFormat(displayLocale(), { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, i, 15))))];

const field: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4, minWidth: 160 };
const input: CSSProperties = { padding: '6px 8px', borderRadius: 8, border: '1px solid var(--line, #e6ddcd)', background: '#fff' };
const n = (x: number) => (x || 0).toLocaleString('en-US');

export function POSAIAudienceBuilderScreen() {
  const [channel, setChannel] = useState<Channel>('sms');
  const [minDays, setMinDays] = useState<number | null>(90);
  const [excludeFuture, setExcludeFuture] = useState(true);
  const [activeOnly, setActiveOnly] = useState(true);
  const [birthday, setBirthday] = useState(0); // 0 none, 1 current, 2..13 → month 1..12

  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true); setError(null);
    try {
      const def: Record<string, unknown> = {
        channel,
        minDaysSinceLastCompletedVisit: minDays,
        excludeWithFutureAppointment: excludeFuture,
        requireActiveStatus: activeOnly,
      };
      if (birthday === 1) def.birthdayMonth = 'current';
      else if (birthday >= 2) def.birthdayMonth = birthday - 1;
      const p = await posAIMarketingApi.previewAudience(def) as Preview;
      setPreview(p);
    } catch (e: any) {
      setError(reportError(e, t('growth.noun.audienceBuilder')));
    } finally {
      setLoading(false);
    }
  }

  const pct = preview && preview.total > 0 ? Math.round((preview.eligible / preview.total) * 100) : 0;

  return (
    <div className="work">
      <div className="vh">
        <h1>{t('pos.audience_builder')}</h1>
        <div className="sub mb-3">{t('pos.estimate_who_would_receive_a_campaign_gfxe')}</div>
      </div>

      <section className="panel">
        <div className="p-h">{t('pos.filters')}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <label style={field}>{t('pos.channel')}
            <select style={input} value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
              <option value="sms">SMS</option>
              <option value="email">{t('pos.email')}</option>
            </select>
          </label>
          <label style={field}>{t('pos.last_visit')}
            <select style={input} value={minDays == null ? '' : String(minDays)} onChange={(e) => setMinDays(e.target.value === '' ? null : Number(e.target.value))}>
              {RECENCY().map(([label, val]) => <option key={label} value={val == null ? '' : String(val)}>{label}</option>)}
            </select>
          </label>
          <label style={field}>{t('pos.birthday')}
            <select style={input} value={birthday} onChange={(e) => setBirthday(Number(e.target.value))}>
              {MONTHS().map((m, i) => <option key={i} value={i}>{m}</option>)}
            </select>
          </label>
        </div>
       <div className="flex flex-wrap items-center justify-between gap-2.5 mt-2.5">
        <div className=" flex gap-2 flex-col sm:flex-row">
          <label style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={excludeFuture} onChange={(e) => setExcludeFuture(e.target.checked)} />
            {t('pos.exclude_customers_with_an_upcoming_appointment')}
          </label>
          <label style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
            {t('pos.active_customers_only')}
          </label></div>
          <button
            onClick={run}
            disabled={loading}
            style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--gold, #A96F22)', color: '#fff', fontWeight: 700, cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.6 : 1 }}
          >
            {loading ? t('pos.estimating') : t('pos.estimate_audience')}
          </button>
        </div>
        {error && <div className="err" style={{ marginTop: 10 }}>{error}</div>}
      </section>

      {preview && (
        <section className="panel" style={{ marginTop: 12 }}>
          <div className="p-h">{t('pos.estimate')}{preview.channel.toUpperCase()})</div>
          <div className="kpis">
            <div className="kpi"><div className="l">{t('pos.eligible_to_send')}</div><div className="v" style={{ color: 'var(--ok)' }}>{n(preview.eligible)}</div></div>
            <div className="kpi"><div className="l">{t('pos.matched_filters')}</div><div className="v">{n(preview.total)}</div></div>
            <div className="kpi"><div className="l">{t('pos.excluded')}</div><div className="v" style={{ color: 'var(--muted)' }}>{n(preview.suppressed)}</div></div>
          </div>
          <div style={{ height: 10, borderRadius: 999, background: 'var(--line, #e6ddcd)', overflow: 'hidden', margin: '10px 0' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: 'var(--gold, #A96F22)' }} />
          </div>
          <div className="overflow-x-auto w-full"><table className="tbl w-full min-w-max">
            <tbody>
              <tr><td>{t('pos.opted_out_suppressed')}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{n(preview.breakdown.optedOut)}</td></tr>
              <tr><td>{t('pos.no_usable')}{' '}{preview.channel === 'email' ? 'email' : 'phone'}</td><td style={{ textAlign: 'right', fontWeight: 700 }}>{n(preview.breakdown.missingContact)}</td></tr>
            </tbody>
          </table></div>
          <div className="sub" style={{ marginTop: 8, fontSize: 12 }}>{t('pos.consent_suppression_and_contact_validity_are_136a')}</div>
        </section>
      )}
    </div>
  );
}
