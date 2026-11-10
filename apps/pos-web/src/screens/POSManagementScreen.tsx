import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { posLocationsApi, type SalonLocation, type LocationSummary } from '../api/posLocationsApi';
import { t as tx, enPlural } from '@aipowersalon/mobile-sdk/i18n';

// POSManagementScreen.tsx — T18 Management. An operational command center that aggregates REAL tenant data from three
// existing modules: branches (/tenant/locations), staff (/pos/technicians/state) and payroll (/pos/payroll/state).
// Branch snapshot, team & roles, payroll allocation and manager performance are all live. Task/approval queues, manager
// checklists, permission matrices and activity feeds need workflow features that aren't built yet — those panels say so
// honestly and link to where the work happens, rather than inventing the mockup numbers.

type Tech = { technicianId: string; displayName: string; role?: string; workingStatus: string; shiftStatus?: string; rating?: number; todaySalesCents: number; estimatedCommissionCents: number };
type TechState = { kpisFull: { totalTechnicians: number; activeTechnicians: number; availableNow: number; onBreak: number; offToday: number; estimatedCommissionCents: number; todayTipsCents: number; todaySalesCents: number }; rows: { items: Tech[] } };
type PayrollPeriod = { id: string; status: string; totalCommissionCents: number; totalTipsCents: number; totalPayableCents: number };
type PayrollState = { kpis: { totalPeriods: number; openPeriods: number; unpaidPayableCents: number; lifetimePayableCents: number; lifetimeCommissionCents: number; lifetimeTipsCents: number }; periods: PayrollPeriod[] };

const money = (c?: number) => '$' + ((c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const PALETTE = ['#A96F22', '#C89B5A', '#6BAF92', '#7B9FD4', '#D08C8C', '#B0A0C8'];
const cardBox: React.CSSProperties = { background: '#FFFCF6', border: '1px solid var(--line)', borderRadius: 14, padding: 14 };
const headStyle: React.CSSProperties = { fontWeight: 800, fontSize: 13.5, marginBottom: 10, fontFamily: 'var(--aps-font-head, Playfair Display)' };

const Donut = ({ items }: { items: { label: string; count: number }[] }) => {
  const total = items.reduce((a, x) => a + x.count, 0);
  if (total === 0) return <div className="muted">{tx('pos.no_payroll_data_yet')}</div>;
  let acc = 0; const R = 52, C = 2 * Math.PI * R;
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <svg viewBox="0 0 140 140" style={{ width: 104, height: 104, flex: 'none' }}>
        {items.map((it, i) => { const dash = (it.count / total) * C; const seg = <circle key={i} cx="70" cy="70" r={R} fill="none" stroke={PALETTE[i % PALETTE.length]} strokeWidth="16" strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-acc} transform="rotate(-90 70 70)" />; acc += dash; return seg; })}
      </svg>
      <div style={{ flex: 1 }}>{items.map((it, i) => (<div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '1px 0' }}><span style={{ width: 9, height: 9, borderRadius: 2, background: PALETTE[i % PALETTE.length] }} /><span>{it.label}</span><span style={{ marginLeft: 'auto', color: '#8A7A66' }}>{money(it.count)}</span></div>))}</div>
    </div>
  );
};

