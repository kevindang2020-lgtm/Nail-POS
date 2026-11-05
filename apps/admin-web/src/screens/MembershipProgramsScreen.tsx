import { useEffect, useState } from 'react';
import { membershipProgramsApi, type MembershipProgramsOverview } from '../api/superAdminMembershipsApi';
import { Donut, money } from './_chartkit';
import { PlanGatingModal, PlatformLimitsModal, AllowedRulesModal, TemplatesModal } from './MembershipControlModals';
import { ReviewProgramsModal, BillingFailuresModal, RevenueModal, CancellationsModal } from './MembershipOversightModals';
import { DuplicateChargesModal, CorrectErrorsModal, DisableProgramModal } from './MembershipActionModals';
import { SuspiciousModal, SupportModeModal } from './MembershipSupportModals';
import { MembersModal, CreditsModal } from './MembershipDrilldownModals';
import { membershipSupportApi } from '../api/superAdminMembershipsApi';
import { membershipExportApi } from '../api/superAdminMembershipsApi';

// MembershipProgramsScreen — Super Admin → Business Management → Membership Programs. Read surface (Unit 1): oversees
// membership functionality across all tenants and branches. 15 KPIs, Platform Membership Controls, Tenant Membership
// Oversight, analytics (revenue trend, members vs benefits redeemed, program mix, recurring billing status), the three
// oversight tables, Quick Actions, three governance cards, and the At-a-Glance summary. Control/action workflows open an
// informational notice here and are wired to real backends in later units. Money is integer cents from the backend.

const STATUS_TONE: Record<string, [string, string]> = {
  active: ['#E7F2EA', '#2F6B43'], trial: ['#E7EFF7', '#2B5E8C'], paused: ['#FBF1E3', '#9A6114'],
  past_due: ['#FBEAEA', '#9B2C2C'], cancelled: ['#EFEFEF', '#555'],
};
const STATUS_LABEL: Record<string, string> = { active: 'Active', trial: 'Trial', paused: 'Paused', past_due: 'Past-Due', cancelled: 'Cancelled' };
const sevTone = (s: string): [string, string] => s === 'High' ? ['#FBEAEA', '#9B2C2C'] : s === 'Medium' ? ['#FBF1E3', '#9A6114'] : ['#EFEFEF', '#555'];
const perfTone = (s: string): [string, string] => s === 'At Risk' ? ['#FBEAEA', '#9B2C2C'] : s === 'Watch' ? ['#FBF1E3', '#9A6114'] : ['#E7F2EA', '#2F6B43'];

function Badge({ text, tone }: { text: string; tone: [string, string] }) {
  return <span style={{ background: tone[0], color: tone[1], padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>{text}</span>;
}

function Line({ points, color = '#C98A3A' }: { points: number[]; color?: string }) {
  const W = 260, H = 90, pad = 6;
  if (points.length === 0) return <div className="state" style={{ fontSize: 11 }}>No data in range.</div>;
  const max = Math.max(1, ...points), x = (i: number) => pad + (i * (W - 2 * pad)) / Math.max(1, points.length - 1), y = (v: number) => H - pad - (v * (H - 2 * pad)) / max;
  return <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 90 }}><polyline fill="none" stroke={color} strokeWidth={1.8} points={points.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />{points.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={1.8} fill={color} />)}</svg>;
}
function DualLine({ a, b, ca = '#3C7FB6', cb = '#3E8F57' }: { a: number[]; b: number[]; ca?: string; cb?: string }) {
  const W = 260, H = 90, pad = 6;
  const max = Math.max(1, ...a, ...b), x = (i: number, len: number) => pad + (i * (W - 2 * pad)) / Math.max(1, len - 1), y = (v: number) => H - pad - (v * (H - 2 * pad)) / max;
  return <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 90 }}><polyline fill="none" stroke={ca} strokeWidth={1.8} points={a.map((v, i) => `${x(i, a.length)},${y(v)}`).join(' ')} /><polyline fill="none" stroke={cb} strokeWidth={1.8} points={b.map((v, i) => `${x(i, b.length)},${y(v)}`).join(' ')} /></svg>;
}

