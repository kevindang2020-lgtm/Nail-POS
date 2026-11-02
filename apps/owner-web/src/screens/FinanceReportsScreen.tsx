import { useEffect, useState } from 'react';
import { useOwnerBranch } from '../shell/OwnerBranchContext';
import { ownerFinanceApi, ownerActivityApi, type OwnerFinanceSummary, type OwnerPaymentMix, type OwnerReportInfo, type OwnerPeriod } from '../api/ownerApi';
import { useOwnerNav } from '../shell/nav';
import { PeriodSelector } from '../components/PeriodSelector';
import { OwnerSkeletonBlocks, OwnerSkeletonList } from '../components/OwnerSkeleton';
import { formatCurrency } from '@aipowersalon/money';   // BUILD_PLAN Phase 13 E (C6 §99–100): shared money / branch-zone date display

// FinanceReportsScreen — Module 5. Summary tab: revenue hero + expenses/net-profit(est.)/avg-ticket/transactions/tax/tips
// cards + payment-mix bars. Reports tab: catalog with real CSV export/download. Net profit = revenue − commission −
// APPROVED expenses (the finance module's ledger — rent, supplies, utilities …); still labelled EST because processor
// fees and taxes are not deducted. Real data from /owner/finance/* and /owner/reports.

const money = (c: number) => formatCurrency(c, { fractionDigits: 0 });
const money2 = (c: number) => formatCurrency(c);
function trend(p: number) { if (p > 0) return { cls: 'up', arrow: '▲', text: `${p.toFixed(1)}%` }; if (p < 0) return { cls: 'down', arrow: '▼', text: `${Math.abs(p).toFixed(1)}%` }; return { cls: 'flat', arrow: '•', text: '0.0%' }; }
const MIX_COLORS = ['var(--owner-primary)', 'var(--owner-success)', 'var(--owner-gold-soft)', 'var(--owner-info)', 'var(--owner-warning)', 'var(--owner-text-muted)'];

