import { useEffect, useState } from 'react';
import { useScopedQuery, useStreamInvalidation, OfflineStatus } from '@aipowersalon/mobile-sdk';
import { ownerDashboardApi, ownerSalonsApi, ownerContextApi, ownerActivityApi, ownerCashHandoffApi, ownerAttentionApi, ownerStaffApi, ownerBookingsApi, type OwnerDashboardState, type OwnerSalonOverview, type OwnerCashHandoffBoard, type OwnerAttentionResp, type OwnerTopTechnician, type OwnerAppointmentListItem } from '../api/ownerApi';
import { SalonOverviewCards } from './SalonOverviewCards';
import { OwnerBranchHealthCard } from './OwnerBranchHealthCard';   // BUILD_PLAN Phase 14 B: C11 §345 branch health
import { useOwnerStream } from '../api/useOwnerStream';
import { useAuth } from '../auth/AuthContext';
import { useOwnerNav } from '../shell/nav';
import { useOwnerBranch } from '../shell/OwnerBranchContext';
import { formatCurrency } from '@aipowersalon/money';   // BUILD_PLAN Phase 13 E (C6 §99–100): shared money / branch-zone date display


// OwnerHomeScreen — Module 1 (Home Dashboard). Renders ONLY real backend data from GET /owner/dashboard/state:
// gold "Today's Revenue" hero + trend sparkline, 6 KPI cards, and a 7-day revenue line chart. No mock values; on
// failure it shows an honest error with Retry rather than fabricated numbers.

const money = (cents: number, currency = 'USD') => formatCurrency(cents, { currency });

