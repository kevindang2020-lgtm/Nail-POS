import { useEffect, useState } from 'react';
import { membershipOversightApi } from '../api/superAdminMembershipsApi';
import { money } from './_chartkit';

// MembershipOversightModals — Unit 3 Tenant Membership Oversight (read-only drill-downs): Review Tenant Programs,
// Review Recurring Billing Failures, Monitor Membership Revenue, Review Cancellation & Pause Activity.

function Overlay({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div role="dialog" aria-label={title} style={{ position: 'fixed', inset: 0, background: 'rgba(20,16,10,0.32)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 50, padding: '6vh 16px' }} onClick={onClose}>
      <div className="panel" style={{ width: wide ? 720 : 560, maxHeight: '84vh', overflowY: 'auto', background: '#fff' }} onClick={(e) => e.stopPropagation()}>
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
const useLoad = <T,>(fn: () => Promise<T>) => {
  const [data, setData] = useState<T | null>(null); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { fn().then(setData).catch((e: any) => setErr(e?.message || 'Failed to load')); }, []);
  return { data, err };
};

export function ReviewProgramsModal({ onClose }: { onClose: () => void }) {
  const [productType, setProductType] = useState('');
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState<any[] | null>(null); const [err, setErr] = useState<string | null>(null);
  const load = () => { setRows(null); membershipOversightApi.programs({ productType: productType || undefined, status: status || undefined }).then((d) => setRows(d.programs)).catch((e: any) => setErr(e?.message)); };
  useEffect(load, [productType, status]);
  return (
    <Overlay title="Review Tenant Membership Programs" onClose={onClose} wide>
      {err && <div className="state" style={{ color: '#9B2C2C' }}>{err}</div>}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <select className="finput" style={{ width: 160 }} value={productType} onChange={(e) => setProductType(e.target.value)}><option value="">All types</option>{['nail', 'spa', 'premium', 'family', 'other'].map((t) => <option key={t} value={t}>{t}</option>)}</select>
        <select className="finput" style={{ width: 160 }} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All statuses</option>{['active', 'inactive', 'archived'].map((s) => <option key={s} value={s}>{s}</option>)}</select>
      </div>
      {!rows ? <div className="state">Loading…</div> : (
        <table className="tgrid" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
          <thead><tr style={th}><th>Program</th><th>Tenant</th><th>Type</th><th>Price</th><th>Active</th><th>Total</th><th>Revenue</th></tr></thead>
          <tbody>{rows.map((p) => (<tr key={p.planId} style={{ borderTop: '1px solid var(--line)' }}><td>{p.name}</td><td>{p.tenantName}</td><td>{p.productType}</td><td>{money(p.priceCents)}{p.billingInterval ? `/${p.billingInterval}` : ''}</td><td>{p.activeMembers}</td><td>{p.totalMembers}</td><td>{money(p.revenueCents)}</td></tr>))}</tbody>
        </table>
      )}
      {rows && rows.length === 0 && <div className="state">No programs match.</div>}
    </Overlay>
  );
}

export function BillingFailuresModal({ onClose }: { onClose: () => void }) {
  const { data, err } = useLoad(() => membershipOversightApi.billingFailures());
  return (
    <Overlay title="Review Recurring Billing Failures" onClose={onClose} wide>
      {err && <div className="state" style={{ color: '#9B2C2C' }}>{err}</div>}
      {!data ? <div className="state">Loading…</div> : (
        <table className="tgrid" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
          <thead><tr style={th}><th>Tenant</th><th>Program</th><th>Member</th><th>Amount</th><th>Reason</th><th>Attempt</th><th>When</th></tr></thead>
          <tbody>{data.failures.map((f) => (<tr key={f.id} style={{ borderTop: '1px solid var(--line)' }}><td>{f.tenant}</td><td>{f.program}</td><td>{f.memberNumber ?? '—'}</td><td>{money(f.amountCents)}</td><td>{f.reason}</td><td>{f.attempt}</td><td>{f.at ? new Date(f.at).toLocaleDateString() : '—'}</td></tr>))}</tbody>
        </table>
      )}
      {data && data.failures.length === 0 && <div className="state">No billing failures.</div>}
      <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>Recurring billing and dunning are performed by the tenant engine. Super Admin oversees failures here.</div>
    </Overlay>
  );
}

export function RevenueModal({ onClose }: { onClose: () => void }) {
  const { data, err } = useLoad(() => membershipOversightApi.revenue());
  return (
    <Overlay title="Monitor Membership Revenue" onClose={onClose} wide>
      {err && <div className="state" style={{ color: '#9B2C2C' }}>{err}</div>}
      {!data ? <div className="state">Loading…</div> : (
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{money(data.totalCents)} <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>total recognized membership revenue</span></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <strong style={{ fontSize: 12.5 }}>By Tenant</strong>
              <table className="tgrid" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5, marginTop: 6 }}>
                <thead><tr style={th}><th>Tenant</th><th>Revenue</th><th>MRR</th></tr></thead>
                <tbody>{data.byTenant.map((t, i) => (<tr key={i} style={{ borderTop: '1px solid var(--line)' }}><td>{t.tenant}</td><td>{money(t.revenueCents)}</td><td>{money(t.mrrCents)}</td></tr>))}</tbody>
              </table>
            </div>
            <div>
              <strong style={{ fontSize: 12.5 }}>By Program</strong>
              <table className="tgrid" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5, marginTop: 6 }}>
                <thead><tr style={th}><th>Program</th><th>Revenue</th></tr></thead>
                <tbody>{data.byProgram.map((p, i) => (<tr key={i} style={{ borderTop: '1px solid var(--line)' }}><td>{p.program}</td><td>{money(p.revenueCents)}</td></tr>))}</tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </Overlay>
  );
}

export function CancellationsModal({ onClose }: { onClose: () => void }) {
  const { data, err } = useLoad(() => membershipOversightApi.cancellations());
  return (
    <Overlay title="Review Cancellation and Pause Activity" onClose={onClose} wide>
      {err && <div className="state" style={{ color: '#9B2C2C' }}>{err}</div>}
      {!data ? <div className="state">Loading…</div> : (
        <table className="tgrid" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
          <thead><tr style={th}><th>Tenant</th><th>Program</th><th>Member</th><th>Status</th><th>Reason</th><th>When</th><th>Resumes</th></tr></thead>
          <tbody>{data.items.map((i, idx) => (<tr key={idx} style={{ borderTop: '1px solid var(--line)' }}><td>{i.tenant}</td><td>{i.program}</td><td>{i.memberNumber ?? '—'}</td><td>{i.status}</td><td>{i.reason ?? '—'}</td><td>{i.at ? new Date(i.at).toLocaleDateString() : '—'}</td><td>{i.resumesAt ? new Date(i.resumesAt).toLocaleDateString() : '—'}</td></tr>))}</tbody>
        </table>
      )}
      {data && data.items.length === 0 && <div className="state">No cancellation or pause activity.</div>}
    </Overlay>
  );
}
