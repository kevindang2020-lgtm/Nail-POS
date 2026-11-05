import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { superAdminMembershipsApi, type SAMembershipOverview, type SAPlanDetail, type SAMemberDetail, type SARevenueRange } from '../api/superAdminMembershipsApi';

// MembershipsOverviewScreen — Super Admin, platform-wide (cross-tenant) Membership Overview. Every figure comes from the
// real /super-admin/memberships/overview aggregation over the canonical membership tables; the screen renders honest
// empty/zero state until tenants have members (no fabricated demo data). Per platform policy, Super Admin oversight is
// read-only here — tenant-scoped actions (enroll, create plan, discounts, settings) are performed inside each salon's POS.

import { ProfileAvatarWithPreview } from '@aipowersalon/ui';
import { centsToUsd } from '@aipowersalon/money';

const GOLD = 'var(--g7,#A96F22)';
const PALETTE = ['#A96F22', '#D09A36', '#3C7FB6', '#3E8F57', '#8B5A18', '#9B8B78'];
const STATUS_COLOR: Record<string, string> = { active: '#3E8F57', trial: '#3C7FB6', grace: '#D09A36', past_due: '#D09A36', paused: '#9B8B78', canceling: '#B85B4D', canceled: '#B85B4D', expired: '#B85B4D', suspended: '#B85B4D', comped: '#3C7FB6', completed: '#6D5F50', pending: '#9B8B78' };
const STATUS_LABEL: Record<string, string> = { active: 'Active', trial: 'Trial', grace: 'Grace Period', past_due: 'Past Due', paused: 'Paused', canceling: 'Cancellation Pending', canceled: 'Canceled', expired: 'Expired', suspended: 'Suspended', comped: 'Comped', completed: 'Completed', pending: 'Pending' };

const money = (c: number): string => centsToUsd(c);   // shared formatter: a negative reads −$6.75, never $-6.75 (wave 4 pilot)
const moneyShort = (c: number): string => { const d = c / 100; return d >= 1000 ? `$${(d / 1000).toFixed(d >= 10000 ? 0 : 1)}K` : `$${d.toFixed(0)}`; };
const fmtDate = (s: string | null): string => { if (!s) return '—'; const d = new Date(s); return isNaN(+d) ? '—' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); };
const fmtWhen = (s: string | null): string => { if (!s) return ''; const d = new Date(s); return isNaN(+d) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const delta = (v: number | null): string => (v == null ? '' : `${v >= 0 ? '+' : ''}${v}%`);
const pctStr = (v: number | null): string => (v == null ? '—' : `${v}%`);
const intervalLabel: Record<string, string> = { month: '/ month', quarter: '/ quarter', six_month: '/ 6 months', year: '/ year', none: '', custom: '' };
const PRIOR_LABEL: Record<SARevenueRange, string> = { this_week: 'vs last week', this_month: 'vs last month', last_month: 'vs prior month', this_quarter: 'vs last quarter', this_year: 'vs last year' };

function Avatar({ name, url, size = 30 }: { name: string; url?: string | null; size?: number }) {
  return <ProfileAvatarWithPreview name={name} url={url} size={size} type="customer" />;
}

function StatusPill({ status }: { status: string }) {
  const danger = ['canceled', 'expired', 'suspended', 'canceling'].includes(status);
  const warn = ['grace', 'past_due', 'paused', 'pending'].includes(status);
  const cls = danger ? '' : warn ? 'pill warn' : 'pill ok';
  const style = danger ? { background: '#B85B4D1A', color: 'var(--danger,#B85B4D)', borderColor: '#E3C2BC' } : undefined;
  return <span className={cls || 'pill'} style={style}>{STATUS_LABEL[status] || status}</span>;
}

function IconTile({ bg, fg, path }: { bg: string; fg: string; path: string }) {
  return (
    <div style={{ width: 38, height: 38, borderRadius: 11, background: bg, display: 'grid', placeItems: 'center', flex: 'none' }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={fg} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{<path d={path} />}</svg>
    </div>
  );
}
const ICON = {
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  crown: 'M2 18h20M3 6l4 5 5-7 5 7 4-5v10H3z',
  dollar: 'M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  calendar: 'M3 4h18v18H3zM16 2v4M8 2v4M3 10h18',
  userx: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M11 7a4 4 0 1 0-8 0 4 4 0 0 0 8 0M17 8l5 5M22 8l-5 5',
  repeat: 'M17 1l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3',
  pulse: 'M22 12h-4l-3 9L9 3l-3 9H2',
};

function Donut({ slices }: { slices: { label: string; value: number; color: string }[] }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const R = 52, C = 2 * Math.PI * R, cx = 64, cy = 64, sw = 20;
  let off = 0;
  return (
    <svg viewBox="0 0 128 128" width="118" height="118" style={{ flex: 'none' }}>
      <circle cx={cx} cy={cy} r={R} fill="none" stroke="var(--line,#E9DAC4)" strokeWidth={sw} />
      {total > 0 && slices.filter((s) => s.value > 0).map((s, i) => {
        const dash = (s.value / total) * C;
        const seg = <circle key={i} cx={cx} cy={cy} r={R} fill="none" stroke={s.color} strokeWidth={sw} strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-off} transform={`rotate(-90 ${cx} ${cy})`} strokeLinecap="butt" />;
        off += dash;
        return seg;
      })}
      <text x={cx} y={cy - 2} textAnchor="middle" fontSize="20" fontWeight="800" fill="var(--text,#2C2118)">{total}</text>
      <text x={cx} y={cy + 14} textAnchor="middle" fontSize="9" fill="var(--muted,#9B8B78)">members</text>
    </svg>
  );
}

function Legend({ slices }: { slices: { label: string; value: number; color: string }[] }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  return (
    <div style={{ flex: 1, minWidth: 0 }}>{slices.slice(0, 6).map((s) => (
      <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, padding: '2px 0' }}>
        <span style={{ width: 9, height: 9, borderRadius: 2, background: s.color, flex: 'none' }} />
        <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.label}</span>
        <span className="muted">{s.value}{total > 0 ? ` (${Math.round((s.value / total) * 100)}%)` : ''}</span>
      </div>
    ))}</div>
  );
}

