import { useEffect, useState } from 'react';
import { useEventCallback } from '@aipowersalon/ui';
import { useOwnerBranch } from '../shell/OwnerBranchContext';
import { ownerBookingsApi, type OwnerBookingOverview, type OwnerAppointmentListItem } from '../api/ownerApi';
import { useOwnerNav } from '../shell/nav';
import { OwnerSkeletonBlocks } from '../components/OwnerSkeleton';

// BookingOverviewScreen — Module 3. Real data from GET /owner/bookings/overview: status donut
// (completed/cancelled/no-show + remaining), a Booking Insights donut (booking mix by source), 7-day bookings trend,
// and completion/cancellation/no-show rate cards. Tapping a status in the legend loads the underlying appointments via
// /owner/bookings/drill-down. No mock values.

function trend(p: number) { if (p > 0) return { cls: 'up', arrow: '▲', text: `${p.toFixed(1)}%` }; if (p < 0) return { cls: 'down', arrow: '▼', text: `${Math.abs(p).toFixed(1)}%` }; return { cls: 'flat', arrow: '•', text: '0.0%' }; }
function Trend({ p }: { p: number }) { const t = trend(p); return <span className={`sub ${t.cls}`}>{t.arrow} {t.text}</span>; }

const COLORS = { completed: 'var(--owner-success)', cancelled: 'var(--owner-warning)', no_show: 'var(--owner-danger)', remaining: 'var(--owner-border)' };

function Donut({ o }: { o: OwnerBookingOverview }) {
  const size = 132, stroke = 16, r = (size - stroke) / 2, cx = size / 2, circ = 2 * Math.PI * r;
  const total = Math.max(1, o.totalBookings);
  const segs = [
    { v: o.completed.count, c: COLORS.completed },
    { v: o.cancelled.count, c: COLORS.cancelled },
    { v: o.noShow.count, c: COLORS.no_show },
  ];
  let offset = 0;
  return (
    <div className="owner-donut" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke={COLORS.remaining} strokeWidth={stroke} />
        <g transform={`rotate(-90 ${cx} ${cx})`}>
          {segs.map((s, i) => {
            const len = (s.v / total) * circ;
            const el = <circle key={i} cx={cx} cy={cx} r={r} fill="none" stroke={s.c} strokeWidth={stroke} strokeDasharray={`${len} ${circ - len}`} strokeDashoffset={-offset} strokeLinecap="butt" />;
            offset += len;
            return el;
          })}
        </g>
      </svg>
      <div className="ctr"><div className="num">{o.totalBookings}</div><div className="lbl">Total Bookings</div></div>
    </div>
  );
}

const SOURCE_COLORS: Record<string, string> = { Online: 'var(--owner-primary)', Phone: '#6B7DB3', 'Walk-in': 'var(--owner-success)', Other: 'var(--owner-text-muted)' };

function SourceDonut({ sources }: { sources: { label: string; count: number; percentage: number }[] }) {
  const size = 132, stroke = 16, r = (size - stroke) / 2, cx = size / 2, circ = 2 * Math.PI * r;
  const tot = sources.reduce((s, x) => s + x.count, 0), total = Math.max(1, tot);
  let offset = 0;
  return (
    <div className="owner-donut" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="var(--owner-border)" strokeWidth={stroke} />
        <g transform={`rotate(-90 ${cx} ${cx})`}>
          {sources.map((s, i) => {
            const len = (s.count / total) * circ;
            const el = <circle key={i} cx={cx} cy={cx} r={r} fill="none" stroke={SOURCE_COLORS[s.label] ?? 'var(--owner-text-muted)'} strokeWidth={stroke} strokeDasharray={`${len} ${circ - len}`} strokeDashoffset={-offset} strokeLinecap="butt" />;
            offset += len;
            return el;
          })}
        </g>
      </svg>
    </div>
  );
}

