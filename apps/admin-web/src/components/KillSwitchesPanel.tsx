// KillSwitchesPanel — Constitution 7 §34: the platform's emergency kill switches in one place. Each flip needs a reason;
// the server adds step-up (the shared "Confirm it's you" prompt) and records the change. Each switch keeps its own
// control on the server — this panel calls it, it does not copy the state.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';

interface KS { key: string; label: string; stops: string; active: boolean; reason: string | null; since: string | null }
const flip = (k: KS, active: boolean, reason: string) =>
  k.key === 'ai.auto_actions' || k.key === 'deals.engine' || k.key.startsWith('payments.') ? api.post(`/super-admin/kill-switches/${k.key}`, { active, reason })
  : k.key === 'sms.emergency_send' ? api.post('/super-admin/sms-packages/platform-controls', { key: 'sms.emergency_send_disabled', enabled: active, reason })
  : api.post('/super-admin/booking-verification/emergency-disable', { disabled: active, reason });

export function KillSwitchesPanel() {
  const [rows, setRows] = useState<KS[] | 'error' | null>(null);
  const [edit, setEdit] = useState<{ key: string; active: boolean; reason: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => { api.get<KS[]>('/super-admin/kill-switches').then(setRows).catch(() => setRows('error')); }, []);
  useEffect(load, [load]);
  const apply = async (k: KS) => {
    if (!edit) return;
    setMsg(null);
    try { await flip(k, edit.active, edit.reason.trim()); setEdit(null); load(); }
    catch (e: any) { setMsg(e?.message || 'The switch could not be changed.'); }
  };
  return (
    <div className="panel" data-testid="kill-switches" style={{ marginBottom: 12 }}>
      <div className="phead"><h2>Kill Switches</h2><span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>emergency stops · reason + step-up required</span></div>
      {msg ? <div className="error" role="alert">{msg}</div> : null}
      {rows === null ? <div className="state">Loading…</div> : rows === 'error' ? <div className="state">Kill switches could not be read.</div> : rows.map((k) => (
        <div key={k.key} className="dkv" style={{ alignItems: 'flex-start', gap: 12, padding: '6px 0' }}>
          <div>
            <b>{k.label}</b> <span className="badge" style={{ background: k.active ? '#FBEFE9' : '#EAF5EE', color: k.active ? '#B85B4D' : '#3E8F57' }}>{k.active ? 'STOPPED' : 'Running'}</span>
            <div className="muted" style={{ fontSize: 12 }}>{k.stops}</div>
            {k.active && (k.reason || k.since) ? <div style={{ fontSize: 12 }}>{k.reason ? `Reason: ${k.reason}` : ''}{k.since ? ` · since ${new Date(k.since).toLocaleString()}` : ''}</div> : null}
            {edit?.key === k.key ? (
              <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                <input aria-label={`Reason for ${k.label}`} placeholder="Reason (required)" value={edit.reason} onChange={(e) => setEdit({ ...edit, reason: e.target.value })} style={{ minWidth: 220 }} />
                <button className="btn" disabled={edit.reason.trim().length < 10} onClick={() => apply(k)}>{edit.active ? 'Stop now' : 'Resume'}</button>
                <button className="btn ghost" onClick={() => setEdit(null)}>Cancel</button>
              </div>
            ) : null}
          </div>
          {edit?.key === k.key ? null : <button className="btn ghost" onClick={() => { setMsg(null); setEdit({ key: k.key, active: !k.active, reason: '' }); }}>{k.active ? 'Resume…' : 'Stop…'}</button>}
        </div>
      ))}
    </div>
  );
}
