import { useCallback, useEffect, useState } from 'react';
import { useInlineAsk } from '@aipowersalon/ui';
import { NotConnected } from './_chartkit';
import {
  getCredentialSummary, listSyncJobs, retrySyncJob, enqueueSync, listConnectionWebhookEvents, retryWebhookEvent,
  getConnectionReliability, resetCircuitBreaker, refreshAuthentication, testConnectionLive, rotateCredential,
  type ManagedConnection, type SyncJob, type InboundWebhookEvent, type ReliabilityState,
} from '../api/superAdminIntegrationsApi';

// ConnectionDetailDrawer — the operator view of one integration_connection, wiring the seven backend units:
// masked credentials, sync jobs (+retry), inbound webhook events (+retry), and reliability/circuit-breaker (+reset).
// No secret is ever shown; rotate takes a new secret + reason inline and surfaces only the resulting mask.

const OK = 'var(--ok)', WARN = 'var(--warn)', DANGER = 'var(--danger)', MUTED = 'var(--muted)';
const tone = (s: string) => /active|valid|healthy|successful|processed|delivered|closed/i.test(s) ? OK : /warn|expir|delay|pending|reauth|queued|half_open|degraded/i.test(s) ? WARN : /fail|expired|invalid|disabled|revoked|error|dead|rejected|open/i.test(s) ? DANGER : MUTED;
const Badge = ({ v }: { v: string }) => <span style={{ fontSize: 10, fontWeight: 700, color: tone(v), background: tone(v) + '18', borderRadius: 4, padding: '1px 6px', whiteSpace: 'nowrap' }}>{v}</span>;
const Row = ({ k, v }: { k: string; v: React.ReactNode }) => <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '3px 0', fontSize: 12 }}><span style={{ color: MUTED }}>{k}</span><span style={{ fontWeight: 600, textAlign: 'right' }}>{v}</span></div>;