const PLATFORM_CONTROLS = ['Enable or Disable Memberships by Plan', 'Create Reusable Membership Templates', 'Set Platform Membership Limits', 'Configure Allowed Membership Rules'];
const TENANT_OVERSIGHT = ['Review Tenant Membership Programs', 'Review Recurring Billing Failures', 'Monitor Membership Revenue', 'Review Cancellation and Pause Activity', 'Correct Platform-Level Membership Errors', 'Review Duplicate Charges', 'Disable Abusive or Improperly Configured Programs', 'Enter Audited Support Mode'];
const QUICK_ACTIONS = ['Enable Memberships by Plan', 'Create Template', 'Set Platform Limits', 'Review Tenant Programs', 'Review Billing Failures', 'Monitor Revenue', 'Review Duplicate Charges', 'Support Mode', 'Export Membership Reports'];

export default function MembershipProgramsScreen() {
  const [ov, setOv] = useState<MembershipProgramsOverview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [modal, setModal] = useState<null | 'gating' | 'limits' | 'rules' | 'templates' | 'programs' | 'failures' | 'revenue' | 'cancellations' | 'duplicates' | 'correct' | 'disable' | 'suspicious' | 'support' | 'credits'>(null);
  const [support, setSupport] = useState<any | null>(null);
  const [membersStatus, setMembersStatus] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportReport, setExportReport] = useState('programs');
  const refreshSupport = () => membershipSupportApi.activeSession().then((d) => setSupport(d.session)).catch(() => {});
  const load = () => { setErr(null); membershipProgramsApi.overview().then((d) => { setOv(d as MembershipProgramsOverview); setLastRefreshed(new Date()); }).catch((e: any) => setErr(e?.message || 'Failed to load overview')); };
  useEffect(() => { load(); refreshSupport(); }, []);

  const doExport = async (report = exportReport) => {
    setExporting(true); setNotice(null);
    try {
      const { filename, csv } = await membershipExportApi.exportCsv({ report });
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
      const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      setNotice(`Exported ${filename} (audited, no card or customer-contact data).`);
    } catch (e: any) { setNotice(e?.message || 'Export failed'); }
    finally { setExporting(false); }
  };

  const k = ov?.kpis;
  // Route the control/action labels to their real modals; the rest open an informational notice pending later units.
  const act = (label: string) => {
    if (/enable or disable memberships by plan|enable memberships by plan/i.test(label)) return setModal('gating');
    if (/create reusable membership templates|create membership template|create template/i.test(label)) return setModal('templates');
    if (/set platform membership limits|set platform limits/i.test(label)) return setModal('limits');
    if (/configure allowed membership rules/i.test(label)) return setModal('rules');
    if (/review tenant membership programs|review tenant programs/i.test(label)) return setModal('programs');
    if (/review recurring billing failures|review billing failures/i.test(label)) return setModal('failures');
    if (/monitor membership revenue|monitor revenue/i.test(label)) return setModal('revenue');
    if (/review cancellation and pause activity/i.test(label)) return setModal('cancellations');
    if (/review duplicate charges/i.test(label)) return setModal('duplicates');
    if (/correct platform-level membership errors/i.test(label)) return setModal('correct');
    if (/disable abusive or improperly configured programs/i.test(label)) return setModal('disable');
    if (/suspicious or duplicate/i.test(label)) return setModal('suspicious');
    if (/support mode|audited support mode/i.test(label)) return setModal('support');
    if (/export report|export membership reports/i.test(label)) return doExport();
    setNotice(`"${label}" is wired to its backend in an upcoming unit.`);
  };
  const soon = act;
  // Each KPI drills into the most relevant view (spec §12: every KPI has a click-through).
  const kpiClick = (label: string) => {
    if (/Total Membership Programs|Tenant Participation|Branch Participation/.test(label)) return setModal('programs');
    if (/Active Members/.test(label)) return setMembersStatus('active');
    if (/Paused/.test(label)) return setMembersStatus('paused');
    if (/Cancelled/.test(label)) return setMembersStatus('cancelled');
    if (/Past-Due/.test(label)) return setMembersStatus('past_due');
    if (/Trial/.test(label)) return setMembersStatus('trial');
    if (/Monthly Recurring Revenue/.test(label)) return setModal('revenue');
    if (/Failed Recurring Payments/.test(label)) return setModal('failures');
    if (/Benefits Issued|Benefits Redeemed|Unused Service Credits|Expiring Credits/.test(label)) return setModal('credits');
    if (/Suspicious/.test(label)) return setModal('suspicious');
  };

  const kpis: { l: string; v: string; bg: string; key: string }[] = [
    { l: 'Total Membership Programs', v: k ? String(k.totalPrograms) : '—', bg: '#FBF1E3', key: 'totalPrograms' },
    { l: 'Active Members', v: k ? String(k.activeMembers) : '—', bg: '#F0EAF7', key: 'activeMembers' },
    { l: 'Paused Memberships', v: k ? String(k.pausedMembers) : '—', bg: '#FBF1E3', key: 'pausedMembers' },
    { l: 'Cancelled Memberships', v: k ? String(k.cancelledMembers) : '—', bg: '#FBEAEA', key: 'cancelledMembers' },
    { l: 'Past-Due Memberships', v: k ? String(k.pastDueMembers) : '—', bg: '#FBEAEA', key: 'pastDueMembers' },
    { l: 'Trial Memberships', v: k ? String(k.trialMembers) : '—', bg: '#E7EFF7', key: 'trialMembers' },
    { l: 'Monthly Recurring Revenue', v: k ? money(k.mrrCents) : '—', bg: '#E7F2EA', key: 'mrrCents' },
    { l: 'Failed Recurring Payments', v: k ? String(k.failedPayments) : '—', bg: '#FBEAEA', key: 'failedPayments' },
    { l: 'Membership Benefits Issued', v: k ? String(k.benefitsIssued) : '—', bg: '#E7EFF7', key: 'benefitsIssued' },
    { l: 'Benefits Redeemed', v: k ? String(k.benefitsRedeemed) : '—', bg: '#E7F2EA', key: 'benefitsRedeemed' },
    { l: 'Unused Service Credits', v: k ? String(k.unusedCredits) : '—', bg: '#FBF1E3', key: 'unusedCredits' },
    { l: 'Expiring Credits', v: k ? String(k.expiringCredits) : '—', bg: '#FBF1E3', key: 'expiringCredits' },
    { l: 'Tenant Participation', v: k ? `${k.tenantParticipation.active} / ${k.tenantParticipation.total}` : '—', bg: '#E7EFF7', key: 'tenantParticipation' },
    { l: 'Branch Participation', v: k ? `${k.branchParticipation.active} / ${k.branchParticipation.total}` : '—', bg: '#F0EAF7', key: 'branchParticipation' },
    { l: 'Suspicious or Duplicate', v: k ? String(k.suspiciousCount) : '—', bg: '#FBEAEA', key: 'suspiciousCount' },
  ];

  const mix = (ov?.programMix ?? []).map((m) => ({ label: m.type, value: m.count }));
  const status = (ov?.statusBreakdown ?? []).map((s) => ({ label: STATUS_LABEL[s.status] ?? s.status, value: s.count }));
  const totalMembers = (ov?.statusBreakdown ?? []).reduce((s, x) => s + x.count, 0);

  return (
    <div className="screen p-5">
      <div className="flex flex-col pb-3 xl:flex-row gap-3 justify-between">
        <div className="vh">
          <h1>Membership Programs <span style={{ color: 'var(--gold,#A96F22)' }}>★</span></h1>
          <div className="sub">Oversees membership functionality across all tenants and branches.</div>
        </div>
        <div className='flex flex-wrap gap-3 items-center '>
          {lastRefreshed && <span className="muted" style={{ fontSize: 10.5 }}>updated {lastRefreshed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</span>}
          <button className="font-bold" onClick={load} aria-label="Refresh">↻</button>
          <select className="finput" style={{ width: 150, height: 32 }} value={exportReport} onChange={(e) => setExportReport(e.target.value)} aria-label="Report to export">
            <option value="programs">Program Directory</option>
            <option value="billing-failures">Billing Failures</option>
            <option value="cancellations">Cancellations &amp; Pauses</option>
            <option value="revenue">Revenue by Tenant</option>
            <option value="suspicious">Suspicious Memberships</option>
          </select>
          <button className="btn ghost" disabled={exporting} onClick={() => doExport()}>⤓ {exporting ? 'Exporting…' : 'Export Report'}</button>
          <button className="btn" onClick={() => setModal('templates')}>+ Create Membership Template</button>
        </div>
      </div>

      {notice && <div style={{ margin: '0 0 10px', padding: '8px 12px', borderRadius: 9, background: '#FBF1E3', color: '#9A6114', border: '1px solid #EED9B8', fontSize: 12.5 }}>{notice} <button className="btn ghost" style={{ height: 22, marginLeft: 8 }} onClick={() => setNotice(null)}>Dismiss</button></div>}

      {support && (
        <div role="status" style={{ margin: '0 0 10px', padding: '8px 12px', borderRadius: 9, background: '#FDECEC', color: '#9B2C2C', border: '1px solid #F1C9C9', fontSize: 12.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>🔒 <strong>Audited Support Mode</strong> — accessing <strong>{support.tenant}</strong> · expires {new Date(support.expiresAt).toLocaleTimeString()} · reason: {support.reason}</span>
          <button className="btn ghost" style={{ height: 24 }} onClick={() => setModal('support')}>Manage</button>
        </div>
      )}

      {err ? <div className="state">Couldn’t load membership overview. <button className="btn ghost" onClick={load}>Retry</button></div> : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2.5">
          {kpis.map((c) => {
            const tr = ov?.kpiTrends?.[c.key];
            const tone = tr?.favorable == null ? 'var(--muted)' : tr.favorable ? '#2F6B43' : '#9B2C2C';
            const arrow = tr && tr.deltaPct != null && tr.deltaPct !== 0 ? (tr.deltaPct > 0 ? '▲' : '▼') : '';
            return (
              <div key={c.l} className="kpi" role="button" tabIndex={0} style={{ border: '1px solid var(--line)', background: '#fff', cursor: 'pointer' }} onClick={() => kpiClick(c.l)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); kpiClick(c.l); } }} aria-label={`${c.l}: ${c.v}${tr && tr.deltaPct != null ? `, ${tr.deltaPct}% ${tr.favorable == null ? '' : tr.favorable ? 'favorable' : 'unfavorable'}` : ''}`}>
                <div style={{ width: 24, height: 24, borderRadius: 999, background: c.bg, marginBottom: 6 }} />
                <div className="l">{c.l}</div><div className="v">{c.v}</div>
                {tr && tr.deltaPct != null && <div style={{ fontSize: 10.5, color: tone, marginTop: 2 }}>{arrow} {tr.deltaPct > 0 ? '+' : ''}{tr.deltaPct}% vs prior</div>}
              </div>
            );
          })}
        </div>
      )}

      {/* Platform controls + tenant oversight */}
      <div className="flex flex-col xl:flex-row gap-3 py-3">
        <div className="panel">
          <strong style={{ fontSize: 13 }}>Platform Membership Controls</strong>
          <div className="muted" style={{ fontSize: 11.5, marginBottom: 8 }}>Configure membership capabilities and reusable defaults across the platform.</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {PLATFORM_CONTROLS.map((a) => <button key={a} className="btn ghost" style={{ height: 52, fontSize: 11.5, textAlign: 'left', padding: '0 10px' }} onClick={() => soon(a)}>{a}</button>)}
          </div>
        </div>
        <div className="panel">
          <strong style={{ fontSize: 13 }}>Tenant Membership Oversight</strong>
          <div className="muted" style={{ fontSize: 11.5, marginBottom: 8 }}>Monitor tenant membership programs, recurring billing, and operational issues.</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {TENANT_OVERSIGHT.map((a) => <button key={a} className="btn ghost" style={{ height: 44, fontSize: 11, textAlign: 'left', padding: '0 10px' }} onClick={() => soon(a)}>{a}</button>)}
          </div>
        </div>
      </div>

      {/* Analytics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 2xl:grid-cols-4 ">
        <div className="panel"><strong style={{ fontSize: 12.5 }}>Membership Revenue Trend</strong><div style={{ marginTop: 8 }}><Line points={(ov?.revenueTrend ?? []).map((r) => r.cents / 100)} /></div></div>
        <div className="panel"><strong style={{ fontSize: 12.5 }}>Members vs Benefits Redeemed</strong><div style={{ marginTop: 8 }}><DualLine a={(ov?.membersVsRedeemed ?? []).map((r) => r.members)} b={(ov?.membersVsRedeemed ?? []).map((r) => r.redeemed)} /></div><div className="muted" style={{ fontSize: 10.5, marginTop: 4 }}>Members vs Redeemed (last 7 days)</div></div>
        <div className="panel"><strong style={{ fontSize: 12.5 }}>Program Mix by Type</strong><div style={{ marginTop: 8 }}><Donut data={mix} centerLabel={`${k?.totalPrograms ?? 0} Total`} /></div></div>
        <div className="panel"><strong style={{ fontSize: 12.5 }}>Recurring Billing Status</strong><div style={{ marginTop: 8 }}><Donut data={status} centerLabel={`${totalMembers} Members`} /></div></div>
      </div>

      {/* Top programs + tenant performance */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
        <div className="panel">
          <strong style={{ fontSize: 12.5 }}>Top Membership Programs This Week</strong>
          <table className="tgrid" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5, marginTop: 8 }}>
            <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10 }}><th>Program</th><th>Type</th><th>Members</th><th>Price</th><th>Benefits</th><th>Redemption</th><th>Revenue</th><th>Status</th></tr></thead>
            <tbody>{(ov?.topPrograms ?? []).map((p) => (<tr key={p.planId} style={{ borderTop: '1px solid var(--line)' }}><td>{p.name}</td><td>{p.type}</td><td>{p.activeMembers}</td><td>{money(p.priceCents)}</td><td>{p.includedBenefits}</td><td>{p.redemptionRatePct}%</td><td>{money(p.revenueCents)}</td><td><Badge text="Active" tone={STATUS_TONE.active} /></td></tr>))}</tbody>
          </table>
          {(ov?.topPrograms ?? []).length === 0 && <div className="state">No programs yet.</div>}
        </div>
        <div className="panel">
          <strong style={{ fontSize: 12.5 }}>Program Performance by Tenant</strong>
          <table className="tgrid" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5, marginTop: 8 }}>
            <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10 }}><th>Tenant</th><th>Programs</th><th>Members</th><th>MRR</th><th>Failures</th><th>Pause %</th><th>Status</th></tr></thead>
            <tbody>{(ov?.tenantPerformance ?? []).map((t) => (<tr key={t.tenantId} style={{ borderTop: '1px solid var(--line)' }}><td>{t.tenant}</td><td>{t.activePrograms}</td><td>{t.members}</td><td>{money(t.mrrCents)}</td><td>{t.billingFailures}</td><td>{t.pauseRatePct}%</td><td><Badge text={t.status} tone={perfTone(t.status)} /></td></tr>))}</tbody>
          </table>
          {(ov?.tenantPerformance ?? []).length === 0 && <div className="state">No tenant participation yet.</div>}
        </div>
      </div>

      {/* Billing failures & duplicate charges */}
      <div className="panel" style={{ marginTop: 12 }}>
        <strong style={{ fontSize: 12.5 }}>Recurring Billing Failures &amp; Duplicate Charges</strong>
        <table className="tgrid" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5, marginTop: 8 }}>
          <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10 }}><th>Tenant / Program</th><th>Issue</th><th>Severity</th><th>Status</th><th>When</th></tr></thead>
          <tbody>{(ov?.billingFailures ?? []).map((f, i) => (<tr key={i} style={{ borderTop: '1px solid var(--line)' }}><td>{f.tenantProgram}</td><td>{f.issue}</td><td><Badge text={f.severity} tone={sevTone(f.severity)} /></td><td>{f.status}</td><td>{f.at ? new Date(f.at).toLocaleDateString() : '—'}</td></tr>))}</tbody>
        </table>
        {(ov?.billingFailures ?? []).length === 0 && <div className="state">No billing failures.</div>}
      </div>

      {/* Quick actions */}
      <div className="panel" style={{ marginTop: 12 }}>
        <strong style={{ fontSize: 13 }}>Quick Actions</strong>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-9 gap-2 mt-2">
          {QUICK_ACTIONS.map((a) => <button key={a} className="btn ghost" style={{ height: 52, fontSize: 10.5, textAlign: 'center', lineHeight: 1.2 }} onClick={() => soon(a)}>{a}</button>)}
        </div>
      </div>

      {/* Governance cards */}
      <div className="grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 gap-3 mt-3">
        <div className="panel">
          <strong style={{ fontSize: 12.5 }}>Membership Programs vs Loyalty Programs</strong>
          <div style={{ fontSize: 11.5, marginTop: 6, display: 'grid', gap: 6 }}>
            <div><strong>Membership:</strong> customer pays a recurring fee (e.g. $49/mo, one included manicure, 10% product discount, priority booking, monthly service credit).</div>
            <div><strong>Loyalty:</strong> customer earns points from visits/spending (1 point per dollar, reward at 500 points, Silver→Gold tier, birthday reward).</div>
            <div className="muted">A customer can have both a membership and a loyalty account.</div>
          </div>
        </div>
        <div className="panel">
          <strong style={{ fontSize: 12.5 }}>Membership Programs vs Billing &amp; Subscriptions</strong>
          <div style={{ fontSize: 11.5, marginTop: 6, display: 'grid', gap: 6 }}>
            <div>Billing &amp; Subscriptions manages what salon <strong>tenants pay AI PowerSalon</strong>.</div>
            <div>Membership Programs manages what salon <strong>customers pay the salon</strong> for recurring services and benefits.</div>
            <div className='flex flex-wrap gap-2 '><Badge text="Billing: Salon → AI PowerSalon" tone={['#E7EFF7', '#2B5E8C']} /><Badge text="Membership: Customer → Salon" tone={['#FBF1E3', '#9A6114']} /></div>
          </div>
        </div>
        <div className="panel">
          <strong style={{ fontSize: 12.5 }}>Super Admin vs Tenant Salon POS</strong>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 11, marginTop: 6 }}>
            <div><div className="muted" style={{ fontSize: 10.5 }}>Super Admin</div>Enables the feature · creates templates · monitors all tenants · reviews billing failures · technical support · detects suspicious activity · controls platform rules.</div>
            <div><div className="muted" style={{ fontSize: 10.5 }}>Tenant Salon POS</div>Creates actual plans · sets price · selects services · enrolls customers · pauses/cancels · redeems benefits · handles requests.</div>
          </div>
        </div>
      </div>

      {/* At-a-glance */}
      <div className="panel !mb-6 " style={{ marginTop: 12 }}>
        <strong style={{ fontSize: 12.5 }}>At-a-Glance Summary (Today)</strong>
        <div className='grid grid-cols-2 sm:grid-cols-3  lg-grid-cols-4 xl:grid-cols-6  gap-3 mt-3'>
          {ov && [
            ['New Members Today', String(ov.atAGlance.newMembersToday)],
            ['Membership Revenue Today', money(ov.atAGlance.revenueTodayCents)],
            ['Failed Payments Today', String(ov.atAGlance.failedPaymentsToday)],
            ['Benefits Redeemed Today', String(ov.atAGlance.benefitsRedeemedToday)],
            ['Expiring Credits Today', String(ov.atAGlance.expiringCreditsToday)],
            ['Support Cases Open', String(ov.atAGlance.supportCasesOpen)],
          ].map(([l, v]) => <div key={l} style={{ border: '1px solid var(--line)', borderRadius: 9, padding: 8 }}><div className="muted" style={{ fontSize: 10.5 }}>{l}</div><div style={{ fontSize: 16, fontWeight: 700 }}>{v}</div></div>)}
        </div>
      </div>

      {modal === 'gating' && <PlanGatingModal onClose={() => setModal(null)} onChanged={load} />}
      {modal === 'limits' && <PlatformLimitsModal onClose={() => setModal(null)} onChanged={load} />}
      {modal === 'rules' && <AllowedRulesModal onClose={() => setModal(null)} onChanged={load} />}
      {modal === 'templates' && <TemplatesModal onClose={() => setModal(null)} onChanged={load} />}
      {modal === 'programs' && <ReviewProgramsModal onClose={() => setModal(null)} />}
      {modal === 'failures' && <BillingFailuresModal onClose={() => setModal(null)} />}
      {modal === 'revenue' && <RevenueModal onClose={() => setModal(null)} />}
      {modal === 'cancellations' && <CancellationsModal onClose={() => setModal(null)} />}
      {modal === 'duplicates' && <DuplicateChargesModal onClose={() => setModal(null)} />}
      {modal === 'correct' && <CorrectErrorsModal onClose={() => setModal(null)} />}
      {modal === 'disable' && <DisableProgramModal onClose={() => setModal(null)} onChanged={load} />}
      {modal === 'suspicious' && <SuspiciousModal onClose={() => setModal(null)} />}
      {modal === 'support' && <SupportModeModal onClose={() => setModal(null)} onChanged={refreshSupport} />}
      {modal === 'credits' && <CreditsModal onClose={() => setModal(null)} />}
      {membersStatus && <MembersModal status={membersStatus} onClose={() => setMembersStatus(null)} />}
    </div>
  );
}
