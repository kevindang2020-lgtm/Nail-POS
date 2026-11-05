// POSAIVoiceTranscriptionSearchScreen.tsx — AI Center → AI Voice Transcription → Search. Wired to
// GET /transcripts/search (ai_voice_transcription.view_transcripts). Searches REDACTED text + summaries/intents
// only; snippets are redacted. Raw transcript content is never searched or shown here.
import { useState } from 'react';
import { displayLocale } from '../i18n/format';
import { ImeSafeInput } from '../components/ImeSafeInput';
import { posAIVoiceTranscriptionApi } from '../api/posAIVoiceTranscriptionApi';
import { reportError } from './reportsCommon';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';

import { growthCode } from './growthLabels';
type Item = { header: { id: string; direction: string; status: string; createdAt: string }; snippet: string; matchedIn: string[] };
const label = (t: string) => growthCode(t, ['direction', 'aiVoice']);
const fmtDate = (iso?: string) => { if (!iso) return '—'; try { return new Date(iso).toLocaleString(displayLocale(), { month: 'short', day: '2-digit', hour: 'numeric', minute: '2-digit' }); } catch { return iso; } };

export function POSAIVoiceTranscriptionSearchScreen() {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const run = async () => {
    if (!q.trim()) { setItems(null); return; }
    setLoading(true); setError(null);
    try { const d = await posAIVoiceTranscriptionApi.search({ q: q.trim() }) as { items: Item[] }; setItems(d.items || []); }
    catch (e: any) { setError(reportError(e, tx('growth.noun.search'))); }
    finally { setLoading(false); }
  };

  return (
    <div className="work">
      <div className="vh flex flex-col sm:flex-row gap-3 justify-between">
        <div>
          <h1>{tx('pos.voice_transcription_search')}</h1>
        <div className="sub mb-3">{tx('pos.search_redacted_transcripts_summaries_and_intents_6udn')}</div>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 16, padding: '12px 16px', display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', background: '#F9FAFB', border: '1px solid var(--line)' }}>
        <ImeSafeInput type="search" className="in" enterKeyHint="search" value={q} onValue={setQ} onKeyDown={(e) => e.key === 'Enter' && run()} placeholder={tx('pos.search_calls_e_g_gel_manicure_ddgn')} aria-label={tx('pos.search_transcripts')} style={{ flex: 1, border: '1px solid var(--line)', borderRadius: 8, padding: '0 12px', height: 38, outline: 'none', fontSize: 14 }} />
        <button className="btn whitespace-nowrap" type="button" onClick={run} disabled={loading || !q.trim()} style={{ height: 38, padding: '0 20px', fontSize: 14 }}>{loading ? tx('pos.searching_2') : tx('pos.search')}</button>
      </div>

      {error ? <div className="err">{error}</div>
        : items == null ? <div className="state">{tx('pos.enter_a_search_term_to_find_1hj7')}</div>
        : items.length === 0 ? <div className="state">{tx('pos.no_matching_calls')}</div>
        : (
          <section className="panel" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="overflow-x-auto w-full">
              <table className="tbl w-full min-w-max">
                <thead>
                  <tr>
                    <th style={{ padding: '10px 12px' }}>{tx('pos.when')}</th>
                    <th className="whitespace-nowrap" style={{ padding: '10px 12px' }}>{tx('pos.direction_2')}</th>
                    <th className="whitespace-nowrap" style={{ padding: '10px 12px' }}>{tx('pos.matched_in')}</th>
                    <th style={{ padding: '10px 12px', width: '40%' }}>{tx('pos.snippet')}</th>
                    <th className="whitespace-nowrap text-right" style={{ padding: '10px 12px' }}>{tx('pos.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.header.id} className="hover:bg-black/5 transition-colors">
                      <td style={{ padding: '12px 12px', verticalAlign: 'top', fontWeight: 500, color: '#111827' }}>
                        {fmtDate(it.header.createdAt)}
                      </td>
                      <td style={{ padding: '12px 12px', verticalAlign: 'top', color: '#4B5563' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          {it.header.direction === 'inbound' ? '↓' : it.header.direction === 'outbound' ? '↑' : ''} {label(it.header.direction)}
                        </span>
                      </td>
                      <td style={{ padding: '12px 12px', verticalAlign: 'top', color: '#374151', fontSize: 13 }}>
                        {it.matchedIn.map((m) => (
                          <span key={m} style={{ background: '#F3F4F6', color: '#4B5563', padding: '2px 6px', borderRadius: 4, marginRight: 4, fontSize: 11, display: 'inline-block', marginBottom: 2 }}>{label(m)}</span>
                        ))}
                      </td>
                      <td style={{ padding: '12px 12px', verticalAlign: 'top', color: '#4B5563', fontSize: 13, lineHeight: 1.5, fontStyle: 'italic' }}>
                        "{it.snippet}"
                      </td>
                      <td style={{ padding: '12px 12px', verticalAlign: 'top', textAlign: 'right' }}>
                        <a href={`/tenant/ai/voice-transcription/transcripts/${it.header.id}`} style={{ display: 'inline-block', border: '1px solid var(--line)', padding: '4px 12px', borderRadius: 6, fontSize: 13, textDecoration: 'none', color: '#111827', fontWeight: 500, background: '#fff' }}>{tx('pos.open')}</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
    </div>
  );
}
