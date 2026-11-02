import { useEffect, useState, useCallback } from 'react';
import { superAdminApi } from '../api/superAdminApi';

// Write-side UI for the security-incident engine. Create incidents + advance them through the validated workflow. Only
// the server-valid next statuses are offered per current status (mirrors the state machine); close/reopen require a
// reason. Nothing is faked — every action calls the live API and refetches.

type IncidentRow = { id: string; incidentRef: string; severity: string; status: string; category?: string; assignedTo?: string | null };
const SEVERITIES = ['critical', 'high', 'medium', 'low', 'informational'];
const CATEGORIES = ['authentication', 'session', 'privilege', 'data', 'device', 'network', 'other'];
// Valid next statuses per current status — mirrors incident-core's state machine.
const NEXT: Record<string, string[]> = {
  detected: ['investigating', 'closed'], investigating: ['contained', 'closed'], contained: ['remediating', 'investigating'],
  remediating: ['monitoring', 'closed', 'investigating'], monitoring: ['closed', 'investigating'], closed: ['reopened'], reopened: ['investigating', 'closed'],
};
const cap = (s: string) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
const needsReason = (to: string) => to === 'closed' || to === 'reopened';

export function SecurityIncidentModal({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<IncidentRow[] | null>(null);
  const [title, setTitle] = useState('');
  const [severity, setSeverity] = useState('medium');
  const [category, setCategory] = useState('other');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txnFor, setTxnFor] = useState<string | null>(null);
  const [txnTo, setTxnTo] = useState('');
  const [txnReason, setTxnReason] = useState('');

  const load = useCallback(() => { (superAdminApi.securityIncidents() as Promise<IncidentRow[]>).then(setRows).catch((e: any) => setError(e?.message || 'Failed to load incidents.')); }, []);
  useEffect(() => { load(); }, [load]);

  const doCreate = async () => {
    if (!title.trim()) return;
    setBusy(true); setError(null);
    try { await superAdminApi.securityIncidentCreate({ title, severity, category }); setTitle(''); setSeverity('medium'); setCategory('other'); load(); }
    catch (e: any) { setError(e?.message || 'Create failed.'); }
    finally { setBusy(false); }
  };
  const openTxn = (id: string, status: string) => { setTxnFor(id); setTxnTo((NEXT[status] || [])[0] || ''); setTxnReason(''); };
  const doTxn = async (id: string) => {
    if (!txnTo || (needsReason(txnTo) && !txnReason.trim())) return;
    setBusy(true); setError(null);
    try { await superAdminApi.securityIncidentTransition(id, { toStatus: txnTo, reason: txnReason || null }); setTxnFor(null); load(); }
    catch (e: any) { setError(e?.message || 'Transition failed.'); }
    finally { setBusy(false); }
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,16,10,0.36)', zIndex: 60, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '4vh 12px' }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Manage incident-response records" style={{ width: 'min(720px, 96vw)', maxHeight: '92vh', overflow: 'auto', background: 'var(--card, #fff)', borderRadius: 10, boxShadow: '0 18px 48px rgba(0,0,0,0.24)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
          <b>Incident-Response Records</b>
          <button className="btn ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {error && <div role="alert" style={{ fontSize: 12, background: '#FBE7E4', border: '1px solid #E7B4AC', borderRadius: 8, padding: '8px 12px', color: '#8A2A1B' }}>{error}</div>}

          <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Open a new incident</div>
            <label style={{ fontSize: 10.5 }} className="muted">Title
              <input className="inp" style={{ width: '100%', height: 32, marginTop: 2 }} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="short description" />
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, marginTop: 8, alignItems: 'end' }}>
              <label style={{ fontSize: 10.5 }} className="muted">Severity
                <select className="inp" style={{ width: '100%', height: 32, marginTop: 2 }} value={severity} onChange={(e) => setSeverity(e.target.value)}>{SEVERITIES.map((x) => <option key={x} value={x}>{cap(x)}</option>)}</select>
              </label>
              <label style={{ fontSize: 10.5 }} className="muted">Category
                <select className="inp" style={{ width: '100%', height: 32, marginTop: 2 }} value={category} onChange={(e) => setCategory(e.target.value)}>{CATEGORIES.map((x) => <option key={x} value={x}>{cap(x)}</option>)}</select>
              </label>
              <button className="btn" onClick={doCreate} disabled={busy || !title.trim()}>Open incident</button>
            </div>
          </div>

          <div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Incidents</div>
            {rows === null ? <div className="muted" style={{ fontSize: 12 }}>Loading…</div>
              : rows.length === 0 ? <div className="muted" style={{ fontSize: 12 }}>No incidents recorded.</div>
              : (
                <table className="tgrid" style={{ width: '100%', fontSize: 11.5 }}>
                  <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10 }}><th>Incident</th><th>Severity</th><th>Status</th><th>Advance</th></tr></thead>
                  <tbody>{rows.map((r) => (
                    <tr key={r.id}>
                      <td style={{ fontFamily: 'monospace', fontSize: 10.5 }}>{r.incidentRef}</td>
                      <td>{cap(r.severity)}</td>
                      <td><span style={{ fontWeight: 600 }}>{cap(r.status)}</span></td>
                      <td>
                        {txnFor === r.id ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <select className="inp" style={{ height: 28, fontSize: 11 }} value={txnTo} onChange={(e) => setTxnTo(e.target.value)}>{(NEXT[r.status] || []).map((x) => <option key={x} value={x}>{cap(x)}</option>)}</select>
                            {needsReason(txnTo) && <input className="inp" style={{ height: 28, fontSize: 11 }} value={txnReason} onChange={(e) => setTxnReason(e.target.value)} placeholder="reason (required)" />}
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button className="btn" style={{ height: 26, fontSize: 10.5 }} disabled={busy || !txnTo || (needsReason(txnTo) && !txnReason.trim())} onClick={() => doTxn(r.id)}>Apply</button>
                              <button className="btn ghost" style={{ height: 26, fontSize: 10.5 }} onClick={() => setTxnFor(null)}>Cancel</button>
                            </div>
                          </div>
                        ) : (NEXT[r.status] || []).length ? <button className="linkbtn" style={{ fontSize: 10.5 }} onClick={() => openTxn(r.id, r.status)}>Advance</button> : <span className="muted" style={{ fontSize: 10 }}>—</span>}
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
          </div>
        </div>
      </div>
    </div>
  );
}