export function POSManagementScreen() {
  const nav = useNavigate();
  const [branches, setBranches] = useState<SalonLocation[]>([]);
  const [locSummary, setLocSummary] = useState<LocationSummary | null>(null);
  const [team, setTeam] = useState<TechState | null>(null);
  const [payroll, setPayroll] = useState<PayrollState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [approvals, setApprovals] = useState<{ n?: number; err?: 'forbidden' | 'unavailable' } | null>(null);

  useEffect(() => {
    posLocationsApi.list().then((d) => { setBranches(d?.locations || []); setLocSummary(d?.summary || null); }).catch(() => {});
    (api.get('/pos/technicians/state') as Promise<TechState>).then(setTeam).catch((e: any) => setError(e?.message || tx('pos.failed_to_load_management_data')));
    (api.get('/pos/payroll/state') as Promise<PayrollState>).then(setPayroll).catch(() => setPayroll(null));
    // SUNMI batch 9 guide 17 (Nov 10 2026): Pending Approvals is the Approvals service's own count (it was a "—"); a role
    // without approvals.view sees "no access", a failure "unavailable" — never a made-up 0
    (api.get('/pos/approvals', { status: 'pending', page: 1, pageSize: 1 }) as Promise<{ total: number }>)
      .then((r) => setApprovals(typeof r?.total === 'number' ? { n: r.total } : { err: 'unavailable' }))
      .catch((e: any) => setApprovals({ err: e?.status === 403 ? 'forbidden' : 'unavailable' }));
  }, []);

  if (error) return <div className="work"><div className="err">{error}</div></div>;
  if (!team) return <div className="work"><div className="state">{tx('pos.loading_management')}</div></div>;

  const tk = team.kpisFull;
  const techs = team.rows.items;
  const activeBranches = locSummary?.active ?? branches.filter((b) => (b.status || '').toLowerCase() === 'active').length;
  const totalBranches = locSummary?.total ?? branches.length;
  const pk = payroll?.kpis;
  type Kpi = { l: string; v: string; note?: boolean; why?: string; link?: string };
  const kpis: Kpi[] = [
    { l: tx('pos.active_staff'), v: String(tk.activeTechnicians) },
    { l: tx('pos.branches_active'), v: `${activeBranches}/${totalBranches}` },
    { l: tx('pos.on_shift_now'), v: String(tk.availableNow) },
    { l: tx('pos.payroll_payable'), v: pk ? money(pk.unpaidPayableCents) : '—' },
    { l: tx('pos.open_pay_periods'), v: pk ? String(pk.openPeriods) : '—' },
    { l: tx('pos.open_tasks'), v: '—', note: true },
    approvals?.n != null ? { l: tx('pos.pending_approvals'), v: String(approvals.n), link: '/approvals' } : { l: tx('pos.pending_approvals'), v: '—', note: true, why: approvals?.err ? tx('mgmt.appr.' + approvals.err) : undefined },
    { l: tx('pos.compliance'), v: '—', note: true },
  ];

  // Payroll allocation (commission / tips / base) — real from payroll KPIs
  const baseCents = Math.max(0, (pk?.lifetimePayableCents || 0) - (pk?.lifetimeCommissionCents || 0) - (pk?.lifetimeTipsCents || 0));
  const allocation = [
    { label: tx('pos.commission'), count: pk?.lifetimeCommissionCents || 0 },
    { label: tx('pos.tips'), count: pk?.lifetimeTipsCents || 0 },
    { label: tx('pos.base_other'), count: baseCents },
  ].filter((x) => x.count > 0);
  const managerPerf = [...techs].filter((t) => t.rating != null).sort((a, b) => (b.rating || 0) - (a.rating || 0)).slice(0, 5);
  const shiftCode = (t: Tech): 'on' | 'break' | 'off' => (t.shiftStatus === 'on_shift' || t.workingStatus === 'available' || t.workingStatus === 'in_service' ? 'on' : t.workingStatus === 'on_break' || t.workingStatus === 'lunch' ? 'break' : 'off');
  const shiftLabel = (t: Tech) => tx(`admin.management.shift.${shiftCode(t)}`);

  return (
    <div className="work" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="vh"><h1>{tx('pos.management')}</h1><div className="sub">{tx('pos.real_time_operational_control_and_oversight_by8l')}</div></div>

      <div className="kpis">{kpis.map((c) => (<div className="kpi" key={c.l}><div className="l">{c.l}</div><div className="v" style={c.note ? { color: '#8A7A66' } : undefined}>{c.v}</div>{c.note ? <div className="s" style={{ color: '#8A7A66' }}>{c.why ?? tx('pos.workflow_pending')}</div> : null}{c.link ? <button className="btn ghost sm" data-testid="mgmt-approvals-open" onClick={() => nav(c.link as string)}>{tx('mgmt.open')}</button> : null}</div>))}</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12 }}>
        <section style={cardBox}>
          <div style={{ display: 'flex', alignItems: 'center' }}><div style={headStyle}>{tx('pos.branch_performance_snapshot')}</div><span className="s" style={{ marginLeft: 'auto', color: '#8A7A66' }}>{totalBranches} {tx('pos.location')}{enPlural(totalBranches === 1 ? '' : 's')}</span></div>
          {branches.length === 0 ? <div className="muted">{tx('pos.no_locations_yet')}{' '}<button className="btn ghost" style={{ padding: '3px 9px', marginLeft: 6 }} onClick={() => nav('/tenant/management/locations')}>{tx('pos.add_location')}</button></div> : <BranchSnapshot branches={branches} />}
          <div style={{ marginTop: 8 }}><button className="btn ghost" onClick={() => nav('/tenant/management/locations')}>{tx('pos.manage_locations')}</button></div>
        </section>
        <section style={cardBox}>
          <div style={{ display: 'flex', alignItems: 'center' }}><div style={headStyle}>{tx('pos.team_role_management')}</div><span className="s" style={{ marginLeft: 'auto', color: '#8A7A66' }}>{tk.totalTechnicians} {tx('pos.members_2')}</span></div>
          <div className="list" style={{ maxHeight: 260, overflow: 'auto' }}>
            {techs.map((t) => (
              <div className="row" key={t.technicianId}>
                <div className="t" style={{ flex: 1 }}>{t.displayName}<div className="s">{t.role || tx('pos.staff')}</div></div>
                <span className={'pill ' + (shiftCode(t) === 'on' ? 'ok' : shiftCode(t) === 'break' ? 'warn' : '')} style={{ marginRight: 8 }}>{shiftLabel(t)}</span>
                <span className="s">{t.rating ? `★ ${t.rating.toFixed(1)}` : '—'}</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 8 }}><button className="btn ghost" onClick={() => nav('/technicians')}>{tx('pos.open_team')}</button></div>
        </section>
        <section style={cardBox}>
          <div style={headStyle}>{tx('pos.payroll_allocation')}</div>
          <Donut items={allocation} />
          <div className="list" style={{ marginTop: 8 }}>
            <div className="row"><div className="t" style={{ flex: 1 }}>{tx('pos.payable_unpaid')}</div><div style={{ marginLeft: 'auto', fontWeight: 700 }}>{pk ? money(pk.unpaidPayableCents) : '—'}</div></div>
            <div className="row"><div className="t" style={{ flex: 1 }}>{tx('pos.lifetime_commission')}</div><div style={{ marginLeft: 'auto' }}>{pk ? money(pk.lifetimeCommissionCents) : '—'}</div></div>
            <div className="row"><div className="t" style={{ flex: 1 }}>{tx('pos.lifetime_tips')}</div><div style={{ marginLeft: 'auto' }}>{pk ? money(pk.lifetimeTipsCents) : '—'}</div></div>
          </div>
          <div style={{ marginTop: 8 }}><button className="btn ghost" onClick={() => nav('/tenant/team/payroll')}>{tx('pos.open_payroll')}</button></div>
        </section>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
        <section style={cardBox}>
          <div style={headStyle}>{tx('pos.manager_performance')}</div>
          {managerPerf.length === 0 ? <div className="muted">{tx('pos.no_rated_staff_yet')}</div> : (
            <div className="list">
              {managerPerf.map((t, i) => (
                <div className="row" key={t.technicianId}><div className="t" style={{ flex: 1 }}>{i + 1}. {t.displayName}</div><div style={{ marginLeft: 'auto', fontWeight: 700 }}>★ {(t.rating || 0).toFixed(1)}</div></div>
              ))}
            </div>
          )}
        </section>
        {[
          { t: tx('pos.pending_approvals_tasks'), d: tx('pos.time_off_schedule_change_inventory_approval_dq3u'), r: '/follow-ups', b: tx('admin.management.open.followUps') },
          { t: tx('pos.manager_checklist'), d: tx('pos.daily_operations_checklist_needs_a_recurring_qdsv'), r: '/reports', b: tx('admin.management.open.reports') },
          { t: tx('pos.permissions_access'), d: tx('pos.role_based_access_overview_is_managed_xggt'), r: '/technicians', b: tx('admin.management.open.team') },
          { t: tx('pos.ai_management_insights'), d: tx('pos.labor_cost_staffing_recommendations_need_the_1md3'), r: '/tenant/ai/command-center', b: tx('admin.management.open.aiCenter') },
          { t: tx('pos.branch_utilization_labor_trend'), d: tx('pos.per_branch_utilization_labor_cost_trend_nyh5'), r: '/reports', b: tx('admin.management.open.reports') },
        ].map((m) => (
          <section key={m.t} style={cardBox}>
            <div style={headStyle}>{m.t}</div>
            <div style={{ fontSize: 12, color: '#8A7A66' }}>{m.d} <span style={{ color: 'var(--danger, #B4673B)' }}>{tx('pos.not_connected_yet')}</span></div>
            <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => nav(m.r)}>{m.b}</button>
          </section>
        ))}
      </div>

      <section style={cardBox}>
        <div style={headStyle}>{tx('pos.quick_actions_2')}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {[
            { l: tx('pos.manage_locations_2'), fn: () => nav('/tenant/management/locations') },
            { l: tx('pos.open_team'), fn: () => nav('/technicians') },
            { l: tx('pos.review_payroll'), fn: () => nav('/tenant/team/payroll') },
            { l: tx('pos.open_schedule'), fn: () => nav('/technicians/schedule') },
            { l: tx('pos.view_reports'), fn: () => nav('/reports') },
            { l: tx('pos.salon_profile'), fn: () => nav('/tenant/management/salon-profile') },
          ].map((a) => <button key={a.l} className="btn ghost" onClick={a.fn}>{a.l}</button>)}
        </div>
      </section>
    </div>
  );
}