function Spark({ series }: { series: { label: string; cents: number }[] }) {
  if (series.length === 0) return <div className="state" style={{ padding: 28 }}>No membership revenue yet.</div>;
  const W = 520, H = 160, pad = 10, base = H - 22;
  const max = Math.max(1, ...series.map((p) => p.cents));
  const stepX = series.length > 1 ? (W - pad * 2) / (series.length - 1) : 0;
  const xy = (p: { cents: number }, i: number) => [pad + i * stepX, base - (p.cents / max) * (base - pad)] as const;
  const line = series.map((p, i) => xy(p, i).join(',')).join(' ');
  const area = `${pad},${base} ${line} ${pad + (series.length - 1) * stepX},${base}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="170" preserveAspectRatio="none">
      <polygon points={area} fill={`${'#A96F22'}14`} />
      <polyline points={line} fill="none" stroke={GOLD} strokeWidth="2.5" strokeLinejoin="round" />
      {series.map((p, i) => { const [x, y] = xy(p, i); return <circle key={i} cx={x} cy={y} r="2.5" fill={GOLD} />; })}
      {series.map((p, i) => (i % Math.ceil(series.length / 6 || 1) === 0 ? <text key={`t${i}`} x={pad + i * stepX} y={H - 5} fontSize="9" fill="var(--muted,#9B8B78)" textAnchor="middle">{p.label}</text> : null))}
    </svg>
  );
}

const csvEsc = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
function downloadCsv(name: string, headers: string[], rows: (string | number)[][]) {
  const body = [headers.join(','), ...rows.map((r) => r.map((c) => csvEsc(String(c))).join(','))].join('\n');
  const url = URL.createObjectURL(new Blob([body], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}

export function MembershipsOverviewScreen() {
  const nav = useNavigate();
  const [r, setR] = useState<SAMembershipOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [planOpen, setPlanOpen] = useState<string | null>(null);
  const [memberOpen, setMemberOpen] = useState<string | null>(null);
  const [revRange, setRevRange] = useState<SARevenueRange>('this_month');

  const load = (rr: SARevenueRange = revRange) => {
    setError(null);
    (superAdminMembershipsApi.overview({ revenueRange: rr }) as Promise<SAMembershipOverview>)
      .then(setR)
      .catch((e: any) => setError(e?.message || 'Couldn’t load membership data. Retry, or check the platform API.'));
  };
  useEffect(() => { load(revRange); /* re-fetch when the revenue range changes */ }, [revRange]);

  const exportOverview = () => {
    if (!r) return;
    downloadCsv(`platform-memberships-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Member', 'Plan', 'Status', 'Joined', 'Next Billing'],
      r.members.map((m) => [m.customerName, m.planName, STATUS_LABEL[m.status] || m.status, fmtDate(m.joinDate), fmtDate(m.nextBillingAt)]));
    setNote(`Exported ${r.members.length} recent member${r.members.length === 1 ? '' : 's'} to CSV.`);
  };
  const tenantScoped = () => setNote('That action is tenant-scoped — salon owners and managers do this inside their own POS. Super Admin here is read-only platform oversight.');

  const statusSlices = useMemo(() => (r ? r.statusBreakdown.map((s) => ({ label: STATUS_LABEL[s.status] || s.status, value: s.count, color: STATUS_COLOR[s.status] || '#9B8B78' })) : []), [r]);
  const planSlices = useMemo(() => (r ? r.planDistribution.map((p, i) => ({ label: p.planName, value: p.count, color: PALETTE[i % PALETTE.length] })) : []), [r]);

  if (error) return <div className="screen"><div className="vh"><h1>Membership Overview</h1></div><div className="state">{error} <button className="linkbtn" style={{ marginLeft: 8 }} onClick={() => load()}>Retry</button></div></div>;
  if (!r) return <div className="screen"><div className="vh"><h1>Membership Overview</h1></div><div className="state">Loading platform memberships…</div></div>;

  const k = r.kpis;
  const kpiCards = [
    { l: 'Total Members', v: String(k.totalMembers), d: k.newMembersThisMonth ? `+${k.newMembersThisMonth} this month` : 'this month', tile: { bg: '#EDE7F6', fg: '#7E57C2', path: ICON.users } },
    { l: 'Active Members', v: String(k.activeMembers), d: `${k.activePctOfTotal}% of total members`, flat: true, tile: { bg: '#FBF1DD', fg: GOLD, path: ICON.crown } },
    { l: 'Membership Revenue', v: money(k.membershipRevenueCents), d: k.revenueDeltaPct == null ? 'this month' : `${delta(k.revenueDeltaPct)} vs last month`, flat: k.revenueDeltaPct == null, tile: { bg: '#E9F5EC', fg: '#3E8F57', path: ICON.dollar } },
    { l: 'Expiring Soon', v: String(k.expiringSoon), d: `Next ${k.expiringWindowDays} days`, flat: true, tile: { bg: '#E7F0F7', fg: '#3C7FB6', path: ICON.calendar } },
    { l: 'Canceled (This Month)', v: String(k.canceledThisMonth), d: k.canceledDeltaPct == null ? 'this month' : `${delta(k.canceledDeltaPct)} vs last month`, flat: true, tile: { bg: '#F7E9E7', fg: '#B85B4D', path: ICON.userx } },
  ];

  const summary = r.summary;
  const bottom = [
    { l: 'Total Members', v: String(summary.totalMembers), sub: k.newMembersThisMonth ? `+${k.newMembersThisMonth} this month` : 'this month', flat: !k.newMembersThisMonth, tile: { bg: '#EDE7F6', fg: '#7E57C2', path: ICON.users } },
    { l: 'Active Members', v: String(summary.activeMembers), sub: `${k.activePctOfTotal}% of total`, flat: true, tile: { bg: '#FBF1DD', fg: GOLD, path: ICON.crown } },
    { l: 'Total Revenue', v: money(summary.totalRevenueCents), sub: k.revenueDeltaPct == null ? 'all-time' : `${delta(k.revenueDeltaPct)} vs last month`, flat: k.revenueDeltaPct == null, tile: { bg: '#E9F5EC', fg: '#3E8F57', path: ICON.dollar } },
    { l: 'Avg Revenue / Member', v: money(summary.avgRevenuePerMemberCents), sub: 'per active member', flat: true, tile: { bg: '#FBF1DD', fg: GOLD, path: ICON.dollar } },
    { l: 'Renewal Rate', v: pctStr(summary.renewalRatePct), sub: summary.renewalRateDeltaPct != null ? `${delta(summary.renewalRateDeltaPct)} vs last month` : summary.renewalRatePct == null ? 'no renewals yet' : 'this month', flat: summary.renewalRateDeltaPct == null, tile: { bg: '#E7F0F7', fg: '#3C7FB6', path: ICON.repeat } },
    { l: 'Churn Rate', v: pctStr(summary.churnRatePct), sub: summary.churnRatePct == null ? 'no cancellations' : 'this month', flat: true, tile: { bg: '#F7E9E7', fg: '#B85B4D', path: ICON.userx } },
  ];

  const quickActions: { label: string; onClick: () => void }[] = [
    { label: 'Add New Member', onClick: tenantScoped },
    { label: 'Create Plan', onClick: tenantScoped },
    { label: 'Send Reminder', onClick: tenantScoped },
    { label: 'Manage Discounts', onClick: tenantScoped },
    { label: 'Membership Report', onClick: () => nav('/ai-reports') },
    { label: 'Export Data', onClick: exportOverview },
    { label: 'Plan Performance', onClick: () => nav('/analytics') },
    { label: 'Membership Settings', onClick: tenantScoped },
  ];

  return (
    <div className="screen" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div className="vh" style={{ flex: 1, minWidth: 240 }}><h1>Membership Overview</h1><div className="sub">Manage membership plans, track member activity, and grow customer loyalty.{r.tenantCount ? ` · ${r.tenantCount} ${r.tenantCount === 1 ? 'tenant' : 'tenants'}` : ''}</div></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="linkbtn" onClick={exportOverview}>↧ Export Report</button>
          <button className="linkbtn" style={{ background: GOLD, color: '#fff', borderColor: GOLD }} onClick={tenantScoped}>+ Create Membership Plan</button>
        </div>
      </div>

      {note && <div className="panel" style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--warn-bg,#FFF6E5)', padding: '8px 12px' }}><span style={{ fontSize: 12.5 }}>{note}</span><button className="linkbtn" style={{ marginLeft: 'auto' }} onClick={() => setNote(null)}>Dismiss</button></div>}

      <div className="kpis">
        {kpiCards.map((c) => (
          <div className="kpi" key={c.l} style={{ display: 'flex', gap: 11, alignItems: 'center' }}>
            <IconTile {...c.tile} />
            <div style={{ minWidth: 0 }}><div className="l">{c.l}</div><div className="v">{c.v}</div><div className={`d${c.flat ? ' flat' : ''}`}>{c.d}</div></div>
          </div>
        ))}
      </div>

      {/* Plans · Members · Activity */}
      <div className="grid3">
        <section className="panel">
          <div className="phead"><h2>Membership Plans</h2><button className="linkbtn" onClick={tenantScoped}>View All Plans</button></div>
          {r.plans.length === 0 ? <div className="state" style={{ padding: 24 }}>No plans yet.</div> : r.plans.map((p) => (
            <div className="row" key={p.planId} onClick={() => setPlanOpen(p.planId)} role="button" tabIndex={0} title="View plan detail" style={{ marginBottom: 8, alignItems: 'flex-start', cursor: 'pointer' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ fontWeight: 700, fontSize: 13 }}>{p.name}</span>{p.isPopular && <span style={{ fontSize: 9, fontWeight: 800, color: GOLD, background: 'var(--warn-bg,#FFF6E5)', border: '1px solid #F0D79A', borderRadius: 999, padding: '1px 7px' }}>Most Popular</span>}</div>
                <div className="s" style={{ marginTop: 2 }}>{p.description || '—'}</div>
                <div style={{ marginTop: 5 }}><StatusPill status={p.status === 'active' ? 'active' : p.status} /> <span className="muted" style={{ fontSize: 11 }}>· {p.memberCount} members</span></div>
              </div>
              <div style={{ textAlign: 'right', flex: 'none' }}><div style={{ fontWeight: 800, color: GOLD, fontSize: 13 }}>{p.isCustomPricing ? 'Custom' : money(p.priceCents)}</div><div className="muted" style={{ fontSize: 10 }}>{p.isCustomPricing ? 'Pricing' : intervalLabel[p.billingInterval] ?? `/ ${p.billingInterval}`}</div></div>
            </div>
          ))}
        </section>

        <section className="panel">
          <div className="phead"><h2>Active Members</h2><button className="linkbtn" onClick={exportOverview}>View All Members</button></div>
          {r.members.length === 0 ? <div className="state" style={{ padding: 24 }}>No members yet.</div> : r.members.map((m) => (
            <div key={m.membershipId} onClick={() => setMemberOpen(m.membershipId)} role="button" tabIndex={0} title="View membership profile" style={{ display: 'flex', gap: 9, alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--line)', cursor: 'pointer' }}>
              <Avatar name={m.customerName} url={m.avatarUrl} />
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 600, fontSize: 12.5 }}>{m.customerName}</div><div className="muted" style={{ fontSize: 11 }}>{m.maskedPhone || '—'}</div></div>
              <div style={{ textAlign: 'right', flex: 'none' }}><div className="muted" style={{ fontSize: 10.5 }}>{m.planName}</div><div className="muted" style={{ fontSize: 10 }}>Next {fmtDate(m.nextBillingAt)}</div></div>
              <div style={{ flex: 'none', marginLeft: 4 }}><StatusPill status={m.status} /></div>
            </div>
          ))}
        </section>

        <section className="panel">
          <div className="phead"><h2>Membership Activity</h2><button className="linkbtn" onClick={() => nav('/audit-logs')}>View All Activity</button></div>
          {r.activity.length === 0 ? <div className="state" style={{ padding: 24 }}>No activity yet.</div> : r.activity.map((a) => (
            <div key={a.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLOR[a.activityType] || GOLD, flex: 'none' }} />
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 12.5 }}><strong>{a.customerName || 'Member'}</strong> {a.activityType.replace(/_/g, ' ')}{a.planName ? ` · ${a.planName}` : ''}</div><div className="muted" style={{ fontSize: 10.5 }}>{fmtWhen(a.occurredAt)}</div></div>
              {a.amountCents != null && <div style={{ fontSize: 12, fontWeight: 700, color: a.amountCents > 0 ? 'var(--ok,#3E8F57)' : 'var(--muted)' }}>{money(a.amountCents)}</div>}
            </div>
          ))}
        </section>
      </div>

      {/* Revenue · Status · Plan Distribution · Top Services */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1fr', gap: 12, marginBottom: 14 }}>
        <section className="panel">
          <div className="phead">
            <h2>Membership Revenue</h2>
            <select value={revRange} onChange={(e) => setRevRange(e.target.value as SARevenueRange)} aria-label="Revenue range"
              style={{ border: '1px solid var(--gline,#E2C686)', color: GOLD, background: '#FFFDF8', borderRadius: 8, fontSize: 11, fontWeight: 800, padding: '4px 8px', fontFamily: 'inherit', cursor: 'pointer' }}>
              <option value="this_week">This Week</option>
              <option value="this_month">This Month</option>
              <option value="last_month">Last Month</option>
              <option value="this_quarter">This Quarter</option>
              <option value="this_year">This Year</option>
            </select>
          </div>
          <div style={{ fontFamily: "'Playfair Display', serif", fontSize: 22 }}>{money(r.revenueRange.totalCents)} {r.revenueRange.deltaPct != null && <span style={{ fontSize: 12, color: r.revenueRange.deltaPct >= 0 ? 'var(--ok,#3E8F57)' : 'var(--danger,#B85B4D)', fontWeight: 700 }}>{delta(r.revenueRange.deltaPct)} {PRIOR_LABEL[revRange]}</span>}</div>
          <Spark series={r.revenueSeries} />
        </section>
        <section className="panel">
          <div className="phead"><h2>Membership Status</h2></div>
          {statusSlices.length === 0 ? <div className="state" style={{ padding: 24 }}>No members yet.</div> : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Donut slices={statusSlices} />
              <Legend slices={statusSlices} />
            </div>
          )}
        </section>
        <section className="panel">
          <div className="phead"><h2>Plan Distribution</h2></div>
          {planSlices.length === 0 ? <div className="state" style={{ padding: 24 }}>No plans yet.</div> : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Donut slices={planSlices} />
              <Legend slices={planSlices} />
            </div>
          )}
        </section>
        <section className="panel">
          <div className="phead"><h2>Top Membership Services</h2></div>
          {r.topServices.length === 0 ? <div className="state" style={{ padding: 24 }}>No redemptions yet.</div> : r.topServices.map((s) => (
            <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
              <span style={{ fontSize: 12.5, flex: 1, minWidth: 0 }}>{s.name}</span><span style={{ fontWeight: 800, fontSize: 13 }}>{s.redemptions}</span>
            </div>
          ))}
        </section>
      </div>

      {/* Expiring · Recently Created */}
      <div className="grid2">
        <section className="panel">
          <div className="phead"><h2>Expiring Memberships</h2></div>
          {r.expiring.length === 0 ? <div className="state" style={{ padding: 24 }}>Nothing expiring soon.</div> : r.expiring.map((e) => (
            <div key={e.membershipId} onClick={() => setMemberOpen(e.membershipId)} role="button" tabIndex={0} title="View membership profile" style={{ display: 'flex', gap: 9, alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--line)', cursor: 'pointer' }}>
              <Avatar name={e.customerName} url={e.avatarUrl} size={26} />
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 600, fontSize: 12.5 }}>{e.customerName}</div><div className="muted" style={{ fontSize: 10.5 }}>{e.planName}</div></div>
              <div style={{ textAlign: 'right', flex: 'none' }}><div className="muted" style={{ fontSize: 10.5 }}>{fmtDate(e.expiresOn)}</div><div style={{ fontSize: 11, fontWeight: 800, color: e.daysLeft <= 7 ? 'var(--danger,#B85B4D)' : e.daysLeft <= 21 ? 'var(--warn,#D09A36)' : 'var(--ok,#3E8F57)' }}>{e.daysLeft} day{e.daysLeft === 1 ? '' : 's'} left</div></div>
            </div>
          ))}
        </section>
        <section className="panel">
          <div className="phead"><h2>Recently Created Memberships</h2></div>
          {r.recentlyCreated.length === 0 ? <div className="state" style={{ padding: 24 }}>No new memberships yet.</div> : r.recentlyCreated.map((e) => (
            <div key={e.membershipId} onClick={() => setMemberOpen(e.membershipId)} role="button" tabIndex={0} title="View membership profile" style={{ display: 'flex', gap: 9, alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--line)', cursor: 'pointer' }}>
              <Avatar name={e.customerName} url={e.avatarUrl} size={26} />
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 600, fontSize: 12.5 }}>{e.customerName}</div><div className="muted" style={{ fontSize: 10.5 }}>{e.planName}</div></div>
              <div style={{ textAlign: 'right', flex: 'none' }}><div style={{ fontWeight: 700, fontSize: 12.5 }}>{e.amountCents ? money(e.amountCents) : '—'}</div><div className="muted" style={{ fontSize: 10 }}>{fmtDate(e.joinDate)}</div></div>
              <div style={{ flex: 'none' }}><StatusPill status={e.status} /></div>
            </div>
          ))}
        </section>
      </div>

      {/* Quick Actions */}
      <section className="panel">
        <div className="phead"><h2>Quick Actions</h2></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
          {quickActions.map((q) => <button key={q.label} className="qbtn" onClick={q.onClick}>{q.label}</button>)}
        </div>
      </section>

      {/* Bottom summary strip */}
      <div className="kpis" style={{ marginTop: 4 }}>
        {bottom.map((b) => (
          <div className="kpi" key={b.l} style={{ display: 'flex', gap: 11, alignItems: 'center' }}>
            <IconTile {...b.tile} />
            <div style={{ minWidth: 0 }}><div className="l">{b.l}</div><div className="v">{b.v}</div><div className={`d${b.flat ? ' flat' : ''}`}>{b.sub}</div></div>
          </div>
        ))}
      </div>

      {planOpen && <PlanDetailDrawer planId={planOpen} onClose={() => setPlanOpen(null)} />}
      {memberOpen && <MemberProfileDrawer membershipId={memberOpen} onClose={() => setMemberOpen(null)} />}
    </div>
  );
}

