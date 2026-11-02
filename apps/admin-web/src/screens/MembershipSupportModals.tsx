import { useEffect, useState } from 'react';
import { membershipSupportApi, membershipOversightApi } from '../api/superAdminMembershipsApi';

// MembershipSupportModals — Unit 5: Suspicious/Duplicate Membership review (investigation only) and Audited Support
// Mode (tenant-scoped, reason-required, time-limited, auto-expiring, fully audited).

function Overlay({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div role="dialog" aria-label={title} style={{ position: 'fixed', inset: 0, background: 'rgba(20,16,10,0.32)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 50, padding: '6vh 16px' }} onClick={onClose}>
      <div className="panel" style={{ width: wide ? 680 : 500, maxHeight: '84vh', overflowY: 'auto', background: '#fff' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <strong style={{ fontSize: 14 }}>{title}</strong>
          <button className="btn ghost" style={{ height: 26 }} onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
const th = { textAlign: 'left' as const, color: 'var(--muted)', fontSize: 10 };
const sevTone = (s: string): [string, string] => s === 'high' ? ['#FBEAEA', '#9B2C2C'] : s === 'medium' ? ['#FBF1E3', '#9A6114'] : ['#EFEFEF', '#555'];

export function SuspiciousModal({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<any[] | null>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { membershipSupportApi.suspicious().then((d) => setData(d.cases)).catch((e: any) => setErr(e?.message)); }, []);
  return (
    <Overlay title="Suspicious or Duplicate Memberships" onClose={onClose} wide>
      {err && <div className="state" style={{ color: '#9B2C2C' }}>{err}</div>}
      <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>Automated signals for investigation only — no customer or tenant is penalized automatically.</div>
      {!data ? <div className="state">Loading…</div> : data.length === 0 ? <div className="state">No suspicious membership activity detected.</div> : (
        <table className="tgrid" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
          <thead><tr style={th}><th>Signal</th><th>Customer</th><th>Tenant</th><th>Active Memberships</th><th>Severity</th></tr></thead>
          <tbody>{data.map((c, i) => (<tr key={i} style={{ borderTop: '1px solid var(--line)' }}><td>{String(c.type).replace(/_/g, ' ')}</td><td>{c.customerName ?? c.customerId?.slice(0, 8)}</td><td>{c.tenant}</td><td>{c.count}</td><td><span style={{ background: sevTone(c.severity)[0], color: sevTone(c.severity)[1], padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600 }}>{c.severity}</span></td></tr>))}</tbody>
        </table>
      )}
    </Overlay>
  );
}

export function SupportModeModal({ onClose, onChanged }: { onClose: () => void; onChanged?: () => void }) {
  const [tenants, setTenants] = useState<{ tenantId: string; tenantName: string }[]>([]);
  const [active, setActive] = useState<any | null>(null); const [loaded, setLoaded] = useState(false);
  const [tenantId, setTenantId] = useState(''); const [reason, setReason] = useState(''); const [duration, setDuration] = useState('30');
  const [err, setErr] = useState<string | null>(null);
  const refresh = () => membershipSupportApi.activeSession().then((d) => { setActive(d.session); setLoaded(true); }).catch(() => setLoaded(true));
  useEffect(() => {
    refresh();
    membershipOversightApi.programs().then((d) => {
      const seen = new Map<string, string>(); for (const p of d.programs) seen.set(p.tenantId, p.tenantName);
      setTenants([...seen.entries()].map(([tenantId, tenantName]) => ({ tenantId, tenantName })));
    }).catch(() => {});
  }, []);
  const enter = async () => {
    setErr(null);
    try { await membershipSupportApi.enter({ tenantId, reason: reason.trim(), durationMinutes: parseInt(duration, 10) || 0, accessLevel: 'read_only' }); await refresh(); onChanged?.(); }
    catch (e: any) { setErr(e?.message || 'Could not enter support mode'); }
  };
  const exit = async () => { if (active) { await membershipSupportApi.exit(active.id); await refresh(); onChanged?.(); } };
  return (
    <Overlay title="Enter Audited Support Mode" onClose={onClose}>
      {err && <div className="state" style={{ color: '#9B2C2C' }}>{err}</div>}
      {!loaded ? <div className="state">Loading…</div> : active ? (
        <div style={{ display: 'grid', gap: 10, fontSize: 12 }}>
          <div style={{ padding: 10, background: '#FBF1E3', border: '1px solid #EED9B8', borderRadius: 9, color: '#9A6114' }}>
            <strong>Support mode active</strong> — {active.tenant}<br />
            <span className="muted">Reason: {active.reason} · Access: {active.accessLevel} · Expires: {new Date(active.expiresAt).toLocaleTimeString()}</span>
          </div>
          <div className="muted" style={{ fontSize: 11 }}>Every sensitive read/write in this session is logged and the session auto-expires. Unrelated tenant access is blocked.</div>
          <div style={{ display: 'flex', gap: 8 }}><button className="btn" onClick={exit}>Exit Support Mode</button><button className="btn ghost" onClick={onClose}>Close</button></div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 8, fontSize: 12 }}>
          <div className="muted" style={{ fontSize: 11 }}>Support mode is tenant-scoped, time-limited, and fully audited. It does not grant ownership of the tenant’s operations.</div>
          <div><label className="flabel">Tenant</label><select className="finput" value={tenantId} onChange={(e) => setTenantId(e.target.value)}><option value="">Select a tenant…</option>{tenants.map((t) => <option key={t.tenantId} value={t.tenantId}>{t.tenantName}</option>)}</select></div>
          <div><label className="flabel">Reason / support case (required)</label><input className="finput" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. investigating billing failure #1234" /></div>
          <div><label className="flabel">Duration (minutes, 15–60)</label><input className="finput" inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value)} /></div>
          <div style={{ display: 'flex', gap: 8 }}><button className="btn" disabled={!tenantId || reason.trim().length < 10} onClick={enter}>Enter Support Mode</button><button className="btn ghost" onClick={onClose}>Cancel</button></div>
        </div>
      )}
    </Overlay>
  );
}
