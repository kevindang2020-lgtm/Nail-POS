import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { posMembershipsApi, type MemberExportRow, type PaymentExportRow, type RedemptionExportRow } from '../api/posMembershipsApi';
import { MembershipPlanBuilder } from './MembershipPlanBuilder';
import { MembershipEnrollModal } from './MembershipEnrollModal';
import { MembershipManageModal, type ManageMember } from './MembershipManageModal';
import { resolveAvatarUrl } from '@aipowersalon/ui';
import { t as tx } from '@aipowersalon/mobile-sdk/i18n';
import { humanizeCode, statusLabel } from '../i18n/status-label';
import { fmtMoney, fmtInZone } from '../i18n/format';

// POS Memberships — Membership Overview. Reads the REAL /pos/memberships/overview aggregation (plans / customer
// memberships / payments / redemptions, tenant + branch scoped, integer cents). Every number is sourced from the
// backend; the screen shows honest empty/zero state until plans and members exist rather than fabricating mockup
// figures. Creating a plan and exporting the visible data are live actions; flows that belong to later phases
// (member enrollment, reminders, discounts, reports) surface a clear inline notice instead of acting silently.

type Kpis = {
  totalMembers: number; newMembersThisMonth: number; activeMembers: number; activePctOfTotal: number;
  membershipRevenueCents: number; revenueDeltaPct: number | null; expiringSoon: number; expiringWindowDays: number;
  canceledThisMonth: number; canceledDeltaPct: number | null;
};
type PlanRow = { planId: string; name: string; description: string | null; productType: string; billingInterval: string; intervalCount: number; priceCents: number; isCustomPricing: boolean; status: string; isPopular: boolean; badge: string | null; memberCount: number; revenueCents: number };
type MemberRow = { membershipId: string; customerId: string; customerName: string; avatarUrl: string | null; maskedPhone: string | null; planName: string; joinDate: string | null; nextBillingAt: string | null; status: string };
type ActivityRow = { id: string; activityType: string; customerName: string | null; planName: string | null; occurredAt: string; amountCents: number | null };
type Overview = {
  kpis: Kpis; plans: PlanRow[]; members: MemberRow[]; activity: ActivityRow[];
  revenueSeries: { label: string; cents: number }[];
  statusBreakdown: { status: string; count: number; pct: number }[];
  planDistribution: { planName: string; count: number; pct: number; revenueCents: number }[];
  topServices: { name: string; redemptions: number; valueCents: number }[];
  rangeDays: number;
};

