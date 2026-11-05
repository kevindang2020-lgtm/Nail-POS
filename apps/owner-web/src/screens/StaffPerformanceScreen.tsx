import { useEffect, useState } from 'react';
import { useOwnerBranch } from '../shell/OwnerBranchContext';
import { ownerStaffApi, type OwnerStaffPerformanceState, type OwnerStaffAttendance, type OwnerPeriod } from '../api/ownerApi';
import { useOwnerNav } from '../shell/nav';
import { PeriodSelector } from '../components/PeriodSelector';
import { OwnerSkeletonList } from '../components/OwnerSkeleton';

// StaffPerformanceScreen — Module 4. Technicians tab = top-tech table (services/sales/rating) + Today's Snapshot
// (total staff / utilization / total commission); Attendance tab = scheduled/clocked-in/break/off/absent tiles.
// Real data from /owner/staff/performance + /owner/staff/attendance; tap a technician → detail. No mock values.

const money = (c: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format((c || 0) / 100);
function trend(p: number) { if (p > 0) return { cls: 'up', arrow: '▲', text: `${p.toFixed(1)}%` }; if (p < 0) return { cls: 'down', arrow: '▼', text: `${Math.abs(p).toFixed(1)}%` }; return { cls: 'flat', arrow: '•', text: '0.0%' }; }
const initials = (name: string) => name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || 'T';

export function StaffPerformanceScreen() {
  const { openTechDetail, go } = useOwnerNav();
  const [tab, setTab] = useState<'technicians' | 'attendance'>('technicians');
  const [period, setPeriod] = useState<OwnerPeriod>('week');
  const { effectiveBranchId } = useOwnerBranch();
  const [perf, setPerf] = useState<OwnerStaffPerformanceState | null>(null);
  const [att, setAtt] = useState<OwnerStaffAttendance | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true); setErr(null);
    Promise.all([ownerStaffApi.performance(period, effectiveBranchId), ownerStaffApi.attendance(effectiveBranchId)])
      .then(([p, a]) => { setPerf(p); setAtt(a); })
      .catch((e: any) => setErr(e?.status === 403 ? 'You do not have access to staff reports.' : e?.message || 'Unable to load staff performance.'))
      .finally(() => setLoading(false));
  };
  useEffect(load, [effectiveBranchId, period]);
  const ut = perf ? trend(perf.utilizationTrendPercent) : null;

  return (
    <>
      <header className="owner-header">
        <button className="owner-back" aria-label="Back" onClick={() => go('more')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--owner-text)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <div className="owner-greet" style={{ textAlign: 'center' }}><div className="n owner-serif" style={{ cursor: 'default', justifyContent: 'center' }}>Team Performance</div></div>
        <div style={{ width: 40 }} />
      </header>

      <div className="owner-tabs">
        <button className={`owner-tab ${tab === 'technicians' ? 'active' : ''}`} onClick={() => setTab('technicians')}>Technicians</button>
        <button className={`owner-tab ${tab === 'attendance' ? 'active' : ''}`} onClick={() => setTab('attendance')}>Attendance</button>
      </div>

      {tab === 'technicians' && <PeriodSelector value={period} onChange={setPeriod} />}

      {err ? (
        <div className="owner-state"><div className="big owner-serif">Couldn’t load staff</div><div className="muted" style={{ marginBottom: 16 }}>{err}</div><button className="owner-btn" onClick={load}>Retry</button></div>
      ) : tab === 'technicians' ? (
        <>
          {loading && !perf ? (
            <div className="owner-chartcard">
              <div className="head"><div className="t">Top Technicians</div></div>
              <div className="owner-stafftable">
                <div className="owner-staffhead"><span /><span>Technician</span><span className="r">Svc</span><span className="r">Util.</span><span className="r">Rating</span></div>
                <div style={{ padding: '8px 0' }}>
                  <OwnerSkeletonList count={3} />
                </div>
              </div>
            </div>
          ) : perf!.topTechnicians.length === 0 ? (
            <div className="owner-state"><div className="big owner-serif">No staff performance yet</div><div className="muted">No completed services in this period.</div></div>
          ) : (
            <div className="owner-chartcard">
              <div className="head"><div className="t">Top Technicians</div></div>
              <div className="owner-stafftable">
                <div className="owner-staffhead"><span /><span>Technician</span><span className="r">Svc</span><span className="r">Util.</span><span className="r">Rating</span></div>
                {perf!.topTechnicians.map((t) => (
                  <div className="owner-staffrow" key={t.technicianId} onClick={() => openTechDetail(t.technicianId)} role="button">
                    <div className="owner-avatar">{initials(t.fullName)}</div>
                    <div><div className="nm">{t.fullName}</div><div className="role">{t.roleLabel}</div></div>
                    <div className="num r">{t.servicesCompleted}</div>
                    <div className="num r">{t.utilizationPercent}%</div>
                    <div className="rate"><span className="owner-star">★</span> {t.rating ? t.rating.toFixed(1) : '—'}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {loading && !perf ? (
            <div className="owner-chartcard" style={{ marginTop: 14 }}>
              <div className="head"><div className="t">Top Performer</div><div className="u">this period</div></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 6 }}>
                <div className="owner-skel" style={{ width: 52, height: 52, borderRadius: 26 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="owner-skel" style={{ width: 100, height: 18, marginBottom: 4 }} />
                  <div className="owner-skel" style={{ width: 60, height: 14 }} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, auto)', gap: 18 }}>
                  <div className="owner-skel" style={{ width: 40, height: 32 }} />
                  <div className="owner-skel" style={{ width: 40, height: 32 }} />
                  <div className="owner-skel" style={{ width: 40, height: 32 }} />
                </div>
              </div>
            </div>
          ) : perf!.topTechnicians.length > 0 ? (() => {
            const tp = perf!.topTechnicians[0];
            return (
              <div className="owner-chartcard" style={{ marginTop: 14, cursor: 'pointer' }} role="button" onClick={() => openTechDetail(tp.technicianId)}>
                <div className="head"><div className="t">Top Performer</div><div className="u">this period</div></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 6 }}>
                  <div className="owner-avatar" style={{ width: 52, height: 52, fontSize: 18, flex: '0 0 auto' }}>{initials(tp.fullName)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="nm" style={{ fontSize: 16, fontWeight: 700 }}>{tp.fullName}</div>
                    <div className="role" style={{ color: 'var(--owner-text-muted)', fontSize: 12 }}>{tp.roleLabel}</div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, auto)', gap: 18, textAlign: 'center' }}>
                    <div><div style={{ fontWeight: 800, fontSize: 15 }}>{money(tp.salesCents)}</div><div style={{ color: 'var(--owner-text-muted)', fontSize: 11 }}>Sales</div></div>
                    <div><div style={{ fontWeight: 800, fontSize: 15 }}>{tp.servicesCompleted}</div><div style={{ color: 'var(--owner-text-muted)', fontSize: 11 }}>Services</div></div>
                    <div><div style={{ fontWeight: 800, fontSize: 15 }}><span className="owner-star">★</span> {tp.rating ? tp.rating.toFixed(1) : '—'}</div><div style={{ color: 'var(--owner-text-muted)', fontSize: 11 }}>Rating</div></div>
                  </div>
                </div>
              </div>
            );
          })() : null}

          <div className="owner-sechead" style={{ marginTop: 16 }}><div className="t" style={{ fontSize: 16 }}>Today’s Snapshot</div></div>
          <div className="owner-kpigrid three">
            <div className="owner-kpi"><div className="label">Total Staff</div><div className="val">{loading && !perf ? <div className="owner-skel" style={{ width: 40, height: 24, margin: '0 auto' }} /> : perf!.totalStaff}</div><div className="sub flat">{loading && !perf ? <div className="owner-skel" style={{ width: 50, height: 12, margin: '4px auto 0' }} /> : `${perf!.onDutyCount} On Duty`}</div></div>
            <div className="owner-kpi"><div className="label">Utilization</div><div className="val">{loading && !perf ? <div className="owner-skel" style={{ width: 40, height: 24, margin: '0 auto' }} /> : `${perf!.utilizationPercent}%`}</div>{loading && !perf ? <div className="owner-skel" style={{ width: 50, height: 12, margin: '4px auto 0' }} /> : ut ? <div className={`sub ${ut.cls}`}>{ut.arrow} {ut.text}</div> : <div className="sub" />}</div>
            <div className="owner-kpi"><div className="label">Total Commission</div><div className="val" style={{ fontSize: 16 }}>{loading && !perf ? <div className="owner-skel" style={{ width: 60, height: 24, margin: '0 auto' }} /> : money(perf!.totalCommissionCents)}</div><div className="sub flat">{loading && !perf ? <div className="owner-skel" style={{ width: 50, height: 12, margin: '4px auto 0' }} /> : 'This Period'}</div></div>
          </div>
        </>
      ) : tab === 'attendance' ? (
        <div className="owner-attendgrid">
          {([['Scheduled', att?.scheduled], ['Clocked In', att?.clockedIn], ['On Break', att?.onBreak], ['Off Shift', att?.offShift], ['Absent', att?.absent], ['Late', att?.late], ['Overtime', att?.overtime]] as const).map(([label, v]) => (
            <div className="owner-attendtile" key={label}><div className="v">{loading && !att ? <div className="owner-skel" style={{ width: 30, height: 32, margin: '0 auto' }} /> : v}</div><div className="l">{label}</div></div>
          ))}
        </div>
      ) : null}
    </>
  );
}
