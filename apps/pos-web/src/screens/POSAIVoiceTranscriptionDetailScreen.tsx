// POSAIVoiceTranscriptionDetailScreen.tsx — AI Center → AI Voice Transcription → call detail. Wired to
// GET /transcripts/:id (header + REDACTED segments), /intelligence, and POST /summary. Shows the redacted
// transcript with speaker roles, the extracted intelligence, and an on-demand AI detailed summary. Raw text is
// never shown here (it is a separately-permissioned call).
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { posAIVoiceTranscriptionApi } from '../api/posAIVoiceTranscriptionApi';
import { reportError } from './reportsCommon';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';

import { statusLabel } from '../i18n/status-label';
import { growthCode } from './growthLabels';
type Segment = { seq: number; speakerRole: string; text: string; startMs: number | null };
type Header = { id: string; status: string; direction: string; handler: string; primaryLanguage: string | null; mixedLanguage: boolean; redactionStatus: string; confidence: number | null; durationSeconds: number | null };
type Intel = { quickSummary: string; detailedSummary: string | null; detailedSource: string | null; intents: any[]; appointment: any; unresolved: any[] } | null;
const label = (t: string) => growthCode(t, ['direction', 'role', 'aiVoice']);
const roleColor = (r: string) => r === 'customer' ? 'var(--gold, #A96F22)' : /receptionist/.test(r) ? '#2563eb' : 'var(--muted)';

export function POSAIVoiceTranscriptionDetailScreen() {
  const { id = '' } = useParams();
  const [header, setHeader] = useState<Header | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [intel, setIntel] = useState<Intel>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [summarizing, setSummarizing] = useState(false);

  useEffect(() => {
    let alive = true; setLoading(true); setError(null);
    (async () => {
      try {
        const [d, i] = await Promise.all([
          posAIVoiceTranscriptionApi.detail(id) as Promise<{ header: Header; segments: Segment[] }>,
          posAIVoiceTranscriptionApi.intelligence(id).catch(() => null) as Promise<Intel>,
        ]);
        if (!alive) return;
        setHeader(d.header); setSegments(d.segments || []); setIntel(i);
      } catch (e: any) { if (alive) setError(reportError(e, tx('growth.noun.transcript'))); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [id]);

  const generate = async () => {
    setSummarizing(true);
    try { const r = await posAIVoiceTranscriptionApi.generateSummary(id) as { summary: string; source: string }; setIntel((p) => p ? { ...p, detailedSummary: r.summary, detailedSource: r.source } : p); }
    catch (e: any) { setError(reportError(e, tx('growth.noun.summary'))); }
    finally { setSummarizing(false); }
  };

  if (loading) return <div className="work"><div className="state">{tx('pos.loading_transcript')}</div></div>;
  if (error) return <div className="work"><div className="err" style={{ marginTop: 12 }}>{error}</div></div>;
  if (!header) return <div className="work"><div className="state">{tx('pos.transcript_not_found')}</div></div>;

  return (
    <div className="work">
      <div className="vh">
        <h1>{tx('pos.call_transcript')}</h1>
        <div className="sub mb-3">{label(header.direction)} · {label(header.handler)} · {label(header.status)} · {header.primaryLanguage ?? '—'}{header.mixedLanguage ? ' (mixed)' : ''} {tx('pos.redaction')}{' '}{label(header.redactionStatus)}</div>
      </div>

      {intel && (
        <div className="panel" style={{ marginBottom: 12 }}>
          <div className="vh flex flex-col sm:flex-row gap-3 justify-between"><h2 style={{ fontSize: 16 }}>{tx('pos.summary_extraction')}</h2></div>
          <p style={{ margin: '4px 0' }}>{intel.quickSummary}</p>
          {intel.detailedSummary
            ? <div className="panel" style={{ marginTop: 8, background: 'var(--card, #fff)' }}><p style={{ margin: 0 }}>{intel.detailedSummary}</p><div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>{intel.detailedSource === 'fallback' ? tx('pos.deterministic_summary_2') : tx('pos.ai_summary')}</div></div>
            : <button type="button" className="btn w-fit whitespace-nowrap" onClick={generate} disabled={summarizing}>{summarizing ? tx('pos.generating') : tx('pos.generate_detailed_summary')}</button>}   {/* Sep 2026 merge: the redesign dropped the click handler — the button did nothing */}
          {intel.intents?.length > 0 && <div style={{ marginTop: 10 }}><strong>{tx('pos.intents_2')}</strong> {intel.intents.map((i: any) => label(i.intent)).join(', ')}</div>}
          {intel.appointment && (intel.appointment.requestedServices?.length > 0 || intel.appointment.preferredDate) && (
            <div style={{ marginTop: 6 }}><strong>{tx('pos.appointment')}</strong> {[intel.appointment.requestedServices?.join(', '), intel.appointment.requestedTechnician, intel.appointment.preferredDate, intel.appointment.preferredTime].filter(Boolean).join(' · ') || '—'}</div>
          )}
          {intel.unresolved?.length > 0 && (
            <div style={{ marginTop: 6 }}><strong>{tx('pos.unresolved')}</strong>
              <ul>{intel.unresolved.map((u: any, idx: number) => <li key={idx}><span style={{ color: u.priority === 'high' ? 'var(--danger, #b3261e)' : 'var(--muted)' }}>[{statusLabel('priority', u.priority)}]</span> {u.description}</li>)}</ul>
            </div>
          )}
        </div>
      )}

      <div className="panel">
        <div className="vh"><h2 style={{ fontSize: 16 }}>{tx('pos.transcript_redacted')}</h2></div>
        {segments.length === 0 ? <div className="state" style={{ padding: 16 }}>{tx('pos.no_transcript_segments_call_may_not_doek')}</div> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {segments.map((s) => (
              <div key={s.seq} style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <span style={{ minWidth: 130, fontWeight: 600, color: roleColor(s.speakerRole) }}>{label(s.speakerRole)}</span>
                <span>{s.text}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
