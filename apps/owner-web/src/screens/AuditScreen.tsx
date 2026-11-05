import { useEffect, useState } from 'react';
import { ownerMoreApi, type OwnerAuditEntry } from '../api/ownerApi';
import { useOwnerNav } from '../shell/nav';
import { OwnerSkeletonBlocks, OwnerSkeletonCards, OwnerSkeletonList } from '../components/OwnerSkeleton';

// AuditScreen — owner Activity Log. Read-only append-only trail from /owner/audit: alert transitions, report exports,
// expense edits, salon switches, payroll approvals/locks, and security events (rejected PINs, blocked access).
const fmt = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const money = (c: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format((c || 0) / 100);
const LABEL: Record<string, string> = {
  alert_acknowledged: 'Alert acknowledged', alert_resolved: 'Alert resolved', alert_dismissed: 'Alert dismissed',
  report_export: 'Report exported', owner_export_created: 'Report exported',
  expense_create: 'Expense added', expense_update: 'Expense updated', expense_delete: 'Expense deleted',
  owner_branch_selected: 'Switched salon', owner_all_salons_selected: 'Viewed all salons', owner_context_loaded: 'Opened the owner app',
  payroll_approved: 'Payroll approved', payroll_locked: 'Payroll locked & paid', payroll_reopened: 'Payroll reopened to draft',
  payroll_pin_rejected: 'Payroll PIN rejected', owner_branch_switch_pin_rejected: 'Salon-switch PIN rejected',
  owner_unauthorized_branch_access_blocked: 'Blocked: unauthorized salon access',
};
const SECURITY = new Set(['payroll_pin_rejected', 'owner_branch_switch_pin_rejected', 'owner_unauthorized_branch_access_blocked']);
const label = (a: string) => LABEL[a] || a.replace(/_/g, ' ');
const icon = (a: string): string => {
  if (SECURITY.has(a)) return '⚠️';
  if (a.startsWith('payroll')) return a.includes('locked') ? '🔒' : a.includes('reopened') ? '↩️' : '💵';
  if (a.startsWith('expense')) return '🧾';
  if (a.startsWith('owner_branch') || a.startsWith('owner_all')) return '🏢';
  if (a === 'report_export' || a === 'owner_export_created') return '📄';
  if (a.startsWith('alert')) return '🔔';
  return '•';
};
function metaText(r: OwnerAuditEntry): string | null {
  const m = (r.metadata ?? {}) as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof m.totalPayableCents === 'number') parts.push(money(m.totalPayableCents));
  else if (typeof m.amountCents === 'number') parts.push(money(m.amountCents));
  if (typeof m.fromStatus === 'string') parts.push(`from ${m.fromStatus}`);
  if (typeof m.category === 'string') parts.push(m.category);
  return parts.length ? parts.join(' · ') : null;
}

export function AuditScreen() {
  const { back } = useOwnerNav();
  const [rows, setRows] = useState<OwnerAuditEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true); setErr(null);
    ownerMoreApi.audit(100)
      .then(setRows)
      .catch((e: any) => setErr(e?.status === 403 ? 'You do not have access to the activity log.' : e?.message || 'Unable to load activity.'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  return (
    <>
      <header className="owner-header">
        <button className="owner-back" aria-label="Back" onClick={back}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--owner-text)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg></button>
        <div className="owner-greet" style={{ textAlign: 'center' }}><div className="n owner-serif" style={{ cursor: 'default', justifyContent: 'center' }}>Activity Log</div></div>
        <div style={{ width: 40 }} />
      </header>

      {loading && !rows ? (
        <div className="owner-menu" style={{ padding: '8px 16px' }}>
          <OwnerSkeletonList count={6} />
        </div>
      ) : err ? (
        <div className="owner-state"><div className="big owner-serif">Couldn’t load activity</div><div className="muted" style={{ marginBottom: 16 }}>{err}</div><button className="owner-btn" onClick={load}>Retry</button></div>
      ) : rows && rows.length === 0 ? (
        <div className="owner-state"><div className="big owner-serif">No activity yet</div><div className="muted">Owner actions will appear here.</div></div>
      ) : rows ? (
        <div className="owner-menu">
          {rows.map((r) => {
            const isSecurity = SECURITY.has(r.action);
            const md = metaText(r);
            return (
              <div className="owner-menurow" key={r.id} style={{ cursor: 'default' }}>
                <div style={{ minWidth: 0 }}>
                  <div className="ml" style={isSecurity ? { color: 'var(--owner-danger)', fontWeight: 700 } : undefined}>{icon(r.action)} {label(r.action)}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--owner-text-muted)', marginTop: 2 }}>{md ? `${md} · ` : ''}{r.entityType ? `${r.entityType} · ` : ''}{r.role ?? ''}</div>
                </div>
                <span />
                <span style={{ fontSize: 11, color: 'var(--owner-text-muted)', whiteSpace: 'nowrap' }}>{fmt(r.createdAt)}</span>
              </div>
            );
          })}
        </div>
      ) : null}
    </>
  );
}
