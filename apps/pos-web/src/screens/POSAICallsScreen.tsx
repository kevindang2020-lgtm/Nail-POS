// POSAICallsScreen.tsx — Calls list + detail (spec Pages 6/17). Reads the real call-outcome records. Honest about
// what isn't stored: transcripts and recordings are not captured by the outcome store, so the detail drawer says so
// rather than showing a broken player. Champagne Gold via existing tokens.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { posAiApi, type ReceptionistCall } from '../api/posAiApi';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';

const cardBox: React.CSSProperties = { background: '#FFFCF6', border: '1px solid var(--line)', borderRadius: 14, padding: 14 };
const headStyle: React.CSSProperties = { fontWeight: 800, fontSize: 13.5, marginBottom: 10, fontFamily: 'var(--aps-font-head, Playfair Display)' };
const GOLD = '#A96F22';
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', color: '#6C6965', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0, fontFamily: 'inherit' };
const dur = (s?: number | null) => s == null ? '\u2014' : `${Math.floor(s / 60)}m ${s % 60}s`;
const whenOf = (c: ReceptionistCall) => c.startedAt ? new Date(c.startedAt).toLocaleString() : c.createdMs ? new Date(c.createdMs).toLocaleString() : '\u2014';
const SENT_TONE: Record<string, string> = { positive: '#3E8F57', neutral: '#6C6965', negative: '#B4673B' };

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return <div style={{ display: 'flex', padding: '5px 0', borderTop: '1px solid var(--line)', fontSize: 12.5 }}><span style={{ color: '#8A7A66', width: 150, flexShrink: 0 }}>{label}</span><span>{value}</span></div>;
}

export function POSAICallsScreen() {
  const nav = useNavigate();
  const [calls, setCalls] = useState<ReceptionistCall[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<ReceptionistCall | null>(null);

  useEffect(() => { posAiApi.receptionistCalls(50).then(setCalls).catch((e: any) => setError(e?.message || tx('pos.failed_to_load_calls'))); }, []);

  if (error) return <div className="work"><div className="err">{error}</div></div>;

  return (
    <div className="work" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="vh"><div><h1>{tx('pos.calls')}</h1>
        <div className="sub mb-3">{tx('pos.every_call_the_ai_receptionist_handled_dwlt')}</div></div></div>

      <div className={"grid gap-[14px] items-start " + (sel ? "grid-cols-1 lg:grid-cols-[1.4fr_1fr]" : "grid-cols-1")} style={{gap: 14, alignItems: 'start' }}>
        <section style={cardBox}>
          <div style={headStyle}>{tx('pos.recent_calls')}</div>
          {calls === null ? <div style={{ fontSize: 12.5, color: '#9B8B78' }}>{tx('pos.loading_u2026')}</div>
            : calls.length === 0 ? <div style={{ fontSize: 12.5, color: '#9B8B78' }}>{tx('pos.no_calls_yet_u2014_they_u2019ll_y6z9')}</div>
            : (
              <div className="overflow-x-auto w-full"><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }} className="w-full min-w-max">
                <thead><tr style={{ textAlign: 'left', color: '#8A7A66' }}><th style={{ padding: '6px 8px' }}>{tx('pos.when')}</th><th style={{ padding: '6px 8px' }}>{tx('pos.intents')}</th><th style={{ padding: '6px 8px' }}>{tx('pos.booking')}</th><th style={{ padding: '6px 8px' }}>{tx('pos.handoff')}</th><th style={{ padding: '6px 8px' }}>{tx('pos.dur')}</th><th></th></tr></thead>
                <tbody>
                  {calls.map((c) => (
                    <tr key={c.providerCallId} style={{ borderTop: '1px solid var(--line)', background: sel?.providerCallId === c.providerCallId ? '#FBF3E4' : 'transparent', cursor: 'pointer' }} onClick={() => setSel(c)}>
                      <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{whenOf(c)}</td>
                      <td style={{ padding: '6px 8px' }}>{(c.intents ?? []).join(', ') || '\u2014'}</td>
                      <td style={{ padding: '6px 8px' }}>{c.bookingOutcome ?? '\u2014'}</td>
                      <td style={{ padding: '6px 8px' }}>{c.handoffOutcome ?? '\u2014'}</td>
                      <td style={{ padding: '6px 8px' }}>{dur(c.durationSeconds)}</td>
                      <td style={{ padding: '6px 8px' }}><button style={{ ...linkBtn, color: GOLD }} onClick={(e) => { e.stopPropagation(); setSel(c); }}>{tx('pos.view')}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
        </section>

        {sel && (
          <section style={cardBox}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <div style={headStyle}>{tx('pos.call_detail')}</div>
              <button style={{ ...linkBtn, }} onClick={() => setSel(null)}>{tx('pos.close')}</button>
            </div>
            {sel.summary ? <div style={{ fontSize: 12.5, color: '#515050', marginBottom: 8 }}>{sel.summary}</div> : null}
            <Field label={tx('pos.call_id')} value={sel.providerCallId} />
            <Field label={tx('pos.when')} value={whenOf(sel)} />
            <Field label={tx('pos.duration')} value={dur(sel.durationSeconds)} />
            <Field label={tx('pos.language')} value={sel.language ?? '\u2014'} />
            <Field label={tx('pos.intents')} value={(sel.intents ?? []).join(', ') || '\u2014'} />
            <Field label={tx('pos.booking')} value={sel.bookingOutcome ?? '\u2014'} />
            <Field label={tx('pos.handoff')} value={sel.handoffOutcome ?? '\u2014'} />
            <Field label={tx('pos.sentiment')} value={sel.sentiment ? <span style={{ color: SENT_TONE[sel.sentiment] ?? '#6C6965', fontWeight: 700, textTransform: 'capitalize' }}>{sel.sentiment}</span> : '\u2014'} />
            <Field label={tx('pos.follow_up')} value={sel.followUpRequired ? 'Required' : 'No'} />
            {sel.errorCategory ? <Field label={tx('pos.error')} value={<span style={{ color: '#B4673B' }}>{sel.errorCategory}</span>} /> : null}
            <Field label={tx('pos.tool_calls')} value={(sel.toolCalls ?? []).length === 0 ? '\u2014' : (sel.toolCalls ?? []).map((t, i) => <span key={i} style={{ display: 'inline-block', marginRight: 6, padding: '1px 7px', borderRadius: 999, fontSize: 10.5, background: t.ok ? '#EAF5EE' : '#F7E4DA', color: t.ok ? '#3E8F57' : '#B4673B' }}>{t.name}{t.ok ? '' : ' \u2717'}</span>)} />
            <div style={{ marginTop: 12, fontSize: 11.5, color: '#9B6B1E', background: '#FBEEDD', borderRadius: 8, padding: '8px 10px' }}>
              {tx('pos.transcript_and_recording_aren_u2019t_captured_1blw')}
            </div>
            {sel.followUpRequired ? <div style={{ marginTop: 10 }}><button style={{ ...linkBtn, color: GOLD }} onClick={() => nav('/tenant/ai/receptionist/follow-ups')}>{tx('pos.open_follow_ups')}</button></div> : null}
          </section>
        )}
      </div>
    </div>
  );
}
