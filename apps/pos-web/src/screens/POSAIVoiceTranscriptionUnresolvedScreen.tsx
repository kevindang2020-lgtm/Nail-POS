// POSAIVoiceTranscriptionUnresolvedScreen.tsx — AI Center → AI Voice Transcription → Follow-ups. Wired to
// GET /pos/ai-voice-transcription/unresolved (ai_voice_transcription.view_transcripts). The staff worklist of calls
// with open items (callbacks, manager requests, health/safety, refunds), high-priority first. Redacted-safe.
import { useEffect, useState } from 'react';
import { displayLocale } from '../i18n/format';
import { posAIVoiceTranscriptionApi } from '../api/posAIVoiceTranscriptionApi';
import { reportError } from './reportsCommon';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';

import { statusLabel } from '../i18n/status-label';
import { growthCode } from './growthLabels';
type Item = { header: { id: string; direction: string; status: string; createdAt: string }; quickSummary: string; unresolved: { type: string; description: string; priority: string }[] };
const label = (t: string) => growthCode(t, ['direction', 'aiVoice']);
const fmtDate = (iso?: string) => { if (!iso) return '—'; try { return new Date(iso).toLocaleString(displayLocale(), { month: 'short', day: '2-digit', hour: 'numeric', minute: '2-digit' }); } catch { return iso; } };
const prColor = (p: string) => p === 'high' ? 'var(--danger, #b3261e)' : p === 'medium' ? 'var(--gold, #A96F22)' : 'var(--muted)';

export function POSAIVoiceTranscriptionUnresolvedScreen() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true; setLoading(true); setError(null);
    (async () => {
      try { const d = await posAIVoiceTranscriptionApi.unresolved() as { items: Item[] }; if (alive) setItems(d.items || []); }
      catch (e: any) { if (alive) setError(reportError(e, tx('growth.noun.followUps'))); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  return (
    <div className="work">
      <div className="vh">
        <h1>{tx('pos.voice_transcription_follow_ups')}</h1>
        <div className="sub mb-3">{tx('pos.calls_with_open_items_callbacks_manager_148t')}</div>
      </div>

      {loading ? <div className="state">{tx('pos.loading_follow_ups')}</div>
        : error ? <div className="err">{error}</div>
        : !items || items.length === 0 ? <div className="state">{tx('pos.no_open_follow_ups_nice_every_1ecd')}</div>
        : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {items.map((it) => (
              <div key={it.header.id} className="panel">
                <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <div><strong>{fmtDate(it.header.createdAt)}</strong> · {label(it.header.direction)}</div>
                  <a href={`/tenant/ai/voice-transcription/transcripts/${it.header.id}`}>{tx('pos.open_call')}</a>
                </div>
                <div style={{ color: 'var(--muted)', margin: '4px 0' }}>{it.quickSummary}</div>
                <ul style={{ margin: '4px 0 0' }}>
                  {it.unresolved.map((u, idx) => (
                    <li key={idx}><span style={{ color: prColor(u.priority), fontWeight: 600 }}>[{statusLabel('priority', u.priority)}]</span> {u.description}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
    </div>
  );
}
