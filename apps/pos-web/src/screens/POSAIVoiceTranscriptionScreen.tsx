// POSAIVoiceTranscriptionScreen.tsx — AI Center → AI Voice Transcription (Overview). Wired to
// GET /pos/ai-voice-transcription/overview (ai_voice_transcription.view). Tenant-scoped, redacted-safe.
import { useEffect, useState } from 'react';
import { posAIVoiceTranscriptionApi } from '../api/posAIVoiceTranscriptionApi';
import { reportError } from './reportsCommon';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';

import { growthCode } from './growthLabels';
type Overview = {
  total: number; completed: number; withUnresolved: number; appointmentsExtracted: number;
  byStatus: { status: string; count: number }[]; byLanguage: { language: string; count: number }[];
};
const n = (v: number) => (v || 0).toLocaleString('en-US');
const label = (t: string) => growthCode(t, 'aiVoice');

export function POSAIVoiceTranscriptionScreen() {
  const [s, setS] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true; setLoading(true); setError(null);
    (async () => {
      try { const d = await posAIVoiceTranscriptionApi.overview() as Overview; if (alive) setS(d); }
      catch (e: any) { if (alive) setError(reportError(e, tx('growth.noun.aiVoiceTranscription'))); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  if (loading) return <div className="work"><div className="state">{tx('pos.loading_voice_transcription')}</div></div>;
  if (error) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error}</div></div>;
  if (!s) return <div className="work"><div className="state">{tx('pos.no_transcription_data')}</div></div>;

  return (
    <div className="work">
      <div className="vh">
        <h1>{tx('pos.ai_voice_transcription')}</h1>
        <div className="sub mb-3">{tx('pos.authorized_calls_transcribed_redacted_and_searchable_7118')}</div>
      </div>

      <div className="kpis">
        <div className="kpi"><div className="l">{tx('pos.transcripts')}</div><div className="v">{n(s.total)}</div></div>
        <div className="kpi"><div className="l">{tx('pos.completed_2')}</div><div className="v">{n(s.completed)}</div></div>
        <div className="kpi"><div className="l">{tx('pos.appointments_extracted')}</div><div className="v">{n(s.appointmentsExtracted)}</div></div>
        <div className="kpi"><div className="l">{tx('pos.with_unresolved_items')}</div><div className="v" style={{ color: s.withUnresolved > 0 ? 'var(--gold, #A96F22)' : undefined }}>{n(s.withUnresolved)}</div></div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, margin: '12px 0' }}>
        <a className="btn" href="/tenant/ai/voice-transcription/history">{tx('pos.call_history')}</a>
        <a className="btn" href="/tenant/ai/voice-transcription/search">{tx('pos.search_transcripts')}</a>
      </div>

      <div className="panel" style={{ marginTop: 8 }}>
        <div className="vh"><h2 style={{ fontSize: 16 }}>{tx('pos.by_status')}</h2></div>
        {s.byStatus.length === 0 ? <div className="state" style={{ padding: 16 }}>{tx('pos.no_calls_transcribed_yet')}</div> : (
          <div className="overflow-x-auto w-full"><table className="tbl w-full min-w-max">
            <thead><tr><th>{tx('pos.status')}</th><th style={{ textAlign: 'right' }}>{tx('pos.count')}</th></tr></thead>
            <tbody>{s.byStatus.map((r) => <tr key={r.status}><td>{label(r.status)}</td><td style={{ textAlign: 'right' }}>{n(r.count)}</td></tr>)}</tbody>
          </table></div>
        )}
      </div>

      {s.byLanguage.length > 0 && (
        <div className="panel" style={{ marginTop: 12 }}>
          <div className="vh"><h2 style={{ fontSize: 16 }}>{tx('pos.languages')}</h2></div>
          <div className="overflow-x-auto w-full"><table className="tbl w-full min-w-max">
            <thead><tr><th>{tx('pos.language')}</th><th style={{ textAlign: 'right' }}>{tx('pos.calls')}</th></tr></thead>
            <tbody>{s.byLanguage.map((r) => <tr key={r.language}><td>{r.language}</td><td style={{ textAlign: 'right' }}>{n(r.count)}</td></tr>)}</tbody>
          </table></div>
        </div>
      )}
    </div>
  );
}
