import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { superAdminBillingApi, type BillingSubscriptionsOverviewResponse } from '../api/superAdminBillingApi';
import { Donut, money, moneyK, dd } from './_chartkit';
import { CreateInvoiceModal, ApplyCreditModal, RetryPaymentModal, ChangePlanModal, AddOnModal, ExtendTrialModal, PromoModal, PauseModal, CancelModal, ExportModal, BillingDrillModal, TenantProfileModal } from './BillingModals';
import { billingLifecycleApi } from '../api/superAdminBillingApi';

// BillingScreen — Super Admin → System Settings → Billing & Subscriptions. SOFTWARE subscription billing
// (tenant → AI PowerSalon). Merchant card transactions belong under Payments & Revenue and never appear here.
// Read surface wired to /super-admin/billing/subscriptions-overview; write workflows (create invoice, credits,
// retries, plan changes, …) open informational notices until their unit lands. Money is integer cents; catalogs
// are canonical (subscription_plans / plan_add_ons).

const PLAN_INCLUDED: Record<string, string> = {
  starter: '1 Location, 2 Users, Basic Features', professional: '2 Locations, 5 Users, Pro Features',
  growth: '3 Locations, 5 Users, Advanced Features', premium: 'Unlimited Locations, 15 Users, Premium Features',
  enterprise: 'Unlimited Everything, Priority Support', unlimited: 'Unlimited Everything, Dedicated Support',
};
const statusTone = (s: string) => /paid|active|recovered/i.test(s) ? '#2F6B43' : /past.?due|failed|cancel/i.test(s) ? '#9B2C2C' : /trial|open|pending|upcoming/i.test(s) ? '#B7791F' : 'var(--muted)';

const CONTROLS: [string, string][] = [
  ['Create Invoices', 'Generate new invoices for tenants.'], ['Apply Credits', 'Apply account credits to invoices.'],
  ['Retry Failed Payments', 'Retry failed or declined payments.'], ['Change Plans', 'Upgrade, downgrade, or switch plans.'],
  ['Add or Remove Add-Ons', 'Manage add-ons for tenants.'], ['Extend Trials', 'Extend trial periods for tenants.'],
  ['Apply Promotional Pricing', 'Apply discounts or promotional pricing.'], ['Pause Subscriptions', 'Temporarily pause subscriptions.'],
  ['Cancel Subscriptions', 'Cancel active subscriptions.'], ['Review Billing History', 'View tenant billing activity.'],
  ['Export Accounting Reports', 'Export invoices and recurring-revenue reports.'],
];
const QUICK = ['Create Invoice', 'Retry Payment', 'Apply Credit', 'Change Plan', 'Extend Trial', 'Export Report', 'Open Tenant Billing Profile'];

