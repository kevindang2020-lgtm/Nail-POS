// POSAIVoiceTranscriptionSettingsScreen.tsx — AI Center → AI Voice Transcription → Settings. Wired to
// GET/PUT /pos/ai-voice-transcription/settings (view / manage_settings). Controls the tenant transcription policy:
// master enable, retention window, raw (pre-redaction) retention, and consent-announcement version. Redaction
// itself is always on and is intentionally not a toggle.
import { useEffect, useState } from 'react';
import { posAIVoiceTranscriptionApi } from '../api/posAIVoiceTranscriptionApi';
import { reportError } from './reportsCommon';
import { t } from '@aipowersalon/mobile-sdk/i18n';

type Settings = { transcriptionEnabled: boolean; retentionDays: number; retainRaw: boolean; consentAnnouncementVersion: string | null };

export function POSAIVoiceTranscriptionSettingsScreen() {
  const [s, setS] = useState<Settings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true; setLoading(true); setError(null);
    (async () => {
      try { const d = await posAIVoiceTranscriptionApi.getSettings() as Settings; if (alive) setS(d); }
      catch (e: any) { if (alive) setError(reportError(e, t('growth.noun.settings'))); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  const save = async () => {
    if (!s) return;
    if (!Number.isInteger(s.retentionDays) || s.retentionDays < 1 || s.retentionDays > 3650) { setError(t('pos.retention_must_be_between_1_and_1l4y')); return; }
    setSaving(true); setError(null); setNotice(null);
    try {
      const d = await posAIVoiceTranscriptionApi.updateSettings({ transcriptionEnabled: s.transcriptionEnabled, retentionDays: s.retentionDays, retainRaw: s.retainRaw, consentAnnouncementVersion: s.consentAnnouncementVersion }) as Settings;
      setS(d); setNotice(t('growth.common.settingsSaved'));
    } catch (e: any) { setError(reportError(e, t('growth.noun.settings'))); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="work"><div className="state">{t('pos.loading_settings')}</div></div>;
  if (!s) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error ?? t('pos.no_settings')}</div></div>;

  return (
    <div className="work">
      <div className="vh">
        <h1>{t('pos.voice_transcription_settings')}</h1>
        <div className="sub mb-3">{t('pos.tenant_transcription_policy_sensitive_data_redaction_kd83')}</div>
      </div>

      {error && <div className="err" style={{ marginBottom: 10 }}>{error}</div>}
      {notice && <div className="ok" style={{ marginBottom: 10 }}>{notice}</div>}

      <div className="panel" style={{ maxWidth: 640 }}>
        <label style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '8px 0' }}>
          <input type="checkbox" checked={s.transcriptionEnabled} onChange={(e) => setS({ ...s, transcriptionEnabled: e.target.checked })} />
          <span><strong>{t('pos.transcription_enabled')}</strong><div className="sub">{t('pos.when_off_new_calls_are_not_bwws')}</div></span>
        </label>

        <label style={{ display: 'block', padding: '8px 0' }}>
          <strong>{t('pos.retention_window_days')}</strong>
          <div className="sub">{t('pos.transcripts_are_automatically_erased_store_and_z489')}</div>
          <input type="number" min={1} max={3650} value={s.retentionDays} onChange={(e) => setS({ ...s, retentionDays: +e.target.value })} style={{ width: 120, marginTop: 4 }} />
        </label>

        <label style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '8px 0' }}>
          <input type="checkbox" checked={s.retainRaw} onChange={(e) => setS({ ...s, retainRaw: e.target.checked })} />
          <span><strong>{t('pos.retain_raw_pre_redaction_text')}</strong><div className="sub">{t('pos.off_by_default_when_on_raw_jmsy')}</div></span>
        </label>

        <label style={{ display: 'block', padding: '8px 0' }}>
          <strong>{t('pos.consent_announcement_version')}</strong>
          <div className="sub">{t('pos.identifier_for_the_recorded_consent_announcement_15nn')}</div>
          <input type="text" value={s.consentAnnouncementVersion ?? ''} onChange={(e) => setS({ ...s, consentAnnouncementVersion: e.target.value || null })} placeholder={t('admin.form.example', { value: 'v1' })} style={{ width: 200, marginTop: 4 }} />
        </label>

        <div style={{ marginTop: 12 }}>
          <button type="button" onClick={save} disabled={saving}>{saving ? t('pos.saving_2') : t('pos.save_settings')}</button>
        </div>
      </div>
    </div>
  );
}
