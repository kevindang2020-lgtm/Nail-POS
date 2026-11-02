import { useEffect, useState } from 'react';
import { mobileCheckoutApi, type AttemptReport, type MobilePaymentsReport } from '../api/mobileCheckoutApi';
import { formatCents, titleCase } from '../util/format';
import { fmtYmd, useT } from '@aipowersalon/mobile-sdk';   // BUILD_PLAN Phase 13 E (C6 §99–100): shared money / branch-zone date display

// Reports (mandate §107–§110, §221–§222): GROSS card sales, cash sales, refunds, tips, transaction count and average
// ticket — from the canonical payments rows, one sale per row whatever surface took it, with the surface as a dimension.
// The word "payout" appears ONLY beside processor settlement data (settlementKnown): gross card sales are never
// labelled a payout. The attempt funnel (this phone's Tap to Pay attempts) stays below as product analytics (§202).
type Period = 'today' | '7d' | '30d';
const PERIODS: { key: Period; label: string }[] = [
  { key: 'today', label: 'Today' }, { key: '7d', label: '7 Days' }, { key: '30d', label: '30 Days' },
];
const STATUS_COLORS: Record<string, string> = {
  confirmed: 'var(--pay-success)', ready: 'var(--pay-primary)', created: 'var(--pay-gold-soft)',
  failed: 'var(--pay-danger)', canceled: 'var(--pay-text-muted)',
};
const SURFACE_LABELS: Record<string, string> = { pos: 'POS', clover_compact: 'Clover Compact', cardpointe_terminal: 'CardPointe Terminal', tap_to_pay_iphone: 'Tap to Pay', customer_display: 'Customer Display', cash: 'Cash', manual_external: 'Manual / External', online: 'Online' };
const chartMax = (daily: AttemptReport['daily']) => Math.max(1, ...daily.map((d) => d.count));
const dayShort = (date: string) => fmtYmd(date, { weekday: 'narrow' });

export function ReportsScreen() {
  const tr = useT();
  const [period, setPeriod] = useState<Period>('7d');
  const [sales, setSales] = useState<MobilePaymentsReport | null>(null);
  const [report, setReport] = useState<AttemptReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setReport(null); setSales(null); setError(null);
    mobileCheckoutApi.salesReport(period).then((r) => { if (active) setSales(r); }).catch((e: any) => { if (active) setError(e?.message || 'Could not load reports.'); });
    mobileCheckoutApi.report(period).then((r) => { if (active) setReport(r); }).catch(() => { /* the funnel is secondary */ });
    return () => { active = false; };
  }, [period]);

  const statuses = report ? Object.keys(report.byStatus) : [];
  const max = report ? chartMax(report.daily) : 1;
  const successRate = report && report.totalAttempts > 0 ? Math.round(((report.byStatus.confirmed || 0) / report.totalAttempts) * 100) : 0;

  return (
    <>
      <div className="pay-sechead"><div className="t pay-serif">{tr('pay.reports.title')}</div></div>

      <div className="pay-chips">
        {PERIODS.map((p) => (
          <button key={p.key} className={`pay-chip ${period === p.key ? 'active' : ''}`} onClick={() => setPeriod(p.key)}>{p.label}</button>
        ))}
      </div>

      {sales === null && !error && <div className="pay-skel" style={{ height: 200 }} />}
      {error && <div className="pay-state"><div className="big">Couldn’t load reports</div><div className="muted">{error}</div></div>}

      {sales && (
        <>
          <div className="pay-kpigrid">
            <div className="pay-kpi settled"><div className="l">{tr('pay.reports.grossCard')}</div><div className="v">{formatCents(sales.grossCardSalesCents)}</div><div className="n">gross, before fees</div></div>
            <div className="pay-kpi"><div className="l">{tr('pay.reports.cash')}</div><div className="v">{formatCents(sales.cashSalesCents)}</div><div className="n">recorded cash</div></div>
            <div className="pay-kpi"><div className="l">{tr('pay.reports.refunds')}</div><div className="v">−{formatCents(sales.refundsCents)}</div><div className="n">this period</div></div>
            <div className="pay-kpi"><div className="l">{tr('pay.reports.tips')}</div><div className="v">{formatCents(sales.tipsCents)}</div><div className="n">on recorded payments</div></div>
            <div className="pay-kpi"><div className="l">{tr('pay.reports.count')}</div><div className="v">{sales.transactionCount}</div><div className="n">payments</div></div>
            <div className="pay-kpi"><div className="l">{tr('pay.reports.avg')}</div><div className="v">{formatCents(sales.averageTicketCents)}</div><div className="n">per ticket</div></div>
          </div>

          {sales.settlementKnown ? (
            <div className="pay-card">
              <div className="pay-cardtitle">Processor settlement</div>
              <div className="pay-totrow"><span className="l">{tr('pay.reports.fees')}</span><span className="v">−{formatCents(sales.processorFeesCents ?? 0)}</span></div>
              <div className="pay-totrow grand"><span className="l">{tr('pay.reports.netPayout')}</span><span className="v">{formatCents(sales.netProcessorPayoutCents ?? 0)}</span></div>
            </div>
          ) : (
            <div className="pay-note">{tr('pay.reports.payoutUnknown')}</div>
          )}

          {sales.bySurface.length > 0 && (
            <div className="pay-card">
              <div className="pay-cardtitle">{tr('pay.reports.bySurface')}</div>
              {sales.bySurface.map((s) => (
                <div className="pay-totrow" key={s.surface}><span className="l">{SURFACE_LABELS[s.surface] || titleCase(s.surface)} · {s.count}</span><span className="v">{formatCents(s.salesCents)}</span></div>
              ))}
            </div>
          )}
        </>
      )}

      {report && report.totalAttempts > 0 && (
        <>
          <div className="pay-card">
            <div className="pay-cardtitle">Tap to Pay attempts · {report.totalAttempts} · {successRate}% confirmed</div>
            <div className="pay-daychart">
              {report.daily.map((d) => (
                <div className="pay-daybar" key={d.date} title={`${d.date}: ${d.count}`}>
                  <div className="bar" style={{ height: `${Math.max(4, (d.count / max) * 100)}%` }} />
                  <span className="dl">{dayShort(d.date)}</span>
                </div>
              ))}
            </div>
            <div className="pay-outcomes">
              {statuses.map((s) => (
                <div className="pay-outrow" key={s}>
                  <span className="sw" style={{ background: STATUS_COLORS[s] || 'var(--pay-text-muted)' }} />
                  <span className="nm">{titleCase(s)}</span>
                  <span className="ct">{report.byStatus[s]}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}