export function FinanceReportsScreen() {
  const { openExpenses } = useOwnerNav();
  const [tab, setTab] = useState<'summary' | 'reports'>('summary');
  const [period, setPeriod] = useState<OwnerPeriod>('month');
  const { effectiveBranchId } = useOwnerBranch();
  const [sum, setSum] = useState<OwnerFinanceSummary | null>(null);
  const [mix, setMix] = useState<OwnerPaymentMix | null>(null);
  const [reports, setReports] = useState<OwnerReportInfo[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => {
    setLoading(true); setErr(null);
    Promise.all([ownerFinanceApi.summary(period, effectiveBranchId), ownerFinanceApi.paymentMix(period, effectiveBranchId), ownerFinanceApi.reports()])
      .then(([s, m, r]) => { setSum(s); setMix(m); setReports(r); })
      .catch((e: any) => setErr(e?.status === 403 ? 'You do not have access to finance reports.' : e?.message || 'Unable to load finance.'))
      .finally(() => setLoading(false));
  };
  useEffect(load, [effectiveBranchId, period]);
  useEffect(() => { void ownerActivityApi.view('reports', effectiveBranchId).catch(() => {}); }, [effectiveBranchId]);

  const download = async (id: string) => {
    setBusy(id);
    try {
      const r = await ownerFinanceApi.export(id, period, effectiveBranchId);
      const blob = new Blob([r.content], { type: r.contentType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = r.filename; document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch { /* ignore; button re-enables */ } finally { setBusy(null); }
  };

  const rt = sum ? trend(sum.revenueTrendPercent) : null;
  const pt = sum ? trend(sum.profitTrendPercent) : null;

  return (
    <>
      <header className="owner-header">
        <div style={{ width: 40 }} />
        <div className="owner-greet" style={{ textAlign: 'center' }}><div className="n owner-serif" style={{ cursor: 'default', justifyContent: 'center' }}>Finance &amp; Reports</div></div>
        <div style={{ width: 40 }} />
      </header>

      <div className="owner-tabs">
        <button className={`owner-tab ${tab === 'summary' ? 'active' : ''}`} onClick={() => setTab('summary')}>Summary</button>
        <button className={`owner-tab ${tab === 'reports' ? 'active' : ''}`} onClick={() => setTab('reports')}>Reports</button>
      </div>

      <PeriodSelector value={period} onChange={setPeriod} />

      {tab === 'summary' && (
        <button className="owner-linkrow" onClick={openExpenses} style={{ margin: '0 16px 8px' }}>
          <span>Manage expenses</span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--owner-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
        </button>
      )}

      {err ? (
        <div className="owner-state"><div className="big owner-serif">Couldn’t load finance</div><div className="muted" style={{ marginBottom: 16 }}>{err}</div><button className="owner-btn" onClick={load}>Retry</button></div>
      ) : tab === 'summary' ? (
        <>
          <section className="owner-hero" aria-label="Total revenue">
            <div className="label">TOTAL REVENUE · THIS MONTH</div>
            <div className="val">{loading && !sum ? <div className="owner-skel" style={{ width: 140, height: 40, margin: '0 auto', borderRadius: 8 }} /> : money(sum!.totalRevenueCents)}</div>
            <div className={`trend ${rt?.cls || 'flat'}`}>{loading && !sum ? <div className="owner-skel" style={{ width: 120, height: 16, margin: '4px auto 0' }} /> : `${rt!.arrow} ${rt!.text} vs last month`}</div>
          </section>

          <div className="owner-kpigrid">
            <div className="owner-kpi">
              <div className="label">Net Profit<span className="owner-estbadge">EST</span></div>
              <div className="val" style={{ fontSize: 17 }}>{loading && !sum ? <div className="owner-skel" style={{ width: 80, height: 24, margin: '0 auto' }} /> : money(sum!.netProfitCents)}</div>
              <div className={`sub ${pt?.cls || 'flat'}`}>{loading && !sum ? <div className="owner-skel" style={{ width: 40, height: 12, margin: '4px auto 0' }} /> : `${pt!.arrow} ${pt!.text}`}</div>
            </div>
            <div className="owner-kpi">
              <div className="label">Expenses</div>
              <div className="val" style={{ fontSize: 17 }}>{loading && !sum ? <div className="owner-skel" style={{ width: 80, height: 24, margin: '0 auto' }} /> : money(sum!.totalExpensesCents)}</div>
              <div className="sub flat">Approved only</div>
            </div>
            <div className="owner-kpi">
              <div className="label" title="Sales (services + retail) ÷ paid tickets — the same definition as the POS reports">Avg Ticket (sales)</div>
              <div className="val" style={{ fontSize: 17 }}>{loading && !sum ? <div className="owner-skel" style={{ width: 80, height: 24, margin: '0 auto' }} /> : money2(sum!.averageTicketCents)}</div>
              <div className="sub flat">{loading && !sum ? <div className="owner-skel" style={{ width: 40, height: 12, margin: '4px auto 0' }} /> : `${sum!.totalTransactions} txns`}</div>
            </div>
            <div className="owner-kpi">
              <div className="label">Transactions</div>
              <div className="val">{loading && !sum ? <div className="owner-skel" style={{ width: 40, height: 24, margin: '0 auto' }} /> : sum!.totalTransactions}</div>
              <div className="sub flat">paid</div>
            </div>
            <div className="owner-kpi">
              <div className="label">Tax Collected</div>
              <div className="val" style={{ fontSize: 17 }}>{loading && !sum ? <div className="owner-skel" style={{ width: 80, height: 24, margin: '0 auto' }} /> : money2(sum!.taxCollectedCents)}</div>
            </div>
            <div className="owner-kpi">
              <div className="label">Tips</div>
              <div className="val" style={{ fontSize: 17 }}>{loading && !sum ? <div className="owner-skel" style={{ width: 80, height: 24, margin: '0 auto' }} /> : money2(sum!.tipsCents)}</div>
            </div>
          </div>

          <div className="owner-chartcard">
            <div className="head"><div className="t">Payment Mix</div></div>
            {loading && !mix ? (
              <OwnerSkeletonBlocks count={2} />
            ) : !mix || mix.methods.length === 0 ? (
              <div className="muted" style={{ fontSize: 13 }}>No payments in this period.</div>
            ) : (
              <div className="owner-mix">
                {mix.methods.map((m, i) => (
                  <div className="owner-mixrow" key={m.method}>
                    <div className="top">
                      <div className="m">{m.method.replace('_', ' ')} <span className="pc">{m.count} · {m.percentage.toFixed(1)}%</span></div>
                      <div className="a">{money2(m.amountCents)}</div>
                    </div>
                    <div className="owner-mixtrack"><div className="owner-mixfill" style={{ width: `${Math.max(2, m.percentage)}%`, background: MIX_COLORS[i % MIX_COLORS.length] }} /></div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {sum && sum.topServices.length > 0 && (
            <div className="owner-chartcard">
              <div className="head"><div className="t">Top Services</div><div className="u">by revenue</div></div>
              <div className="owner-mix">
                {sum.topServices.map((s, i) => {
                  const max = sum.topServices[0].revenueCents || 1;
                  return (
                    <div className="owner-mixrow" key={s.name + i}>
                      <div className="top">
                        <div className="m"><span style={{ color: 'var(--owner-text-muted)', fontWeight: 700, marginRight: 8 }}>{i + 1}</span>{s.name}</div>
                        <div className="a">{money(s.revenueCents)}</div>
                      </div>
                      <div className="owner-mixtrack"><div className="owner-mixfill" style={{ width: `${Math.max(2, Math.round((s.revenueCents / max) * 100))}%`, background: 'var(--owner-primary)' }} /></div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="owner-chartcard">
            <div className="muted" style={{ fontSize: 11.5 }}>
              Net profit is an <strong>estimate</strong>: revenue minus staff commission minus approved expenses (rent, supplies,
              utilities and the rest you record under Expenses). Processor fees and taxes are not deducted, and receipts still
              waiting for review are not counted. Revenue and tax/tips/discounts are actuals from paid tickets.
            </div>
          </div>
        </>
      ) : tab === 'reports' ? (
        <div className="owner-chartcard">
          {loading && !reports ? (
            <OwnerSkeletonList count={4} />
          ) : reports ? (
            reports.map((r) => (
              <div className="owner-reportrow" key={r.id}>
                <div><div className="t">{r.title}</div><div className="d">{r.description}</div></div>
                <button className="owner-dlbtn" disabled={busy === r.id} onClick={() => download(r.id)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14" /></svg>
                  {busy === r.id ? 'Preparing…' : 'CSV'}
                </button>
              </div>
            ))
          ) : null}
        </div>
      ) : null}
    </>
  );
}
