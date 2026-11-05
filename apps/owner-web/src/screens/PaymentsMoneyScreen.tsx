import { useCallback, useEffect, useState } from 'react';
import { useOwnerBranch } from '../shell/OwnerBranchContext';
import { useOwnerNav } from '../shell/nav';
import { ownerPaymentsApi, type OwnerPaymentsOverviewResp, type OwnerPeriod } from '../api/ownerApi';
import { PeriodSelector } from '../components/PeriodSelector';
import { OwnerSkeletonCards } from '../components/OwnerSkeleton';

// Payments & Money — Module 10 (read surface). Payment-level oversight: a summary (gross/net/refunds/tips + method mix)
// plus browsable recent transactions and refunds, scoped to the owner's branches + period. Rows carry no card data —
// only method, a masked gateway reference, and amounts.

const money = (c: number): string => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((c || 0) / 100);
const num = (v: number): string => new Intl.NumberFormat('en-US').format(v || 0);
const METHOD_LABEL: Record<string, string> = { card: 'Card', cash: 'Cash', gift_card: 'Gift card', gift: 'Gift card', split: 'Split', other: 'Other' };

function statusColor(s: string): string {
  const ok = ['captured', 'paid', 'approved', 'settled', 'completed', 'succeeded'];
  const bad = ['failed', 'declined', 'error'];
  const neutral = ['voided', 'cancelled', 'refunded', 'partially_refunded'];
  if (ok.includes(s)) return 'var(--owner-success)';
  if (bad.includes(s)) return 'var(--owner-danger)';
  if (neutral.includes(s)) return 'var(--owner-text-secondary)';
  return 'var(--owner-text-secondary)';
}
const prettyStatus = (s: string): string => s.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
const timeOf = (iso: string): string => { try { return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch { return ''; } };

export function PaymentsMoneyScreen() {
  const { back } = useOwnerNav();
  const { effectiveBranchId } = useOwnerBranch();
  const [period, setPeriod] = useState<OwnerPeriod>('month');
  const [tab, setTab] = useState<'transactions' | 'refunds'>('transactions');
  const [data, setData] = useState<OwnerPaymentsOverviewResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    ownerPaymentsApi.overview(period, effectiveBranchId)
      .then((d) => { setData(d); setLoading(false); })
      .catch((e: any) => { setError(e?.message || 'Could not load payments.'); setLoading(false); });
  }, [period, effectiveBranchId]);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <header className="owner-header">
        <button className="owner-back" aria-label="Back" onClick={back}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--owner-text)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <div className="owner-greet" style={{ textAlign: 'center' }}><div className="n owner-serif" style={{ cursor: 'default', justifyContent: 'center' }}>Payments &amp; Money</div></div>
        <div style={{ width: 40 }} />
      </header>

      <div style={{ padding: '0 16px' }}><PeriodSelector value={period} onChange={setPeriod} options={['week', 'month', 'quarter', 'year']} /></div>

      {error && <div className="owner-state" role="alert">{error}</div>}
      {loading && <OwnerSkeletonCards count={3} />}

      {data && (
        <div style={{ padding: '6px 16px 24px' }}>
          <div className="owner-kpigrid" style={{ marginBottom: 8 }}>
            <div className="owner-kpi"><div className="label">Gross</div><div className="val">{money(data.summary.grossCents)}</div><div className="sub owner-text-muted">{num(data.summary.transactionCount)} payments</div></div>
            <div className="owner-kpi"><div className="label">Net</div><div className="val">{money(data.summary.netCents)}</div><div className="sub owner-text-muted">after refunds</div></div>
          </div>
          <div className="owner-kpigrid" style={{ marginBottom: 12 }}>
            <div className="owner-kpi"><div className="label">Tips</div><div className="val">{money(data.summary.tipsCents)}</div></div>
            <div className="owner-kpi"><div className="label">Refunds</div><div className="val" style={{ color: data.summary.refundsCents > 0 ? 'var(--owner-danger)' : undefined }}>{money(data.summary.refundsCents)}</div><div className="sub owner-text-muted">{num(data.summary.refundCount)} issued</div></div>
          </div>

          {data.summary.byMethod.length > 0 && (
            <div className="owner-chartcard" style={{ marginBottom: 12 }}>
              <div className="owner-sechead"><div className="h">By Method</div><div className="d">captured</div></div>
              <div className="owner-drill">
                {data.summary.byMethod.map((m) => (
                  <div className="owner-drillrow" key={m.method}>
                    <div style={{ fontWeight: 700 }}>{METHOD_LABEL[m.method] ?? m.method}</div>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
                      <span className="owner-text-muted" style={{ fontSize: 12 }}>{num(m.count)}</span>
                      <span style={{ fontWeight: 700 }}>{money(m.amountCents)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="owner-tabs" style={{ marginBottom: 8 }}>
            <button className={`owner-tab ${tab === 'transactions' ? 'active' : ''}`} style={{ flex: 1 }} onClick={() => setTab('transactions')}>Transactions</button>
            <button className={`owner-tab ${tab === 'refunds' ? 'active' : ''}`} style={{ flex: 1 }} onClick={() => setTab('refunds')}>Refunds &amp; Voids</button>
          </div>

          {tab === 'transactions' ? (
            data.transactions.length === 0 ? <div className="owner-state">No transactions in this period.</div>
              : (
                <div className="owner-drill">
                  {data.transactions.map((t) => (
                    <div className="owner-drillrow" key={t.id}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700 }}>{money(t.amountCents)}{t.tipCents > 0 ? <span className="owner-text-muted" style={{ fontWeight: 400, fontSize: 12 }}> +{money(t.tipCents)} tip</span> : null}</div>
                        <div className="owner-text-muted" style={{ fontSize: 12 }}>{METHOD_LABEL[t.method] ?? t.method}{t.processorRef ? ` · ${t.processorRef}` : ''}{t.ticketRef ? ` · ${t.ticketRef}` : ''} · {timeOf(t.at)}</div>
                      </div>
                      <div className="owner-pill" style={{ color: statusColor(t.status), borderColor: statusColor(t.status), fontSize: 11, whiteSpace: 'nowrap', marginLeft: 10 }}>{prettyStatus(t.status)}</div>
                    </div>
                  ))}
                </div>
              )
          ) : (
            data.refunds.length === 0 ? <div className="owner-state">No refunds or voids in this period.</div>
              : (
                <div className="owner-drill">
                  {data.refunds.map((r) => (
                    <div className="owner-drillrow" key={r.id}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, color: 'var(--owner-danger)' }}>−{money(r.amountCents)}</div>
                        <div className="owner-text-muted" style={{ fontSize: 12 }}>{r.reason || 'No reason given'}{r.paymentRef ? ` · ${r.paymentRef}` : ''} · {timeOf(r.at)}</div>
                      </div>
                      <div className="owner-pill" style={{ color: statusColor(r.status), borderColor: statusColor(r.status), fontSize: 11, whiteSpace: 'nowrap', marginLeft: 10 }}>{prettyStatus(r.status)}</div>
                    </div>
                  ))}
                </div>
              )
          )}
        </div>
      )}
    </>
  );
}
