import { useCallback, useEffect, useState, Fragment } from 'react';
import { displayLocale } from '../i18n/format';
import { useNavigate } from 'react-router-dom';
import { posTeamApi, type POSTeamState, type TeamMemberRow, type TeamMemberDetail } from '../api/posTeamApi';
import { ProfileAvatarWithPreview, useEventCallback } from '@aipowersalon/ui';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { ImeSafeInput } from '../components/ImeSafeInput';

import { statusLabel } from '../i18n/status-label';
// POS Team Management — the salon-tenant employee dashboard (reference layout, 1:1). Consumes the canonical
// GET /pos/team/state behind TenantAuthGuard + RolePermissionGuard (settings.view; tenant/branch/role come from the
// session, never the browser). Every visible module binds to real data: 8 KPIs, search + 4 filters + tabs, the
// employee table (role/dept/shift/status/performance/services/revenue/commission), server-side pagination, the
// attendance donut, performance overview, top performers, birthdays, shift overview, productivity, pending approvals,
// and training. Filters/tabs/pagination round-trip to the backend.

const money = (c: number) => '$' + Math.round((c || 0) / 100).toLocaleString('en-US');
const money2 = (c: number) => '$' + ((c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf = (x: number) => (x || 0).toLocaleString('en-US');
const pctOf = (n: number, total: number) => (total ? Math.round((n / total) * 1000) / 10 : 0);
const fmtTrend = (t: number | null | undefined, kind: string) => {
  if (t == null) return null;
  const up = t >= 0;
  return { text: `${up ? '▲' : '▼'} ${kind === 'abs' ? Math.abs(t).toFixed(1) : Math.abs(t) + '%'}`, up };
};

const STATUS_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  on_shift: { bg: '#E7F4EA', fg: '#2E7D32', get label() { return tx('pos.on_shift'); } },
  on_break: { bg: '#FDEFE0', fg: '#C26A12', get label() { return tx('pos.on_break_2'); } },
  off_today: { bg: '#EFEAE0', fg: '#8A7A66', get label() { return tx('pos.off_today_2'); } },
  absent: { bg: '#FBEAE8', fg: '#C0392B', get label() { return tx('pos.absent'); } },
  time_off: { bg: '#E9F1FA', fg: '#2C6BB0', get label() { return tx('pos.time_off_2'); } },
  training: { bg: '#EFEAFA', fg: '#6E59C7', get label() { return tx('pos.training'); } },
};
const statusPill = (s: string) => STATUS_STYLE[s] || { bg: '#EFEAE0', fg: '#8A7A66', label: statusLabel('teamMember', s) };

const KI: Record<string, JSX.Element> = {
  team: <><circle cx="8" cy="8" r="3" /><path d="M2 19c0-3 2.7-5 6-5M15 8.5a3 3 0 100-5M16 14c2.8.3 5 2.2 5 5" /></>,
  active: <><circle cx="9" cy="8" r="3" /><path d="M3 19c0-3.3 2.7-6 6-6M16 11l2 2 3-3" /></>,
  onshift: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  star: <><path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.2l1-5.8L3.5 9.2l5.9-.9z" /></>,
  services: <><path d="M4 7h16M4 12h16M4 17h10" /></>,
  pay: <><rect x="2.5" y="5.5" width="19" height="13" rx="2.4" /><path d="M2.5 9.8h19M6 14.5h4" /></>,
  approval: <><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" /></>,
  recruit: <><circle cx="9" cy="8" r="3.2" /><path d="M3 19c0-3.3 2.7-6 6-6M18 8v6M15 11h6" /></>,
};
function KIcon({ name }: { name: string }) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" width={17} height={17} aria-hidden>{KI[name]}</svg>; }
const Star = ({ s = 12 }: { s?: number }) => <svg viewBox="0 0 24 24" width={s} height={s} fill="#E8852B" stroke="none" aria-hidden style={{ verticalAlign: 'middle' }}><path d="M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.2l1-5.8L3.5 9.2l5.9-.9z" /></svg>;

const PALETTE = ['#2E7D32', '#E8852B', '#C0392B', '#8A8F98', '#6E59C7', '#2C6BB0'];
const Donut = ({ items }: { items: { label: string; count: number }[] }) => {
  const total = items.reduce((a, x) => a + x.count, 0);
  if (total === 0) return <div className="muted">{tx('pos.no_attendance_data_yet')}</div>;
  let acc = 0; const R = 52, C = 2 * Math.PI * R;
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
      <svg viewBox="0 0 140 140" style={{ width: 112, height: 112, flex: 'none' }}>
        {items.map((it, i) => { const dash = (it.count / total) * C; const seg = <circle key={i} cx="70" cy="70" r={R} fill="none" stroke={PALETTE[i % PALETTE.length]} strokeWidth="15" strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-acc} transform="rotate(-90 70 70)" />; acc += dash; return seg; })}
        <circle cx="70" cy="70" r="36" fill="#fff" />
      </svg>
      <div style={{ flex: 1 }}>{items.map((it, i) => (<div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, padding: '2px 0' }}><span style={{ width: 9, height: 9, borderRadius: '50%', background: PALETTE[i % PALETTE.length] }} /><span>{it.label}</span><span style={{ marginLeft: 'auto', color: '#8A7A66', fontWeight: 600 }}>{it.count} ({pctOf(it.count, total)}%)</span></div>))}</div>
    </div>
  );
};