const money = (c?: number) => fmtMoney(c || 0);
const GOLD = '#A96F22';
const PALETTE = ['#6BAF92', '#A96F22', '#C89B5A', '#7B9FD4', '#D08C8C', '#B0A0C8'];
// codes → labels, translated when read (a language switch re-labels in place); an unknown code shows humanised
const labelOr = (key: string, code: string) => { const s = tx(key); return s === key ? humanizeCode(code) : s; };
const memberStatusLabel = (s: string) => labelOr(`people.membership.status.${s}`, s);
const intervalLabel = (s: string) => labelOr(`people.membership.interval.${s}`, s).toLowerCase();
const activityLabel = (s: string) => labelOr(`people.membership.activity.${s}`, s).toLowerCase();
const statusTone = (s: string): 'ok' | 'info' | 'warn' | 'danger' | 'muted' => {
  if (s === 'active' || s === 'comped') return 'ok';
  if (s === 'trial') return 'info';
  if (s === 'grace' || s === 'past_due' || s === 'canceling') return 'warn';
  if (s === 'canceled' || s === 'expired' || s === 'suspended') return 'danger';
  return 'muted';
};
const TONE_BG: Record<string, string> = { ok: '#E7F3EC', info: '#E8EFF9', warn: '#FBF0DF', danger: '#FAE7E7', muted: '#EFE9DF' };
const TONE_FG: Record<string, string> = { ok: '#2E7D55', info: '#3A5B8C', warn: '#9A6A1B', danger: '#A33B3B', muted: '#7A6A56' };
const fmtDateTime = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? '—' : fmtInZone(d, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const planPrice = (p: PlanRow) => (p.isCustomPricing ? tx('pos.custom_pricing') : `${money(p.priceCents)} / ${intervalLabel(p.billingInterval)}`);


const activityTone = (t: string): keyof typeof TONE_FG => {
  if (t === 'purchased' || t === 'renewed' || t === 'payment_recovered' || t === 'resumed') return 'ok';
  if (t === 'upgraded' || t === 'downgraded' || t === 'transferred' || t === 'benefit_redeemed' || t === 'credit_rolled_over') return 'info';
  if (t === 'expiring') return 'warn';
  if (t === 'canceled' || t === 'payment_failed' || t === 'credit_expired') return 'danger';
  return 'muted';
};

function Badge({ tone, children }: { tone: keyof typeof TONE_FG; children: React.ReactNode }) {
  return <span style={{ background: TONE_BG[tone], color: TONE_FG[tone], borderRadius: 999, padding: '2px 9px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>{children}</span>;
}

function PlanGlyph({ popular }: { popular: boolean }) {
  return (
    <div style={{ width: 34, height: 34, borderRadius: 9, flex: 'none', display: 'grid', placeItems: 'center', background: popular ? 'linear-gradient(135deg,#C89B5A,#A96F22)' : '#F2E9DA', color: popular ? '#fff' : GOLD }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M2 10h20" /></svg>
    </div>
  );
}

function Donut({ slices }: { slices: { label: string; count: number; sub?: string }[] }) {
  const total = slices.reduce((a, x) => a + x.count, 0);
  if (total === 0) return <div className="muted" style={{ fontSize: 12 }}>{tx('pos.no_data_yet')}</div>;
  let acc = 0; const R = 52, C = 2 * Math.PI * R;
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
      <svg viewBox="0 0 140 140" style={{ width: 108, height: 108, flex: 'none' }}>
        {slices.map((it, i) => { const dash = (it.count / total) * C; const seg = <circle key={i} cx="70" cy="70" r={R} fill="none" stroke={PALETTE[i % PALETTE.length]} strokeWidth="17" strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-acc} transform="rotate(-90 70 70)" />; acc += dash; return seg; })}
        <circle cx="70" cy="70" r="34" fill="var(--aps-card, #fff)" />
      </svg>
      <div style={{ flex: 1, minWidth: 0 }}>{slices.map((it, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, padding: '2px 0' }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: PALETTE[i % PALETTE.length], flex: 'none' }} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.label}</span>
          <span style={{ marginLeft: 'auto', color: '#8A7A66', flex: 'none' }}>{it.sub ?? ''} {Math.round((it.count / total) * 100)}%</span>
        </div>
      ))}</div>
    </div>
  );
}

