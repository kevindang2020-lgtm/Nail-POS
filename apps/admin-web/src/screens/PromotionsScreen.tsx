import { useEffect, useMemo, useState } from 'react';
import { superAdminApi } from '../api/superAdminApi';
import { Donut, money, dt, NotConnected } from './_chartkit';

// PromotionsScreen.tsx — Super Admin › Business Management › Promotions & Offers. Platform-level promotion oversight.
// The real source is the marketing `campaigns` table (there is no dedicated promotions/redemption/abuse/template
// schema), so widgets that HAVE a source show real data and the rest render an honest "Not connected". No fabrication.
// Redemptions = campaign-attributed bookings; Revenue Impact = gross attributed campaign revenue (documented labels).

type Kpi = { value: number | null; available: boolean; note?: string };
type Overview = {
  kpis: Record<'promotionTemplates' | 'activePromotions' | 'scheduledPromotions' | 'completedPromotions' | 'platformOffers' | 'discountRedemptions' | 'revenueImpactCents' | 'abuseAlerts' | 'participatingBranches' | 'averageDiscountPct' | 'redemptionRatePct' | 'highValuePending', Kpi>;
  statusMix: { segments: { label: string; value: number; tone: string }[]; total: number };
  trend: { day: string; redemptions: number; revenueCents: number }[];
  redemptionsVsRevenue: { day: string; redemptions: number; revenueCents: number }[];
  topPromotions: { id: string; name: string; tenant: string | null; branch: string | null; offer: string | null; status: string; statusTone: string; revenueCents: number; redemptions: number; startAt: string | null; endAt: string | null }[];
  tenantOversight: { tenantId: string; tenant: string; active: number; redemptions: number; revenueCents: number; lastActivity: string | null }[];
  offerExceptions: { id: string; name: string; tenant: string | null; issue: string; severity: string }[];
  bottom: Record<'redemptionsToday' | 'revenueTodayCents' | 'newOffersToday' | 'abuseCasesOpen' | 'approvalSlaHours' | 'averageOfferRoi', Kpi>;
  promotionMixByType: { available: true; segments: { label: string; value: number }[]; total: number } | { available: false; note?: string };
  abuseByStatus: { available: boolean; note?: string };
  abuseReview: { available: boolean; note?: string };
  meta: { redemptionsLabel: string; revenueLabel: string; activeRatePct: number };
};

