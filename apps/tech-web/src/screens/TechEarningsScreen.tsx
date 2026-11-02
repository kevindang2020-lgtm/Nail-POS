import { useMemo, useState } from 'react';
import { useScopedQuery, OfflineStatus, fmtMonthDay } from '@aipowersalon/mobile-sdk';
import { techApi, type TechCanonicalEarnings, type TechCashPendingItem } from '../api/techApi';
import { useTechNav } from '../shell/nav';
import { money2, longDate } from '../lib/tech';

// Module 4 — Earnings (1:1 with the reference). Headline + Services/Tips/Retail/Bonuses breakdown come from the canonical
// compensation summary (GET /tech/earnings/canonical — immutable per-ticket snapshots; bonus/guarantee/adjustments are
// honestly null until payroll finalizes). The "vs last period" trend compares the previous period's canonical total.
// Cash Pending is the real awaiting-handoff total; the Daily Earnings chart buckets the period's paid lines by day.
const Cal = () => (<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="3" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>);
type FilterType = 'Today' | 'Yesterday' | 'This Week' | 'Last Week' | 'This Month' | 'Last Month' | 'Specific Day' | 'Custom Range';
const ALL_FILTERS: FilterType[] = ['Today', 'Yesterday', 'This Week', 'Last Week', 'This Month', 'Last Month', 'Specific Day', 'Custom Range'];

function getIsoDate(daysOffset: number): string {
  const d = new Date(); d.setDate(d.getDate() + daysOffset); return d.toISOString();
}
function getIsoMonth(monthsOffset: number): string {
  const d = new Date(); d.setMonth(d.getMonth() + monthsOffset); return d.toISOString();
}
function parseLocal(ymd: string) { return new Date(ymd + 'T00:00:00'); }

function resolveFilter(type: FilterType, from?: string, to?: string) {
  switch (type) {
    case 'Today': return { period: 'day', date: undefined, prevDate: getIsoDate(-1) };
    case 'Yesterday': return { period: 'day', date: getIsoDate(-1), prevDate: getIsoDate(-2) };
    case 'This Week': return { period: 'week', date: undefined, prevDate: getIsoDate(-7) };
    case 'Last Week': return { period: 'week', date: getIsoDate(-7), prevDate: getIsoDate(-14) };
    case 'This Month': return { period: 'month', date: undefined, prevDate: getIsoMonth(-1) };
    case 'Last Month': return { period: 'month', date: getIsoMonth(-1), prevDate: getIsoMonth(-2) };
    case 'Specific Day': {
      if (!from) return null;
      const d = parseLocal(from);
      const pd = new Date(d); pd.setDate(pd.getDate() - 1);
      return { period: 'day', date: d.toISOString(), prevDate: pd.toISOString() };
    }
    case 'Custom Range': {
      if (!from || !to) return null;
      const d1 = parseLocal(from);
      const d2 = parseLocal(to); d2.setDate(d2.getDate() + 1);
      const diff = d2.getTime() - d1.getTime();
      const pd1 = new Date(d1.getTime() - diff);
      const pd2 = new Date(d2.getTime() - diff);
      return { period: 'custom', date: d1.toISOString(), dateTo: d2.toISOString(), prevDate: pd1.toISOString(), prevDateTo: pd2.toISOString() };
    }
  }
}

const rangeLabel = (c: TechCanonicalEarnings | null, fType: FilterType): string => {
  if (!c?.dateFrom) return longDate();
  if (fType === 'Today') return `Today, ${longDate(new Date(c.dateFrom))}`;
  if (fType === 'Yesterday') return `Yesterday, ${longDate(new Date(c.dateFrom))}`;
  if (fType === 'This Week' || fType === 'Last Week' || fType === 'Custom Range') {
    const from = new Date(c.dateFrom);
    const to = new Date(c.dateTo || c.dateFrom); to.setDate(to.getDate() - 1);
    const fmt = (x: Date) => fmtMonthDay(x);
    return `${fmt(from)} – ${fmt(to)}`;
  }
  if (fType === 'This Month' || fType === 'Last Month') return new Date(c.dateFrom).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  return longDate(new Date(c.dateFrom));
};
const statusLabelFor = (s?: string) => ({ estimated: 'Estimated', pending: 'Pending', approved: 'Approved', finalized: 'Finalized', paid: 'Paid' } as Record<string, string>)[s || 'estimated'] || 'Estimated';

