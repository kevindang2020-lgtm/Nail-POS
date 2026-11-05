import { useCallback, useEffect, useState } from 'react';
import { useOwnerNav } from '../shell/nav';
import { useOwnerStream } from '../api/useOwnerStream';
import { ownerApprovalsApi, type OwnerApprovalsResp } from '../api/ownerApi';
import { FiBell } from 'react-icons/fi';
import { OwnerSkeletonBlocks, OwnerSkeletonCards, OwnerSkeletonList } from '../components/OwnerSkeleton';

// Approval Center — the Approvals tab. One queue of pending owner actions: payroll periods awaiting approval or lock
// (each deep-links into the Commission & Payroll screen, pre-selected to that period, where the fresh-auth approve/lock
// flow lives), plus an entry into operational alerts. Aggregated server-side from existing reads.

const money = (c: number): string => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format((c || 0) / 100);

function Chevron() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--owner-text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>;
}

export function ApprovalCenterScreen() {
  const { openPayroll, openAlerts } = useOwnerNav();
  const [data, setData] = useState<OwnerApprovalsResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    ownerApprovalsApi.get()
      .then((d) => { setData(d); setLoading(false); })
      .catch((e: any) => { setError(e?.message || 'Could not load approvals.'); setLoading(false); });
  }, []);

  useEffect(() => { load(); }, [load]);
  // Live refresh: payroll approvals/locks and alert changes both alter this queue. Mirrors the Home strip's refresh.
  useOwnerStream((e) => { if (['owner_payroll_updated', 'owner_alert_created', 'owner_alert_updated'].includes(e)) load(); });

  const totalPending = (data?.counts.payrollToApprove ?? 0) + (data?.counts.payrollToLock ?? 0);

  return (
    <div style={{ paddingBlock: '12px ' }}>
      <div className="owner-sechead">
        <div className="h owner-serif">Approvals</div>
        <div className="d">{data ? (totalPending > 0 ? `${totalPending} pending` : 'Up to date') : 'Pending actions'}</div>
      </div>

      {error ? (
        <div className="owner-state" role="alert">{error}</div>
      ) : (
        <>
          {loading && !data ? (
            <div className="owner-drill" style={{ marginBottom: 16 }}>
              <OwnerSkeletonList count={2} />
            </div>
          ) : data!.items.length === 0 ? (
            <div className="owner-state" style={{ marginTop: 8 }}>No payroll periods awaiting your approval.</div>
          ) : (
            <div className="owner-drill" style={{ marginBottom: 16 }}>
              {data!.items.map((it) => {
                const color = it.action === 'approve' ? 'var(--owner-primary)' : 'var(--owner-success)';
                return (
                  <button className="owner-drillrow" key={it.periodId} onClick={() => openPayroll(it.periodId)} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700 }}>{it.label}</div>
                      <div className="owner-text-muted" style={{ fontSize: 12 }}>{it.detail} · {money(it.amountCents)}</div>
                    </div>
                    <div className="owner-pill" style={{ color, borderColor: color, fontSize: 11, whiteSpace: 'nowrap', marginLeft: 10 }}>{it.action === 'approve' ? 'Approve' : 'Lock & Pay'}</div>
                  </button>
                );
              })}
            </div>
          )}

          <section className="owner-menu-section" style={{ marginTop: 16 }}>
            <div className="owner-menu-section-head">
              <h6>OPERATIONAL</h6>
              <p>Real-time system monitoring &amp; business alerts</p>
            </div>

            <div className="owner-menu-card">
              {loading && !data ? (
                <div style={{ padding: 16 }}>
                  <OwnerSkeletonList count={1} />
                </div>
              ) : (
                <button
                  className="owner-menurow"
                  onClick={openAlerts}
                  style={{ width: '100%', cursor: 'pointer' }}
                >
                  <span
                    className="owner-menu-icon"
                    style={{
                      background:
                        data!.counts.openAlerts > 0
                          ? 'var(--owner-warning-bg, #FFF4DF)'
                          : 'var(--owner-primary-light, #F4E3BF)',
                      color:
                        data!.counts.openAlerts > 0
                          ? 'var(--owner-warning, #CE8A2C)'
                          : 'var(--owner-primary-dark, #8B5A18)',
                    }}
                  >
                    <FiBell size={18} />
                  </span>
                  <div className="owner-menu-content">
                    <span className="ml">
                      Alerts{data!.counts.openAlerts > 0 ? ` · ${data!.counts.openAlerts} open` : ''}
                    </span>
                    <span className="owner-menu-subtitle">
                      {data!.counts.openAlerts > 0
                        ? `${data!.counts.openAlerts} requiring review`
                        : 'All salon operations operating normally'}
                    </span>
                  </div>
                  {data!.counts.openAlerts > 0 ? (
                    <span
                      className="owner-pill"
                      style={{
                        background: 'var(--owner-warning-bg, #FFF4DF)',
                        color: 'var(--owner-warning, #CE8A2C)',
                        fontSize: 11,
                      }}
                    >
                      {data!.counts.openAlerts} open
                    </span>
                  ) : (
                    <span
                      className="owner-pill"
                      style={{
                        background: 'var(--owner-success-bg, #EDF8F0)',
                        color: 'var(--owner-success, #31905A)',
                        fontSize: 11,
                      }}
                    >
                      Clean
                    </span>
                  )}
                  <Chevron />
                </button>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