// ── Read-only drill-down drawers (Super Admin oversight; viewing only, never altering tenant data) ──
function Drawer({ title, sub, onClose, children }: { title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,16,10,0.32)', zIndex: 50, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" style={{ width: 'min(480px, 95vw)', height: '100vh', background: 'var(--card,#fff)', boxShadow: '-8px 0 28px rgba(0,0,0,0.18)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ minWidth: 0 }}><div style={{ fontWeight: 800, fontSize: 14 }}>{title}</div>{sub && <div className="muted" style={{ fontSize: 11, marginTop: 1 }}>{sub}</div>}</div>
          <button className="btn ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>{children}</div>
      </div>
    </div>
  );
}
function SectionLabel({ children }: { children: ReactNode }) {
  return <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--muted)', margin: '14px 0 6px' }}>{children}</div>;
}
function Field({ k, v }: { k: string; v: ReactNode }) {
  return <div style={{ display: 'flex', gap: 10, padding: '5px 0', borderBottom: '1px solid var(--line)', fontSize: 12.5 }}><span className="muted" style={{ minWidth: 130, flex: 'none' }}>{k}</span><span style={{ flex: 1, textAlign: 'right', wordBreak: 'break-word' }}>{v}</span></div>;
}

function PlanDetailDrawer({ planId, onClose }: { planId: string; onClose: () => void }) {
  const [d, setD] = useState<SAPlanDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { superAdminMembershipsApi.planDetail(planId).then((res) => setD(res.plan)).catch((e: any) => setErr(e?.message || 'Couldn’t load plan.')); }, [planId]);
  return (
    <Drawer title={d ? d.name : 'Plan'} sub={d ? `${d.tenantName || 'Tenant'}${d.branchName ? ` · ${d.branchName}` : ' · All branches'} · read-only` : 'read-only oversight'} onClose={onClose}>
      {err ? <div className="state" style={{ fontSize: 12.5 }}>{err}</div> : !d ? <div className="state" style={{ fontSize: 12.5 }}>Loading plan…</div> : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <StatusPill status={d.status === 'active' ? 'active' : d.status} />
            {d.isPopular && <span style={{ fontSize: 9, fontWeight: 800, color: GOLD, background: 'var(--warn-bg,#FFF6E5)', border: '1px solid #F0D79A', borderRadius: 999, padding: '1px 7px' }}>Most Popular</span>}
            {d.version && !d.version.isPublished && <span className="pill warn">Draft version</span>}
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--soft,#6D5F50)' }}>{d.description || '—'}</div>
          <SectionLabel>Plan</SectionLabel>
          <Field k="Owning tenant" v={d.tenantName || '—'} />
          <Field k="Branch" v={d.branchName || 'All branches'} />
          <Field k="Type" v={d.productType} />
          <Field k="Price" v={d.version?.isCustomPricing ? 'Custom pricing' : (d.version ? `${money(d.version.priceCents)} ${intervalLabel[d.version.billingInterval] ?? `/ ${d.version.billingInterval}`}` : '—')} />
          <Field k="Active members" v={d.memberCount} />
          <Field k="Revenue (this month)" v={money(d.revenueCents)} />
          {d.version ? (
            <>
              <SectionLabel>Current Version (v{d.version.versionNumber})</SectionLabel>
              <Field k="Billing" v={`${d.version.intervalCount > 1 ? `every ${d.version.intervalCount} ` : ''}${d.version.billingInterval}`} />
              <Field k="Auto-renew" v={d.version.autoRenew ? 'Yes' : 'No'} />
              <Field k="Term" v={d.version.termDays ? `${d.version.termType} · ${d.version.termDays} days` : d.version.termType} />
              <Field k="Technician split" v={`${d.version.techSplitPct}%`} />
              <Field k="Owner split" v={`${d.version.ownerSplitPct}%`} />
              <Field k="Allocation timing" v={d.version.allocationTiming || '—'} />
              <Field k="Cancellation policy" v={d.version.cancellationPolicy || '—'} />
              <Field k="Published" v={d.version.isPublished ? 'Yes' : 'No (draft)'} />
              <SectionLabel>Included Benefits</SectionLabel>
              {d.version.benefits.length === 0 ? <div className="muted" style={{ fontSize: 12 }}>No benefits configured.</div> : d.version.benefits.map((b, i) => (
                <Field key={i} k={b.label || b.benefitType} v={b.percent ? `${b.percent}% off` : b.creditsPerCycle ? `${b.creditsPerCycle} / cycle` : b.valueCents ? money(b.valueCents) : '✓'} />
              ))}
            </>
          ) : <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>No published version.</div>}
          <div className="muted" style={{ fontSize: 11, marginTop: 14 }}>Plan editing is performed by the salon owner inside their POS. Super Admin view is read-only.</div>
        </>
      )}
    </Drawer>
  );
}