export function BillingScreen() {
  const [ov, setOv] = useState<BillingSubscriptionsOverviewResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [drill, setDrill] = useState<string | null>(null);
  const [profileTenant, setProfileTenant] = useState<string | null>(null);
  const [modal, setModal] = useState<null | 'create-invoice' | 'apply-credit' | 'retry' | 'change-plan' | 'addon' | 'extend-trial' | 'promo' | 'pause' | 'resume' | 'cancel' | 'export'>(null);
  const nav = useNavigate();
  const load = () => { setErr(null); superAdminBillingApi.overview().then(setOv).catch((e: any) => setErr(e?.message || 'Failed to load billing overview')); };
  useEffect(load, []);

  const modalFor: Record<string, 'create-invoice' | 'apply-credit' | 'retry' | 'change-plan' | 'addon' | 'extend-trial' | 'promo' | 'pause' | 'cancel' | 'export'> = {
    'Create Invoices': 'create-invoice', 'Create Invoice': 'create-invoice',
    'Apply Credits': 'apply-credit', 'Apply Credit': 'apply-credit',
    'Retry Failed Payments': 'retry', 'Retry Payment': 'retry',
    'Change Plans': 'change-plan', 'Change Plan': 'change-plan',
    'Add or Remove Add-Ons': 'addon', 'Extend Trials': 'extend-trial', 'Extend Trial': 'extend-trial',
    'Apply Promotional Pricing': 'promo',
    'Pause Subscriptions': 'pause', 'Cancel Subscriptions': 'cancel',
    'Export Accounting Report': 'export', 'Export Accounting Reports': 'export', 'Export Report': 'export',
  };
  const openProfileQuick = () => { if (ov?.tenantOverview[0]) setProfileTenant(ov.tenantOverview[0].tenantId); };
  const soon = (label: string) => setNotice(`${label} — this workflow is being wired in an upcoming unit. No changes were made.`);
  const act = (label: string) => { if (label === 'Open Tenant Billing Profile') { openProfileQuick(); return; } const m = modalFor[label]; if (m === 'export') { setNotice(null); setModal('export'); return; } if (m && ov) { setNotice(null); setModal(m); } else soon(label); };
  const done = (msg: string) => { setModal(null); setNotice(msg); load(); };
  const review = async (changeId: string, decision: 'approve' | 'reject') => {
    try { await billingLifecycleApi.reviewRequest(changeId, { decision }); setNotice(`Request ${decision === 'approve' ? 'approved' : 'rejected'}.`); load(); }
    catch (e: any) { setNotice(e?.message || 'Could not review request'); }
  };

  const k = ov?.kpis;
  const kpis: { l: string; v: string; sub?: string; tone?: string; key: string; drill?: string }[] = [
    { l: 'Active Subscriptions', v: k ? String(k.activeSubscriptions) : '—', key: 'activeSubscriptions', drill: 'active' },
    { l: 'Trial Accounts', v: k ? String(k.trialAccounts) : '—', key: 'trialAccounts', drill: 'trialing' },
    { l: 'Past-Due Accounts', v: k ? String(k.pastDueAccounts) : '—', tone: '#9B2C2C', key: 'pastDueAccounts', drill: 'past_due' },
    { l: 'Failed Payments', v: k ? String(k.failedPayments) : '—', tone: '#9B2C2C', key: 'failedPayments', drill: 'failed' },
    { l: 'Invoices', v: k ? String(k.invoices) : '—', key: 'invoices', drill: 'invoices' },
    { l: 'Credits Issued', v: k ? money(k.creditsIssuedCents) : '—', key: 'creditsIssuedCents' },
    { l: 'Discounts Applied', v: k ? money(k.discountsAppliedCents) : '—', key: 'discountsAppliedCents' },
    { l: 'Add-Ons Active', v: k ? String(k.addOnsActive) : '—', key: 'addOnsActive' },
    { l: 'Subscription Changes', v: k ? String(k.subscriptionChanges) : '—', key: 'subscriptionChanges', drill: 'changes' },
    { l: 'Cancellation Requests', v: k ? String(k.cancellationRequests) : '—', tone: '#B7791F', key: 'cancellationRequests', drill: 'changes' },
    { l: 'Upcoming Renewals', v: k ? String(k.upcomingRenewals) : '—', sub: 'Next 7 days', key: 'upcomingRenewals', drill: 'renewals' },
    { l: 'Monthly Recurring Revenue', v: k ? money(k.mrrCents) : '—', tone: '#2F6B43', key: 'mrrCents' },
  ];
  const glance = ov?.atAGlance;
  const glanceCards: { l: string; v: string; sub?: string }[] = [
    { l: 'New Invoices Today', v: glance ? String(glance.newInvoicesToday) : '—' },
    { l: 'Payments Recovered', v: glance ? money(glance.paymentsRecoveredCents) : '—' },
    { l: 'Credits Applied Today', v: glance ? money(glance.creditsAppliedTodayCents) : '—' },
    { l: 'Plan Changes Today', v: glance ? String(glance.planChangesToday) : '—' },
    { l: 'Trials Extended', v: glance ? String(glance.trialsExtended) : '—' },
    { l: 'Renewals Due', v: glance ? String(glance.renewalsDue) : '—', sub: 'Next 7 days' },
  ];

  if (err && !ov) return <div className="screen"><div className="phead"><div className="vh"><h1>Billing &amp; Subscriptions</h1></div></div><div className="state" style={{ color: '#9B2C2C' }}>{err} <button className="btn ghost" onClick={load}>Retry</button></div></div>;

  return (
    <div className="work">
      <div className="mb-3 flex flex-col lg:flex-row justify-between gap-3">
        <div className="vh"><h1>Billing &amp; Subscriptions <span style={{ color: 'var(--gold)' }}>★</span></h1>
          <div className="sub">Manages what tenants owe AI PowerSalon for software subscriptions and add-ons.</div></div>
        <div className='flex-wrap items-baseline ' style={{ display: 'flex', gap: 8 }}>
          <button className="btn ghost" onClick={() => act('Export Accounting Report')}>⤓ Export Accounting Report</button>
          <button className="btn" onClick={() => act('Create Invoice')}>+ Create Invoice</button>
        </div>
      </div>

      <div role="note" style={{ display: 'flex', gap: 8, alignItems: 'center', background: '#EAF2FB', border: '1px solid #B9D3EE', color: '#25507D', borderRadius: 8, padding: '8px 12px', fontSize: 12.5, marginBottom: 12 }}>
        <span aria-hidden>ⓘ</span> This module manages software subscription billing. Merchant card transactions belong under Payments &amp; Revenue.
      </div>

      {notice && <div className="state" style={{ background: '#FBF6EC', border: '1px solid var(--line)', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 12.5 }}>{notice} <button className="linklike" onClick={() => setNotice(null)}>dismiss</button></div>}

      <div className=" grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2.5 mb-3.5">
        {kpis.map((c) => {
          const tr = ov?.kpiTrends?.[c.key];
          const ttone = tr?.favorable == null ? 'var(--muted)' : tr.favorable ? '#2F6B43' : '#9B2C2C';
          const arrow = tr && tr.deltaPct != null && tr.deltaPct !== 0 ? (tr.deltaPct > 0 ? '▲' : '▼') : '';
          const clickable = !!(c.drill && ov);
          return (
            <div key={c.l} className="kpi" role={clickable ? 'button' : undefined} tabIndex={clickable ? 0 : undefined}
              style={{ border: '1px solid var(--line)', background: '#fff', cursor: clickable ? 'pointer' : 'default' }}
              onClick={clickable ? () => setDrill(c.drill!) : undefined}
              onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDrill(c.drill!); } } : undefined}
              aria-label={`${c.l}: ${c.v}${tr && tr.deltaPct != null ? `, ${tr.deltaPct}% ${tr.favorable == null ? '' : tr.favorable ? 'favorable' : 'unfavorable'}` : ''}`}>
              <div className="l">{c.l}</div>
              <div className="v" style={c.tone ? { color: c.tone } : undefined}>{c.v}</div>
              {tr && tr.deltaPct != null ? <div style={{ fontSize: 10.5, color: ttone }}>{arrow} {tr.deltaPct > 0 ? '+' : ''}{tr.deltaPct}% vs prior</div> : (c.sub && <div className="muted" style={{ fontSize: 10.5 }}>{c.sub}</div>)}
            </div>
          );
        })}
      </div>

      {/* Filters */}
      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="flex flex-wrap items-end gap-2.5">
          {[['Tenant', 'All Tenants'], ['Plan', 'All Plans'], ['Billing Status', 'All Statuses'], ['Add-On Type', 'All Add-Ons']].map(([lab, ph]) => (
            <label key={lab} className="flabel font-semibold border border-[var(--line)] p-2 rounded-md">{lab}<select className="finput font-normal" defaultValue=""><option value="">{ph}</option></select></label>
          ))}
          <label className="flabel font-semibold border border-[var(--line)] p-2 rounded-md">Date Range: <input className="finput  whitespace-nowrap font-normal" type="text" readOnly disabled title="The subscriptions overview covers every billing period — a date filter is not available yet" value="All dates" /></label>
          <button className="btn !min-h-[35px] !h-[40px]" onClick={() => soon('Apply Filters')}>Apply Filters</button>
          <button className="btn ghost !min-h-[35px] !h-[40px]" onClick={load}>Reset Filters</button>
        </div>
      </div>

      {/* Billing Controls */}
      <div className="panel" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <strong>Billing Controls</strong>
          <button className="linklike" onClick={() => nav('/plans')}>Manage Plans →</button>
        </div>
        <div className=" grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2.5 mb-3.5">
          {CONTROLS.map(([title, desc]) => (
            <button key={title} className="kpi" style={{ textAlign: 'left', border: '1px solid var(--line)', background: '#fff', cursor: 'pointer' }} onClick={() => act(title)}>
              <div style={{ fontWeight: 600, fontSize: 12 }}>{title}</div>
              <div className="muted" style={{ fontSize: 10.5, marginTop: 2 }}>{desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Subscription Plans & Add-Ons (canonical catalog) */}
      <div className="panel" style={{ marginBottom: 14 }}>
        <strong>Subscription Plans &amp; Add-Ons</strong>
        <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-4 mt-2">
          <div className="rounded-[10px] border border-[var(--line)] bg-[#FFFDF8] p-3.5 overflow-hidden">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div>
                <div className="text-xs font-semibold text-[var(--text)]">
                  Plans
                </div>
                <div className="text-[10px] muted mt-0.5">
                  Software Subscriptions
                </div>
              </div>
              <span className="pill">
                {(ov?.planCatalog ?? []).length} Plans
              </span>
            </div>
            <div className="w-full overflow-x-auto">
              <table className=" w-full min-w-[520px] text-[11.5px] border-collapse">
                <thead>
                  <tr className="text-left text-[var(--muted)] border-b border-[var(--line)]">
                    <th className="py-2 px-2 font-semibold">Plan</th>
                    <th className="py-2 px-2 font-semibold whitespace-nowrap">
                      Monthly Price
                    </th>
                    <th className="py-2 px-2 font-semibold">Included</th>
                    <th className="py-2 px-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(ov?.planCatalog ?? []).map((p) => (
                    <tr
                      key={p.code}
                      className="border-b border-[var(--line)] last:border-b-0"
                    >
                      <td className="py-2.5 px-2 font-medium capitalize">
                        {p.name}
                      </td>
                      <td className="py-2.5 px-2 whitespace-nowrap font-semibold">
                        {money(p.monthlyPriceCents)}
                      </td>
                      <td className="py-2.5 px-2 muted">
                        {PLAN_INCLUDED[p.code] ?? '—'}
                      </td>
                      <td
                        className="py-2.5 px-2 capitalize font-medium"
                        style={{ color: statusTone(p.status) }}
                      >
                        {p.status}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="rounded-[10px] border border-[var(--line)] bg-[#FFFDF8] p-3.5 overflow-hidden">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div>
                <div className="text-xs font-semibold text-[var(--text)]">
                  Add-Ons
                </div>
                <div className="text-[10px] muted mt-0.5">
                  Optional Services
                </div>
              </div>
              <span className="pill">
                {(ov?.addOnCatalog ?? []).length} Add-Ons
              </span>
            </div>
            <div className="w-full overflow-x-auto">
              <table className=" w-full min-w-[420px] text-[11.5px] border-collapse">
                <thead>
                  <tr className="text-left text-[var(--muted)] border-b border-[var(--line)]">
                    <th className="py-2 px-2 font-semibold">Add-On</th>
                    <th className="py-2 px-2 font-semibold whitespace-nowrap">
                      Monthly Price
                    </th>
                    <th className="py-2 px-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(ov?.addOnCatalog ?? []).map((a) => (
                    <tr
                      key={a.code}
                      className="border-b border-[var(--line)] last:border-b-0"
                    >
                      <td className="py-2.5 px-2 font-medium">
                        {a.name}
                      </td>
                      <td className="py-2.5 px-2 whitespace-nowrap font-semibold">
                        {money(a.monthlyPriceCents)}
                      </td>
                      <td
                        className="py-2.5 px-2 capitalize font-medium"
                        style={{ color: statusTone(a.status) }}
                      >
                        {a.status}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Analytics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3.5 mb-3.5">
        <div className="panel"><strong style={{ fontSize: 12.5 }}>Subscription Revenue Trend</strong>
          <div style={{ fontSize: 18, fontWeight: 700, margin: '4px 0' }}>{ov ? money(k!.mrrCents) : '—'}</div>
          <MiniLine points={(ov?.revenueTrend ?? []).map((r) => r.cents)} />
          {ov && ov.revenueTrend.length === 0 && <div className="muted" style={{ fontSize: 11 }}>No paid invoices in the last 7 days.</div>}
        </div>
        <div className="panel"><strong style={{ fontSize: 12.5 }}>Plan Distribution</strong>
          <Donut data={(ov?.planDistribution ?? []).map((p) => ({ label: p.plan, value: p.count }))} centerLabel={ov ? String(ov.planDistribution.reduce((s, p) => s + p.count, 0)) : ''} />
        </div>
        <div className="panel"><strong style={{ fontSize: 12.5 }}>Billing Status Breakdown</strong>
          <Donut data={(ov?.billingStatusBreakdown ?? []).map((s) => ({ label: s.status, value: s.count }))} centerLabel={ov ? String(ov.kpis.invoices) : ''} />
        </div>
        <div className="panel"><strong style={{ fontSize: 12.5 }}>Add-On Revenue Mix</strong>
          <Donut data={(ov?.addOnRevenueMix ?? []).map((a) => ({ label: a.addOn, value: a.cents }))} centerLabel={ov ? moneyK(ov.addOnRevenueMix.reduce((s, a) => s + a.cents, 0)) : ''} />
        </div>
        <div className="panel"><strong style={{ fontSize: 12.5 }}>Trial to Paid Conversion</strong>
          {ov ? (ov.trialConversion.denominator === 0 ? <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>No trial cohort has reached a conversion decision yet.</div>
            : <div style={{ marginTop: 6 }}><div style={{ fontSize: 20, fontWeight: 700 }}>{ov.trialConversion.rate}%</div><div className="muted" style={{ fontSize: 11 }}>{ov.trialConversion.numerator} converted of {ov.trialConversion.denominator} eligible trials</div></div>)
            : <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>Loading…</div>}
        </div>
        <div className="panel"><strong style={{ fontSize: 12.5 }}>Failed vs Recovered Payments</strong>
          {ov ? <div style={{ marginTop: 6 }}>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{ov.failedVsRecovered.recoveredRate}% <span className="muted" style={{ fontSize: 11, fontWeight: 400 }}>recovered</span></div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', height: 60, marginTop: 6 }}>
              {ov.failedVsRecovered.weekly.map((w) => { const m = Math.max(1, ...ov.failedVsRecovered.weekly.flatMap((x) => [x.failed, x.recovered])); return (
                <div key={w.week} style={{ flex: 1, textAlign: 'center' }} title={`${w.week}: ${w.failed} failed, ${w.recovered} recovered`}>
                  <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', justifyContent: 'center', height: 44 }}>
                    <div style={{ width: 8, height: `${(w.failed / m) * 44}px`, background: '#9B2C2C' }} />
                    <div style={{ width: 8, height: `${(w.recovered / m) * 44}px`, background: '#2F6B43' }} />
                  </div>
                  <div className="muted" style={{ fontSize: 9 }}>{w.week.replace('Week ', 'W')}</div>
                </div>); })}
            </div>
            <div className="muted" style={{ fontSize: 10 }}>Recovered payments link to a prior failed obligation.</div>
          </div> : <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>Loading…</div>}
        </div>
      </div>

      {/* Tenant Subscription Overview */}
      <Table title="Tenant Subscription Overview" cols={['Tenant', 'Current Plan', 'Add-Ons', 'Billing Status', 'Renewal Date', 'Monthly Amount', 'Credits', 'State', '']}
        rows={(ov?.tenantOverview ?? []).map((t) => [<button className="linklike" onClick={() => setProfileTenant(t.tenantId)}>{t.tenant}</button>, cap(t.plan), String(t.addOns), badge(t.billingStatus), dd(t.renewalDate), money(t.monthlyCents), money(t.creditsCents), badge(t.state),
          t.state === 'paused' ? <button className="linklike" onClick={() => setModal('resume')}>Resume</button> : <span className="muted">—</span>])} empty={ov ? 'No tenant subscriptions.' : ''} />

      {/* Invoices & Failed Payments */}
      <Table title="Invoices & Failed Payments" cols={['Invoice ID', 'Tenant', 'Amount', 'Due Date', 'Payment Status', 'Retry Status', 'Last Action']}
        rows={(ov?.invoices ?? []).map((i) => [i.invoiceNumber, i.tenant, money(i.amountCents), dd(i.dueDate), badge(i.status), i.retryStatus ?? '—', i.lastAction ?? '—'])} empty={ov ? 'No invoices.' : ''} />

      {/* Changes & Cancellations + Upcoming Renewals side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
        <Table title="Subscription Changes & Cancellation Requests" cols={['Tenant', 'Requested Change', 'Effective', 'Reason', 'Status', 'Review']}
          rows={(ov?.changes ?? []).map((c) => [c.tenant, c.requested, dd(c.effectiveAt), c.reason ?? '—', badge(c.status),
            c.status === 'pending'
              ? <span style={{ display: 'flex', gap: 6 }}><button className="linklike" onClick={() => review(c.changeId, 'approve')}>Approve</button><button className="linklike" style={{ color: '#9B2C2C' }} onClick={() => review(c.changeId, 'reject')}>Reject</button></span>
              : <span className="muted">—</span>])} empty={ov ? 'No pending changes.' : ''} />
        <Table title="Upcoming Renewals" cols={['Tenant', 'Plan', 'Renewal Date', 'Amount', 'Auto-Renew', 'Status']}
          rows={(ov?.upcomingRenewals ?? []).map((r) => [r.tenant, cap(r.plan), dd(r.renewalDate), money(r.amountCents), r.autoRenew ? 'ON' : 'OFF', badge(r.status)])} empty={ov ? 'No renewals scheduled.' : ''} />
      </div>

      {/* Billing History / Recent Activity */}
      <Table title="Billing History / Recent Activity" cols={['Time', 'Tenant', 'Action', 'Details', 'Amount']}
        rows={(ov?.recentActivity ?? []).map((a) => [new Date(a.at).toLocaleString(), a.tenant, a.action, a.details, a.amountCents == null ? '—' : money(a.amountCents)])} empty={ov ? 'No recent activity.' : ''} />

      {/* Quick Actions */}
      <div className="panel" style={{ marginTop: 14 }}>
        <strong>Quick Actions</strong>
        <div className=" grid  grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2.5 mt-3">
          {QUICK.map((q) => (<button key={q} className="kpi" style={{ textAlign: 'center', border: '1px solid var(--line)', background: '#fff', cursor: 'pointer', fontSize: 11.5 }} onClick={() => act(q)}>{q}</button>))}
        </div>
      </div>

      {/* At-a-Glance */}
      <div className="panel" style={{ marginTop: 14 }}>
        <strong>At-a-Glance Summary (Today)</strong>
        <div className=" grid  grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2.5 mt-3">
          {glanceCards.map((c) => (
            <div key={c.l} className="kpi" style={{ border: '1px solid var(--line)', background: '#fff' }}>
              <div className="l">{c.l}</div><div className="v">{c.v}</div>{c.sub && <div className="muted" style={{ fontSize: 10.5 }}>{c.sub}</div>}
            </div>
          ))}
        </div>
      </div>
      {ov && modal === 'create-invoice' && <CreateInvoiceModal ov={ov} onClose={() => setModal(null)} onDone={done} />}
      {ov && modal === 'apply-credit' && <ApplyCreditModal ov={ov} onClose={() => setModal(null)} onDone={done} />}
      {ov && modal === 'retry' && <RetryPaymentModal ov={ov} onClose={() => setModal(null)} onDone={done} />}
      {ov && modal === 'change-plan' && <ChangePlanModal ov={ov} onClose={() => setModal(null)} onDone={done} />}
      {ov && modal === 'addon' && <AddOnModal ov={ov} onClose={() => setModal(null)} onDone={done} />}
      {ov && modal === 'extend-trial' && <ExtendTrialModal ov={ov} onClose={() => setModal(null)} onDone={done} />}
      {ov && modal === 'promo' && <PromoModal ov={ov} onClose={() => setModal(null)} onDone={done} />}
      {ov && modal === 'pause' && <PauseModal ov={ov} mode="pause" onClose={() => setModal(null)} onDone={done} />}
      {ov && modal === 'resume' && <PauseModal ov={ov} mode="resume" onClose={() => setModal(null)} onDone={done} />}
      {ov && modal === 'cancel' && <CancelModal ov={ov} onClose={() => setModal(null)} onDone={done} />}
      {modal === 'export' && <ExportModal onClose={() => setModal(null)} onDone={done} />}
      {profileTenant && <TenantProfileModal tenantId={profileTenant} onClose={() => setProfileTenant(null)} />}
      {ov && drill && <BillingDrillModal ov={ov} drill={drill} onClose={() => setDrill(null)} />}
    </div>
  );
}

function cap(s: string | null) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : '—'; }
function badge(s: string) { return <span style={{ color: statusTone(s), textTransform: 'capitalize', fontWeight: 600 }}>{s.replace(/_/g, ' ')}</span>; }

