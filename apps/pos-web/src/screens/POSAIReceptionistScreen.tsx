// POSAIReceptionistScreen.tsx — the tenant-facing AI Receptionist Command Center (spec Page 1). Reads the REAL
// /tenant/ai/receptionist/overview + /calls endpoints (server-scoped to this salon). Everything shown is honest:
// analytics come from real call outcomes (rates render — when there are no calls; providers show their true
// not-connected state; the setup checklist reflects real config. Champagne Gold design via the existing pos-web
// tokens (#A96F22 gold, #FFFCF6 card, Playfair heads) — consistent with the rest of AI PowerSalon. Provider
// provisioning (Retell agent, Twilio number, live test call) is a later phase gated on real accounts; those
// checklist steps say so plainly rather than offering dead buttons.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { posAiApi, type ReceptionistOverview, type ReceptionistCall } from '../api/posAiApi';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';

const cardBox: React.CSSProperties = { background: '#FFFCF6', border: '1px solid var(--line)', borderRadius: 14, padding: 14 };
const headStyle: React.CSSProperties = { fontWeight: 800, fontSize: 13.5, marginBottom: 10, fontFamily: 'var(--aps-font-head, Playfair Display)' };
const GOLD = '#A96F22';
const pct = (v: number | null) => v == null ? '\u2014' : `${v}%`;
const dur = (s: number | null | undefined) => s == null ? '\u2014' : `${Math.floor(s / 60)}m ${s % 60}s`;

const STATUS_TONE: Record<string, { label: string; bg: string; fg: string }> = {
  live: { get label() { return tx('pos.live'); }, bg: '#EAF5EE', fg: '#3E8F57' },
  ready: { get label() { return tx('pos.ready'); }, bg: '#F0D4AB', fg: '#7A5518' },
  setup: { get label() { return tx('pos.setup'); }, bg: '#FBEEDD', fg: '#9B6B1E' },
  paused: { get label() { return tx('pos.paused'); }, bg: '#F3ECE1', fg: '#6C6965' },
};
const CHK_TONE: Record<string, { mark: string; color: string }> = {
  done: { mark: '\u2713', color: '#3E8F57' },
  action_needed: { mark: '!', color: '#B4673B' },
  pending: { mark: '\u25CB', color: '#9B8B78' },
};

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ ...cardBox, padding: 12 }}>
      <div style={{ fontSize: 11, color: '#8A7A66' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'var(--aps-font-head, Playfair Display)' }}>{value}</div>
      {sub ? <div style={{ fontSize: 11, color: '#9B8B78', marginTop: 2 }}>{sub}</div> : null}
    </div>
  );
}