function MemberProfileDrawer({ membershipId, onClose }: { membershipId: string; onClose: () => void }) {
  const [d, setD] = useState<SAMemberDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { superAdminMembershipsApi.memberDetail(membershipId).then((res) => setD(res.member)).catch((e: any) => setErr(e?.message || 'Couldn’t load membership.')); }, [membershipId]);
  return (
    <Drawer title={d ? d.customer.name : 'Membership'} sub={d ? `${d.planName} · ${d.tenantName || 'Tenant'} · read-only` : 'read-only oversight'} onClose={onClose}>
      {err ? <div className="state" style={{ fontSize: 12.5 }}>{err}</div> : !d ? <div className="state" style={{ fontSize: 12.5 }}>Loading membership…</div> : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <Avatar name={d.customer.name} url={d.customer.avatarUrl} size={40} />
            <div style={{ minWidth: 0 }}><div style={{ fontWeight: 700 }}>{d.customer.name}</div><div className="muted" style={{ fontSize: 11.5 }}>{d.customer.maskedPhone || '—'}{d.customer.email ? ` · ${d.customer.email}` : ''}</div></div>
            <div style={{ marginLeft: 'auto' }}><StatusPill status={d.status} /></div>
          </div>
          <SectionLabel>Membership</SectionLabel>
          <Field k="Member #" v={d.memberNumber || '—'} />
          <Field k="Plan" v={`${d.planName}${d.versionNumber ? ` (v${d.versionNumber})` : ''}`} />
          <Field k="Owning tenant" v={d.tenantName || '—'} />
          <Field k="Branch" v={d.branchName || '—'} />
          <Field k="Preferred technician" v={d.technicianName || 'Any qualified'} />
          <Field k="Joined" v={fmtDate(d.startedAt)} />
          <Field k="Billing" v={`${d.intervalCount > 1 ? `every ${d.intervalCount} ` : ''}${d.billingInterval}`} />
          <Field k="Current period" v={d.currentPeriodStart || d.currentPeriodEnd ? `${fmtDate(d.currentPeriodStart)} → ${fmtDate(d.currentPeriodEnd)}` : '—'} />
          <Field k="Next billing" v={fmtDate(d.nextBillingAt)} />
          <Field k="Auto-renew" v={d.autoRenew ? 'Yes' : 'No'} />
          <Field k="Cycles billed" v={d.cyclesBilled} />
          <Field k="Technician / Owner split" v={`${d.techSplitPct}% / ${d.ownerSplitPct}%`} />
          {(d.cancelAtPeriodEnd || d.canceledAt || d.pausedAt) && (
            <>
              <SectionLabel>Lifecycle</SectionLabel>
              {d.pausedAt && <Field k="Paused" v={`${fmtDate(d.pausedAt)}${d.pauseResumesAt ? ` → resumes ${fmtDate(d.pauseResumesAt)}` : ''}`} />}
              {d.cancelAtPeriodEnd && <Field k="Cancels at period end" v="Yes" />}
              {d.canceledAt && <Field k="Canceled" v={`${fmtDate(d.canceledAt)}${d.cancelReason ? ` · ${d.cancelReason}` : ''}`} />}
            </>
          )}
          <SectionLabel>Included Benefits</SectionLabel>
          {d.benefits.length === 0 ? <div className="muted" style={{ fontSize: 12 }}>No benefits configured.</div> : d.benefits.map((b, i) => (
            <Field key={i} k={b.label || b.benefitType} v={b.percent ? `${b.percent}% off` : b.creditsPerCycle ? `${b.creditsPerCycle} / cycle` : b.valueCents ? money(b.valueCents) : '✓'} />
          ))}
          <SectionLabel>Payment History</SectionLabel>
          {d.payments.length === 0 ? <div className="muted" style={{ fontSize: 12 }}>No payments yet.</div> : d.payments.map((p, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--line)', fontSize: 12.5 }}>
              <span style={{ flex: 1, minWidth: 0, textTransform: 'capitalize' }}>{p.kind.replace(/_/g, ' ')}<span className="muted" style={{ fontSize: 10.5 }}> · {fmtDate(p.settledAt || p.createdAt)}{p.processor ? ` · ${p.processor}` : ''}</span></span>
              <span style={{ fontWeight: 700 }}>{money(p.amountCents)}</span>
              <span className={p.status === 'succeeded' ? 'pill ok' : 'pill warn'}>{p.status}</span>
            </div>
          ))}
          <SectionLabel>Activity</SectionLabel>
          {d.activity.length === 0 ? <div className="muted" style={{ fontSize: 12 }}>No activity yet.</div> : d.activity.map((a, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid var(--line)', fontSize: 12.5 }}>
              <span style={{ flex: 1, minWidth: 0, textTransform: 'capitalize' }}>{a.activityType.replace(/_/g, ' ')}</span>
              <span className="muted" style={{ fontSize: 10.5 }}>{fmtWhen(a.occurredAt)}</span>
              {a.amountCents != null && <span style={{ fontWeight: 700 }}>{money(a.amountCents)}</span>}
            </div>
          ))}
          <div className="muted" style={{ fontSize: 11, marginTop: 14 }}>Membership changes are performed by the salon inside their POS. Super Admin view is read-only.</div>
        </>
      )}
    </Drawer>
  );
}
