// POSAIVoiceTranscriptionHistoryScreen.tsx — AI Center → AI Voice Transcription → Call History. Wired to
// GET /pos/ai-voice-transcription/transcripts (ai_voice_transcription.view_transcripts). Server-side filtered.
import { useEffect, useState } from 'react';
import { displayLocale } from '../i18n/format';
import { posAIVoiceTranscriptionApi } from '../api/posAIVoiceTranscriptionApi';
import { reportError } from './reportsCommon';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';

import { growthCode } from './growthLabels';
type Row = {
  id: string; provider: string; providerCallId: string; direction: string; handler: string; status: string;
  primaryLanguage: string | null; durationSeconds: number | null; segmentCount: number; createdAt: string;
};
const label = (t: string) => growthCode(t, ['direction', 'aiVoice']);
const fmtDate = (iso?: string) => { if (!iso) return '—'; try { return new Date(iso).toLocaleString(displayLocale(), { month: 'short', day: '2-digit', hour: 'numeric', minute: '2-digit' }); } catch { return iso; } };
const dur = (s: number | null) => s == null ? '—' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const STATUSES = ['', 'completed', 'low_confidence', 'consent_declined', 'consent_missing', 'transcription_disabled', 'provider_error'];

const statusStyle = (s: string) => {
  if (s === 'completed') return { bg: '#E8F5E9', color: '#2E7D32' };
  if (s === 'low_confidence') return { bg: '#FDF6E3', color: '#A96F22' };
  if (s === 'provider_error' || s === 'consent_declined') return { bg: '#FDECEC', color: '#B3261E' };
  return { bg: '#F3F4F6', color: '#6B7280' };
};

export function POSAIVoiceTranscriptionHistoryScreen() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [direction, setDirection] = useState('');

  useEffect(() => {
    let alive = true; setLoading(true); setError(null);
    (async () => {
      try { const d = await posAIVoiceTranscriptionApi.list({ status: status || undefined, direction: direction || undefined }) as { items: Row[] }; if (alive) setRows(d.items || []); }
      catch (e: any) { if (alive) setError(reportError(e, tx('growth.noun.callHistory'))); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [status, direction]);

  return (
    <div className="work">
      <div className="vh">
        <h1>{tx('pos.voice_transcription_call_history')}</h1>
        <div className="sub mb-3">{tx('pos.authorized_redacted_call_transcripts_tenant_scoped_1u9u')}</div>
      </div>

      <div className="panel" style={{ marginBottom: 16, padding: '12px 16px', display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', background: '#F9FAFB', border: '1px solid var(--line)' }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: '#374151' }}>{tx('pos.filters')}</div>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#4B5563' }}>
          {tx('pos.status_2')}
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label={tx('pos.filter_by_status')} style={{ border: '1px solid var(--line)', borderRadius: 6, padding: '4px 8px', fontSize: 13, background: '#fff', outline: 'none', cursor: 'pointer' }}>
            {STATUSES.map((s) => <option key={s || 'all'} value={s}>{s ? label(s) : tx('pos.all')}</option>)}
          </select>
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#4B5563' }}>
          {tx('pos.direction')}
          <select value={direction} onChange={(e) => setDirection(e.target.value)} aria-label={tx('pos.filter_by_direction')} style={{ border: '1px solid var(--line)', borderRadius: 6, padding: '4px 8px', fontSize: 13, background: '#fff', outline: 'none', cursor: 'pointer' }}>
            <option value="">{tx('pos.all')}</option><option value="inbound">{tx('pos.inbound')}</option><option value="outbound">{tx('pos.outbound')}</option>
          </select>
        </label>
      </div>

      {loading ? <div className="state">{tx('pos.loading_calls')}</div>
        : error ? <div className="err">{error}</div>
        : !rows || rows.length === 0 ? <div className="state">{tx('pos.no_calls_match_transcribed_calls_will_btg7')}</div>
        : (
          <section className="panel" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="overflow-x-auto w-full">
              <table className="tbl w-full min-w-max">
                <thead>
                  <tr>
                    <th style={{ padding: '10px 12px' }}>{tx('pos.when')}</th>
                    <th className="whitespace-nowrap" style={{ padding: '10px 12px' }}>{tx('pos.direction_2')}</th>
                    <th className="whitespace-nowrap" style={{ padding: '10px 12px' }}>{tx('pos.handler')}</th>
                    <th className="whitespace-nowrap" style={{ padding: '10px 12px' }}>{tx('pos.status')}</th>
                    <th className="whitespace-nowrap text-center" style={{ padding: '10px 12px' }}>{tx('pos.language')}</th>
                    <th className="whitespace-nowrap text-center" style={{ padding: '10px 12px' }}>{tx('pos.duration')}</th>
                    <th className="whitespace-nowrap text-center" style={{ padding: '10px 12px' }}>{tx('pos.segments_2')}</th>
                    <th className="whitespace-nowrap text-right" style={{ padding: '10px 12px' }}>{tx('pos.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const st = statusStyle(r.status);
                    return (
                      <tr key={r.id} className="hover:bg-black/5 transition-colors">
                        <td style={{ padding: '12px 12px', verticalAlign: 'middle', fontWeight: 500, color: '#111827' }}>
                          {fmtDate(r.createdAt)}
                        </td>
                        <td style={{ padding: '12px 12px', verticalAlign: 'middle', color: '#4B5563' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            {r.direction === 'inbound' ? '↓' : r.direction === 'outbound' ? '↑' : ''} {label(r.direction)}
                          </span>
                        </td>
                        <td style={{ padding: '12px 12px', verticalAlign: 'middle', color: '#374151', fontWeight: 500 }}>
                          {label(r.handler)}
                        </td>
                        <td style={{ padding: '12px 12px', verticalAlign: 'middle' }}>
                          <span style={{ background: st.bg, color: st.color, padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600, display: 'inline-block' }}>{label(r.status)}</span>
                        </td>
                        <td style={{ padding: '12px 12px', verticalAlign: 'middle', textAlign: 'center', color: '#4B5563', fontSize: 13 }}>
                          {r.primaryLanguage ? String(r.primaryLanguage).toUpperCase() : '—'}
                        </td>
                        <td style={{ padding: '12px 12px', verticalAlign: 'middle', textAlign: 'center', color: '#4B5563', fontSize: 13, fontFamily: 'monospace' }}>
                          {dur(r.durationSeconds)}
                        </td>
                        <td style={{ padding: '12px 12px', verticalAlign: 'middle', textAlign: 'center', color: '#4B5563' }}>
                          {r.segmentCount}
                        </td>
                        <td style={{ padding: '12px 12px', verticalAlign: 'middle', textAlign: 'right' }}>
                          <a href={`/tenant/ai/voice-transcription/transcripts/${r.id}`} style={{ display: 'inline-block', border: '1px solid var(--line)', padding: '4px 12px', borderRadius: 6, fontSize: 13, textDecoration: 'none', color: '#111827', fontWeight: 500, background: '#fff' }}>{tx('pos.open')}</a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
    </div>
  );
}