export function TechEarningsScreen() {
  const nav = useTechNav();
  const [filterType, setFilterType] = useState<FilterType>('This Week');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  // BUILD_PLAN Phase 13: server state through the query layer — keyed by realm + salon + branch + the resolved range.
  // The earnings snapshot is kept in the offline read cache; the cash-pending list (payments awaiting confirmation) is
  // NOT persisted — payment details never sit on the device.
  const res = resolveFilter(filterType, customFrom, customTo);
  // ONE endpoint (merge Oct 12, other chat): the headline AND the per-line breakdown come from /tech/earnings/canonical
  // (snapshot store, tenant-zone window) — the second /tech/earnings/detail call used a UTC window and could disagree.
  const eq = useScopedQuery<{ can: TechCanonicalEarnings; prevTotal: number | null }>({
    key: ['tech', 'earnings', res?.period ?? null, res?.date ?? null, res?.dateTo ?? null], persist: true, enabled: !!res,
    fn: async () => {
      const [c, prev] = await Promise.all([
        techApi.earningsCanonical(res!.period, res!.date, res!.dateTo),
        techApi.earningsCanonical(res!.period, res!.prevDate, res!.prevDateTo).catch(() => null),
      ]);
      return { can: c, prevTotal: prev ? prev.estimatedEarningsCents : null };
    },
  });
  const cq = useScopedQuery<{ items: TechCashPendingItem[] }>({ key: ['tech', 'cash-pending'], fn: () => techApi.cashPending().catch(() => ({ items: [] as TechCashPendingItem[] })) });
  const can = eq.data?.can ?? null;
  const prevTotal = eq.data?.prevTotal ?? null;
  const lines = can?.lines ?? null;
  const cash = cq.data?.items || [];
  const error = !eq.data && eq.isError ? ((eq.error as any)?.message || 'Failed to load your earnings.') : null;
  const loading = eq.isPending;

  // per-service breakdown + daily buckets from the ranged paid lines (real; commission attributed per day)
  const services = useMemo(() => {
    if (!lines) return [] as { serviceName: string; qty: number; cents: number }[];
    const m = new Map<string, { qty: number; cents: number }>();
    for (const l of lines) { const k = l.serviceName || 'Service'; const e = m.get(k) || { qty: 0, cents: 0 }; e.qty += 1; e.cents += l.lineTotalCents; m.set(k, e); }
    return [...m.entries()].map(([serviceName, v]) => ({ serviceName, ...v })).sort((a, b) => b.cents - a.cents);
  }, [lines]);
  const daily = useMemo(() => {
    if (!lines) return [] as { label: string; cents: number }[];
    const m = new Map<string, number>();
    // bucket by the LOCAL calendar day (toISOString() is UTC — an evening service landed on tomorrow's bar)
    for (const l of lines) { if (!l.completedAt) continue; const d = new Date(l.completedAt); const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; m.set(key, (m.get(key) || 0) + l.commissionCents); }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-7)
      .map(([key, cents]) => ({ label: new Date(key + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' }), cents }));
  }, [lines]);
  const dailyMax = Math.max(1, ...daily.map((x) => x.cents));

  const trendPct = can && prevTotal && prevTotal > 0 ? Math.round(((can.estimatedEarningsCents - prevTotal) / prevTotal) * 100) : null;
  const cashCents = cash.reduce((n, i) => n + (i.amountCents || 0), 0);

  return (
    <div>
      <div className="tech-tab-header" style={{ marginBottom: 32 }}>
        <div className="tech-tab-header__inner">
          <div className="t-title">Earnings</div>
          <button className="tech-iconbtn" style={{ marginLeft: 'auto' }} aria-label="Choose period" onClick={() => setModalOpen(true)}><Cal /></button>
        </div>
      </div>
<div className="tech-main-2">
      <OfflineStatus updatedAt={eq.dataUpdatedAt || undefined} failed={eq.isError} />
      {error ? <div className="tech-state" role="alert" style={{ color: 'var(--tech-danger)' }}>{error}</div>
        : loading || !can ? (
          <>
            <div className="tech-card">
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                <div className="tech-skel" style={{ width: 120, height: 16 }} />
                <div className="tech-skel" style={{ width: 60, height: 20, borderRadius: 10 }} />
              </div>
              <div className="tech-skel" style={{ width: 160, height: 38, marginTop: 12, marginBottom: 12 }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div className="tech-skel" style={{ width: 100, height: 16 }} />
                <div className="tech-skel" style={{ width: 80, height: 16 }} />
              </div>
            </div>
            <div className="tech-card" style={{ marginTop: 12, padding: '16px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              {[1, 2, 3, 4].map(i => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <div className="tech-skel" style={{ width: 80, height: 16 }} />
                  <div className="tech-skel" style={{ width: 60, height: 16 }} />
                </div>
              ))}
            </div>
          </>
        )
        : (<>
          {/* Total earnings + vs-last-period trend + status label */}
          <div className="tech-card">
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <div className="tech-label">{rangeLabel(can, filterType)}</div>
              <span className="tech-chip neutral" style={{ padding: '2px 9px' }}>{statusLabelFor(can.status)}</span>
            </div>
            <div className="tech-h-serif" style={{ fontSize: 32, fontWeight: 800, marginTop: 2 }} aria-label={`Total earnings ${money2(can.estimatedEarningsCents)}`}>{money2(can.estimatedEarningsCents)}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="tech-label">Total Earnings</span>
              {trendPct !== null ? <span className={'tech-trend ' + (trendPct >= 0 ? 'up' : 'down')} style={{ margin: 0 }}>{trendPct >= 0 ? '↑' : '↓'} {Math.abs(trendPct)}% vs last {filterType === 'Today' || filterType === 'Yesterday' || filterType === 'Specific Day' ? 'day' : filterType === 'This Week' || filterType === 'Last Week' ? 'week' : filterType === 'This Month' || filterType === 'Last Month' ? 'month' : 'period'}</span> : null}
            </div>
          </div>

          {/* Breakdown — Services / Tips / Retail / Bonuses (bonuses null until payroll → "—", never invented) */}
          <div className="tech-card" style={{ marginTop: 12, padding: '4px 16px' }}>
            <div className="tech-brk"><span className="k">Services</span><span className="v">{money2(can.serviceCommissionCents)}</span></div>
            <div className="tech-brk"><span className="k">Tips</span><span className="v">{money2(can.tipsCents)}</span></div>
            <div className="tech-brk"><span className="k">Retail</span><span className="v">{money2(can.retailCommissionCents)}</span></div>
            <div className="tech-brk"><span className="k">Bonuses</span><span className="v">{can.bonusCents == null ? '—' : money2(can.bonusCents)}</span></div>
            {can.guaranteeTopUpCents != null ? <div className="tech-brk"><span className="k">Guarantee top-up</span><span className="v">{money2(can.guaranteeTopUpCents)}</span></div> : null}
            {can.adjustmentsCents != null ? <div className="tech-brk"><span className="k">Adjustments</span><span className="v">{money2(can.adjustmentsCents)}</span></div> : null}
          </div>

          {/* Cash Pending — real awaiting-handoff total; taps through to the handoff screen */}
          {cash.length ? (
            <button className="tech-card" style={{ marginTop: 14, width: '100%', textAlign: 'left', border: '1px solid var(--tech-border)', cursor: 'pointer', display: 'flex', alignItems: 'center' }} onClick={() => nav.openCashPending()}>
              <div>
                <div className="tech-label">Cash Pending</div>
                <div className="tech-muted" style={{ fontSize: 12 }}>{cash.length} handoff{cash.length > 1 ? 's' : ''} pending</div>
              </div>
              <div className="tech-h-serif" style={{ marginLeft: 'auto', fontSize: 20, fontWeight: 800 }}>{money2(cashCents)}</div>
            </button>
          ) : null}

          {/* Daily Earnings chart — buckets the period's paid commission by day */}
          {daily.length > 1 ? (
            <>
              <div className="tech-section-title" style={{ margin: '18px 0 8px' }}>Daily Earnings</div>
              <div className="tech-card">
                <div className="tech-bars" role="img" aria-label="Daily earnings for the period">
                  {daily.map((b, i) => (
                    <div className="col" key={i}>
                      <div className="bar" style={{ height: `${Math.max(4, (b.cents / dailyMax) * 100)}%` }} title={money2(b.cents)} />
                      <div className="bl">{b.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : null}

          {/* Service mix (real ranged lines) */}
          <div className="tech-section-title" style={{ margin: '18px 0 8px' }}>Service Breakdown</div>
          {services.length === 0 ? (
            <div className="tech-card tech-state" style={{ boxShadow: 'none' }}>No paid services in this period.</div>
          ) : (
            <div className="tech-card" style={{ padding: '4px 16px' }}>
              {services.map((b) => (
                <div key={b.serviceName} className="tech-row">
                  <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.serviceName}</span>
                  <span className="tech-muted" style={{ width: 28, textAlign: 'center' }}>{b.qty}</span>
                  <span style={{ fontWeight: 600 }}>{money2(b.cents)}</span>
                </div>
              ))}
            </div>
          )}

          <div className="tech-muted" style={{ fontSize: 11.5, textAlign: 'center', margin: '14px 0 4px' }}>
            Estimated from completed work. Final payroll is confirmed by the salon.
          </div>
        </>)}

      {modalOpen && (
        <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, background: 'rgba(20,12,4,0.4)', display: 'grid', placeItems: 'center', zIndex: 20 }} onClick={() => setModalOpen(false)}>
          <div style={{ background: 'var(--tech-background)', width: 'calc(100% - 32px)', maxWidth: 400, borderRadius: 24, padding: '24px 20px', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.15)', boxSizing: 'border-box' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
              <div className="tech-h-serif" style={{ fontSize: 24, fontWeight: 700 }}>Select Date</div>
              <button className="tech-iconbtn" onClick={() => setModalOpen(false)} style={{ border: 'none', background: 'transparent', boxShadow: 'none' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 24 }}>
              {ALL_FILTERS.slice(0, 6).map((f) => (
                <button key={f} className={`tech-btn ${filterType === f ? 'gold' : 'outline'}`} onClick={() => { setFilterType(f); setModalOpen(false); }}>
                  {f}
                </button>
              ))}
            </div>
            
            <div className="tech-label" style={{ marginBottom: 8, fontSize: 13 }}>Specific Day</div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 24 }}>
              <input type="date" className="tech-input" value={filterType === 'Specific Day' ? customFrom : ''} max={new Date().toISOString().slice(0, 10)} onChange={(e) => { setCustomFrom(e.target.value); setFilterType('Specific Day'); if (e.target.value) setModalOpen(false); }} style={{ flex: 1, minWidth: 0, padding: '0 12px' }} />
            </div>

            <div className="tech-label" style={{ marginBottom: 8, fontSize: 13 }}>Custom Range</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="date" className="tech-input" value={filterType === 'Custom Range' ? customFrom : ''} max={new Date().toISOString().slice(0, 10)} onChange={(e) => { setCustomFrom(e.target.value); if (customTo) setFilterType('Custom Range'); }} style={{ flex: 1, minWidth: 0, padding: '0 12px' }} />
              <div style={{ color: 'var(--tech-text-muted)', fontWeight: 600 }}>–</div>
              <input type="date" className="tech-input" value={filterType === 'Custom Range' ? customTo : ''} max={new Date().toISOString().slice(0, 10)} onChange={(e) => { setCustomTo(e.target.value); if (customFrom) setFilterType('Custom Range'); }} style={{ flex: 1, minWidth: 0, padding: '0 12px' }} />
            </div>
            {filterType === 'Custom Range' && customFrom && customTo && (
              <button className="tech-btn gold" style={{ width: '100%', marginTop: 24 }} onClick={() => setModalOpen(false)}>Apply Range</button>
            )}
          </div>
        </div>
      )}
    </div>
    </div>
  );
}
