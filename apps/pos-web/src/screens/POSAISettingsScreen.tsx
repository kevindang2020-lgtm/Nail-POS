// POSAISettingsScreen.tsx — AI Receptionist Settings (spec Page 9). Persists ONLY receptionist-level settings; for
// booking rules and notification preferences it links to their existing screens rather than duplicating them (those
// remain the source of truth). Recording defaults to off with a consent message field; nothing legal is asserted.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { posAiApi, type ReceptionistSettings } from '../api/posAiApi';
import { t } from '@aipowersalon/mobile-sdk/i18n';

const cardBox: React.CSSProperties = { background: '#FFFCF6', border: '1px solid var(--line)', borderRadius: 14, padding: 14 };
const headStyle: React.CSSProperties = { fontWeight: 800, fontSize: 13.5, marginBottom: 10, fontFamily: 'var(--aps-font-head, Playfair Display)' };
const GOLD = '#A96F22';
const inputStyle: React.CSSProperties = { height: 32, padding: '0 10px', borderRadius: 8, border: '1px solid var(--line)', background: '#fff', fontSize: 13, fontFamily: 'inherit' };
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', color: GOLD, fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0, fontFamily: 'inherit' };

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, fontSize: 13, cursor: 'pointer', padding: '6px 0' }}>
      <span onClick={() => onChange(!checked)} style={{ width: 38, height: 22, borderRadius: 999, background: checked ? GOLD : '#D8CDBB', position: 'relative', transition: 'background .15s', flexShrink: 0 }}>
        <span style={{ position: 'absolute', top: 2, left: checked ? 18 : 2, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left .15s' }} />
      </span>
      {label}
    </label>
  );
}
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '6px 0', fontSize: 13 }}><span style={{ width: '100%', maxWidth: 200, color: '#515050' }}>{label}</span>{children}</div>;
}

export function POSAISettingsScreen() {
  const nav = useNavigate();
  const [s, setS] = useState<ReceptionistSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { posAiApi.receptionistSettings().then(setS).catch((e: any) => setError(e?.message || t('pos.failed_to_load_settings'))); }, []);

  const set = (patch: Partial<ReceptionistSettings>) => { setS((cur) => cur ? { ...cur, ...patch } : cur); setSaved(false); };
  const save = async () => {
    if (!s) return; setBusy(true); setError(null);
    try {
      const next = await posAiApi.updateReceptionistSettings({ enabled: s.enabled, defaultLanguage: s.defaultLanguage, afterHoursBehavior: s.afterHoursBehavior, allowInterruptions: s.allowInterruptions, silenceTimeoutSeconds: s.silenceTimeoutSeconds, maxCallDurationSeconds: s.maxCallDurationSeconds, recordingEnabled: s.recordingEnabled, recordingConsentMessage: s.recordingConsentMessage });
      setS(next); setSaved(true);
    } catch (e: any) { setError(e?.message || t('pos.could_not_save_settings')); }
    finally { setBusy(false); }
  };

  if (error && !s) return <div className="work"><div className="err">{error}</div></div>;
  if (!s) return <div className="work"><div className="state">{t('pos.loading_settings_u2026')}</div></div>;

  return (
    <div className="work" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="vh flex flex-col sm:flex-row gap-3 justify-between">
        <div>
        <div>
          <h1>{t('pos.settings')}</h1>
        <div className="sub mb-3">{t('pos.receptionist_behavior_booking_and_notification_rules_1txb')}</div>
        </div></div>
        <div style={{ alignSelf: 'center', display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          {saved ? <span style={{ fontSize: 12, color: '#3E8F57' }}>{t('pos.saved')}</span> : null}
          <button className="btn w-fit whitespace-nowrap"  disabled={busy} onClick={save}>{busy ? t('pos.saving_2') : t('pos.save_changes')}</button>
        </div>
      </div>
      {error ? <div className="err">{error}</div> : null}

      <section style={cardBox}>
        <div style={headStyle}>{t('pos.general')}</div>
        <Toggle label={t('pos.enable_ai_receptionist')} checked={s.enabled} onChange={(v) => set({ enabled: v })} />
        {/* Kevin (Oct 28 2026): the AI receptionist speaks English only — callers are the salon's customers */}
        <Row label={t('pos.default_language')}><span data-testid="ai-receptionist-language">{t('growth.aiReceptionist.englishOnly')}</span></Row>
        <Row label={t('pos.after_hours_behavior')}><select style={inputStyle} value={s.afterHoursBehavior} onChange={(e) => set({ afterHoursBehavior: e.target.value as ReceptionistSettings['afterHoursBehavior'] })}><option value="ai_answers">{t('pos.ai_answers')}</option><option value="handoff">{t('pos.hand_off_to_human')}</option><option value="voicemail">{t('pos.voicemail')}</option></select></Row>
      </section>

      <section style={cardBox}>
        <div style={headStyle}>{t('pos.conversation')}</div>
        <Toggle label={t('pos.allow_caller_to_interrupt')} checked={s.allowInterruptions} onChange={(v) => set({ allowInterruptions: v })} />
        <Row label={t('pos.silence_timeout_seconds')}><input type="number" min={2} max={30} style={{ ...inputStyle, width: 90 }} value={s.silenceTimeoutSeconds} onChange={(e) => set({ silenceTimeoutSeconds: Number(e.target.value) })} /></Row>
        <Row label={t('pos.max_call_duration_seconds')}><input type="number" min={60} max={3600} style={{ ...inputStyle, width: 90 }} value={s.maxCallDurationSeconds} onChange={(e) => set({ maxCallDurationSeconds: Number(e.target.value) })} /></Row>
      </section>

      <section style={cardBox}>
        <div style={headStyle}>{t('pos.recording_consent')}</div>
        <Toggle label={t('pos.enable_call_recording')} checked={s.recordingEnabled} onChange={(v) => set({ recordingEnabled: v })} />
        <label style={{ fontSize: 12, display: 'block', marginTop: 8 }}>{t('pos.consent_message_played_to_callers')}<textarea style={{ ...inputStyle, width: '100%', height: 52, padding: 8 }} value={s.recordingConsentMessage} onChange={(e) => set({ recordingConsentMessage: e.target.value })} /></label>
        <div style={{ fontSize: 11.5, color: '#9B6B1E', marginTop: 6 }}>{t('pos.recording_activates_only_when_a_provider_2g59')}</div>
      </section>

      <section style={cardBox}>
        <div style={headStyle}>{t('pos.uses_your_existing_settings')}</div>
        <div style={{ fontSize: 12, color: '#8A7A66', marginBottom: 8 }}>{t('pos.the_receptionist_reads_these_from_their_2ar9')}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          <button style={linkBtn} onClick={() => nav('/settings?section=booking-appointments')}>{t('pos.booking_rules_u2192')}</button>
          <button style={linkBtn} onClick={() => nav('/settings?section=notifications')}>{t('pos.notifications_u2192')}</button>
          <button style={linkBtn} onClick={() => nav('/tenant/ai/receptionist/business-setup')}>{t('pos.business_setup_faqs_u2192')}</button>
        </div>
      </section>

      <div style={{ fontSize: 11.5, color: '#9B8B78' }}><button style={linkBtn} onClick={() => nav('/tenant/ai/receptionist')}>{t('pos.back_to_command_center')}</button></div>
    </div>
  );
}