// End-of-day cash at a glance (self-contained: own fetch; hides quietly if there's no cash activity or on error so it
// can never block the dashboard). Taps through to the full End-of-Day Cash screen.
export function CashHandoffHomeCard({ onOpen }: { onOpen: () => void }) {
  const [board, setBoard] = useState<OwnerCashHandoffBoard | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    ownerCashHandoffApi.state().then((b) => { if (alive) { setBoard(b); setLoading(false); } }).catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);
  if (!loading && (!board || board.technicianCount === 0)) return null;
  const discrepancies = board?.technicians.filter((t) => t.status === 'discrepancy').length ?? 0;
  return (
    <div className="owner-chartcard" style={{ cursor: 'pointer' }} role="button" onClick={onOpen}>
      <div className="head"><div className="t">End-of-Day Cash</div><div className="u">Tap to review</div></div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginTop: 4 }}>
        <div>
          {loading ? (
            <>
              <div className="owner-skel" style={{ width: 80, height: 28, marginBottom: 4 }} />
              <div className="owner-skel" style={{ width: 140, height: 14 }} />
            </>
          ) : (
            <>
              <div style={{ fontSize: 24, fontWeight: 700 }}>{money(board!.totalExpectedCents)}</div>
              <div className="muted" style={{ fontSize: 12 }}>collected by {board!.technicianCount} technician{board!.technicianCount === 1 ? '' : 's'} today</div>
            </>
          )}
        </div>
        <div style={{ textAlign: 'right', fontSize: 12.5 }}>
          {loading ? (
            <div className="owner-skel" style={{ width: 100, height: 16, display: 'inline-block' }} />
          ) : (
            <>
              <div className="muted">{board!.reconciledCount} reconciled · {board!.openCount} awaiting</div>
              {discrepancies > 0 ? <div style={{ color: '#c0392b', fontWeight: 700, marginTop: 2 }}>{discrepancies} discrepanc{discrepancies === 1 ? 'y' : 'ies'}</div> : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Top 3 technicians for the selected salon TODAY. Self-contained (own fetch), reuses GET /owner/staff/performance —
// the same endpoint the Staff Performance screen runs on, so the two never disagree. Degrades to null on load/error/
// empty (like the cash card) so a supporting section can never take the dashboard down or show a fabricated figure.
// A row taps through to that technician; "See all" opens the Staff tab.
function TopTechniciansCard({ branchId, currency, onSeeAll, onOpenTech }: { branchId?: string; currency: string; onSeeAll: () => void; onOpenTech: (id: string) => void }) {
  const [techs, setTechs] = useState<OwnerTopTechnician[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true; setTechs(null); setFailed(false); setLoading(true);
    // Promise.resolve + try/catch: if the call throws synchronously the promise never exists and a bare `.catch`
    // cannot save it — and an exception in an effect unmounts the whole dashboard. This section is never allowed to.
    try {
      Promise.resolve(ownerStaffApi.performance('today', branchId))
        .then((s) => { if (alive) { setTechs((s?.topTechnicians ?? []).slice(0, 3)); setLoading(false); } })
        .catch(() => { if (alive) { setFailed(true); setLoading(false); } });
    } catch { if (alive) { setFailed(true); setLoading(false); } }
    return () => { alive = false; };
  }, [branchId]);
  if (!loading && (failed || techs === null || techs.length === 0)) return null;
  return (
    <div className="owner-chartcard">
      <div className="head">
        <div className="t">Top Technicians <span style={{ color: 'var(--owner-text-muted)', fontWeight: 400, fontSize: 11 }}>(Today)</span></div>
        <button className="u" onClick={onSeeAll} style={{ background: 'none', border: 'none', color: 'var(--owner-primary)', fontWeight: 700, cursor: 'pointer', padding: 0 }}>See all</button>
      </div>
      <div style={{ marginTop: 4 }}>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0' }}>
            <div className="owner-skel" style={{ height: 40, borderRadius: 8 }} />
            <div className="owner-skel" style={{ height: 40, borderRadius: 8 }} />
            <div className="owner-skel" style={{ height: 40, borderRadius: 8 }} />
          </div>
        ) : techs!.map((t, i) => (
          <button key={t.technicianId} onClick={() => onOpenTech(t.technicianId)} aria-label={`View ${t.fullName}`}
            style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', background: 'none', border: 'none', borderTop: i === 0 ? 'none' : '1px solid var(--owner-border)', padding: '9px 0', cursor: 'pointer' }}>
            <span aria-hidden style={{ minWidth: 22, height: 22, borderRadius: 11, background: 'rgba(169,111,34,0.10)', color: 'var(--owner-primary)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800 }}>{i + 1}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--owner-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.fullName}</div>
              <div className="muted" style={{ fontSize: 12 }}>{t.roleLabel} · {t.servicesCompleted} service{t.servicesCompleted === 1 ? '' : 's'}</div>
            </div>
            <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
              <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--owner-text)' }}>{money(t.salesCents, currency)}</div>
              {t.rating > 0 ? <div className="muted" style={{ fontSize: 12 }}>{t.rating.toFixed(1)}★</div> : null}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

const APPT_TIME = (t: string) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(t || ''); if (!m) return t || '';
  let h = parseInt(m[1], 10); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return `${h}:${m[2]} ${ap}`;
};
const APPT_STATUS_COLOR: Record<string, string> = {
  completed: '#2E7D5B', checked_in: 'var(--owner-primary)', in_service: 'var(--owner-primary)',
  cancelled: 'var(--owner-danger)', no_show: 'var(--owner-danger)',
};
// Today's most recent appointments for the selected salon. Reuses GET /owner/bookings/drill-down (the Bookings
// screen's own source). Same null-on-load/error/empty discipline; "See all" opens the full Bookings screen.
function RecentAppointmentsCard({ branchId, onSeeAll }: { branchId?: string; onSeeAll: () => void }) {
  const [appts, setAppts] = useState<OwnerAppointmentListItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true; setAppts(null); setFailed(false); setLoading(true);
    try {
      Promise.resolve(ownerBookingsApi.drillDown({ period: 'today', branchId, limit: 5 }))
        .then((rows) => { if (alive) { setAppts(Array.isArray(rows) ? rows : []); setLoading(false); } })
        .catch(() => { if (alive) { setFailed(true); setLoading(false); } });
    } catch { if (alive) { setFailed(true); setLoading(false); } }
    return () => { alive = false; };
  }, [branchId]);
  if (!loading && (failed || appts === null || appts.length === 0)) return null;
  return (
    <div className="owner-chartcard">
      <div className="head">
        <div className="t">Recent Appointments <span style={{ color: 'var(--owner-text-muted)', fontWeight: 400, fontSize: 11 }}>(Today)</span></div>
        <button className="u" onClick={onSeeAll} style={{ background: 'none', border: 'none', color: 'var(--owner-primary)', fontWeight: 700, cursor: 'pointer', padding: 0 }}>See all</button>
      </div>
      <div style={{ marginTop: 4 }}>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0' }}>
            <div className="owner-skel" style={{ height: 40, borderRadius: 8 }} />
            <div className="owner-skel" style={{ height: 40, borderRadius: 8 }} />
            <div className="owner-skel" style={{ height: 40, borderRadius: 8 }} />
          </div>
        ) : appts!.map((a, i) => {
          const color = APPT_STATUS_COLOR[a.status] ?? 'var(--owner-text-secondary)';
          return (
            <div key={a.appointmentId} style={{ display: 'flex', alignItems: 'center', gap: 10, borderTop: i === 0 ? 'none' : '1px solid var(--owner-border)', padding: '9px 0' }}>
              <div style={{ minWidth: 62, fontWeight: 700, fontSize: 12.5, color: 'var(--owner-text)' }}>{APPT_TIME(a.startTime)}</div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 13.5, color: 'var(--owner-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.customerName || 'Guest'}</div>
                <div className="muted" style={{ fontSize: 12, textTransform: 'capitalize' }}>{(a.source || '').replace(/_/g, ' ') || '—'}</div>
              </div>
              <span style={{ fontSize: 11.5, fontWeight: 700, color, textTransform: 'capitalize', whiteSpace: 'nowrap' }}>{(a.status || '').replace(/_/g, ' ')}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function trend(p: number) {
  if (p > 0) return { cls: 'up', arrow: '▲', text: `${p.toFixed(1)}%` };
  if (p < 0) return { cls: 'down', arrow: '▼', text: `${Math.abs(p).toFixed(1)}%` };
  return { cls: 'flat', arrow: '•', text: '0.0%' };
}

function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 12 ? 'Good Morning,' : h < 18 ? 'Good Afternoon,' : 'Good Evening,';
}

function Sparkline({ points }: { points: number[] }) {
  const w = 96, h = 34, max = Math.max(1, ...points), min = Math.min(...points);
  const span = Math.max(1, max - min);
  const step = points.length > 1 ? w / (points.length - 1) : w;
  const path = points.map((v, i) => `${i === 0 ? 'M' : 'L'} ${(i * step).toFixed(1)} ${(h - ((v - min) / span) * (h - 6) - 3).toFixed(1)}`).join(' ');
  return (
    <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={path} fill="none" stroke="rgba(255,255,255,.95)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {points.map((v, i) => (<circle key={i} cx={(i * step).toFixed(1)} cy={(h - ((v - min) / span) * (h - 6) - 3).toFixed(1)} r="1.7" fill="#fff" />))}
    </svg>
  );
}

function RevenueChart({ data }: { data: { date: string; revenueCents: number }[] }) {
  const w = 320, h = 130, padL = 8, padR = 8, padT = 10, padB = 6;
  const vals = data.map((d) => d.revenueCents / 100);
  const max = Math.max(1, ...vals);
  const iw = w - padL - padR, ih = h - padT - padB;
  const step = data.length > 1 ? iw / (data.length - 1) : iw;
  const xy = (i: number, v: number) => [padL + i * step, padT + ih - (v / max) * ih] as const;
  const line = vals.map((v, i) => { const [x, y] = xy(i, v); return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`; }).join(' ');
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return (
    <>
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Revenue trend, this week, in dollars">
        {[0.25, 0.5, 0.75].map((g) => (<line key={g} x1={padL} x2={w - padR} y1={padT + ih * g} y2={padT + ih * g} stroke="var(--owner-border)" strokeWidth="1" />))}
        <path d={line} fill="none" stroke="var(--owner-primary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        {vals.map((v, i) => { const [x, y] = xy(i, v); return <circle key={i} cx={x.toFixed(1)} cy={y.toFixed(1)} r="3.1" fill="var(--owner-primary)" stroke="#fff" strokeWidth="1.4"><title>{money(data[i].revenueCents)}</title></circle>; })}
      </svg>
      <div className="owner-axis">{days.map((d) => (<span key={d}>{d}</span>))}</div>
    </>
  );
}

export function OwnerHomeScreen() {
  const { logout } = useAuth();
  const nav = useOwnerNav();
  const { effectiveBranchId, selection, branches, setSelection } = useOwnerBranch();
  // BUILD_PLAN Phase 13: the dashboard snapshot through the query layer — keyed by realm + salon + branch (+ the branch
  // selection), kept in the offline read cache (§18 "owner dashboard snapshot"), refetched on the stream's events.
  const dq = useScopedQuery<OwnerDashboardState>({ key: ['owner', 'dashboard', effectiveBranchId ?? 'all'], fn: () => ownerDashboardApi.state(effectiveBranchId), persist: true });
  const data = dq.data ?? null;
  const loading = dq.isPending;
  const e0 = dq.error as any;
  const err = !data && dq.isError ? (e0?.status === 403 ? 'You do not have access to this dashboard.' : e0?.message || 'Unable to load your business overview.') : null;
  const [salons, setSalons] = useState<OwnerSalonOverview[]>([]);
  const [attention, setAttention] = useState<OwnerAttentionResp | null>(null);
  const loadAttention = () => { ownerAttentionApi.get(effectiveBranchId).then(setAttention).catch(() => setAttention(null)); };
  useEffect(loadAttention, [effectiveBranchId]);
  const showSalonCards = selection.mode === 'all' && branches.length > 1;

  const invalidateDashboard = useStreamInvalidation([['owner', 'dashboard']]);
  const load = () => { void dq.refetch(); };
  // A genuine view (mount or salon switch) — decoupled from load() so realtime refreshes don't re-log it.
  useEffect(() => { void ownerActivityApi.view('dashboard', effectiveBranchId).catch(() => {}); }, [effectiveBranchId]);
  // Per-salon "today" cards only matter in the combined view with more than one salon.
  useEffect(() => {
    if (!showSalonCards) { setSalons([]); return; }
    let alive = true;
    ownerSalonsApi.overview().then((rows) => { if (alive) setSalons(rows); }).catch(() => { if (alive) setSalons([]); });
    return () => { alive = false; };
  }, [showSalonCards, effectiveBranchId]);
  useOwnerStream((e) => { if (['owner_alert_updated', 'owner_alert_created', 'ticket_paid', 'payment_approved', 'reports_updated', 'appointment_created', 'appointment_updated', 'appointment_cancelled'].includes(e)) invalidateDashboard(e); if (['payment_approved', 'reports_updated', 'owner_alert_created', 'owner_alert_updated', 'owner_payroll_updated'].includes(e)) loadAttention(); });

  const pickSalon = (branchId: string) => { setSelection({ mode: 'single', branchId }); void ownerContextApi.select('single', branchId).catch(() => {}); };

  const heroTrend = data ? trend(data.todayRevenueTrendPercent) : null;

  return (
    <>
      <header className="owner-header">
        <div className="owner-logo" style={{ overflow: 'hidden', padding: 0 }}>
          {data?.owner.avatarUrl ? (
            <img src={data.owner.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <span>{data?.owner.fullName ? data.owner.fullName.trim().split(/\\s+/).map((w) => w[0]?.toUpperCase() ?? '').slice(0, 2).join('') : 'O'}</span>
          )}
        </div>
        <div className="owner-greet">
          <div className="g">{greeting()}</div>
          <div className="n" title="Account">{data?.owner.firstName ? `${data.owner.fullName}` : 'Owner'} <span aria-hidden>⌄</span></div>
        </div>
        <button className="owner-bell" aria-label="Alerts & notifications" title="Alerts & notifications" onClick={nav.openNotifications}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--owner-text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 01-3.4 0" /></svg>
          {!!data && data.unreadNotificationCount > 0 && <span className="badge">{data.unreadNotificationCount}</span>}
        </button>
      </header>



      <OfflineStatus updatedAt={dq.dataUpdatedAt || undefined} failed={dq.isError} />
      {!loading && err && (
        <div className="owner-state">
          <div className="big owner-serif">Couldn’t load your dashboard</div>
          <div className="muted" style={{ marginBottom: 16 }}>{err}</div>
          <button className="owner-btn" onClick={load}>Retry</button>{' '}
          <button className="owner-btn ghost" onClick={logout}>Sign out</button>
        </div>
      )}

      {(!err) && (
        <>
          {attention && (() => {
            const approvals = attention.payrollToApprove + attention.payrollToLock;
            const chips: { key: string; label: string; count: number; color: string; onClick: () => void }[] = [];
            if (approvals > 0) chips.push({ key: 'appr', label: approvals === 1 ? 'approval' : 'approvals', count: approvals, color: 'var(--owner-primary)', onClick: () => nav.go('approvals') });
            if (attention.outOfStock > 0) chips.push({ key: 'oos', label: 'out of stock', count: attention.outOfStock, color: 'var(--owner-danger)', onClick: () => nav.openInventory() });
            if (attention.lowStock > 0) chips.push({ key: 'low', label: 'low stock', count: attention.lowStock, color: '#C2410C', onClick: () => nav.openInventory() });
            if (attention.openAlerts > 0) chips.push({ key: 'alerts', label: attention.openAlerts === 1 ? 'alert' : 'alerts', count: attention.openAlerts, color: 'var(--owner-text-secondary)', onClick: () => nav.openAlerts() });
            if (chips.length === 0) return null;
            return (
              <div style={{ margin: '6px 0 14px' }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--owner-text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 7 }}>Needs attention</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {chips.map((c) => (
                    <button key={c.key} onClick={c.onClick} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 12px', borderRadius: 999, border: `1px solid ${c.color}`, background: 'rgba(169,111,34,0.04)', cursor: 'pointer' }}>
                      <span style={{ minWidth: 20, height: 20, borderRadius: 10, background: c.color, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, padding: '0 5px' }}>{c.count}</span>
                      <span style={{ fontWeight: 700, fontSize: 13 }}>{c.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}

          <div className="owner-sechead">
            <div className="t">Today’s Overview</div>
            <div className="d">{data ? new Date(data.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) + ' 🗓' : <div className="owner-skel" style={{ width: 100, height: 16, display: 'inline-block', verticalAlign: 'middle' }} />}</div>
          </div>

          {showSalonCards && salons.length > 1 ? <SalonOverviewCards salons={salons} onPick={pickSalon} /> : null}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 14 }}>
            <div className="owner-kpi"><div className="label">Locations</div><div className="val">{branches.length}</div></div>
            <div className="owner-kpi"><div className="label">Staff on Duty</div><div className="val">{data ? data.activeTechnicians : <div className="owner-skel" style={{ width: 30, height: 24, margin: '0 auto' }} />}</div></div>
            <div className="owner-kpi" role="button" onClick={() => nav.go('live')} style={{ cursor: 'pointer' }}><div className="label">Services Today</div><div className="val">{data ? data.servicesToday : <div className="owner-skel" style={{ width: 30, height: 24, margin: '0 auto' }} />}</div></div>
          </div>

          <section className="owner-hero" aria-label="Today's revenue">
            <div className="label">TODAY’S REVENUE</div>
            <div className="val">{data ? money(data.todayRevenueCents, data.context.currency) : <div className="owner-skel" style={{ width: 140, height: 40, margin: '0 auto', borderRadius: 8 }} />}</div>
            <div className="trend">{data && heroTrend ? <>{heroTrend.arrow} {heroTrend.text} vs Yesterday</> : <div className="owner-skel" style={{ width: 120, height: 16, margin: '4px auto 0' }} />}</div>
            {data ? <Sparkline points={data.revenueTrend.map((d) => d.revenueCents)} /> : <div className="owner-skel" style={{ width: '100%', height: 34, marginTop: 12, borderRadius: 4 }} />}
          </section>

          <div className="owner-kpigrid">
            <div className="owner-kpi" role="button" onClick={() => nav.go('live')} style={{ cursor: 'pointer' }}><div className="label">Check-ins</div><div className="val">{data ? data.checkInsToday : <div className="owner-skel" style={{ width: 30, height: 24, margin: '0 auto' }} />}</div></div>
            <div className="owner-kpi" role="button" onClick={() => nav.go('live')} style={{ cursor: 'pointer' }}><div className="label">Waiting Guests</div><div className="val">{data ? data.waitingNow : <div className="owner-skel" style={{ width: 30, height: 24, margin: '0 auto' }} />}</div></div>
            <div className="owner-kpi" role="button" onClick={() => nav.go('live')} style={{ cursor: 'pointer' }}><div className="label">Active Services</div><div className="val">{data ? data.servingNow : <div className="owner-skel" style={{ width: 30, height: 24, margin: '0 auto' }} />}</div></div>
            <div className="owner-kpi" role="button" onClick={() => nav.go('live')} style={{ cursor: 'pointer' }}><div className="label">Ready to Checkout</div><div className="val" style={(data?.readyToCheckout ?? 0) > 0 ? { color: 'var(--owner-primary)' } : undefined}>{data ? data.readyToCheckout : <div className="owner-skel" style={{ width: 30, height: 24, margin: '0 auto' }} />}</div></div>
          </div>

          <div className="owner-kpi" style={{ marginTop: 12 }}>
            <div className="label" title="Sales (services + retail) ÷ paid tickets, this week — the same definition as the POS reports">Average Ticket (sales)</div>
            <div className="val">{data ? money(data.averageTicketCents, data.context.currency) : <div className="owner-skel" style={{ width: 80, height: 24, margin: '0 auto' }} />}</div>
            {data ? (() => { const t = trend(data.averageTicketTrendPercent); return <div className={`sub ${t.cls}`}>{t.arrow} {t.text}</div>; })() : <div className="owner-skel" style={{ width: 60, height: 16, margin: '4px auto 0' }} />}
          </div>

          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--owner-text-muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 9 }}>Quick Actions</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              {([
                { label: 'Approvals', d: 'M20 6L9 17l-5-5', on: () => nav.go('approvals') },
                { label: 'Payroll', d: 'M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6', on: () => nav.openPayroll() },
                { label: 'Marketing', d: 'M3 11l18-5v12L3 14zM11.6 16.8a3 3 0 11-5.8-1.6', on: () => nav.openMarketing() },
                { label: 'Reports', d: 'M18 20V10M12 20V4M6 20v-6', on: () => nav.go('reports') },
              ] as const).map((a) => (
                <button key={a.label} onClick={a.on} aria-label={a.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7, padding: '13px 6px', borderRadius: 12, border: '1px solid var(--owner-border)', background: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 12, color: 'var(--owner-text)' }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--owner-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={a.d} /></svg>
                  {a.label}
                </button>
              ))}
            </div>
          </div>

          <TopTechniciansCard branchId={effectiveBranchId} currency={data?.context.currency || 'USD'} onSeeAll={() => nav.go('staff')} onOpenTech={(id) => nav.openTechDetail(id)} />

          <RecentAppointmentsCard branchId={effectiveBranchId} onSeeAll={() => nav.openBookings()} />

          <div className="owner-chartcard">
            <div className="head"><div className="t">Revenue Trend <span style={{ color: 'var(--owner-text-muted)', fontWeight: 400, fontSize: 11 }}>(This Week)</span></div><div className="u">$ in dollars</div></div>
            {data ? <RevenueChart data={data.revenueTrend} /> : <div className="owner-skel" style={{ width: '100%', height: 130, marginTop: 12, borderRadius: 8 }} />}
          </div>

          <CashHandoffHomeCard onOpen={() => nav.openCashHandoff()} />

          <OwnerBranchHealthCard branchId={effectiveBranchId} />
        </>
      )}
    </>
  );
}
