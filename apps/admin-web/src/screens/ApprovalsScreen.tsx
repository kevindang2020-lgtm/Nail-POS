// ApprovalsScreen — Constitution 7 §119/§120: maker/checker. Pending requests (approve with step-up, or reject with a
// reason; you can never approve your own), and per-action policy: whether a change needs a second person (off by default).
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';

interface Req { id: string; action: string; label: string; targetRef: string | null; payload: any; reason: string; requestedBy: string; requestedByEmail: string | null; requiredPermission: string; status: string; expiresAt: string; createdAt: string }
interface Policy { action: string; label: string; requiredPermission: string; required: boolean }

export function ApprovalsScreen() {
  const { principal } = useAuth() as any;
  const [rows, setRows] = useState<Req[] | 'error' | null>(null);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [reject, setReject] = useState<{ id: string; note: string } | null>(null);
  const [pol, setPol] = useState<{ action: string; required: boolean; reason: string } | null>(null);
  const load = useCallback(() => {
    api.get<{ rows: Req[] }>('/super-admin/approvals').then((r) => setRows(r.rows)).catch(() => setRows('error'));
    api.get<Policy[]>('/super-admin/approvals/policies').then(setPolicies).catch(() => setPolicies([]));
  }, []);
  useEffect(load, [load]);
  const act = async (fn: () => Promise<unknown>, ok: string) => { setMsg(null); try { await fn(); setMsg({ tone: 'ok', text: ok }); setReject(null); setPol(null); load(); } catch (e: any) { setMsg({ tone: 'err', text: e?.message || 'That did not work.' }); } };
  return (
    <div className="screen">
      {msg ? <div className={msg.tone === 'ok' ? 'notice' : 'error'} role="status" style={{ marginBottom: 8 }}>{msg.text}</div> : null}
      <div className="panel" data-testid="approvals" style={{ marginBottom: 12 }}>
        <div className="phead"><h2>Pending approvals</h2><span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>a second person must approve · expires after 24 h</span></div>
        {rows === null ? <div className="state">Loading…</div> : rows === 'error' ? <div className="state">Approvals could not be loaded.</div>
          : rows.length === 0 ? <div className="state">Nothing is waiting for approval.</div> : rows.map((r) => {
            const mine = principal?.userId && principal.userId === r.requestedBy;
            return (
              <div key={r.id} className="dkv" style={{ alignItems: 'flex-start', padding: '8px 0', gap: 12 }}>
                <div>
                  <b>{r.label}</b>{r.targetRef ? <span className="muted"> · {r.targetRef}</span> : null}
                  <div style={{ fontSize: 12 }}>Reason: {r.reason}</div>
                  <div className="muted" style={{ fontSize: 12 }}>Requested by {r.requestedByEmail || r.requestedBy} · needs {r.requiredPermission} · expires {new Date(r.expiresAt).toLocaleString()}</div>
                  <pre style={{ fontSize: 11, margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{JSON.stringify(r.payload?.input ?? r.payload)}</pre>
                  {reject?.id === r.id ? (
                    <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                      <input aria-label="Rejection reason" placeholder="Why? (required)" value={reject.note} onChange={(e) => setReject({ ...reject, note: e.target.value })} style={{ minWidth: 220 }} />
                      <button className="btn" disabled={reject.note.trim().length < 10} onClick={() => act(() => api.post(`/super-admin/approvals/${r.id}/reject`, { note: reject.note.trim() }), 'Request rejected.')}>Reject</button>
                      <button className="btn ghost" onClick={() => setReject(null)}>Cancel</button>
                    </div>
                  ) : null}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {mine ? <span className="muted" style={{ fontSize: 12 }}>Your request — another person must approve</span> : (
                    <>
                      <button className="btn" onClick={() => act(() => api.post(`/super-admin/approvals/${r.id}/approve`, {}), 'Approved and applied.')}>Approve</button>
                      <button className="btn ghost" onClick={() => setReject({ id: r.id, note: '' })}>Reject…</button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
      </div>
      <div className="panel" data-testid="approval-policies">
        <div className="phead"><h2>Approval policy</h2><span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>off = the change applies immediately</span></div>
        {policies.map((p) => (
          <div key={p.action} className="dkv" style={{ alignItems: 'flex-start', gap: 12 }}>
            <div><b>{p.label}</b> <span className="badge">{p.required ? 'Needs a second approver' : 'Applies immediately'}</span>
              {pol?.action === p.action ? (
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <input aria-label={`Policy reason for ${p.label}`} placeholder="Reason (required)" value={pol.reason} onChange={(e) => setPol({ ...pol, reason: e.target.value })} style={{ minWidth: 220 }} />
                  <button className="btn" disabled={pol.reason.trim().length < 10} onClick={() => act(() => api.post(`/super-admin/approvals/policies/${p.action}`, { required: pol.required, reason: pol.reason.trim() }), 'Policy updated.')}>Save</button>
                  <button className="btn ghost" onClick={() => setPol(null)}>Cancel</button>
                </div>
              ) : null}
            </div>
            {pol?.action === p.action ? null : <button className="btn ghost" onClick={() => setPol({ action: p.action, required: !p.required, reason: '' })}>{p.required ? 'Turn off…' : 'Require approval…'}</button>}
          </div>
        ))}
      </div>
    </div>
  );
}