function TrendChart({ data }: { data: { date: string; bookingCount: number }[] }) {
  const w = 320, h = 120, padL = 8, padR = 8, padT = 10, padB = 6, iw = w - padL - padR, ih = h - padT - padB;
  const vals = data.map((d) => d.bookingCount); const max = Math.max(1, ...vals);
  const step = data.length > 1 ? iw / (data.length - 1) : iw;
  const xy = (i: number, v: number) => [padL + i * step, padT + ih - (v / max) * ih] as const;
  const line = vals.map((v, i) => { const [x, y] = xy(i, v); return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`; }).join(' ');
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return (
    <>
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Bookings trend, this week">
        {[0.33, 0.66].map((g) => (<line key={g} x1={padL} x2={w - padR} y1={padT + ih * g} y2={padT + ih * g} stroke="var(--owner-border)" strokeWidth="1" />))}
        <path d={line} fill="none" stroke="var(--owner-primary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {vals.map((v, i) => { const [x, y] = xy(i, v); return <circle key={i} cx={x.toFixed(1)} cy={y.toFixed(1)} r="3" fill="var(--owner-primary)" stroke="#fff" strokeWidth="1.4"><title>{v} bookings</title></circle>; })}
      </svg>
      <div className="owner-axis">{days.map((d) => (<span key={d}>{d}</span>))}</div>
    </>
  );
}

const statusColor = (s: string) => s === 'completed' ? COLORS.completed : s === 'cancelled' ? COLORS.cancelled : s === 'no_show' ? COLORS.no_show : 'var(--owner-text-muted)';

export function BookingOverviewScreen() {
  const { back } = useOwnerNav();
  const [period, setPeriod] = useState<'today' | 'week'>('week');
  const [o, setO] = useState<OwnerBookingOverview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [drillStatus, setDrillStatus] = useState<string | null>(null);
  const [drill, setDrill] = useState<OwnerAppointmentListItem[] | null>(null);

  const { effectiveBranchId } = useOwnerBranch();
  const load = useEventCallback((p: 'today' | 'week') => {
    setLoading(true); setErr(null); setDrillStatus(null); setDrill(null);
    ownerBookingsApi.overview(p, effectiveBranchId)
      .then(setO)
      .catch((e: any) => setErr(e?.status === 403 ? 'You do not have access to booking reports.' : e?.message || 'Unable to load booking overview.'))
      .finally(() => setLoading(false));
  });
  useEffect(() => { load(period); }, [period, effectiveBranchId, load]);

  const openDrill = (status: string) => {
    if (drillStatus === status) { setDrillStatus(null); setDrill(null); return; }
    setDrillStatus(status); setDrill(null);
    ownerBookingsApi.drillDown({ period, status, branchId: effectiveBranchId }).then(setDrill).catch(() => setDrill([]));
  };

  // Render the period's calendar start as a stable local date. dateFrom is a full ISO instant (salon-local midnight in
  // UTC); parsing it directly would render in the viewer's timezone and could slip a day west of the salon, so pin to the
  // date portion at local midnight — matching OwnerHomeScreen.
  const dateLabel = o ? new Date((o.businessDateFrom ?? o.dateFrom.slice(0, 10)) + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '';

  return (
    <>
      <header className="owner-header">
        <button className="owner-back" aria-label="Back" onClick={back}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--owner-text)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <div className="owner-greet" style={{ textAlign: 'center' }}><div className="n owner-serif" style={{ cursor: 'default', justifyContent: 'center' }}>Booking Overview</div></div>
        <div style={{ width: 40 }} />
      </header>

      <div className="owner-tabs">
        <button className={`owner-tab ${period === 'today' ? 'active' : ''}`} onClick={() => setPeriod('today')}>Daily</button>
        <button className={`owner-tab ${period === 'week' ? 'active' : ''}`} onClick={() => setPeriod('week')}>Weekly</button>
      </div>

      {err ? (
        <div className="owner-state"><div className="big owner-serif">Couldn’t load bookings</div><div className="muted" style={{ marginBottom: 16 }}>{err}</div><button className="owner-btn" onClick={() => load(period)}>Retry</button></div>
      ) : o && o.totalBookings === 0 ? (
        <div className="owner-state"><div className="big owner-serif">No bookings found</div><div className="muted">No appointments in this period.</div></div>
      ) : (
        <>
          <div className="owner-sechead"><div className="t" style={{ fontSize: 15 }}>{loading && !o ? <div className="owner-skel" style={{ width: 120, height: 16, display: 'inline-block' }} /> : dateLabel}</div><div className="d">🗓</div></div>

          <div className="owner-chartcard">
            {loading && !o ? (
              <OwnerSkeletonBlocks count={1} />
            ) : (
              <>
                <div className="owner-donut-wrap">
                  <Donut o={o!} />
                  <div className="owner-legend">
                    {([['completed', 'Completed', o!.completed], ['cancelled', 'Cancelled', o!.cancelled], ['no_show', 'No-Show', o!.noShow]] as const).map(([key, label, seg]) => (
                      <div className="li" key={key} onClick={() => openDrill(key)} role="button" aria-expanded={drillStatus === key}>
                        <span className="dot" style={{ background: statusColor(key) }} />
                        <span className="nm">{label}</span>
                        <span className="ct">{seg.count}</span>
                        <span className="pc">{seg.percentage.toFixed(1)}%</span>
                      </div>
                    ))}
                  </div>
                </div>

                {drillStatus && (
                  <div className="owner-drill">
                    <div className="dh">{drillStatus.replace('_', '-')} appointments{drill ? ` (${drill.length})` : ''}</div>
                    {!drill && <div className="muted" style={{ fontSize: 12 }}>Loading…</div>}
                    {drill && drill.length === 0 && <div className="muted" style={{ fontSize: 12 }}>None in this period.</div>}
                    {drill && drill.map((a) => (
                      <div className="owner-drillrow" key={a.appointmentId}>
                        <div><div className="nm">{a.customerName || 'Walk-in'}</div><div className="mt">{a.startTime}–{a.endTime} · {a.source.replace('_', ' ')}</div></div>
                        <span className="owner-statusbadge" style={{ background: 'var(--owner-panel)', color: statusColor(a.status) }}>{a.status.replace('_', '-')}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="owner-chartcard">
            <div className="head"><div className="t">Booking Insights</div><div className="u">by source</div></div>
            {loading && !o ? (
              <OwnerSkeletonBlocks count={1} />
            ) : o && o.bookingSources.length > 0 ? (
              <div className="owner-donut-wrap">
                <SourceDonut sources={o.bookingSources} />
                <div className="owner-legend">
                  {o.bookingSources.map((s) => (
                    <div className="li" key={s.label}>
                      <span className="dot" style={{ background: SOURCE_COLORS[s.label] ?? 'var(--owner-text-muted)' }} />
                      <span className="nm">{s.label}</span>
                      <span className="ct">{s.count}</span>
                      <span className="pc">{s.percentage}%</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="owner-chartcard">
            <div className="head"><div className="t">Bookings Trend <span style={{ color: 'var(--owner-text-muted)', fontWeight: 400, fontSize: 11 }}>(This Week)</span></div></div>
            {loading && !o ? <div className="owner-skel" style={{ width: '100%', height: 120, borderRadius: 8, marginTop: 12 }} /> : <TrendChart data={o!.trend} />}
          </div>

          <div className="owner-kpigrid three">
            <div className="owner-kpi"><div className="label">Completion Rate</div><div className="val">{loading && !o ? <div className="owner-skel" style={{ width: 40, height: 24, margin: '0 auto' }} /> : `${o!.completionRate.toFixed(1)}%`}</div>{loading && !o ? <div className="owner-skel" style={{ width: 40, height: 12, margin: '4px auto 0' }} /> : <Trend p={o!.completionRateTrendPercent} />}</div>
            <div className="owner-kpi"><div className="label">Cancellation Rate</div><div className="val">{loading && !o ? <div className="owner-skel" style={{ width: 40, height: 24, margin: '0 auto' }} /> : `${o!.cancellationRate.toFixed(1)}%`}</div>{loading && !o ? <div className="owner-skel" style={{ width: 40, height: 12, margin: '4px auto 0' }} /> : <Trend p={o!.cancellationRateTrendPercent} />}</div>
            <div className="owner-kpi"><div className="label">No-Show Rate</div><div className="val">{loading && !o ? <div className="owner-skel" style={{ width: 40, height: 24, margin: '0 auto' }} /> : `${o!.noShowRate.toFixed(1)}%`}</div>{loading && !o ? <div className="owner-skel" style={{ width: 40, height: 12, margin: '4px auto 0' }} /> : <Trend p={o!.noShowRateTrendPercent} />}</div>
          </div>
        </>
      )}
    </>
  );
}
