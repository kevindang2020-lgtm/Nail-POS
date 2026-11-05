// AiReceptionistScreen.tsx — Super Admin → AI Receptionist. Three real sections over the /super-admin/voice/* API:
//   • Integration keys — issue (raw shown once), list (prefix + status only), revoke.
//   • Call history — the real call-outcome store (metadata only; no transcripts/recordings — privacy).
//   • Learning review — open suggestions with approve/reject, and the active prompt version with rollback.
// Nothing here is mocked: every panel reflects a real backend store. Missing values render as an em-dash, never faked.
import { useCallback, useEffect, useState } from 'react';
import { useInlineAsk } from '@aipowersalon/ui';
import { superAdminVoiceApi, type VoiceKey, type CallOutcomeRecord, type Suggestion, type VoicePromptVersion, type VoiceAnalytics, type GatewayMetrics, type FleetSummary, type ProvisioningMetrics } from '../api/superAdminVoiceApi';
import { useCan } from '../auth/useCan';

const GOLD = 'var(--g7,#A96F22)';
const LINE = 'var(--line,#E7DBC6)';
const CARD = 'var(--card,#FFFCF6)';
const fmt = (ms: number | null) => { if (ms == null) return '—'; const d = new Date(ms); return isNaN(+d) ? '—' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const fmtIso = (s: string | null) => { if (!s) return '—'; const d = new Date(s); return isNaN(+d) ? '—' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const dash = (s: string | null | undefined) => (s && String(s).trim() ? s : '—');
const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

function keyStatus(k: VoiceKey): { label: string; color: string } {
  if (k.revokedMs != null) return { label: 'Revoked', color: '#B85B4D' };
  if (k.expiresMs != null && k.expiresMs <= Date.now()) return { label: 'Expired', color: '#D09A36' };
  return { label: 'Active', color: '#3E8F57' };
}

const panel: React.CSSProperties = { background: CARD, border: `1px solid ${LINE}`, borderRadius: 12, padding: 16, marginBottom: 16 };
const h2: React.CSSProperties = { fontFamily: "'Playfair Display', serif", fontSize: 15, marginBottom: 12 };
const th: React.CSSProperties = { textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: '#9B8B78', padding: '6px 8px', borderBottom: `1px solid ${LINE}` };
const td: React.CSSProperties = { fontSize: 12.5, padding: '8px', borderBottom: `1px solid ${LINE}`, color: '#3C3322' };
const btn: React.CSSProperties = { height: 34, border: `1px solid ${GOLD}`, background: GOLD, color: '#fff', borderRadius: 9, padding: '0 14px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' };
const btnGhost: React.CSSProperties = { ...btn, background: 'transparent', color: GOLD };
const input: React.CSSProperties = { height: 34, border: `1px solid ${LINE}`, borderRadius: 9, padding: '0 10px', fontSize: 12.5, background: '#fff', color: '#3C3322' };

function Pill({ label, color }: { label: string; color: string }) {
  return <span style={{ fontSize: 11, fontWeight: 700, color, background: `${color}1A`, borderRadius: 999, padding: '2px 9px' }}>{label}</span>;
}
const pctText = (v: number | null) => (v == null ? '—' : `${v}%`);
function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ border: `1px solid ${LINE}`, borderRadius: 10, padding: '10px 12px', background: '#FFFDF9' }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: '#9B8B78' }}>{label}</div>
      <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, marginTop: 2, color: '#2C2118' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#A99B86', marginTop: 1 }}>{sub}</div>}
    </div>
  );
}