const toneColor: Record<string, string> = { ok: '#1F9254', warn: '#B7791F', danger: '#C0392B', muted: '#6B7280', info: '#2F6FED' };
const toneBg: Record<string, string> = { ok: '#E7F5EC', warn: '#FBF0DC', danger: '#FBE7E4', muted: '#EEF0F3', info: '#EAF1FF' };
const sevTone: Record<string, string> = { Low: 'ok', Medium: 'warn', High: 'danger', Critical: 'danger' };
const csvCell = (v: unknown) => { const s = String(v ?? ''); const g = /^[=+\-@]/.test(s) ? "'" + s : s; return '"' + g.replace(/"/g, '""') + '"'; };

function Badge({ label, tone }: { label: string; tone: string }) {
  return <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, color: toneColor[tone] || toneColor.muted, background: toneBg[tone] || toneBg.muted }}>{label}</span>;
}
function DualLine({ data }: { data: { day: string; redemptions: number; revenueCents: number }[] }) {
  if (!data.length) return <NotConnected>No activity in range.</NotConnected>;
  const w = 300, h = 150, pad = 8;
  const maxR = Math.max(1, ...data.map((d) => d.redemptions)), maxV = Math.max(1, ...data.map((d) => d.revenueCents));
  const X = (i: number) => pad + (i * (w - 2 * pad)) / Math.max(1, data.length - 1);
  const line = (get: (d: any) => number, max: number) => data.map((d, i) => `${X(i)},${h - pad - (get(d) / max) * (h - 2 * pad)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="150" role="img" aria-label="Promotion performance trend: redemptions and revenue impact">
      <polyline points={line((d) => d.redemptions, maxR)} fill="none" stroke="#2F6FED" strokeWidth={2} />
      <polyline points={line((d) => d.revenueCents, maxV)} fill="none" stroke="#F0820B" strokeWidth={2} />
    </svg>
  );
}
function BarsLine({ data }: { data: { day: string; redemptions: number; revenueCents: number }[] }) {
  if (!data.length) return <NotConnected>No activity in range.</NotConnected>;
  const w = 300, h = 150, pad = 8;
  const maxR = Math.max(1, ...data.map((d) => d.redemptions)), maxV = Math.max(1, ...data.map((d) => d.revenueCents));
  const bw = (w - 2 * pad) / (data.length * 1.6);
  const X = (i: number) => pad + (i * (w - 2 * pad)) / Math.max(1, data.length);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="150" role="img" aria-label="Redemptions vs revenue impact">
      {data.map((d, i) => <rect key={i} x={X(i)} y={h - pad - (d.redemptions / maxR) * (h - 2 * pad)} width={bw} height={(d.redemptions / maxR) * (h - 2 * pad)} fill="#2F6FED" opacity={0.85} rx={2} />)}
      <polyline points={data.map((d, i) => `${X(i) + bw / 2},${h - pad - (d.revenueCents / maxV) * (h - 2 * pad)}`).join(' ')} fill="none" stroke="#F0820B" strokeWidth={2} />
    </svg>
  );
}

const CONTROLS_PLATFORM = [
  { l: 'Create Promotion Templates', d: 'Design reusable promotion templates with flexible discount and eligibility configurations.', gap: 'No promotion-template schema exists yet — creation isn’t connected.' },
  { l: 'Create Platform-Sponsored Promotions', d: 'Launch platform-wide promotions to drive engagement and boost bookings.', gap: 'No platform-offer schema exists yet — creation isn’t connected.' },
  { l: 'Set Eligibility Rules', d: 'Define customer segments, services, products, and other rules for promotion eligibility.', gap: 'No eligibility-rule schema exists yet — the builder isn’t connected.' },
  { l: 'Limit Promotions by Plan', d: 'Control how many promotions tenants can run based on their subscription plan and limits.', gap: 'Plan-limit configuration lives in Plans & Feature Limits; promotion limits aren’t modelled yet.' },
];
const CONTROLS_TENANT = [
  { l: 'Approve High-Value Promotions', d: 'Review and approve promotions that exceed discount or impact thresholds.', gap: 'No approval-queue schema exists yet.' },
  { l: 'Review Promotion Abuse', d: 'Detect and investigate unusual redemption patterns or potential abuse.', gap: 'No abuse-detection schema exists yet.' },
  { l: 'Disable Invalid Offers', d: 'Disable promotions that violate policies or are misconfigured.', gap: 'Disabling writes to a promotion record that isn’t modelled yet.' },
  { l: 'Track Redemption Performance', d: 'Monitor how tenant promotions perform across branches and time periods.', gap: 'Redemption-level tracking needs a redemption schema; aggregate performance is shown above.' },
];

export function PromotionsScreen() {
  const [o, setO] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ id: string; name: string; status: string } | null>(null);
  const [confirm, setConfirm] = useState<{ action: 'approve' | 'disable'; id: string; name: string } | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => (superAdminApi.promotionsOverview() as Promise<Overview>).then(setO).catch((e: any) => setError(e?.message || 'Failed to load promotions.'));
  useEffect(() => { load(); }, []);

  const runAction = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm.action === 'approve') { await superAdminApi.promotionApprove(confirm.id); setNotice(`Approved “${confirm.name}”.`); }
      else { await superAdminApi.promotionDisable(confirm.id, reason.trim()); setNotice(`Disabled “${confirm.name}”.`); }
      setConfirm(null); setReason(''); setSelected(null); await load();
    } catch (e: any) {
      setNotice(e?.response?.data?.message || e?.message || 'Action failed.');
    } finally { setBusy(false); }
  };
  const askAction = (action: 'approve' | 'disable') => {
    if (!selected) { setNotice(`Select a promotion in “Top Promotions This Week” first, then ${action} it.`); return; }
    setReason(''); setConfirm({ action, id: selected.id, name: selected.name });
  };

  const kpiCards = useMemo(() => o ? ([
    ['Promotion Templates', o.kpis.promotionTemplates, (v: number) => v.toLocaleString(), '#EEF0F3', '#6B7280'],
    ['Active Promotions', o.kpis.activePromotions, (v: number) => v.toLocaleString(), '#E7F5EC', '#1F9254'],
    ['Scheduled Promotions', o.kpis.scheduledPromotions, (v: number) => v.toLocaleString(), '#FBF0DC', '#B7791F'],
    ['Completed Promotions', o.kpis.completedPromotions, (v: number) => v.toLocaleString(), '#EAF1FF', '#2F6FED'],
    ['Platform Offers', o.kpis.platformOffers, (v: number) => v.toLocaleString(), '#F3ECFB', '#7C3AED'],
    ['Discount Redemptions', o.kpis.discountRedemptions, (v: number) => v.toLocaleString(), '#EAF1FF', '#2F6FED'],
    ['Revenue Impact', o.kpis.revenueImpactCents, money, '#E7F5EC', '#1F9254'],
    ['Abuse Alerts', o.kpis.abuseAlerts, (v: number) => v.toLocaleString(), '#FBE7E4', '#C0392B'],
    ['Participating Branches', o.kpis.participatingBranches, (v: number) => v.toLocaleString(), '#F3ECFB', '#7C3AED'],
    ['Average Discount', o.kpis.averageDiscountPct, (v: number) => `${v}%`, '#FBF0DC', '#B7791F'],
    ['Redemption Rate', o.kpis.redemptionRatePct, (v: number) => `${v}%`, '#EAF1FF', '#2F6FED'],
    ['High-Value Promos Pending', o.kpis.highValuePending, (v: number) => v.toLocaleString(), '#FBF0DC', '#B7791F'],
  ] as [string, Kpi, (v: number) => string, string, string][]) : [], [o]);

  const exportReport = () => {
    if (!o) return;
    const head = ['Promotion', 'Tenant', 'Branch', 'Offer', 'Status', 'Redemptions', 'Revenue Impact', 'Start'];
    const body = o.topPromotions.map((r) => [r.name, r.tenant, r.branch, r.offer, r.status, r.redemptions, money(r.revenueCents), dt(r.startAt)].map(csvCell).join(','));
    const csv = [head.map(csvCell).join(','), ...body].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a'); a.href = url; a.download = `promotions-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
    setNotice('Exported the promotion report (current oversight scope).');
  };
  const createOffer = () => setNotice('Create Offer asks for a creation type (Promotion Template or Platform-Sponsored Promotion). Those schemas aren’t modelled yet, so creation is not connected — it never modifies a tenant-owned promotion.');

  const quickActions: { l: string; fn: () => void }[] = [
    { l: 'Create Template', fn: createOffer }, { l: 'Launch Platform Offer', fn: createOffer },
    { l: 'Set Eligibility Rules', fn: () => setNotice('Eligibility-rule builder needs a rule schema — not connected yet.') },
    { l: 'Approve Promotion', fn: () => askAction('approve') },
    { l: 'Review Abuse', fn: () => setNotice('Abuse review needs an abuse-case schema — not connected yet.') },
    { l: 'Disable Offer', fn: () => askAction('disable') },
    { l: 'Track Redemptions', fn: () => setNotice('Aggregate redemption performance is shown above; per-redemption tracking needs a redemption schema.') },
    { l: 'Export Report', fn: exportReport },
  ];

  if (error) return <div className="screen"><div className="state">{error}</div></div>;
  if (!o) return <div className="screen"><div className="state">Loading promotions…</div></div>;

  const bottomCards: [string, Kpi, (v: number) => string][] = [
    ['Total Redemptions Today', o.bottom.redemptionsToday, (v) => v.toLocaleString()],
    ['Promotion Revenue Today', o.bottom.revenueTodayCents, money],
    ['New Offers Created', o.bottom.newOffersToday, (v) => v.toLocaleString()],
    ['Abuse Cases Open', o.bottom.abuseCasesOpen, (v) => v.toLocaleString()],
    ['Approval SLA (Avg.)', o.bottom.approvalSlaHours, (v) => `${v} hrs`],
    ['Average Offer ROI', o.bottom.averageOfferRoi, (v) => `${v}x`],
  ];

  return (
    <div className="screen p-5" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="flex flex-col lg:flex-row gap-3 justify-between">
        <div className="vh"><h1>Promotions &amp; Offers <span style={{ color: '#F0820B' }}>★</span></h1><div className="sub">Controls promotion templates, platform offers, and tenant-level promotion oversight.</div></div>
        <div style={{ display: 'flex', gap: 8 }}><button className="btn ghost" onClick={exportReport}>Export Report</button><button className="btn" onClick={createOffer}>+ Create Offer</button></div>
      </div>

      {notice && <div className="state" role="status" style={{ fontSize: 12, background: '#FBF0DC', border: '1px solid #F0D9A8', borderRadius: 8, padding: '8px 12px', display: 'flex', justifyContent: 'space-between', gap: 12 }}><span>{notice}</span><button className="linkbtn" onClick={() => setNotice(null)}>Dismiss</button></div>}

      {/* 12 KPI cards — two rows of six */}
      <div className="kpis grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3" >
        {kpiCards.map(([l, k, fmt, bg, fg]) => (
          <div className="kpi" key={l} aria-label={`${l}: ${k.available ? fmt(k.value as number) : 'not connected'}`}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ width: 24, height: 24, borderRadius: 999, background: bg, color: fg, flex: 'none' }} /><div className="l" style={{ fontSize: 11 }}>{l}</div></div>
            <div className="text-base" style={{ marginTop: 4 }} title={k.note || ''}>{k.available ? fmt(k.value as number) : <NotConnected>Not connected</NotConnected>}</div>
          </div>
        ))}
      </div>

      {/* Platform-Level Promotion Controls */}
      <section className="panel"><h2>Platform-Level Promotion Controls</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
          {CONTROLS_PLATFORM.map((c) => (
            <button key={c.l} className="qbtn" onClick={() => setNotice(c.gap)} style={{ textAlign: 'left', padding: 12, display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start', height: 'auto' }}>
              <b style={{ fontSize: 12.5 }}>{c.l}</b><span className="muted" style={{ fontSize: 11, fontWeight: 400 }}>{c.d}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Tenant-Level Promotion Oversight controls */}
      <section className="panel"><h2>Tenant-Level Promotion Oversight</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
          {CONTROLS_TENANT.map((c) => (
            <button key={c.l} className="qbtn" onClick={() => (c.l === 'Approve High-Value Promotions' ? askAction('approve') : c.l === 'Disable Invalid Offers' ? askAction('disable') : setNotice(c.gap))} style={{ textAlign: 'left', padding: 12, display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start', height: 'auto' }}>
              <b style={{ fontSize: 12.5 }}>{c.l}</b><span className="muted" style={{ fontSize: 11, fontWeight: 400 }}>{c.d}</span>
            </button>
          ))}
        </div>
      </section>

      {/* 5 analytics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        <section className="panel"><h2 style={{ fontSize: 13 }}>Promotion Performance Trend</h2><DualLine data={o.trend} /><div className="muted" style={{ fontSize: 10.5, marginTop: 4 }}>Blue: redemptions · Orange: revenue (USD)</div></section>
        <section className="panel"><h2 style={{ fontSize: 13 }}>Redemptions vs Revenue Impact</h2><BarsLine data={o.redemptionsVsRevenue} /></section>
        <section className="panel"><h2 style={{ fontSize: 13 }}>Promotion Mix by Type</h2>{o.promotionMixByType.available ? <Donut data={o.promotionMixByType.segments.map((s) => ({ label: s.label, value: s.value }))} centerLabel={`${o.promotionMixByType.total} Total`} /> : <NotConnected>{o.promotionMixByType.note || 'Not connected'}</NotConnected>}</section>
        <section className="panel"><h2 style={{ fontSize: 13 }}>Offer Status Overview</h2>{o.statusMix.total === 0 ? <NotConnected>No offers yet.</NotConnected> : <Donut data={o.statusMix.segments.map((s) => ({ label: s.label, value: s.value }))} centerLabel={`${o.statusMix.total} Total`} />}</section>
        <section className="panel"><h2 style={{ fontSize: 13 }}>Abuse Alerts by Status</h2><NotConnected>{o.abuseByStatus.note || 'Not connected'}</NotConnected></section>
      </div>

      {/* Top Promotions This Week */}
      <section className="panel"><h2>Top Promotions This Week</h2>
        {o.topPromotions.length === 0 ? <div className="state" style={{ fontSize: 12 }}>No promotions yet.</div> : (
          <div style={{ overflowX: 'auto' }}>
            <table className="tgrid" style={{ width: '100%', fontSize: 12, minWidth: 820 }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 11 }}><th>Promotion Name</th><th>Tenant</th><th>Offer</th><th>Branch</th><th>Start</th><th>Redemptions</th><th>Revenue Impact</th><th>Status</th></tr></thead>
              <tbody>{o.topPromotions.map((r) => (
                <tr key={r.id} onClick={() => setSelected({ id: r.id, name: r.name, status: r.status })} style={{ cursor: 'pointer', background: selected?.id === r.id ? '#FFF3E6' : undefined }} aria-selected={selected?.id === r.id}><td style={{ fontWeight: 600 }}>{r.name}</td><td className="muted">{r.tenant || '—'}</td><td className="muted">{r.offer || '—'}</td><td className="muted">{r.branch || '—'}</td><td className="muted">{dt(r.startAt)}</td><td>{r.redemptions.toLocaleString()}</td><td style={{ fontWeight: 600 }}>{money(r.revenueCents)}</td><td><Badge label={r.status} tone={r.statusTone} /></td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      {/* 3 lower tables */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 items-start">
        <section className="panel"><h2 style={{ fontSize: 13 }}>Tenant Promotion Oversight</h2>
          {o.tenantOversight.length === 0 ? <div className="state" style={{ fontSize: 12 }}>No tenant activity.</div> : (
            <table className="tgrid" style={{ width: '100%', fontSize: 11.5 }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10.5 }}><th>Tenant</th><th>Active</th><th>Redemptions</th><th>Revenue</th><th>Last</th></tr></thead>
              <tbody>{o.tenantOversight.map((t) => (<tr key={t.tenantId}><td style={{ fontWeight: 600 }}>{t.tenant}</td><td>{t.active}</td><td className="muted">{t.redemptions.toLocaleString()}</td><td>{money(t.revenueCents)}</td><td className="muted">{dt(t.lastActivity)}</td></tr>))}</tbody>
            </table>
          )}
        </section>
        <section className="panel"><h2 style={{ fontSize: 13 }}>Promotion Abuse Review</h2><NotConnected>{o.abuseReview.note || 'Not connected'}</NotConnected></section>
        <section className="panel"><h2 style={{ fontSize: 13 }}>Offer Exceptions</h2>
          {o.offerExceptions.length === 0 ? <div className="state" style={{ fontSize: 12 }}>No offer exceptions detected.</div> : (
            <table className="tgrid" style={{ width: '100%', fontSize: 11.5 }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10.5 }}><th>Promotion / Tenant</th><th>Issue</th><th>Severity</th></tr></thead>
              <tbody>{o.offerExceptions.map((e, i) => (<tr key={i}><td style={{ fontWeight: 600 }}>{e.name}<span className="muted" style={{ fontWeight: 400 }}>{e.tenant ? ` · ${e.tenant}` : ''}</span></td><td className="muted">{e.issue}</td><td><Badge label={e.severity} tone={sevTone[e.severity] || 'muted'} /></td></tr>))}</tbody>
            </table>
          )}
        </section>
      </div>

      {/* Quick Actions */}
      <section className="panel"><h2>Quick Actions</h2>
        <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 2xl:grid-cols-8">{quickActions.map((a) => <button key={a.l} className="qbtn" onClick={a.fn} style={{ fontSize: 11 }}>{a.l}</button>)}</div>
      </section>

      {/* 6 bottom summary cards */}
      <div className="kpis pb-7 grid gap-2 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 ">
        {bottomCards.map(([l, k, fmt]) => (
          <div className="kpi" key={l} aria-label={`${l}: ${k.available ? fmt(k.value as number) : 'not connected'}`}>
            <div className="l" style={{ fontSize: 11 }}>{l}</div>
            <div className="text-base" title={k.note || ''}>{k.available ? fmt(k.value as number) : <NotConnected>Not connected</NotConnected>}</div>
          </div>
        ))}
      </div>

      {/* Approve / Disable confirmation — the backend validates the transition; disable requires a reason */}
      {confirm && (
        <div role="dialog" aria-label={`${confirm.action === 'approve' ? 'Approve' : 'Disable'} promotion`} onClick={() => !busy && setConfirm(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(20,22,30,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, padding: 18, width: 'min(460px, 92vw)', boxShadow: '0 12px 40px rgba(0,0,0,0.2)' }}>
            <div className="phead"><h2 style={{ margin: 0, fontSize: 15 }}>{confirm.action === 'approve' ? 'Approve promotion' : 'Disable promotion'}</h2><button className="linkbtn" aria-label="Close" onClick={() => !busy && setConfirm(null)}>✕</button></div>
            <p style={{ fontSize: 12.5, margin: '8px 0' }}>{confirm.action === 'approve' ? `Approve “${confirm.name}”? The backend re-checks the promotion’s current status.` : `Disable “${confirm.name}”? Future redemptions stop; past redemptions and history are preserved.`}</p>
            {confirm.action === 'disable' && (
              <label style={{ display: 'block', fontSize: 11.5 }}>Reason (required)
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} aria-label="Disable reason" style={{ width: '100%', marginTop: 4, fontSize: 12, borderRadius: 8, border: '1px solid var(--line)', padding: 8 }} />
              </label>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button className="btn ghost" onClick={() => setConfirm(null)} disabled={busy}>Cancel</button>
              <button className="btn" onClick={runAction} disabled={busy || (confirm.action === 'disable' && reason.trim().length < 4)}>{busy ? 'Working…' : confirm.action === 'approve' ? 'Approve' : 'Disable'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
