import { useEffect, useState, useCallback } from 'react';
import { useInlineAsk } from '@aipowersalon/ui';
import { NotConnected } from './_chartkit';
import { ConnectionDetailDrawer } from './ConnectionDetailDrawer';
import {
  listConnections, refreshAuthentication, testConnectionLive, disableConnectionLifecycle, rotateCredential,
  enqueueSync,
  type ManagedConnection,
} from '../api/superAdminIntegrationsApi';

// ManagedConnections — the real integration_connections created via the wizard, with live per-row lifecycle actions
// (Test / Refresh Auth / Rotate / Disable) wired to the audited backend. Connection/auth/sync/webhook are shown as
// separate badges. No secret is ever shown — rotation takes a new secret + reason inline and displays only the mask.

const OK = 'var(--ok)', WARN = 'var(--warn)', DANGER = 'var(--danger)', MUTED = 'var(--muted)', G7 = 'var(--g7)';
const tone = (s: string) => /active|valid|healthy|successful/i.test(s) ? OK : /warn|expir|delay|pending|reauth/i.test(s) ? WARN : /fail|expired|invalid|disabled|revoked|error/i.test(s) ? DANGER : MUTED;
const Badge = ({ v }: { v: string }) => <span style={{ fontSize: 10, fontWeight: 700, color: tone(v), background: tone(v) + '18', borderRadius: 4, padding: '1px 6px', whiteSpace: 'nowrap' }}>{v}</span>;

export function ManagedConnections({ reloadKey }: { reloadKey: number }) {
  const [rows, setRows] = useState<ManagedConnection[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const { ask, askUi } = useInlineAsk();
  const [rotateId, setRotateId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ManagedConnection | null>(null);
  const [secret, setSecret] = useState(''); const [reason, setReason] = useState('');

  const load = useCallback(() => { listConnections().then((r) => setRows(r.connections)).catch(() => setRows([])); }, []);
  useEffect(() => { load(); }, [load, reloadKey]);

  async function act(id: string, fn: () => Promise<string>) { setBusyId(id); setMsg(null); try { setMsg(await fn()); load(); } catch (e: any) { setMsg(e?.message ?? 'Action failed.'); } finally { setBusyId(null); } }
  const doTest = (c: ManagedConnection) => act(c.id, async () => { const r = await testConnectionLive(c.id); return r.result.succeeded ? `${c.provider_key}: test succeeded (${r.result.latencyMs ?? '—'} ms).` : `${c.provider_key}: test failed — ${r.result.errorCategory ?? 'check credentials'}.`; });
  const doRefresh = (c: ManagedConnection) => act(c.id, async () => { const r = await refreshAuthentication(c.id); return `${c.provider_key}: authentication ${r.authenticationStatus}.`; });
  const doSync = (c: ManagedConnection) => act(c.id, async () => { const r = await enqueueSync(c.id, { syncType: 'incremental' }); return `${c.provider_key}: sync ${r.deduped ? 'already queued' : 'queued'} (job ${r.jobId.slice(0, 8)}…) — a worker drains the queue.`; });
  const doDisable = (c: ManagedConnection) => ask(`Reason for disabling ${c.provider_key}?`, (why) => act(c.id, async () => { await disableConnectionLifecycle(c.id, why); return `${c.provider_key}: disabled — credentials revoked, history preserved.`; }));
  const submitRotate = (c: ManagedConnection) => act(c.id, async () => { const r = await rotateCredential(c.id, { newSecret: secret, reason }); setRotateId(null); setSecret(''); setReason(''); return `${c.provider_key}: credential rotated (${r.maskedCredential}).`; });

  return (
    <div className="panel">
      <div className="phead"><h2 style={{ fontSize: 14 }}>Managed Connections</h2></div>
      {msg && <div className="card" style={{ padding: 8, fontSize: 12, marginBottom: 8, border: `1px solid ${OK}` }}>{msg}</div>}
      <div className="max-h-[38vh] overflow-auto">
        <table className="w-full min-w-[900px] border-collapse text-[11px]">
          <thead><tr style={{ textAlign: 'left', color: MUTED, fontSize: 9.5 }}>{['Provider', 'Ownership', 'Connection', 'Auth', 'Webhook', 'Account', 'Actions'].map((h) => <th key={h} style={{ padding: '5px 5px', fontWeight: 600 }}>{h}</th>)}</tr></thead>
          <tbody>
            {!rows ? <tr><td colSpan={7} style={{ padding: 14 }}><NotConnected>Loading connections…</NotConnected></td></tr>
              : rows.length === 0 ? <tr><td colSpan={7} style={{ padding: 14 }}><NotConnected>No managed connections yet — use “+ Add Integration”.</NotConnected></td></tr>
                : rows.map((c) => (
                  <tr key={c.id} style={{ borderTop: '1px solid var(--line)' }}>
                    <td style={{ padding: '5px 5px', fontWeight: 600 }}>{c.provider_key}<div style={{ fontSize: 9, color: MUTED }}>{c.category}</div></td>
                    <td style={{ padding: '5px 5px', color: MUTED }}>{c.ownership_type}</td>
                    <td style={{ padding: '5px 5px' }}><Badge v={c.connection_status} /></td>
                    <td style={{ padding: '5px 5px' }}><Badge v={c.authentication_status} /></td>
                    <td style={{ padding: '5px 5px' }}><Badge v={c.webhook_status} /></td>
                    <td style={{ padding: '5px 5px', color: MUTED }}>{c.provider_account ?? '—'}</td>
                    <td style={{ padding: '5px 5px' }}>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        <button className="btn" style={{ padding: '2px 6px', fontSize: 10 }} onClick={() => setDetail(c)}>Details</button>
                        <button className="btn" style={{ padding: '2px 6px', fontSize: 10 }} disabled={busyId === c.id || c.connection_status === 'disabled'} onClick={() => doSync(c)}>Sync</button>
                        <button className="btn" style={{ padding: '2px 6px', fontSize: 10 }} disabled={busyId === c.id} onClick={() => doTest(c)}>Test</button>
                        {c.auth_method === 'oauth2' && <button className="btn" style={{ padding: '2px 6px', fontSize: 10 }} disabled={busyId === c.id} onClick={() => doRefresh(c)}>Refresh Auth</button>}
                        <button className="btn" style={{ padding: '2px 6px', fontSize: 10 }} onClick={() => setRotateId(rotateId === c.id ? null : c.id)}>Rotate</button>
                        {c.connection_status !== 'disabled' && <button className="btn" style={{ padding: '2px 6px', fontSize: 10, color: DANGER }} disabled={busyId === c.id} onClick={() => doDisable(c)}>Disable</button>}
                      </div>
                      {rotateId === c.id && (
                        <div style={{ display: 'flex', gap: 4, marginTop: 5, flexWrap: 'wrap', alignItems: 'center' }}>
                          <input className="inp" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="new secret" style={{ fontSize: 10, padding: '2px 5px', width: 120 }} />
                          <input className="inp" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="reason" style={{ fontSize: 10, padding: '2px 5px', width: 110 }} />
                          <button className="btn primary" style={{ padding: '2px 6px', fontSize: 10 }} disabled={busyId === c.id || !secret || !reason} onClick={() => submitRotate(c)}>Save</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 6, fontSize: 10, color: MUTED }}>Live records from <span style={{ color: G7 }}>integration_connections</span>. Secrets are encrypted; only masked references are ever shown.</div>
      {detail && <ConnectionDetailDrawer conn={detail} onClose={() => setDetail(null)} onChanged={load} />}
      {askUi}
    </div>
  );
}