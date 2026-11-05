import { useEffect, useState } from 'react';
import { membershipDrilldownApi } from '../api/superAdminMembershipsApi';

// MembershipDrilldownModals — KPI click-through views: a status-filtered member list and a per-program credits summary.
// Read-only; member_number is a non-PII identifier (no names/contact/payment data).

function Overlay({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div role="dialog" aria-label={title} style={{ position: 'fixed', inset: 0, background: 'rgba(20,16,10,0.32)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 50, padding: '6vh 16px' }} onClick={onClose}>
      <div className="panel" style={{ width: 640, maxHeight: '84vh', overflowY: 'auto', background: '#fff' }} onClick={(e) => e.stopPropagation()}>
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
const LABEL: Record<string, string> = { active: 'Active Members', paused: 'Paused Memberships', cancelled: 'Cancelled Memberships', past_due: 'Past-Due Memberships', trial: 'Trial Memberships' };

export function MembersModal({ status, onClose }: { status: string; onClose: () => void }) {
  const [rows, setRows] = useState<any[] | null>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { membershipDrilldownApi.members(status).then((d) => setRows(d.members)).catch((e: any) => setErr(e?.message)); }, [status]);
  return (
    <Overlay title={LABEL[status] ?? 'Memberships'} onClose={onClose}>
      {err && <div className="state" style={{ color: '#9B2C2C' }}>{err}</div>}
      {!rows ? <div className="state">Loading…</div> : rows.length === 0 ? <div className="state">No memberships in this status.</div> : (
        <table className="tgrid" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
          <thead><tr style={th}><th>Member</th><th>Tenant</th><th>Program</th><th>Status</th><th>Started</th><th>Next Billing</th></tr></thead>
          <tbody>{rows.map((r, i) => (<tr key={i} style={{ borderTop: '1px solid var(--line)' }}><td>{r.memberNumber}</td><td>{r.tenant}</td><td>{r.program}</td><td>{r.status}</td><td>{r.startedAt ? new Date(r.startedAt).toLocaleDateString() : '—'}</td><td>{r.nextBillingAt ? new Date(r.nextBillingAt).toLocaleDateString() : '—'}</td></tr>))}</tbody>
        </table>
      )}
    </Overlay>
  );
}

export function CreditsModal({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<any[] | null>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { membershipDrilldownApi.creditsSummary().then((d) => setRows(d.rows)).catch((e: any) => setErr(e?.message)); }, []);
  return (
    <Overlay title="Service Credits by Program" onClose={onClose}>
      {err && <div className="state" style={{ color: '#9B2C2C' }}>{err}</div>}
      {!rows ? <div className="state">Loading…</div> : rows.length === 0 ? <div className="state">No credit activity.</div> : (
        <table className="tgrid" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
          <thead><tr style={th}><th>Program</th><th>Tenant</th><th>Issued</th><th>Redeemed</th><th>Unused</th><th>Expiring (30d)</th></tr></thead>
          <tbody>{rows.map((r, i) => (<tr key={i} style={{ borderTop: '1px solid var(--line)' }}><td>{r.program}</td><td>{r.tenant}</td><td>{r.issued}</td><td>{r.redeemed}</td><td>{r.unused}</td><td>{r.expiring}</td></tr>))}</tbody>
        </table>
      )}
    </Overlay>
  );
}
