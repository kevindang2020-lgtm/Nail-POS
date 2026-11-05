// SupportModeBanner — Constitution 7 §75: while this admin is in Support Mode, the shell ALWAYS shows it:
//   SUPPORT MODE · Tenant · Reason · Expires · Exit Support Mode
// One line per live session (Support Access and View POS), refreshed every 30 s and on the clock, gone when the session
// ends or expires. It cannot be dismissed — only exited (which ends the session server-side, audited).
import { useCallback, useEffect, useState } from 'react';
import { superAdminApi } from '../api/superAdminApi';
import { useCan } from '../auth/useCan';

export interface MySupportSession { id: string; source: 'support_access' | 'view_pos'; tenantId: string; tenantName: string | null; reason: string; scope: string; startedAt: string; expiresAt: string }
const SCOPE: Record<string, string> = { READ_ONLY: 'Read only', STANDARD_SUPPORT: 'Standard support', ELEVATED_SUPPORT: 'Elevated support' };

export function SupportModeBanner() {
  const [rows, setRows] = useState<MySupportSession[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [err, setErr] = useState<string | null>(null);
  // hooks stay above the early return below (React's rule of hooks)
  const [ext, setExt] = useState<{ id: string; minutes: number; reason: string } | null>(null);
  const can = useCan(); const mayRead = can('super_admin.support.view');
  const load = useCallback(() => { if (!mayRead) return; Promise.resolve().then(() => superAdminApi.mySupportSessions()).then((r) => setRows(Array.isArray(r) ? r : [])).catch(() => { /* keep the last known sessions visible */ }); }, [mayRead]);
  useEffect(() => {
    load(); const a = setInterval(load, 30_000); const b = setInterval(() => setNow(Date.now()), 15_000);
    window.addEventListener('aps:support-mode-changed', load);   // a session started elsewhere in the app shows at once
    return () => { clearInterval(a); clearInterval(b); window.removeEventListener('aps:support-mode-changed', load); };
  }, [load]);
  const live = rows.filter((s) => new Date(s.expiresAt).getTime() > now);
  if (!live.length) return null;
  // §78: an extension needs a reason (and step-up — the route's); it is capped server-side and told to the owner
  const extend = async () => {
    if (!ext) return;
    setErr(null);
    try { await superAdminApi.extendSupportSession(ext.id, ext.minutes, ext.reason.trim()); setExt(null); load(); }
    catch (e: any) { setErr(e?.message || 'Could not extend Support Mode.'); }
  };
  const exit = async (id: string) => {
    setErr(null);
    try { await superAdminApi.endSupportSession(id); setRows((r) => r.filter((s) => s.id !== id)); }
    catch (e: any) { setErr(e?.message || 'Could not exit Support Mode.'); }
  };
  return (
    <div role="status" aria-live="polite" data-testid="support-mode-banner"
      style={{ background: '#7A1F1F', color: '#fff', padding: '8px 14px', fontSize: 13, display: 'grid', gap: 4 }}>
      {live.map((s) => (
        <div key={s.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center' }}>
          <b style={{ letterSpacing: 1 }}>SUPPORT MODE</b>
          <span>Tenant: <b>{s.tenantName || s.tenantId}</b></span>
          <span>Reason: {s.reason}</span>
          <span>{SCOPE[s.scope] ?? s.scope}</span>
          <span>Expires: {new Date(s.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
          <button className="btn ghost" style={{ marginLeft: 'auto', color: '#fff', borderColor: '#fff' }} onClick={() => setExt({ id: s.id, minutes: 15, reason: '' })}>Extend</button>
          <button className="btn ghost" style={{ color: '#fff', borderColor: '#fff' }} onClick={() => exit(s.id)}>Exit Support Mode</button>
        </div>
      ))}
      {ext ? (
        <div data-testid="support-extend" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <span>Extend by</span>
          <select aria-label="Extend by minutes" value={ext.minutes} onChange={(e) => setExt({ ...ext, minutes: Number(e.target.value) })}>
            {[15, 30, 45, 60].map((m) => <option key={m} value={m}>{m} min</option>)}
          </select>
          <input aria-label="Extension reason" placeholder="Why do you need more time?" value={ext.reason} onChange={(e) => setExt({ ...ext, reason: e.target.value })} style={{ flex: 1, minWidth: 180 }} />
          <button className="btn" disabled={ext.reason.trim().length < 10} onClick={extend}>Extend access</button>
          <button className="btn ghost" style={{ color: '#fff', borderColor: '#fff' }} onClick={() => setExt(null)}>Cancel</button>
        </div>
      ) : null}
      {err ? <div role="alert">{err}</div> : null}
    </div>
  );
}