const Ring = ({ value, max, color }: { value: number; max: number; color: string }) => {
  const R = 22, C = 2 * Math.PI * R; const frac = max ? Math.min(1, value / max) : 0;
  return (
    <svg viewBox="0 0 56 56" width={56} height={56}>
      <circle cx="28" cy="28" r={R} fill="none" stroke="#EFE6D6" strokeWidth="6" />
      <circle cx="28" cy="28" r={R} fill="none" stroke={color} strokeWidth="6" strokeDasharray={`${frac * C} ${C}`} strokeLinecap="round" transform="rotate(-90 28 28)" />
      <text x="28" y="33" textAnchor="middle" style={{ fontSize: 16, fontWeight: 800, fill: '#2A2118' }}>{value}</text>
    </svg>
  );
};

const ipt: React.CSSProperties = { height: 34, border: '1px solid var(--line)', borderRadius: 9, padding: '0 10px', background: '#FFFDF8', fontFamily: 'inherit', fontSize: 12.5, color: 'var(--text)' };
const selS: React.CSSProperties = { ...ipt, minWidth: 120 };
const card: React.CSSProperties = { background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 14, padding: '11px 13px' };

export function POSTeamScreen() {
  const nav = useNavigate();
  const [s, setS] = useState<POSTeamState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [shift, setShift] = useState('');
  const [department, setDepartment] = useState('');
  const [tab, setTab] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 8;
  const [moreOpen, setMoreOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [drawer, setDrawer] = useState<TeamMemberRow | null>(null);
  const [detail, setDetail] = useState<TeamMemberDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);

  const openMember = (m: TeamMemberRow) => {
    setDrawer(m); setDetail(null); setDetailBusy(true);
    (posTeamApi.getMember(m.userId) as Promise<TeamMemberDetail>).then((d) => setDetail(d)).catch(() => setDetail(null)).finally(() => setDetailBusy(false));
  };

  const load = useCallback((q: Record<string, unknown>) => (posTeamApi.getState(q) as Promise<POSTeamState>).then(setS).catch((e: any) => setError(e?.message || tx('pos.failed_to_load_team'))), []);
  const buildQ = useEventCallback(() => ({ search: search || undefined, role: role || undefined, status: status || undefined, shift: shift || undefined, department: department || undefined, tab: tab || undefined, page, pageSize }));
  useEffect(() => {
    const t = setTimeout(() => load(buildQ()), search ? 250 : 0);
    return () => clearTimeout(t);
     
  }, [load, search, role, status, shift, department, tab, page, buildQ]);

  const setFilter = (fn: (v: string) => void) => (v: string) => { fn(v); setPage(1); };
  const pickTab = (id: string) => { setTab(id); setPage(1); };

  if (error) return <div className="work"><div className="err">{error}</div></div>;
  if (!s) return <div className="work"><div className="state">{tx('pos.loading_team')}</div></div>;

  const k = s.kpis; const pg = s.rows.pagination; const rows = s.rows.items;
  const tr = s.trends || { members: null, performance: null, services: null, commission: null, prodServices: null, prodRevenue: null, prodCommission: null };
  const kpis8 = [
    { l: tx('pos.total_team_members'), v: nf(k.totalMembers), sub: tx('pos.all_staff'), trend: tr.members, kind: 'pct', ic: 'team', color: '#2E7D32', bg: '#EAF4EC' },
    { l: tx('pos.active_today'), v: nf(k.activeToday), sub: tx('pos.v0_of_total', { v0: String(pctOf(k.activeToday, k.totalMembers)) }), trend: null, kind: 'pct', ic: 'active', color: '#6E59C7', bg: '#EFEAFA' },
    { l: tx('pos.on_shift_now'), v: nf(k.onShiftNow), sub: tx('pos.v0_of_total', { v0: String(pctOf(k.onShiftNow, k.totalMembers)) }), trend: null, kind: 'pct', ic: 'onshift', color: '#2C6BB0', bg: '#E9F1FA' },
    { l: tx('pos.avg_performance_score'), v: k.avgPerformance ? k.avgPerformance.toFixed(1) : '—', sub: tx('pos.team_rating'), trend: tr.performance, kind: 'abs', ic: 'star', color: '#E8852B', bg: '#FDEFE0', star: true },
    { l: tx('pos.total_services_completed'), v: nf(k.totalServices), sub: tx('pos.last_30_days'), trend: tr.services, kind: 'pct', ic: 'services', color: '#2E7D32', bg: '#EAF4EC' },
    { l: tx('pos.total_commission_paid'), v: money(k.totalCommissionCents), sub: tx('pos.last_30_days'), trend: tr.commission, kind: 'pct', ic: 'pay', color: '#2C6BB0', bg: '#E9F1FA' },
    { l: tx('pos.pending_approvals'), v: nf(k.pendingApprovals), sub: tx('pos.leave_shift_docs'), trend: null, kind: 'pct', ic: 'approval', color: '#C0392B', bg: '#FBEAE8' },
    { l: tx('pos.open_positions'), v: nf(k.openPositions), sub: tx('pos.recruiting'), trend: null, kind: 'pct', ic: 'recruit', color: '#E8852B', bg: '#FDEFE0' },
  ];
  const perfMax = Math.max(1, ...s.performance.distribution.map((d) => d.count));
  const from = pg.totalItems === 0 ? 0 : (pg.page - 1) * pg.pageSize + 1;
  const to = Math.min(pg.page * pg.pageSize, pg.totalItems);
  const pageBtns: (number | '…')[] = [];
  if (pg.totalPages <= 6) { for (let i = 1; i <= pg.totalPages; i++) pageBtns.push(i); }
  else { for (let i = 1; i <= 4; i++) pageBtns.push(i); pageBtns.push('…'); pageBtns.push(pg.totalPages); }
  const TRAIN = [
    { v: s.training.certificationsExpiring, label: tx('pos.certifications_expiring'), sub: tx('pos.this_month_3'), color: '#E8852B', max: 12 },
    { v: s.training.trainingInProgress, label: tx('pos.training_in_progress'), sub: tx('pos.ongoing'), color: '#2C6BB0', max: 12 },
    { v: s.training.newTrainings, label: tx('pos.new_trainings'), sub: tx('pos.available'), color: '#2E7D32', max: 12 },
  ];

  return (
    <div className="work" >
      <div className="mb-6 flex flex-col xl:flex-row gap-3 justify-between ">
        <div className="vh"><h1>{tx('pos.team_management')}</h1><div className="sub">{tx('pos.manage_your_team_roles_performance_and_voax')}</div></div>
        <div style={{  display: 'flex', gap: 8 }}>
          <button className="btn ghost" onClick={() => nav('/tenant/team/payroll')}> {tx('pos.export')}</button>
          <button className="btn" title={tx('pos.create_or_invite_a_technician')} onClick={() => nav('/technicians')}>{tx('pos.add_team_member')}</button>
        </div>
      </div>
      {/* 8 KPI cards */}
 <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8 gap-2.5 mb-3.5">
        {kpis8.map((c) => (
          <div key={c.l} style={card}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 28, height: 28, borderRadius: '50%', background: c.bg, color: c.color, display: 'grid', placeItems: 'center', flex: 'none' }}><KIcon name={c.ic} /></span>
              <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700, lineHeight: 1.1 }}>{c.l}</span>
            </div>
            <div style={{ fontFamily: '"Playfair Display",serif', fontSize: 21, fontWeight: 800, marginTop: 7 }}>{c.v}{c.star && k.avgPerformance ? <Star s={15} /> : null}</div>
            {(() => { const tt = fmtTrend(c.trend, c.kind); return tt ? <div style={{ fontSize: 10.5, marginTop: 2, color: tt.up ? '#2E7D32' : '#C0392B', fontWeight: 700 }}>{tt.text} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>{tx('pos.vs_last_month')}</span></div> : <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 2 }}>{c.sub}</div>; })()}
          </div>
        ))}
      </div>

      {/* Header */}
   

      {note ? <div className="err" style={{ marginBottom: 12 }}>{note}</div> : null}

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <ImeSafeInput placeholder={tx('pos.search_by_name_role_phone_or_1q21')} value={search} onValue={(v) => { setSearch(v); setPage(1); }} style={{ ...ipt, flex: 1, minWidth: 240, height: 36 }} />
        <select value={role} onChange={(e) => setFilter(setRole)(e.target.value)} style={selS}><option value="">{tx('pos.all_roles_2')}</option>{s.facets.roles.map((x) => <option key={x} value={x}>{x}</option>)}</select>
        <select value={status} onChange={(e) => setFilter(setStatus)(e.target.value)} style={selS}><option value="">{tx('pos.all_status')}</option>{s.facets.statuses.map((x) => <option key={x} value={x}>{statusPill(x).label}</option>)}</select>
        <select value={shift} onChange={(e) => setFilter(setShift)(e.target.value)} style={selS}><option value="">{tx('pos.all_shifts')}</option>{s.facets.shifts.map((x) => <option key={x} value={x}>{x === 'scheduled' ? tx('pos.scheduled') : tx('pos.unscheduled')}</option>)}</select>
        <select value={department} onChange={(e) => setFilter(setDepartment)(e.target.value)} style={selS}><option value="">{tx('pos.all_departments')}</option>{s.facets.departments.map((x) => <option key={x} value={x}>{x}</option>)}</select>
        <button className="btn ghost" onClick={() => setMoreOpen((v) => !v)}>{tx('pos.more_filters_2')}</button>
      </div>

      {moreOpen ? (
        <section className="panel" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="s muted">{tx('pos.refine_by_the_dropdowns_above_location_6h3a')}</span>
            <button className="btn ghost" style={{ marginLeft: 'auto' }} onClick={() => { setRole(''); setStatus(''); setShift(''); setDepartment(''); setSearch(''); setTab(''); setPage(1); }}>{tx('pos.clear_all')}</button>
          </div>
        </section>
      ) : null}

      {addOpen ? (
        <section className="panel" style={{ marginBottom: 12, borderColor: 'var(--gline)' }}>
          <h2 style={{ marginTop: 0 }}>{tx('pos.add_team_member_2')}</h2>
          <div className="s muted">{tx('pos.full_onboarding_role_location_schedule_skills_51iq')}</div>
          <div style={{ marginTop: 8 }}><button className="btn ghost" onClick={() => setAddOpen(false)}>{tx('pos.close')}</button></div>
        </section>
      ) : null}

      {/* tabs */}
    <div className="flex  gap-1 border-b border-[var(--line)] mb-3 overflow-x-auto whitespace-nowrap">
        {s.tabs.map((t) => {
          const on = tab === t.id;
          return <button key={t.label} onClick={() => pickTab(t.id)} style={{ background: 'none', border: 'none', borderBottom: on ? '2px solid var(--aps-orange)' : '2px solid transparent', padding: '8px 12px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: on ? 800 : 600, color: on ? 'var(--text)' : 'var(--muted)' }}>{t.label} <span style={{ color: 'var(--muted)', fontWeight: 600 }}>{nf(t.count)}</span></button>;
        })}
      </div>

      {/* main split */}
     <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-3 items-start">
        <div>
          <section className="panel" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ background: '#FBF5EA', color: 'var(--muted)', textAlign: 'left' }}>
                    {[tx('pos.team_member'), tx('pos.role_2'), tx('pos.department'), tx('pos.shift'), tx('pos.status'), tx('pos.performance'), tx('pos.services'), tx('pos.revenue'), tx('pos.commission'), tx('pos.actions')].map((h, i) => (
                      <th key={h} style={{ padding: '9px 12px', fontSize: 10.5, fontWeight: 800, letterSpacing: '.03em', textAlign: i >= 6 && i <= 8 ? 'right' : 'left', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? <tr><td colSpan={10} style={{ padding: 20, color: 'var(--muted)' }}>{tx('pos.no_matching_team_members')}</td></tr> : rows.map((m) => {
                    const st = statusPill(m.status);
                    return (
                      <Fragment key={m.employeeId}>
                        <tr style={{ borderTop: '1px solid var(--line)' }}>
                          <td style={{ padding: '8px 12px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                              <ProfileAvatarWithPreview name={m.name} url={m.avatarUrl} size={32} type={m.role} />
                              <div style={{ minWidth: 0 }}>
                                <div style={{ fontWeight: 800, cursor: 'pointer' }} onClick={() => openMember(m)} title={tx('pos.open_profile')}>{m.name}</div>
                                <div style={{ fontSize: 10, color: 'var(--muted)' }}>{tx('pos.id')}{' '}{m.employeeId}{m.email ? ` · ${m.email}` : ''}</div>
                                {m.phone ? <div style={{ fontSize: 10, color: 'var(--muted)' }}>{m.phone}</div> : null}
                              </div>
                            </div>
                          </td>
                          <td style={{ padding: '8px 12px' }}><div style={{ fontWeight: 700 }}>{statusLabel('role', m.role)}</div>{m.roleLevel ? <div style={{ fontSize: 10, color: 'var(--aps-orange)', fontWeight: 700 }}>{m.roleLevel}</div> : null}</td>
                          <td style={{ padding: '8px 12px', color: 'var(--muted)' }}>{m.department}</td>
                          <td style={{ padding: '8px 12px', whiteSpace: 'nowrap' }}>{m.shift || '—'}</td>
                          <td style={{ padding: '8px 12px' }}><span style={{ background: st.bg, color: st.fg, borderRadius: 8, padding: '3px 9px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>{st.label}</span></td>
                          <td style={{ padding: '8px 12px' }}>{m.performanceScore != null ? <><div style={{ fontWeight: 800 }}>{m.performanceScore.toFixed(1)} <Star /></div><div style={{ fontSize: 10, color: 'var(--muted)' }}>{m.performanceLabel}</div></> : <span className="muted">—</span>}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right' }}>{m.isProvider ? nf(m.servicesCount) : '—'}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700 }}>{m.isProvider ? money2(m.revenueCents) : '—'}</td>
                          <td style={{ padding: '8px 12px', textAlign: 'right' }}>{m.isProvider ? money2(m.commissionCents) : '—'}</td>
                          <td style={{ padding: '8px 12px' }}>
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button className="btn ghost" title={tx('pos.message')} style={{ padding: '4px 7px' }} onClick={() => nav('/messages')}>✉</button>
                              <button className="btn ghost" title={tx('pos.open_edit')} style={{ padding: '4px 7px' }} onClick={() => openMember(m)}>▤</button>
                              <button className="btn ghost" title={tx('pos.more_2')} style={{ padding: '4px 7px' }} onClick={() => openMember(m)}>⋯</button>
                            </div>
                          </td>
                        </tr>
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', borderTop: '1px solid var(--line)', gap: 8, flexWrap: 'wrap' }}>
              <div className="s muted">{tx('pos.showing')}{' '}{from} {tx('pos.to')}{' '}{to} {tx('pos.of')}{' '}{nf(pg.totalItems)} {tx('pos.team_members_2')}</div>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
                <button className="btn ghost" style={{ padding: '4px 9px' }} disabled={pg.page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>‹</button>
                {pageBtns.map((b, i) => b === '…' ? <span key={'e' + i} className="s muted" style={{ padding: '0 4px' }}>…</span> : (
                  <button key={b} onClick={() => setPage(b)} className={'btn' + (b === pg.page ? '' : ' ghost')} style={{ padding: '4px 10px', ...(b === pg.page ? { background: 'var(--aps-orange)', borderColor: 'var(--aps-orange)', color: '#fff' } : {}) }}>{b}</button>
                ))}
                <button className="btn ghost" style={{ padding: '4px 9px' }} disabled={pg.page >= pg.totalPages} onClick={() => setPage((p) => Math.min(pg.totalPages, p + 1))}>›</button>
              </div>
            </div>
          </section>
        </div>

        {/* right rail */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <section className="panel" style={{ margin: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}><h2 style={{ margin: 0 }}>{tx('pos.team_attendance_today')}</h2><button className="btn ghost" style={{ marginLeft: 'auto', padding: '3px 8px', fontSize: 11 }} onClick={() => nav('/tenant/account/users-roles')}>{tx('pos.view_full_attendance')}</button></div>
            <Donut items={s.attendance.map((a) => ({ label: a.status, count: a.count }))} />
          </section>
          <section className="panel" style={{ margin: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}><h2 style={{ margin: 0 }}>{tx('pos.performance_overview')}</h2><span className="s muted" style={{ marginLeft: 'auto' }}>{tx('pos.this_month_3')}</span></div>
            <div style={{ fontFamily: '"Playfair Display",serif', fontSize: 24, fontWeight: 800 }}>{s.performance.overall ? s.performance.overall.toFixed(1) : '—'} {s.performance.overall ? <Star s={16} /> : null}</div>
            <div style={{ marginTop: 8 }}>
              {s.performance.distribution.map((d) => (
                <div key={d.label} style={{ marginBottom: 6 }}>
                  <div style={{ display: 'flex', fontSize: 11 }}><span>{d.label}</span><span style={{ marginLeft: 'auto', color: 'var(--muted)' }}>{d.count} ({pctOf(d.count, s.kpis.totalMembers)}%)</span></div>
                  <div style={{ height: 6, background: '#EFE6D6', borderRadius: 4, marginTop: 3 }}><div style={{ width: `${Math.round((d.count / perfMax) * 100)}%`, height: 6, background: 'var(--aps-orange)', borderRadius: 4 }} /></div>
                </div>
              ))}
            </div>
          </section>
          <section className="panel" style={{ margin: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}><h2 style={{ margin: 0 }}>{tx('pos.top_performers')}</h2><span className="s muted" style={{ marginLeft: 'auto' }}>{tx('pos.this_month_3')}</span></div>
            {s.topPerformers.length === 0 ? <div className="muted">{tx('pos.no_rated_team_members_yet')}</div> : s.topPerformers.map((t, i) => (
              <div key={t.employeeId} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '4px 0' }}>
                <span style={{ width: 18, color: 'var(--muted)', fontWeight: 800, fontSize: 12 }}>{i + 1}</span>
                <ProfileAvatarWithPreview name={t.name} url={t.avatarUrl} size={26} type="technician" />
                <span style={{ fontWeight: 700, fontSize: 12 }}>{t.name}</span>
                <span style={{ marginLeft: 'auto', fontWeight: 800 }}>{t.score.toFixed(1)} <Star /></span>
              </div>
            ))}
          </section>
          <section className="panel" style={{ margin: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}><h2 style={{ margin: 0 }}>{tx('pos.upcoming_birthdays')}</h2><button className="btn ghost" style={{ marginLeft: 'auto', padding: '3px 8px', fontSize: 11 }} onClick={() => nav('/tenant/account/users-roles')}>{tx('pos.view_all_4')}</button></div>
            {s.birthdays.length === 0 ? <div className="muted">{tx('pos.no_staff_birthdays_on_file_add_izv2')}</div> : s.birthdays.map((b) => (
              <div key={b.employeeId} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '4px 0' }}>
                <ProfileAvatarWithPreview name={b.name} url={b.avatarUrl} size={26} type="technician" />
                <span style={{ fontWeight: 700, fontSize: 12 }}>{b.name}</span><span style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: 12 }}>{b.date}</span>
              </div>
            ))}
          </section>
        </div>
      </div>

      {/* bottom row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3 mt-3.5">
        <section className="panel" style={{ margin: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}><h2 style={{ margin: 0 }}>{tx('pos.today_s_shift_overview')}</h2><button className="btn ghost" style={{ marginLeft: 'auto', padding: '3px 8px', fontSize: 11 }} onClick={() => nav('/tenant/account/users-roles')}>{tx('pos.view_all_shifts')}</button></div>
          {s.shiftOverview.every((x) => x.members === 0) ? <div className="muted">{tx('pos.no_shifts_scheduled_for_today')}</div> : s.shiftOverview.map((sh) => (
            <div key={sh.label} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
              <div><div style={{ fontWeight: 700, fontSize: 12 }}>{sh.label}</div><div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{sh.time} · {sh.members} {tx('pos.members')}</div></div>
              <span style={{ marginLeft: 'auto', background: '#E7F4EA', color: '#2E7D32', borderRadius: 8, padding: '3px 9px', fontSize: 11, fontWeight: 700 }}>{sh.presentLabel}</span>
            </div>
          ))}
        </section>
        <section className="panel" style={{ margin: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}><h2 style={{ margin: 0 }}>{tx('pos.team_productivity')}</h2><span className="s muted" style={{ marginLeft: 'auto' }}>{tx('pos.this_week_2')}</span></div>
          {[
            { l: tx('pos.services_completed'), v: nf(s.productivity.servicesCompleted), trend: tr.prodServices },
            { l: tx('pos.revenue_generated'), v: money(s.productivity.revenueCents), trend: tr.prodRevenue },
            { l: tx('pos.commission_earned'), v: money(s.productivity.commissionCents), trend: tr.prodCommission },
          ].map((r) => {
            const tt = fmtTrend(r.trend, 'pct');
            return (
              <div key={r.l} style={{ padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
                <div style={{ display: 'flex', alignItems: 'baseline' }}>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{r.l}</span>
                  <span style={{ marginLeft: 'auto', fontFamily: '"Playfair Display",serif', fontSize: 18, fontWeight: 800 }}>{r.v}</span>
                </div>
                {tt ? <div style={{ fontSize: 10.5, color: tt.up ? '#2E7D32' : '#C0392B', fontWeight: 700 }}>{tt.text} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>{tx('pos.vs_last_week')}</span></div> : null}
              </div>
            );
          })}
        </section>
        <section className="panel" style={{ margin: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}><h2 style={{ margin: 0 }}>{tx('pos.pending_approvals')}</h2><button className="btn ghost" style={{ marginLeft: 'auto', padding: '3px 8px', fontSize: 11 }} onClick={() => nav('/tenant/account/users-roles')}>{tx('pos.view_all_4')}</button></div>
          {s.approvals.length === 0 ? <div className="muted">{tx('pos.no_pending_approvals')}</div> : s.approvals.map((a) => (
            <div key={a.type} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
              <div><div style={{ fontWeight: 700, fontSize: 12 }}>{a.count} {a.label}</div><div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{tx('pos.pending_approval')}</div></div>
            </div>
          ))}
        </section>
        <section className="panel" style={{ margin: 0 }}>
          <h2 style={{ marginTop: 0 }}>{tx('pos.training_certifications')}</h2>
          <div style={{ display: 'flex', justifyContent: 'space-around', gap: 6, marginTop: 6 }}>
            {TRAIN.map((t) => (
              <div key={t.label} style={{ textAlign: 'center', flex: 1 }}>
                <Ring value={t.v} max={t.max} color={t.color} />
                <div style={{ fontSize: 10, fontWeight: 700, marginTop: 4 }}>{t.label}</div>
                <div style={{ fontSize: 9.5, color: 'var(--muted)' }}>{t.sub}</div>
              </div>
            ))}
          </div>
          <div className="s muted" style={{ marginTop: 8, fontSize: 10.5 }}>{tx('pos.training_records_need_a_backend_training_p3i8')}</div>
        </section>
      </div>

      {drawer ? (
        <MemberDrawer row={drawer} detail={detail} busy={detailBusy} onClose={() => setDrawer(null)} nav={nav} />
      ) : null}
    </div>
  );
}

function MemberDrawer({ row, detail, busy, onClose, nav }: { row: TeamMemberRow; detail: TeamMemberDetail | null; busy: boolean; onClose: () => void; nav: (to: string) => void }) {
  const d = detail;
  const st = statusPill(d?.status || row.status);
  const fmtDate = (iso?: string | null) => { if (!iso) return '—'; try { return new Date(iso).toLocaleDateString(displayLocale(), { month: 'short', day: '2-digit', year: 'numeric' }); } catch { return iso; } };
  const services = d?.servicesCount ?? row.servicesCount;
  const revenue = d?.revenueCents ?? row.revenueCents;
  const commission = d?.commissionCents ?? row.commissionCents;
  const perf = d?.performanceScore ?? row.performanceScore;
  const TABS = [
    { l: tx('pos.overview'), on: true, to: '' },
    { l: tx('pos.schedule'), to: '/tenant/team/members' },
    { l: tx('pos.performance'), to: '/tenant/team/performance' },
    { l: tx('pos.commissions'), to: '/tenant/team/commission' },
    { l: tx('pos.payroll'), to: '/tenant/team/payroll' },
    { l: tx('pos.activity'), to: '/tenant/account/users-roles' },
  ];
  const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
    <div style={{ display: 'flex', padding: '14px 0', borderBottom: '1px solid #F1ECE4', fontSize: 14 }}>
      <span style={{ color: '#8A7A6D' }}>{k}</span>
      <span style={{ marginLeft: 'auto', fontWeight: 600, color: '#2C2A29', textAlign: 'right' }}>{v}</span>
    </div>
  );
  const H = ({ t, mt }: { t: string; mt?: number }) => <h3 style={{ margin: `${mt ?? 24}px 0 12px`, fontSize: 13, color: '#B5821F', letterSpacing: '0.06em', fontWeight: 800, textTransform: 'uppercase' }}>{t}</h3>;
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(30,20,8,.28)', zIndex: 60 }} />
      <aside role="dialog" aria-label={tx('pos.name_profile', { name: String(row.name) })} className="no-scrollbar" style={{ position: 'fixed', top: 0, right: 0, height: '100vh', width: 540, maxWidth: '94vw', background: '#FFFFFF', borderLeft: '1px solid #EFEAE1', boxShadow: '-24px 0 80px rgba(0,0,0,0.08)', zIndex: 61, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '32px', background: '#FAFAF9', borderBottom: '1px solid #EFEAE1' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
            <ProfileAvatarWithPreview name={row.name} url={d?.avatarUrl || row.avatarUrl} size={64} type={d?.role || row.role} />
            <div style={{ minWidth: 0, flex: 1, marginTop: 4 }}>
              <div style={{ fontFamily: '"Playfair Display",serif', fontSize: 26, fontWeight: 800, color: '#2C2A29' }}>{row.name}</div>
              <div style={{ fontSize: 13, color: '#8A7A6D', marginTop: 4 }}>{d?.role || row.role}{(d?.roleLevel || row.roleLevel) ? ` · ${d?.roleLevel || row.roleLevel}` : ''} · {row.employeeId}</div>
            </div>
            <button onClick={onClose} aria-label={tx('pos.close')} style={{ background: '#FFFFFF', border: '1px solid #EFEAE1', borderRadius: '50%', width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, color: '#8A7A6D', cursor: 'pointer', transition: 'all 0.2s' }} onMouseOver={e => { e.currentTarget.style.background = '#FDF0EE'; e.currentTarget.style.color = '#C0392B'; }} onMouseOut={e => { e.currentTarget.style.background = '#FFFFFF'; e.currentTarget.style.color = '#8A7A6D'; }}>✕</button>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 20, alignItems: 'center' }}>
            <span style={{ textTransform: 'capitalize', background: st.bg, color: st.fg, padding: '6px 12px', borderRadius: 20, fontSize: 13, fontWeight: 600, border: '1px solid #EFEAE1' }}>• {st.label}</span>
            {perf != null ? <span style={{ background: 'linear-gradient(135deg, #FDFBF7 0%, #F1ECE4 100%)', color: '#B5821F', borderRadius: 20, padding: '6px 12px', fontSize: 13, fontWeight: 700, border: '1px solid #EADBB6' }}>{perf.toFixed(1)} ★ {d?.performanceLabel || row.performanceLabel}</span> : null}
            <button style={{ marginLeft: 'auto', background: '#F8F6F3', border: '1px solid #EFEAE1', borderRadius: 20, padding: '6px 16px', fontSize: 13, fontWeight: 600, color: '#2C2A29', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => nav('/messages')}>{tx('pos.message_2')}</button>
            <button style={{ background: '#2C2A29', border: '1px solid #2C2A29', borderRadius: 20, padding: '6px 16px', fontSize: 13, fontWeight: 600, color: '#FFFFFF', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => nav('/tenant/account/users-roles')}>{tx('pos.edit')}</button>
          </div>
        </div>
        <div className="no-scrollbar" style={{ display: 'flex', gap: 16, padding: '0 32px', borderBottom: '1px solid #EFEAE1', overflowX: 'auto', background: '#FAFAF9' }}>
          {TABS.map((t) => (
            <button key={t.l} onClick={() => { if (!t.on) nav(t.to); }} style={{ background: 'none', border: 'none', borderBottom: t.on ? '2px solid #D4AF37' : '2px solid transparent', padding: '16px 2px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, fontWeight: t.on ? 700 : 500, color: t.on ? '#2C2A29' : '#8A7A6D', whiteSpace: 'nowrap', transition: 'all 0.2s' }}>{t.l}</button>
          ))}
        </div>
        <div className="no-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '24px 32px 60px' }}>
          {busy && !d ? <div style={{ fontSize: 14, color: '#8A7A6D', textAlign: 'center', padding: 40 }}>{tx('pos.loading_profile')}</div> : null}
          <H t={tx('pos.employment_2')} mt={0} />
          <Row k={tx('pos.role_2')} v={d?.role || row.role} />
          <Row k={tx('pos.department')} v={d?.department || row.department} />
          <Row k={tx('pos.status')} v={st.label} />
          <Row k={tx('pos.current_shift')} v={d?.shift || row.shift || '—'} />
          <Row k={tx('pos.hire_date')} v={fmtDate(d?.hireDate)} />

          <H t={tx('pos.contact_2')} />
          <Row k={tx('pos.email')} v={d?.email || row.email || '—'} />
          <Row k={tx('pos.phone')} v={d?.phone || row.phone || '—'} />

          <H t={tx('pos.this_period_last_30_days')} />
          <Row k={tx('pos.services_completed_2')} v={row.isProvider ? nf(services) : '—'} />
          <Row k={tx('pos.revenue_generated_2')} v={row.isProvider ? money2(revenue) : '—'} />
          <Row k={tx('pos.commission_earned_2')} v={row.isProvider ? money2(commission) : '—'} />
          <Row k={tx('pos.performance')} v={perf != null ? tx('pos.v0_v1_review_plural', { v0: String(perf.toFixed(1)), v1: String(d?.reviewCount ?? 0), plural: String((d?.reviewCount ?? 0) === 1 ? '' : 's') }) : '—'} />

          {(d?.skills?.length ?? 0) > 0 ? (
            <>
              <H t={tx('pos.service_eligibility')} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>{(d?.skills ?? []).map((sk) => <span key={sk} style={{ background: 'linear-gradient(135deg, #FDFBF7 0%, #F1ECE4 100%)', color: '#B5821F', padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 600, border: '1px solid #EADBB6' }}>{sk}</span>)}</div>
            </>
          ) : null}

          {d?.access ? (
            <>
              <H t={tx('pos.access')} />
              <Row k={tx('pos.account_status')} v={d.access.accountStatus} />
              <Row k={tx('pos.two_factor_auth_2')} v={d.access.mfaEnabled ? tx('pos.enabled') : tx('pos.off_2')} />
              <Row k={tx('pos.last_login_2')} v={fmtDate(d.access.lastLoginAt)} />
            </>
          ) : null}

          <div style={{ marginTop: 24, fontSize: 13, color: '#8A7A6D', textAlign: 'center', background: '#FAFAF9', padding: '16px', borderRadius: 12, border: '1px dashed #D2C4B3' }}>{tx('pos.schedule_performance_commissions_payroll_and_activity_1n49')}</div>
        </div>
      </aside>
    </>
  );
}