// ── SUNMI batch 9 guide 18 (Nov 10 2026): Branch Performance Snapshot ────────────────────────────────────────────────────
// The branch list (name, city, status) is unchanged; beside it, each branch's revenue, bookings, average ticket and trend for
// Today / This Week / This Month from the owner branch comparison (the SAME numbers as Reports → Multi-Location). Without
// owner.branches.view the figures are withheld ("—"), never zero; a branch with no prior revenue has no trend (N/A).
type Cmp = { branches: { branchId: string; revenueCents: number; trendPercent: number | null; bookingCount: number; averageTicketCents: number }[] };
function BranchSnapshot({ branches }: { branches: SalonLocation[] }) {
  const [period, setPeriod] = useState<'today' | 'week' | 'month'>('month');
  const [cmp, setCmp] = useState<Cmp | null>(null);
  const [err, setErr] = useState<'forbidden' | 'unavailable' | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    let alive = true; setErr(null);
    (api.get('/owner/branches/comparison', { period }) as Promise<Cmp>)
      .then((r) => { if (alive) setCmp(Array.isArray(r?.branches) ? r : null); })
      .catch((e: any) => { if (alive) { setCmp(null); setErr(e?.status === 403 ? 'forbidden' : 'unavailable'); } });
    return () => { alive = false; };
  }, [period]);
  const by = new Map((cmp?.branches ?? []).map((x) => [x.branchId, x] as const));
  const fold = (x: unknown) => String(x ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const rows = branches.filter((b) => !q || [b.public_display_name, b.name, b.city, b.state].some((v) => fold(v).includes(fold(q))));
  const st = (b: SalonLocation) => ((b.status || '').toLowerCase() === 'active' ? tx('mgmt.st.active') : (b.status || '').toLowerCase() === 'inactive' ? tx('mgmt.st.inactive') : tx('mgmt.st.draft'));
  return (
    <div data-testid="mgmt-snapshot">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <div className="fk-seg" role="group" aria-label={tx('mgmt.snap.period')}>{(['today', 'week', 'month'] as const).map((k) => <button key={k} type="button" className={period === k ? 'on' : ''} aria-pressed={period === k} style={{ minHeight: 40 }} data-testid={`mgmt-snap-${k}`} onClick={() => setPeriod(k)}>{tx('mgmt.snap.p.' + k)}</button>)}</div>
        {branches.length > 4 ? <input className="input" style={{ minHeight: 40 }} value={q} maxLength={60} onChange={(e) => setQ(e.target.value)} placeholder={tx('mgmt.snap.search')} aria-label={tx('mgmt.snap.search')} /> : null}
      </div>
      {err ? <div className="s" data-testid={`mgmt-snap-${err}`} style={{ color: '#8A7A66' }}>{tx('mgmt.snap.' + err)}</div> : null}
      <div className="overflow-x-auto w-full"><table className="tbl w-full">
        <thead><tr><th>{tx('pos.branch')}</th><th>{tx('pos.city')}</th><th>{tx('pos.status')}</th><th style={{ textAlign: 'right' }}>{tx('pos.revenue')}</th><th style={{ textAlign: 'right' }}>{tx('pos.bookings_2')}</th><th style={{ textAlign: 'right' }}>{tx('pos.avg_ticket')}</th><th style={{ textAlign: 'right' }}>{tx('pos.trend')}</th></tr></thead>
        <tbody>{rows.map((b) => { const m = by.get(b.id); return (
          <tr key={b.id}>
            <td className="t">{b.public_display_name || b.name || tx('pos.location_2')}</td>
            <td className="s">{b.city || '—'}{b.state ? `, ${b.state}` : ''}</td>
            <td><span className={'pill ' + ((b.status || '').toLowerCase() === 'active' ? 'ok' : 'warn')}>{st(b)}</span></td>
            <td className="num" style={{ textAlign: 'right' }}>{m ? money(m.revenueCents) : '—'}</td>
            <td className="num" style={{ textAlign: 'right' }}>{m ? m.bookingCount : '—'}</td>
            <td className="num" style={{ textAlign: 'right' }}>{m ? money(m.averageTicketCents) : '—'}</td>
            <td className="num" style={{ textAlign: 'right' }} data-testid={`mgmt-trend-${b.id}`}>{!m ? '—' : m.trendPercent == null ? tx('rpt.na') : `${m.trendPercent > 0 ? '+' : ''}${m.trendPercent}%`}</td>
          </tr>); })}</tbody>
      </table></div>
      <div className="s mt-1">{tx('mgmt.snap.basis')}</div>
    </div>
  );
}