export default function AiReceptionistScreen() {
  const [tenantId, setTenantId] = useState('');
  const [committed, setCommitted] = useState('');
  const { ask, askUi } = useInlineAsk();
  const [keys, setKeys] = useState<VoiceKey[] | null>(null);
  const [calls, setCalls] = useState<CallOutcomeRecord[] | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [activePrompt, setActivePrompt] = useState<VoicePromptVersion | null>(null);
  const [analytics, setAnalytics] = useState<VoiceAnalytics | null>(null);
  const [gwMetrics, setGwMetrics] = useState<GatewayMetrics | null>(null);
  const [fleet, setFleet] = useState<FleetSummary | null>(null);
  const [provMetrics, setProvMetrics] = useState<ProvisioningMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<{ raw: string; label: string } | null>(null);
  const [branchId, setBranchId] = useState('');
  const [label, setLabel] = useState('');

  const load = useCallback(async (tid: string) => {
    if (!tid) return;
    setLoading(true); setError(null);
    try {
      const [k, c, s, p] = await Promise.all([
        superAdminVoiceApi.listKeys(tid),
        superAdminVoiceApi.listCalls(tid, { limit: 25 }),
        superAdminVoiceApi.listSuggestions(tid, 'open'),
        superAdminVoiceApi.activePrompt(tid).catch(() => null),
      ]);
      setKeys(k); setCalls(c); setSuggestions(s); setActivePrompt(p);
      superAdminVoiceApi.analytics(tid).then(setAnalytics).catch(() => setAnalytics(null));
      superAdminVoiceApi.gatewayMetrics().then(setGwMetrics).catch(() => setGwMetrics(null));
    } catch (e: any) { setError(e?.message || 'Could not load AI receptionist data.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (committed) void load(committed); }, [committed, load]);
  const mayVoice = useCan()('super_admin.communications.view');   // the voice fleet is a Communications read
  useEffect(() => { if (!mayVoice) return; superAdminVoiceApi.fleet().then(setFleet).catch(() => setFleet(null)); superAdminVoiceApi.provisioningMetrics().then(setProvMetrics).catch(() => setProvMetrics(null)); }, [mayVoice]);

  async function issue() {
    if (!committed || !branchId.trim() || !label.trim()) { setError('Tenant, branch, and a label are required to issue a key.'); return; }
    try {
      const res = await superAdminVoiceApi.issueKey({ tenantId: committed, branchId: branchId.trim(), label: label.trim() });
      setNewKey({ raw: res.raw, label: label.trim() }); setLabel(''); setBranchId('');
      await load(committed);
    } catch (e: any) { setError(e?.message || 'Could not issue key.'); }
  }
  async function revoke(id: string) {
    try { await superAdminVoiceApi.revokeKey(committed, id); await load(committed); }
    catch (e: any) { setError(e?.message || 'Could not revoke key.'); }
  }
  async function decide(id: string, approve: boolean) {
    if (approve) {
      ask('Approving drafts a new prompt version — it will NOT go live until you activate it.\n\nPaste the new prompt text for the draft:',
        (body) => { void applyDecision(id, body); },
        { multiline: true, inputLabel: 'New prompt text', confirmLabel: 'Approve draft' });
      return;
    }
    await applyDecision(id, null);
  }
  async function applyDecision(id: string, body: string | null) {
    try {
      if (body != null) await superAdminVoiceApi.approveSuggestion(committed, id, body);
      else await superAdminVoiceApi.rejectSuggestion(committed, id);
      await load(committed);
    } catch (e: any) { setError(e?.message || 'Could not update suggestion.'); }
  }

  return (
    <div style={{ padding: 20, overflow: 'auto' }}>
      {askUi}
      <div className='flex flex-col md:flex-row justify-between gap-3 mb-3 '>
        <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 21 }}>AI Receptionist</h1>
        <span style={{ fontSize: 11.5, color: '#9B8B78' }}>Manage voice keys, review calls, and approve learning changes</span>
      </div>

      <div style={{ ...panel, display: 'flex', gap: 10, alignItems: 'center' }}>
        <label style={{ fontSize: 12.5, color: '#7A6C57' }}>Tenant ID</label>
        <input style={{ ...input, width: 320 }} value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="Enter the tenant you're managing" onKeyDown={(e) => { if (e.key === 'Enter') setCommitted(tenantId.trim()); }} />
        <button style={btn} onClick={() => setCommitted(tenantId.trim())}>Load</button>
        {loading && <span style={{ fontSize: 12, color: '#9B8B78' }}>Loading…</span>}
      </div>

      {error && <div style={{ ...panel, borderColor: '#E4B4AC', background: '#FBF0EE', color: '#9A4436', fontSize: 12.5 }}>{error}</div>}

      {!committed ? (
        <div style={{ ...panel, textAlign: 'center', color: '#9B8B78', fontSize: 13 }}>Enter a tenant ID to manage its AI receptionist.</div>
      ) : (
        <>
          {/* Integration keys */}
          <section style={panel}>
            <h2 style={h2}>Integration keys</h2>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              <input style={{ ...input, width: 240 }} value={branchId} onChange={(e) => setBranchId(e.target.value)} placeholder="Branch ID" />
              <input style={{ ...input, width: 240 }} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (e.g. Retell — Main St)" />
              <button style={btn} onClick={issue}>Issue key</button>
            </div>
            {newKey && (
              <div style={{ border: `1px solid ${GOLD}`, background: '#FBF4E6', borderRadius: 9, padding: 12, marginBottom: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: GOLD, marginBottom: 4 }}>Copy this key now — it won't be shown again</div>
                <code style={{ fontSize: 13, wordBreak: 'break-all' }}>{newKey.raw}</code>
                <div style={{ marginTop: 8 }}><button style={btnGhost} onClick={() => { navigator.clipboard?.writeText(newKey.raw); }}>Copy</button> <button style={{ ...btnGhost, borderColor: LINE, color: '#7A6C57' }} onClick={() => setNewKey(null)}>Done</button></div>
              </div>
            )}
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Label</th><th style={th}>Prefix</th><th style={th}>Provider</th><th style={th}>Last used</th><th style={th}>Status</th><th style={th}></th></tr></thead>
              <tbody>
                {(keys ?? []).map((k) => { const st = keyStatus(k); return (
                  <tr key={k.id}>
                    <td style={td}>{dash(k.label)}</td>
                    <td style={td}><code>{k.prefix}…</code></td>
                    <td style={td}>{titleCase(k.provider)}</td>
                    <td style={td}>{fmt(k.lastUsedMs)}</td>
                    <td style={td}><Pill label={st.label} color={st.color} /></td>
                    <td style={td}>{k.revokedMs == null && <button style={{ ...btnGhost, height: 28, borderColor: '#E4B4AC', color: '#B85B4D' }} onClick={() => revoke(k.id)}>Revoke</button>}</td>
                  </tr>
                ); })}
                {keys && keys.length === 0 && <tr><td style={{ ...td, color: '#9B8B78' }} colSpan={6}>No keys yet. Issue one to connect a voice provider.</td></tr>}
              </tbody>
            </table>
          </section>

          {/* Analytics */}
          <section style={panel}>
            <h2 style={h2}>Call analytics</h2>
            {analytics && analytics.totalCalls > 0 ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
                  <Metric label="Calls" value={String(analytics.totalCalls)} />
                  <Metric label="Booked" value={pctText(analytics.bookingRatePct)} sub={`${analytics.booked} calls`} />
                  <Metric label="Handoffs" value={pctText(analytics.handoffRatePct)} sub={`${analytics.handoffs} calls`} />
                  <Metric label="Abandoned" value={pctText(analytics.abandonmentRatePct)} sub={`${analytics.abandoned} calls`} />
                  <Metric label="Tool failures" value={pctText(analytics.toolFailureRatePct)} sub={`${analytics.callsWithToolFailure} calls`} />
                  <Metric label="Avg duration" value={analytics.avgDurationSeconds != null ? `${Math.floor(analytics.avgDurationSeconds / 60)}m ${analytics.avgDurationSeconds % 60}s` : '—'} />
                </div>
                {analytics.topIntents.length > 0 && (
                  <div style={{ marginTop: 12, fontSize: 12, color: '#7A6C57' }}>
                    Top intents: {analytics.topIntents.map((t) => `${titleCase(t.intent)} (${t.count})`).join(' · ')}
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontSize: 12.5, color: '#9B8B78' }}>No calls yet — analytics will appear once the receptionist starts taking calls.</div>
            )}
          </section>

          {/* Platform fleet — cross-tenant rollup (aggregates only, no per-tenant data) */}
          <section style={panel}>
            <h2 style={h2}>Platform fleet</h2>
            {fleet && fleet.connected ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
                  <Metric label="Tenants with agents" value={String(fleet.tenantsWithAgents)} />
                  <Metric label="Live agents" value={String(fleet.agentsByStatus.live ?? 0)} />
                  <Metric label="Draft agents" value={String(fleet.agentsByStatus.draft ?? 0)} />
                  <Metric label="Provisioning failures" value={String(fleet.provisioningFailures)} />
                  <Metric label="Open follow-ups" value={String(fleet.openFollowUps)} />
                </div>
                {Object.keys(fleet.agentsByStatus).length > 0 && (
                  <div style={{ marginTop: 12, fontSize: 12, color: '#7A6C57' }}>
                    Agents by status: {Object.entries(fleet.agentsByStatus).map(([s, n]) => `${s} (${n})`).join(' · ')}
                  </div>
                )}
                {provMetrics && provMetrics.attempts > 0 && (
                  <div style={{ marginTop: 8, fontSize: 12, color: '#7A6C57' }}>
                    Provisioning (since {new Date(provMetrics.since).toLocaleString()}): {provMetrics.attempts} attempts, {provMetrics.succeeded} ok / {provMetrics.failed} failed{provMetrics.successRatePct != null ? ` (${provMetrics.successRatePct}% success)` : ''}{Object.keys(provMetrics.byErrorCode).length > 0 ? ` — ${Object.entries(provMetrics.byErrorCode).map(([c, n]) => `${c} (${n})`).join(' · ')}` : ''}
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontSize: 12.5, color: '#9B8B78' }}>No AI receptionist agents across the platform yet — this rollup fills in as tenants create agents.</div>
            )}
          </section>

          {/* Gateway health — in-process, since server start */}
          <section style={panel}>
            <h2 style={h2}>Gateway health</h2>
            {gwMetrics && gwMetrics.totalRequests > 0 ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
                  <Metric label="Requests" value={String(gwMetrics.totalRequests)} />
                  <Metric label="Success" value={gwMetrics.successRatePct == null ? '—' : `${gwMetrics.successRatePct}%`} sub={`${gwMetrics.totalErrors} errors`} />
                  <Metric label="Idempotent replays" value={String(gwMetrics.idempotentReplays)} />
                  <Metric label="Rate-limit hits" value={String(gwMetrics.rateLimitEvents)} />
                  <Metric label="Handoffs" value={String(gwMetrics.handoffs)} />
                </div>
                {Object.keys(gwMetrics.byErrorCode).length > 0 && (
                  <div style={{ marginTop: 12, fontSize: 12, color: '#7A6C57' }}>
                    Errors by code: {Object.entries(gwMetrics.byErrorCode).map(([code, n]) => `${code} (${n})`).join(' · ')}
                  </div>
                )}
                <div style={{ marginTop: 8, fontSize: 11, color: '#9B8B78' }}>In-process counters since {new Date(gwMetrics.since).toLocaleString()} — reset on server restart.</div>
              </>
            ) : (
              <div style={{ fontSize: 12.5, color: '#9B8B78' }}>No gateway traffic yet this session — health metrics appear once Retell functions start calling the gateway.</div>
            )}
          </section>

          {/* Call history */}
          <section style={panel}>
            <h2 style={h2}>Recent calls</h2>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Started</th><th style={th}>Booking</th><th style={th}>Handoff</th><th style={th}>Intents</th><th style={th}>Tools</th><th style={th}>Follow-up</th></tr></thead>
              <tbody>
                {(calls ?? []).map((c) => {
                  const failed = c.toolCalls.filter((t) => !t.ok).length;
                  return (
                    <tr key={c.id}>
                      <td style={td}>{fmtIso(c.startedAt)}</td>
                      <td style={td}>{dash(c.bookingOutcome)}</td>
                      <td style={td}>{dash(c.handoffOutcome)}</td>
                      <td style={td}>{c.intents.length ? c.intents.map(titleCase).join(', ') : '—'}</td>
                      <td style={td}>{c.toolCalls.length ? `${c.toolCalls.length}${failed ? ` (${failed} failed)` : ''}` : '—'}</td>
                      <td style={td}>{c.followUpRequired ? <Pill label="Needed" color="#D09A36" /> : '—'}</td>
                    </tr>
                  );
                })}
                {calls && calls.length === 0 && <tr><td style={{ ...td, color: '#9B8B78' }} colSpan={6}>No calls recorded yet.</td></tr>}
              </tbody>
            </table>
            <div style={{ marginTop: 10, fontSize: 11, color: '#A99B86' }}>Call metadata only — transcripts and recordings are governed by your retention policy and are not shown here.</div>
          </section>

          {/* Learning review */}
          <section style={panel}>
            <h2 style={h2}>Learning review</h2>
            <div style={{ fontSize: 12, color: '#7A6C57', marginBottom: 10 }}>
              Active prompt: <strong>{activePrompt ? `${activePrompt.versionLabel} (activated ${fmt(activePrompt.activatedMs)})` : '—'}</strong>
              {activePrompt && <button style={{ ...btnGhost, height: 28, marginLeft: 10 }} onClick={async () => { try { await superAdminVoiceApi.rollbackPrompt(committed); await load(committed); } catch (e: any) { setError(e?.message || 'Nothing to roll back to.'); } }}>Roll back</button>}
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr><th style={th}>Category</th><th style={th}>Target</th><th style={th}>Detail</th><th style={th}>From call</th><th style={th}></th></tr></thead>
              <tbody>
                {(suggestions ?? []).map((s) => (
                  <tr key={s.id}>
                    <td style={td}>{titleCase(s.category)}</td>
                    <td style={td}>{titleCase(s.targetType)}</td>
                    <td style={td}>{s.detail}</td>
                    <td style={td}>{dash(s.sourceCallId)}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>
                      <button style={{ ...btnGhost, height: 28 }} onClick={() => decide(s.id, true)}>Approve</button>{' '}
                      <button style={{ ...btnGhost, height: 28, borderColor: LINE, color: '#7A6C57' }} onClick={() => decide(s.id, false)}>Reject</button>
                    </td>
                  </tr>
                ))}
                {suggestions && suggestions.length === 0 && <tr><td style={{ ...td, color: '#9B8B78' }} colSpan={5}>No open suggestions. The receptionist flags calls worth reviewing here.</td></tr>}
              </tbody>
            </table>
            <div style={{ marginTop: 10, fontSize: 11, color: '#A99B86' }}>Approving a suggestion drafts a new prompt version for your review — it never goes live until you activate it.</div>
          </section>
        </>
      )}
    </div>
  );
}