function RevenueLine({ series }: { series: { label: string; cents: number }[] }) {
  if (series.length === 0) return <div className="muted" style={{ fontSize: 12 }}>{tx('pos.no_membership_revenue_yet')}</div>;
  const W = 320, H = 96, pad = 6;
  const max = Math.max(1, ...series.map((p) => p.cents));
  const n = series.length;
  const x = (i: number) => (n <= 1 ? W / 2 : pad + (i * (W - pad * 2)) / (n - 1));
  const y = (c: number) => H - pad - (c / max) * (H - pad * 2);
  const pts = series.map((p, i) => `${x(i)},${y(p.cents)}`).join(' ');
  const area = `${pad},${H - pad} ${pts} ${x(n - 1)},${H - pad}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 96 }}>
      <polygon points={area} fill={GOLD} opacity="0.10" />
      <polyline points={pts} fill="none" stroke={GOLD} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {series.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.cents)} r="2.6" fill={GOLD} />)}
    </svg>
  );
}

const QUICK = [
  { key: 'add-member', get label() { return tx('pos.add_new_member'); } },
  { key: 'create-plan', get label() { return tx('pos.create_plan'); } },
  { key: 'send-reminder', get label() { return tx('pos.send_reminder'); } },
  { key: 'manage-discounts', get label() { return tx('pos.manage_discounts'); } },
  { key: 'report', get label() { return tx('pos.membership_report'); } },
  { key: 'export-members', get label() { return tx('pos.export_members'); } },
  { key: 'export-payments', get label() { return tx('pos.export_payments'); } },
  { key: 'export-redemptions', get label() { return tx('pos.export_redemptions'); } },
  { key: 'plan-performance', get label() { return tx('pos.plan_performance'); } },
  { key: 'settings', get label() { return tx('pos.membership_settings'); } },
];
const COMING: Record<string, string> = { 'manage-discounts': 'people.membership.coming.manageDiscounts', report: 'people.membership.coming.report', 'plan-performance': 'people.membership.coming.planPerformance' };

export function POSMembershipsScreen() {
  const nav = useNavigate();
  const [s, setS] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showEnroll, setShowEnroll] = useState(false);
  const [manageMember, setManageMember] = useState<ManageMember | null>(null);
  // Jul 27, 2026 — "View All Plans" loads GET /pos/memberships/plans which returns PlanRow[].
  const [allPlans, setAllPlans] = useState<any[] | null>(null);
  const loadAllPlans = () => { setNote(null); posMembershipsApi.plans().then((r: any) => setAllPlans(Array.isArray(r) ? r : (r?.plans || []))).catch((e: any) => setNote(e?.message || tx('pos.could_not_load_the_plan_list'))); };

  const load = useCallback(() => {
    setError(null);
    (posMembershipsApi.overview() as Promise<Overview>).then(setS).catch((e: any) => setError(e?.message || tx('pos.failed_to_load_membership_overview')));
  }, []);
  useEffect(() => { load(); }, [load]);

  const dateStamp = () => new Date().toISOString().slice(0, 10);
  const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US') : '');
  const dollars = (c: number) => (c / 100).toFixed(2);
  const downloadCsv = (filename: string, header: string[], rows: (string | number)[][]) => {
    const lines = [header.map((h) => csv(String(h))).join(','), ...rows.map((r) => r.map((v) => csv(String(v))).join(','))];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };
  const sendReminders = async () => {
    try {
      const r = (await posMembershipsApi.runReminders(7)) as { due: number; sent: number; skipped: number };
      if (r.sent > 0) setNote(tx('pos.sent_sent_renewal_reminder_plural_v2', { sent: String(r.sent), plural: String(r.sent === 1 ? '' : 's'), v2: String(r.skipped ? tx('pos.skipped_already_sent', { skipped: String(r.skipped) }) : '') }));
      else if (r.due === 0) setNote(tx('pos.no_members_are_due_for_a_13zy'));
      else setNote(tx('pos.the_skipped_due_member_plural_were_1i9x', { skipped: String(r.skipped), plural: String(r.skipped === 1 ? '' : 's') }));
    } catch (e: any) { setNote(e?.message || tx('pos.could_not_send_reminders')); }
  };
  const exportMembers = async () => {
    try {
      const rows = (await posMembershipsApi.exportMembers()) as MemberExportRow[];
      downloadCsv(`membership-members-${dateStamp()}.csv`, [tx('people.membership.csv.customer'), tx('people.membership.csv.plan'), tx('people.membership.csv.status'), tx('people.membership.csv.memberNumber'), tx('people.membership.csv.joined'), tx('people.membership.csv.nextBilling'), tx('people.membership.csv.autoRenew'), tx('people.membership.csv.lifetimePaid')],
        rows.map((r) => [r.customerName, r.planName || '', memberStatusLabel(r.status), r.memberNumber || '', fmtDate(r.joinDate), fmtDate(r.nextBillingAt), r.autoRenew ? tx('pos.yes') : tx('pos.no'), dollars(r.lifetimePaidCents)]));
      setNote(tx('pos.exported_length_member_plural_to_csv', { length: String(rows.length), plural: String(rows.length === 1 ? '' : 's') }));
    } catch (e: any) { setNote(e?.message || tx('pos.member_export_failed')); }
  };
  const exportPayments = async () => {
    try {
      const rows = (await posMembershipsApi.exportPayments()) as PaymentExportRow[];
      downloadCsv(`membership-payments-${dateStamp()}.csv`, [tx('people.membership.csv.customer'), tx('people.membership.csv.plan'), tx('people.membership.csv.kind'), tx('people.membership.csv.amount'), tx('people.membership.csv.tax'), tx('people.membership.csv.status'), tx('people.membership.csv.processor'), tx('people.membership.csv.created'), tx('people.membership.csv.settled')],
        rows.map((r) => [r.customerName, r.planName || '', r.kind, dollars(r.amountCents), dollars(r.taxCents), statusLabel(['payment', 'paymentAttempt'], r.status), r.processor || '', fmtDate(r.createdAt), fmtDate(r.settledAt)]));
      setNote(tx('pos.exported_length_payment_plural_to_csv', { length: String(rows.length), plural: String(rows.length === 1 ? '' : 's') }));
    } catch (e: any) { setNote(e?.message || tx('pos.payment_export_failed')); }
  };
  const exportRedemptions = async () => {
    try {
      const rows = (await posMembershipsApi.exportRedemptions()) as RedemptionExportRow[];
      downloadCsv(`membership-redemptions-${dateStamp()}.csv`, [tx('people.membership.csv.customer'), tx('people.membership.csv.service'), tx('people.membership.csv.standardValue'), tx('people.membership.csv.allocatedValue'), tx('people.membership.csv.upgradeCharge'), tx('people.membership.csv.technician'), tx('people.membership.csv.date')],
        rows.map((r) => [r.customerName, r.serviceName || '', dollars(r.standardValueCents), dollars(r.allocatedValueCents), dollars(r.upgradeChargeCents), r.technicianName || '', fmtDate(r.createdAt)]));
      setNote(tx('pos.exported_length_redemption_plural_to_csv', { length: String(rows.length), plural: String(rows.length === 1 ? '' : 's') }));
    } catch (e: any) { setNote(e?.message || tx('pos.redemption_export_failed')); }
  };
  const quick = (key: string) => {
    if (key === 'create-plan') { setShowCreate(true); return; }
    if (key === 'send-reminder') { sendReminders(); return; }
    if (key === 'export-members') { exportMembers(); return; }
    if (key === 'export-payments') { exportPayments(); return; }
    if (key === 'export-redemptions') { exportRedemptions(); return; }
    if (key === 'settings') { nav('/tenant/management/membership-rules'); return; }
    if (key === 'add-member') { setShowEnroll(true); return; }
    setNote(COMING[key] ? tx(COMING[key]) : tx('pos.this_opens_in_an_upcoming_memberships_14wj'));
  };

  if (error) return <div className="work"><div className="vh"><h1>{tx('pos.membership_overview')}</h1></div><div className="panel" style={{ color: 'var(--danger)' }}>{error} <button className="btn" style={{ marginLeft: 8 }} onClick={load}>{tx('pos.retry')}</button></div></div>;
  if (!s) return <div className="work"><div className="vh"><h1>{tx('pos.membership_overview')}</h1></div><div className="muted" style={{ padding: 12 }}>{tx('pos.loading_memberships')}</div></div>;

  const k = s.kpis;
  const delta = (v: number | null) => (v == null ? null : <span style={{ color: v >= 0 ? '#2E7D55' : '#A33B3B', fontWeight: 700 }}>{v >= 0 ? '+' : ''}{v}%</span>);
  const kpiCards = [
    { l: tx('pos.total_members'), v: String(k.totalMembers), sub: <span style={{ color: '#2E7D55', fontWeight: 700 }}>+{k.newMembersThisMonth} {tx('pos.this_month_4')}</span> },
    { l: tx('pos.active_members'), v: String(k.activeMembers), sub: <span className="muted">{k.activePctOfTotal}{tx('pos.of_total_members')}</span> },
    { l: tx('pos.membership_revenue'), v: money(k.membershipRevenueCents), sub: k.revenueDeltaPct == null ? <span className="muted">{tx('pos.this_month_4')}</span> : <span>{delta(k.revenueDeltaPct)} <span className="muted">{tx('pos.vs_last_month')}</span></span> },
    { l: tx('pos.expiring_soon'), v: String(k.expiringSoon), sub: <span className="muted">{tx('pos.next')}{' '}{k.expiringWindowDays} {tx('pos.days')}</span> },
    { l: tx('pos.canceled_this_month'), v: String(k.canceledThisMonth), sub: k.canceledDeltaPct == null ? <span className="muted">{tx('pos.vs_last_month')}</span> : <span>{delta(k.canceledDeltaPct)} <span className="muted">{tx('pos.vs_last_month')}</span></span> },
  ];

  return (
    <div className="work">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div className="vh" style={{ flex: 1, minWidth: 220 }}><h1>{tx('pos.membership_overview')}</h1><div className="sub">{tx('pos.manage_membership_plans_track_member_activity_1q23')}</div></div>
        <button className="btn"  onClick={() => setShowCreate(true)}>{tx('pos.create_membership_plan')}</button>
      </div>

      {note && <div className="panel" style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, background: '#FBF6EC' }}><span style={{ fontSize: 13 }}>{note}</span><button className="btn" style={{ marginLeft: 'auto', padding: '2px 8px' }} onClick={() => setNote(null)}>{tx('pos.dismiss')}</button></div>}

      <div className="kpis" style={{ marginTop: 12 }}>{kpiCards.map((c) => (<div className="kpi" key={c.l}><div className="l">{c.l}</div><div className="v">{c.v}</div><div style={{ fontSize: 12, marginTop: 2 }}>{c.sub}</div></div>))}</div>

      <div className='grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3 mt-3'>
        {/* Membership Plans */}
        <section className="panel">
          <h2 style={{ display: 'flex', alignItems: 'center' }}>{tx('pos.membership_plans')}{' '}<button className="btn" style={{ marginLeft: 'auto', padding: '2px 8px', fontSize: 12 }} onClick={allPlans ? () => setAllPlans(null) : loadAllPlans}>{allPlans ? tx('pos.show_fewer_2') : tx('pos.view_all_plans')}</button></h2>
          {s.plans.length === 0 ? <div className="muted" style={{ fontSize: 13 }}>{tx('pos.no_plans_yet_use_create_membership_1u84')}</div> : (
<div className="overflow-x-auto ">
<div className="list min-w-125">{(allPlans ?? s.plans).map((p: any) => (
              <div key={p.planId} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 0', borderBottom: '1px solid var(--line,#EFE6D6)' }}>
                <PlanGlyph popular={p.isPopular} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ fontWeight: 700 }}>{p.name}</span>{p.isPopular && <Badge tone="warn">★ {p.badge || tx('pos.most_popular')}</Badge>}</div>
                  {p.description && <div className="muted" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.description}</div>}
                  <div style={{ marginTop: 3 }}><Badge tone={p.status === 'active' ? 'ok' : p.status === 'draft' ? 'muted' : 'warn'}>{p.status === 'active' ? tx('pos.active_3') : p.status === 'draft' ? tx('pos.draft_2') : tx('pos.archived_2')}</Badge></div>
                </div>
                <div style={{ textAlign: 'right', flex: 'none' }}><div style={{ fontWeight: 700, color: GOLD, fontSize: 13 }}>{planPrice(p)}</div>{p.memberCount > 0 && <div className="muted" style={{ fontSize: 11 }}>{p.memberCount} {tx('pos.members_2')}</div>}</div>
              </div>
              
            ))}</div>
            </div>
          )}
        </section>

        {/* Active Members */}
        <section className="panel">
          <h2 style={{ display: 'flex', alignItems: 'center' }}>{tx('pos.active_members')}{' '}<button className="btn" style={{ marginLeft: 'auto', padding: '2px 8px', fontSize: 12 }} onClick={() => setNote(tx('pos.the_full_member_directory_isn_t_hq0r'))}>{tx('pos.view_all_members')}</button></h2>
          {s.members.length === 0 ? <div className="muted" style={{ fontSize: 13 }}>{tx('pos.no_members_yet')}</div> : (
           <div className="overflow-x-auto ">
<div className="list min-w-125">{s.members.map((m) => (
              <div key={m.membershipId} style={{ display: 'flex', gap: 9, alignItems: 'center', padding: '7px 0', borderBottom: '1px solid var(--line,#EFE6D6)' }}>
                <Avatar name={m.customerName} url={m.avatarUrl} />
                <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 600, fontSize: 13 }}>{m.customerName}</div><div className="muted" style={{ fontSize: 11 }}>{m.maskedPhone || '—'}</div></div>
                <div style={{ flex: 'none', textAlign: 'right' }}>
                  <Badge tone="info">{m.planName}</Badge>
                  <div className="muted" style={{ fontSize: 10, marginTop: 2 }}>{tx('pos.next')}{' '}{fmtDate(m.nextBillingAt)}</div>
                </div>
                <div style={{ flex: 'none', marginLeft: 4 }}><Badge tone={statusTone(m.status)}>{memberStatusLabel(m.status)}</Badge></div>
                <button className="btn" style={{ flex: 'none', marginLeft: 6, padding: '3px 9px', fontSize: 12 }} onClick={() => setManageMember({ membershipId: m.membershipId, customerName: m.customerName, planName: m.planName, status: m.status, nextBillingAt: m.nextBillingAt })}>{tx('pos.manage')}</button>
              </div>
            ))}
            </div>
            </div>
          )}
        </section>

        {/* Membership Activity */}
        <section className="panel">
          <h2 style={{ display: 'flex', alignItems: 'center' }}>{tx('pos.membership_activity')}{' '}<button className="btn" style={{ marginLeft: 'auto', padding: '2px 8px', fontSize: 12 }} onClick={() => setNote(tx('pos.the_full_activity_log_isn_t_cr7q'))}>{tx('pos.view_all_activity')}</button></h2>
          {s.activity.length === 0 ? <div className="muted" style={{ fontSize: 13 }}>{tx('pos.no_activity_yet')}</div> : (
            <div className="list">{s.activity.map((a) => (
              <div key={a.id} style={{ display: 'flex', gap: 9, alignItems: 'flex-start', padding: '7px 0', borderBottom: '1px solid var(--line,#EFE6D6)' }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: TONE_FG[activityTone(a.activityType)], marginTop: 5, flex: 'none' }} />
                <div style={{ flex: 1, minWidth: 0, fontSize: 12 }}>
                  <div><b>{a.customerName || tx('pos.a_member')}</b> {activityLabel(a.activityType)}{a.planName ? ` ${a.planName}` : ''}</div>
                  <div className="muted" style={{ fontSize: 11 }}>{fmtDateTime(a.occurredAt)}</div>
                </div>
                {a.amountCents != null && <div style={{ flex: 'none', fontWeight: 700, fontSize: 12, color: activityTone(a.activityType) === 'danger' ? '#A33B3B' : GOLD }}>{money(a.amountCents)}</div>}
              </div>
            ))}</div>
          )}
        </section>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, marginTop: 12 }}>
        <section className="panel">
          <h2>{tx('pos.membership_revenue')}</h2>
          <div style={{ fontSize: 20, fontWeight: 800, color: GOLD, margin: '2px 0 6px' }}>{money(k.membershipRevenueCents)} {k.revenueDeltaPct != null && <span style={{ fontSize: 12 }}>{delta(k.revenueDeltaPct)} <span className="muted">{tx('pos.vs_last_month')}</span></span>}</div>
          <RevenueLine series={s.revenueSeries} />
        </section>
        <section className="panel"><h2>{tx('pos.membership_status')}</h2><Donut slices={s.statusBreakdown.map((x) => ({ label: memberStatusLabel(x.status), count: x.count }))} /></section>
        <section className="panel"><h2>{tx('pos.plan_distribution')}</h2><Donut slices={s.planDistribution.map((x) => ({ label: x.planName, count: x.count }))} /></section>
        <section className="panel">
          <h2>{tx('pos.top_membership_services')}</h2>
          {s.topServices.length === 0 ? <div className="muted" style={{ fontSize: 12 }}>{tx('pos.no_redemptions_yet')}</div> : (
            <div className="list">{s.topServices.map((t, i) => (
              <div key={t.name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', fontSize: 13 }}>
                <span className="muted" style={{ width: 16 }}>{i + 1}</span><span style={{ flex: 1 }}>{t.name}</span><span style={{ fontWeight: 700 }}>{t.redemptions}</span>
              </div>
            ))}</div>
          )}
        </section>
      </div>

      {/* Quick Actions */}
      <section className="panel" style={{ marginTop: 12 }}>
        <h2>{tx('pos.quick_actions_2')}</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {QUICK.map((q) => {
            const live = q.key === 'create-plan' || q.key === 'send-reminder' || q.key.startsWith('export-') || q.key === 'settings' || q.key === 'add-member';
            return <button key={q.key} className="btn" onClick={() => quick(q.key)} style={live ? { borderColor: GOLD, color: GOLD, fontWeight: 600 } : undefined}>{q.label}</button>;
          })}
        </div>
      </section>

      {showCreate && <MembershipPlanBuilder onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); setNote(tx('pos.plan_published')); load(); }} />}
      {showEnroll && <MembershipEnrollModal onClose={() => setShowEnroll(false)} onEnrolled={(msg) => { setShowEnroll(false); setNote(msg); load(); }} />}
      {manageMember && <MembershipManageModal member={manageMember} onClose={() => setManageMember(null)} onDone={(msg) => { setManageMember(null); setNote(msg); load(); }} />}
    </div>
  );
}

function Avatar({ name, url }: { name: string; url: string | null }) {
  const initials = name.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?';
  const resolvedUrl = resolveAvatarUrl(url);
  if (resolvedUrl) return <img src={resolvedUrl} alt="" style={{ width: 30, height: 30, borderRadius: 999, objectFit: 'cover', flex: 'none' }} />;
  return <div style={{ width: 30, height: 30, borderRadius: 999, background: '#F2E9DA', color: GOLD, display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700, flex: 'none' }}>{initials}</div>;
}

function csv(v: string): string { return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }

