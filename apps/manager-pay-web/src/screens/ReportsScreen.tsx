import { useEffect, useState } from 'react';
import { mobileCheckoutApi, type AttemptReport } from '../api/mobileCheckoutApi';
import { formatCents, titleCase } from '../util/format';
import { SelectDateModal, type DateRangeResult } from '../components/SelectDateModal';

type Period = 'today' | '7d' | '30d';
const PERIODS: { key: Period; label: string }[] = [
  { key: 'today', label: 'Today' }, { key: '7d', label: '7 Days' }, { key: '30d', label: '30 Days' },
];

const STATUS_COLORS: Record<string, string> = {
  confirmed: 'var(--pay-success)', ready: 'var(--pay-primary)', created: 'var(--pay-gold-soft)',
  failed: 'var(--pay-danger)', canceled: 'var(--pay-text-muted)',
};

function chartMax(daily: AttemptReport['daily']): number {
  return Math.max(1, ...daily.map((d) => d.count));
}
function dayShort(date: string): string {
  const d = new Date(date + 'T00:00:00');
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { weekday: 'narrow' });
}

export function ReportsScreen() {
  const [period, setPeriod] = useState<Period>('7d');
  const [customRange, setCustomRange] = useState<DateRangeResult | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [report, setReport] = useState<AttemptReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setReport(null); setError(null);

    const call = customRange
      ? mobileCheckoutApi.report({
          period: customRange.type === 'Today' ? 'today' : 'custom',
          startDate: customRange.startDate,
          endDate: customRange.endDate,
        })
      : mobileCheckoutApi.report(period);

    call
      .then((r) => { if (active) setReport(r); })
      .catch((e: any) => { if (active) setError(e?.message || 'Could not load reports.'); });
    return () => { active = false; };
  }, [period, customRange]);

  const handleSelectRange = (range: DateRangeResult) => {
    if (range.type === 'Today') {
      setPeriod('today');
      setCustomRange(null);
    } else {
      setCustomRange(range);
    }
  };

  const handlePresetChipClick = (p: Period) => {
    setCustomRange(null);
    setPeriod(p);
  };

  const statuses = report ? Object.keys(report.byStatus) : [];
  const max = report ? chartMax(report.daily) : 1;
  const successRate = report && report.totalAttempts > 0 ? Math.round(((report.byStatus.confirmed || 0) / report.totalAttempts) * 100) : 0;

  return (
    <>
      <div className="pay-sechead" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="t pay-serif">Reports</div>
        <button
          className={`pay-iconbtn ${customRange ? 'active' : ''}`}
          onClick={() => setModalOpen(true)}
          aria-label="Select Date Range"
          title="Select Date Range"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="3" />
            <path d="M3 9h18M8 2v4M16 2v4" />
          </svg>
        </button>
      </div>

      <div className="pay-chips">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            className={`pay-chip ${!customRange && period === p.key ? 'active' : ''}`}
            onClick={() => handlePresetChipClick(p.key)}
          >
            {p.label}
          </button>
        ))}
        {customRange && (
          <button
            className="pay-chip active"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            onClick={() => setModalOpen(true)}
          >
            <span>{customRange.label}</span>
            <span
              role="button"
              aria-label="Clear date filter"
              onClick={(e) => {
                e.stopPropagation();
                setCustomRange(null);
              }}
              style={{ fontWeight: 800, fontSize: 13, marginLeft: 2 }}
            >
              ✕
            </span>
          </button>
        )}
      </div>

      {report === null && !error && <div className="pay-skel" style={{ height: 200 }} />}
      {error && <div className="pay-state"><div className="big">Couldn’t load reports</div><div className="muted">{error}</div></div>}

      {report && (
        <>
          <div className="pay-kpigrid">
            <div className="pay-kpi"><div className="l">Attempts</div><div className="v">{report.totalAttempts}</div><div className="n">this period</div></div>
            <div className="pay-kpi"><div className="l">Attempted</div><div className="v">{formatCents(report.attemptedTotalCents)}</div><div className="n">across all attempts</div></div>
            <div className="pay-kpi settled"><div className="l">Settled</div><div className="v">{formatCents(report.settledTotalCents)}</div><div className="n">completed captures</div></div>
            <div className="pay-kpi"><div className="l">Success rate</div><div className="v">{successRate}%</div><div className="n">confirmed / attempts</div></div>
          </div>

          {report.totalAttempts === 0 ? (
            <div className="pay-state"><div className="big">No attempts in this period</div><div className="muted">Checkout attempts you start will be summarized here.</div></div>
          ) : (
            <>
              <div className="pay-card">
                <div className="pay-cardtitle">Daily attempts</div>
                <div className="pay-daychart">
                  {report.daily.map((d) => (
                    <div className="pay-daybar" key={d.date} title={`${d.date}: ${d.count}`}>
                      <div className="bar" style={{ height: `${Math.max(4, (d.count / max) * 100)}%` }} />
                      <span className="dl">{dayShort(d.date)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pay-card">
                <div className="pay-cardtitle">Outcomes</div>
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

          {report.settledTotalCents === 0 && (
            <div className="pay-note">Settled totals reflect completed card captures. Completing a Tap to Pay capture requires on-device Tap-to-Pay onboarding.</div>
          )}
        </>
      )}

      <SelectDateModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        activeType={customRange ? customRange.type : period === 'today' ? 'Today' : 'This Week'}
        initialFrom={customRange?.customFrom}
        initialTo={customRange?.customTo}
        onSelect={handleSelectRange}
      />
    </>
  );
}