function Table({ title, cols, rows, empty }: { title: string; cols: string[]; rows: (string | JSX.Element)[][]; empty: string }) {
  return (
    <div className="panel" style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        {/* Jul 28, 2026: this read "View All" — a link-looking span with no target, on tables that already render
            every row the API returned. It promised more data that does not exist. An accurate count instead. */}
        <strong style={{ fontSize: 12.5 }}>{title}</strong><span className="muted" style={{ fontSize: 11 }}>{rows.length ? `${rows.length} shown` : ''}</span>
      </div>
      {rows.length === 0 ? <div className="state muted" style={{ fontSize: 11.5 }}>{empty || 'Loading…'}</div> : (
        <div className="w-full overflow-x-auto">
          <table
            className="w-full min-w-[600px] text-[11.5px] border-collapse"
          >
            <thead><tr style={{ textAlign: 'left', color: 'var(--muted)' }}>{cols.map((c) => <th key={c} style={{ padding: '4px 6px' }}>{c}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => (<tr key={i} style={{ borderTop: '1px solid var(--line)' }}>{r.map((cell, j) => <td key={j} style={{ padding: '5px 6px' }}>{cell}</td>)}</tr>))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MiniLine({ points }: { points: number[] }) {
  if (points.length < 2) return <div style={{ height: 90 }} />;
  const max = Math.max(1, ...points), min = Math.min(...points);
  const w = 260, h = 90, span = max - min || 1;
  const pts = points.map((p, i) => `${(i / (points.length - 1)) * w},${h - ((p - min) / span) * (h - 10) - 5}`).join(' ');
  return <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 90 }}><polyline points={pts} fill="none" stroke="var(--gold)" strokeWidth={2} /></svg>;
}