export function ConnectionDetailDrawer({ conn, onClose, onChanged }: { conn: ManagedConnection; onClose: () => void; onChanged: () => void }) {
  const [cred, setCred] = useState<{ connection: any; credentials: { id: string; kind: string; masked_value: string; status: string }[] } | null>(null);
  const [jobs, setJobs] = useState<SyncJob[] | null>(null);
  const [events, setEvents] = useState<InboundWebhookEvent[] | null>(null);
  const { ask, askUi } = useInlineAsk();
  const [rel, setRel] = useState<ReliabilityState | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rotate, setRotate] = useState(false); const [secret, setSecret] = useState(''); const [reason, setReason] = useState('');

  const load = useCallback(() => {
    getCredentialSummary(conn.id).then((r) => setCred({ connection: r.connection, credentials: r.credentials })).catch(() => setCred({ connection: null, credentials: [] }));
    listSyncJobs(conn.id).then((r) => setJobs(r.jobs)).catch(() => setJobs([]));
    listConnectionWebhookEvents(conn.id).then((r) => setEvents(r.events)).catch(() => setEvents([]));
    getConnectionReliability(conn.id).then(setRel).catch(() => setRel(null));
  }, [conn.id]);
  useEffect(() => { load(); }, [load]);

  async function act(fn: () => Promise<string>) { setBusy(true); setMsg(null); try { setMsg(await fn()); load(); onChanged(); } catch (e: any) { setMsg(e?.message ?? 'Action failed.'); } finally { setBusy(false); } }
  const doTest = () => act(async () => { const r = await testConnectionLive(conn.id); return r.result.succeeded ? `Test succeeded (${r.result.latencyMs ?? '—'} ms).` : `Test failed — ${r.result.errorCategory ?? 'check credentials'}.`; });
  const doRefresh = () => act(async () => { const r = await refreshAuthentication(conn.id); return `Authentication ${r.authenticationStatus}.`; });
  const doSync = () => act(async () => { const r = await enqueueSync(conn.id, { syncType: 'incremental' }); return `Sync ${r.deduped ? 'already queued' : 'queued'} (job ${r.jobId.slice(0, 8)}…).`; });
  const doRetryJob = (id: string) => act(async () => { const r = await retrySyncJob(id); return `Sync job ${r.jobStatus}.`; });
  const doRetryEvent = (id: string) => act(async () => { const r = await retryWebhookEvent(id); return `Webhook event ${r.eventStatus}.`; });
  const doReset = () => ask('Reason to reset the circuit breaker?', (why) => act(async () => { const r = await resetCircuitBreaker(conn.id, why); return `Circuit breaker ${r.breakerState}.`; }));
  const doRotate = () => act(async () => { const r = await rotateCredential(conn.id, { newSecret: secret, reason }); setRotate(false); setSecret(''); setReason(''); return `Credential rotated (${r.maskedCredential}).`; });

  const panel: React.CSSProperties = { background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 10, padding: 12 };
  const h: React.CSSProperties = { fontSize: 12.5, fontWeight: 700, marginBottom: 6 };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', justifyContent: 'flex-end', zIndex: 50 }} role="dialog" aria-modal="true" aria-label="Connection detail" onClick={onClose}>
      <div style={{ width: 'min(560px, 96vw)', height: '100%', background: 'var(--page)', overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div><h2 style={{ margin: 0, fontSize: 17 }}>{conn.provider_key}</h2><div style={{ fontSize: 11, color: MUTED }}>{conn.category} · {conn.ownership_type}</div></div>
          <button className="btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {msg && <div className="card" style={{ padding: 8, fontSize: 12, border: `1px solid ${OK}` }}>{msg}</div>}

        <div style={panel}>
          <div style={h}>Status</div>
          <Row k="Connection" v={<Badge v={conn.connection_status} />} />
          <Row k="Authentication" v={<Badge v={conn.authentication_status} />} />
          <Row k="Sync" v={<Badge v={conn.sync_status} />} />
          <Row k="Webhook" v={<Badge v={conn.webhook_status} />} />
          <Row k="Provider account" v={conn.provider_account ?? '—'} />
          <Row k="Scopes" v={(conn.granted_scopes ?? []).length ? conn.granted_scopes.join(', ') : '—'} />
          <Row k="Token expires" v={conn.token_expires_at ? conn.token_expires_at.slice(0, 10) : '—'} />
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <button className="btn" disabled={busy} onClick={doTest}>Test</button>
            <button className="btn" disabled={busy} onClick={doSync}>Sync</button>
            {conn.auth_method === 'oauth2' && <button className="btn" disabled={busy} onClick={doRefresh}>Refresh Auth</button>}
          </div>
        </div>

        <div style={panel}>
          <div style={{ ...h, display: 'flex', justifyContent: 'space-between' }}>Credentials <button className="btn" style={{ padding: '1px 8px', fontSize: 10.5 }} onClick={() => setRotate(!rotate)}>Rotate</button></div>
          {!cred ? <NotConnected>Loading…</NotConnected> : cred.credentials.length === 0 ? <div style={{ fontSize: 11, color: MUTED }}>No stored credentials.</div>
            : cred.credentials.map((c) => <Row key={c.id} k={c.kind} v={<span><code style={{ fontSize: 11 }}>{c.masked_value}</code> <Badge v={c.status} /></span>} />)}
          {rotate && (
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input className="inp" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="new secret" style={{ fontSize: 11, padding: '3px 6px', width: 140 }} />
              <input className="inp" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="reason" style={{ fontSize: 11, padding: '3px 6px', width: 120 }} />
              <button className="btn primary" style={{ padding: '3px 8px', fontSize: 11 }} disabled={busy || !secret || !reason} onClick={doRotate}>Save</button>
            </div>
          )}
        </div>

        <div style={panel}>
          <div style={h}>Reliability</div>
          {!rel ? <NotConnected>—</NotConnected> : (<>
            <Row k="Circuit breaker" v={<Badge v={rel.breaker?.state ?? 'closed'} />} />
            <Row k="Failures" v={`${rel.breaker?.failure_count ?? 0}${rel.breaker?.failure_threshold ? ` / ${rel.breaker.failure_threshold}` : ''}`} />
            {(rel.rateLimits ?? []).slice(0, 4).map((r, i) => <Row key={i} k={`Rate · ${r.scope_type}`} v={`${r.count}/${r.limit_per_window} per ${r.window_seconds}s`} />)}
            {(rel.breaker?.state === 'open' || (rel.breaker?.failure_count ?? 0) > 0) && <div style={{ marginTop: 8 }}><button className="btn" disabled={busy} onClick={doReset}>Reset Circuit Breaker</button></div>}
          </>)}
        </div>

        <div style={panel}>
          <div style={h}>Sync Jobs</div>
          {!jobs ? <NotConnected>Loading…</NotConnected> : jobs.length === 0 ? <div style={{ fontSize: 11, color: MUTED }}>No sync jobs.</div>
            : jobs.slice(0, 8).map((j) => (
              <div key={j.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 11, borderTop: '1px solid var(--line)' }}>
                <span>{j.sync_type} · <Badge v={j.status} /></span>
                <span style={{ color: MUTED }}>r{j.items_read}/c{j.items_created}/s{j.items_skipped}/f{j.items_failed}</span>
                {(j.status === 'failed' || j.status === 'partial') && <button className="btn" style={{ padding: '1px 6px', fontSize: 10 }} disabled={busy} onClick={() => doRetryJob(j.id)}>Retry</button>}
              </div>
            ))}
        </div>

        <div style={panel}>
          <div style={h}>Inbound Webhook Events</div>
          {!events ? <NotConnected>Loading…</NotConnected> : events.length === 0 ? <div style={{ fontSize: 11, color: MUTED }}>No inbound events.</div>
            : events.slice(0, 10).map((e) => (
              <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: 11, borderTop: '1px solid var(--line)' }}>
                <span>{e.event_type ?? e.provider_event_id} · <Badge v={e.status} /></span>
                <span style={{ color: MUTED, display: 'flex', gap: 4 }}>{e.signature_result !== 'valid' && <Badge v={e.signature_result} />}{e.replay_result === 'blocked' && <Badge v="replay" />}</span>
                {e.status === 'failed' && <button className="btn" style={{ padding: '1px 6px', fontSize: 10 }} disabled={busy} onClick={() => doRetryEvent(e.id)}>Retry</button>}
              </div>
            ))}
        </div>
      </div>
      {askUi}
    </div>
  );
}