export function POSAIReceptionistScreen() {
  const nav = useNavigate();
  const [ov, setOv] = useState<ReceptionistOverview | null>(null);
  const [calls, setCalls] = useState<ReceptionistCall[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    posAiApi.receptionistOverview().then(setOv).catch((e: any) => setError(e?.message || tx('pos.failed_to_load_the_ai_receptionist')));
    posAiApi.receptionistCalls(10).then(setCalls).catch(() => setCalls([]));
  }, []);

  if (error) return <div className="work"><div className="err">{error}</div></div>;
  if (!ov) return <div className="work"><div className="state">{tx('pos.loading_ai_receptionist_u2026')}</div></div>;

  const st = STATUS_TONE[ov.frontDeskStatus] ?? STATUS_TONE.setup;
  const a = ov.analytics;
  const provider = (s: string) => s === 'connected' ? { t: tx('pos.connected_2'), c: '#3E8F57' } : s === 'error' ? { t: tx('pos.error'), c: '#B4673B' } : { t: 'Not connected', c: '#9B8B78' };
  const va = provider(ov.providers.voiceAgent); const tel = provider(ov.providers.telephony);

  return (
    <div className="work" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="vh">
        <div>
          <h1>{tx('pos.ai_receptionist')}</h1>
        <div className="sub mb-3">{tx('pos.your_ai_front_desk_agent_u2014_29z1')}</div>
        </div>
        <span style={{ alignSelf: 'center', padding: '4px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700, background: st.bg, color: st.fg }}>{st.label}</span>
      </div>

      {/* Live metrics — real call outcomes; rates are — until calls exist */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2.5">
        <Metric label={tx('pos.calls')} value={String(a.totalCalls)} />
        <Metric label={tx('pos.booked')} value={pct(a.bookingRatePct)} sub={tx('pos.booked_calls', { booked: String(a.booked) })} />
        <Metric label={tx('pos.handoffs')} value={pct(a.handoffRatePct)} sub={tx('pos.handoffs_calls', { handoffs: String(a.handoffs) })} />
        <Metric label={tx('pos.abandoned')} value={pct(a.abandonmentRatePct)} sub={tx('pos.abandoned_calls', { abandoned: String(a.abandoned) })} />
        <Metric label={tx('pos.avg_duration_2')} value={dur(a.avgDurationSeconds)} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1.2fr_1fr] gap-3.5 items-start">
        {/* Setup checklist */}
        <section style={cardBox}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div style={headStyle}>{tx('pos.setup_checklist')}</div>
            <div style={{ fontSize: 12, color: GOLD, fontWeight: 700 }}>{ov.setupProgressPct}%</div>
          </div>
          <div style={{ height: 6, background: '#EFE6D6', borderRadius: 3, marginBottom: 12 }}><div style={{ width: `${ov.setupProgressPct}%`, height: 6, background: GOLD, borderRadius: 3 }} /></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {ov.checklist.map((c) => {
              const t = CHK_TONE[c.state] ?? CHK_TONE.pending;
              return (
                <div key={c.key} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-start' }}>
                  <span style={{ width: 18, height: 18, borderRadius: '50%', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: '#fff', background: t.color }}>{t.mark}</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{c.label}</div>
                    <div style={{ fontSize: 11.5, color: '#8A7A66' }}>{c.detail}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Connections + quick actions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <section style={cardBox}>
            <div style={headStyle}>{tx('pos.connections')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
              <div style={{ display: 'flex' }}><span>{tx('pos.voice_agent_retell')}</span><b style={{ color: va.c }}>{va.t}</b></div>
              <div style={{ display: 'flex' }}><span>{tx('pos.phone_number_twilio')}</span><b style={{ color: tel.c }}>{tel.t}</b></div>
              <div style={{ display: 'flex' }}><span>{tx('pos.integration_key')}</span><b style={{ color: ov.keyIssued ? '#3E8F57' : '#9B8B78' }}>{ov.keyIssued ? tx('pos.issued') : tx('pos.not_issued')}</b></div>
              <div style={{ display: 'flex' }}><span>{tx('pos.booking_actions')}</span><b style={{ color: ov.writeToolsEnabled ? '#3E8F57' : '#9B8B78' }}>{ov.writeToolsEnabled ? tx('pos.armed') : tx('pos.handoff_only')}</b></div>
            </div>
            {(va.t === 'Not connected' || tel.t === 'Not connected') && (
              <div style={{ marginTop: 10, fontSize: 11.5, color: '#9B6B1E', background: '#FBEEDD', borderRadius: 8, padding: '8px 10px' }}>
                {ov.providers.voiceAgentDetail || ov.providers.telephonyDetail
                  ? <>{ov.providers.voiceAgentDetail}{ov.providers.telephonyDetail ? <><br />{ov.providers.telephonyDetail}</> : null}</>
                  : tx('pos.connect_a_retell_voice_account_and_8s1a')}
                {' '}{tx('pos.setup_happens_in_a_later_step_1fxq')}
              </div>
            )}
          </section>

          <section style={cardBox}>
            <div style={headStyle}>{tx('pos.quick_actions')}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {[
                { l: tx('pos.manage_agents'), fn: () => nav('/tenant/ai/receptionist/front-desk') },
                { l: tx('pos.calls'), fn: () => nav('/tenant/ai/receptionist/calls') },
                { l: tx('pos.business_setup'), fn: () => nav('/tenant/ai/receptionist/business-setup') },
                { l: tx('pos.calendar'), fn: () => nav('/tenant/ai/receptionist/calendar') },
                { l: tx('pos.follow_ups'), fn: () => nav('/tenant/ai/receptionist/follow-ups') },
                { l: tx('pos.settings'), fn: () => nav('/tenant/ai/receptionist/settings') },
                { l: tx('pos.plans_usage'), fn: () => nav('/tenant/ai/plans') },
              ].map((x) => <button key={x.l} onClick={x.fn} style={{ height: 32, padding: '0 12px', borderRadius: 8, border: '1px solid var(--line)', background: '#FFFCF6', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>{x.l}</button>)}
            </div>
          </section>
        </div>
      </div>

      {/* Recent calls — real outcome rows, honest empty state */}
      <section style={cardBox}>
        <div style={headStyle}>{tx('pos.recent_calls')}</div>
        {calls && calls.length > 0 ? (
          <div className="overflow-x-auto">
            <div className="min-w-[600px]">
              <div className="overflow-x-auto w-full"><table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }} className="w-full min-w-max">
                <thead><tr style={{ textAlign: 'left', color: '#8A7A66' }}><th style={{ padding: '6px 8px' }}>{tx('pos.when')}</th><th style={{ padding: '6px 8px' }}>{tx('pos.intents')}</th><th style={{ padding: '6px 8px' }}>{tx('pos.booking')}</th><th style={{ padding: '6px 8px' }}>{tx('pos.handoff')}</th><th style={{ padding: '6px 8px' }}>{tx('pos.duration')}</th></tr></thead>
                <tbody>
                  {calls.map((c, i) => (
                    <tr key={c.providerCallId ?? i} style={{ borderTop: '1px solid var(--line)' }}>
                      <td style={{ padding: '6px 8px' }}>{c.startedAt ? new Date(c.startedAt).toLocaleString() : c.createdMs ? new Date(c.createdMs).toLocaleString() : '\u2014'}</td>
                      <td style={{ padding: '6px 8px' }}>{(c.intents ?? []).join(', ') || '\u2014'}</td>
                      <td style={{ padding: '6px 8px' }}>{c.bookingOutcome ?? '\u2014'}</td>
                      <td style={{ padding: '6px 8px' }}>{c.handoffOutcome ?? '\u2014'}</td>
                      <td style={{ padding: '6px 8px' }}>{dur(c.durationSeconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 12.5, color: '#9B8B78' }}>{tx('pos.no_calls_yet_u2014_they_u2019ll_y6z9')}</div>
        )}
      </section>
    </div>
  );
}
