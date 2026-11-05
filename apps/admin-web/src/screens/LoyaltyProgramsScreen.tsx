import { useCallback, useEffect, useRef, useState } from 'react';
import { superAdminLoyaltyApi, type SALoyaltyDashboard } from '../api/superAdminLoyaltyApi';
import { Donut, AreaLine, MiniBars, money, moneyK, NotConnected } from './_chartkit';

// LoyaltyProgramsScreen — Super Admin › Business Management › Loyalty Programs. Platform-wide oversight over the real
// loyalty tables via GET /super-admin/loyalty/dashboard. Read-only oversight (salons run earn/redeem in their POS).
// Honest where no event source exists: points-issued/expired over time, suspicious cases, and liability-change render as
// "—"/NotConnected rather than fabricated numbers. Processors/points are never mutated here.

const GOLD = 'var(--g7,#A96F22)';
const TITLE = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const num = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString());
const pctS = (n: number | null | undefined) => (n == null ? '—' : `${n}%`);

export function LoyaltyProgramsScreen() {
  const [d, setD] = useState<SALoyaltyDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const flashT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const load = useCallback(() => {
    superAdminLoyaltyApi.dashboard().then((r) => { setD(r); setError(null); }).catch((e: any) => setError(e?.message || 'Failed to load loyalty dashboard.'));
  }, []);
  useEffect(load, [load]);
    const say = useCallback((m: string) => { setFlash(m); if (flashT.current) clearTimeout(flashT.current); flashT.current = setTimeout(() => setFlash(null), 4000); }, []);
  const doExport = useCallback(async (fmt: 'csv' | 'xlsx') => {
    try {
      const blob = await (fmt === 'csv' ? superAdminLoyaltyApi.exportCsv : superAdminLoyaltyApi.exportXlsx)();
      const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `loyalty-report-${new Date().toISOString().slice(0, 10)}.${fmt}`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      say(`Exported the cross-tenant loyalty report to ${fmt.toUpperCase()} — audited server-side.`);
    } catch { say('Export was unavailable — please retry.'); }
  }, [say]);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [config, setConfig] = useState<import('../api/superAdminLoyaltyApi').SALoyaltyConfig | null>(null);
  const [templates, setTemplates] = useState<import('../api/superAdminLoyaltyApi').SALoyaltyTemplate[]>([]);
  const openSettings = useCallback(async () => {
    setSettingsOpen(true);
    try {
      const [c, t] = await Promise.all([superAdminLoyaltyApi.getConfig(), superAdminLoyaltyApi.listTemplates()]);
      setConfig(c.config); setTemplates(t.templates);
    } catch { say('Could not load loyalty settings.'); }
  }, [say]);
  const saveConfig = useCallback(async (patch: Partial<import('../api/superAdminLoyaltyApi').SALoyaltyConfig>) => {
    try { const r = await superAdminLoyaltyApi.putConfig(patch); if (r.ok) { setConfig(r.config); say('Loyalty configuration saved (audited).'); } else say('Could not save configuration.'); }
    catch { say('Could not save configuration.'); }
  }, [say]);
  const addTemplate = useCallback(async (name: string, programType: string) => {
    try { const r = await superAdminLoyaltyApi.createTemplate({ name, programType }); if (r.ok) { const t = await superAdminLoyaltyApi.listTemplates(); setTemplates(t.templates); say('Default template created (audited).'); } else say(r.error === 'name_required' ? 'Template name is required.' : 'Could not create template.'); }
    catch { say('Could not create template.'); }
  }, [say]);

  const runDetection = useCallback(async () => {
    try { const r = await superAdminLoyaltyApi.detectSuspicious(); say(`Detection complete — ${r.open} open case${r.open === 1 ? '' : 's'} over real redemption activity.`); load(); }
    catch { say('Detection was unavailable — please retry.'); }
  }, [say, load]);
  const reviewCase = useCallback(async (id: string, to: 'reviewing' | 'resolved' | 'dismissed') => {
    try { const r = await superAdminLoyaltyApi.transitionSuspicious(id, { to }); if (r.ok) { say(`Case marked ${to} (audited).`); load(); } else say('Could not update the case.'); }
    catch { say('Could not update the case.'); }
  }, [say, load]);

  const [correctionsOpen, setCorrectionsOpen] = useState(false);
  const [corrections, setCorrections] = useState<import('../api/superAdminLoyaltyApi').SALoyaltyCorrection[]>([]);
  const openCorrections = useCallback(async () => {
    setCorrectionsOpen(true);
    try { await superAdminLoyaltyApi.detectCorrections(); const r = await superAdminLoyaltyApi.listCorrections({ status: 'detected', limit: 25 }); setCorrections(r.corrections); }
    catch { say('Could not run calculation-error detection.'); }
  }, [say]);
  const reviewCorrection = useCallback(async (id: string, to: 'approved' | 'rejected', reason: string) => {
    try {
      const r = await superAdminLoyaltyApi.reviewCorrection(id, { to, reason, rootCause: 'platform_calculation' });
      if (r.ok) { const list = await superAdminLoyaltyApi.listCorrections({ status: 'detected', limit: 25 }); setCorrections(list.corrections); say(`Correction ${to} (compensating record only — tenant balance unchanged, audited).`); }
      else say(r.error === 'reason_required' ? 'A reason is required to review a correction.' : 'Could not review the correction.');
    } catch { say('Could not review the correction.'); }
  }, [say]);


  if (error) return <div className="screen"><div className="state" role="alert">{error} <button className="linkbtn" onClick={load}>Retry</button></div></div>;
  if (!d) return <div className="screen"><div className="state" style={{ padding: 28 }}>Loading loyalty dashboard…</div></div>;

  const k = d.kpis;
  const kpis: { l: string; v: string; note?: string }[] = [
    { l: 'Loyalty Members', v: num(k.loyaltyMembers) },
    { l: 'Points Issued', v: num(k.pointsIssued) },
    { l: 'Points Redeemed', v: num(k.pointsRedeemed) },
    { l: 'Outstanding Point Liability', v: money(k.liabilityCents) },
    { l: 'Rewards Issued', v: num(k.rewardsIssued) },
    { l: 'Tier Membership', v: num(k.tierMembership) },
    { l: 'Expired Points', v: k.expiredPoints ? num(k.expiredPoints) : '—', note: k.expiredPoints ? undefined : 'No expiration ledger connected' },
    { l: 'Suspicious Redemption Activity', v: k.suspiciousActivity ? num(k.suspiciousActivity) : '—', note: k.suspiciousActivity ? undefined : 'No case store connected' },
    { l: 'Loyalty Engagement', v: pctS(k.engagementPct) },
    { l: 'Program Performance by Tenant', v: pctS(k.programPerformancePct) },
    { l: 'Active Loyalty Programs', v: num(k.activePrograms) },
    { l: 'Avg Reward Redemption Rate', v: pctS(k.avgRedemptionRatePct) },
  ];

  const platformControls = [
    ['Configure Loyalty-Program Types', 'Manage points, tiered rewards, visit-based, and spend-based program structures.'],
    ['Create Default Loyalty Templates', 'Create reusable templates for tenants launching new loyalty programs.'],
    ['Set Points and Reward Limits', 'Control maximum points issuance and redemption thresholds.'],
    ['Configure Expiration Rules', 'Set global rules for point expiration windows and reward validity.'],
  ] as const;
  const tenantOversight = [
    ['Review Suspicious Activity', 'Investigate unusual redemption patterns and flagged accounts.'],
    ['Correct Platform Calculation Errors', 'Review and correct detected loyalty math or sync issues.'],
    ['Enable or Disable Loyalty Features by Plan', 'Control loyalty access based on subscription plan.'],
    ['Export Loyalty Reports', 'Download cross-tenant loyalty performance and liability reports.'],
  ] as const;
  const quickActions = ['Configure Program Types', 'Create Default Template', 'Set Points Limits', 'Configure Expiration Rules', 'Review Suspicious Activity', 'Correct Calculation Errors', 'Toggle Loyalty by Plan', 'Export Loyalty Reports'];

  const glance = [
    { l: 'New Members Today', v: num(d.atAGlance.newMembers) },
    { l: 'Rewards Redeemed Today', v: num(d.atAGlance.rewardsRedeemed) },
    { l: 'Points Issued Today', v: d.atAGlance.pointsIssued == null ? '—' : num(d.atAGlance.pointsIssued), note: d.atAGlance.pointsIssued == null ? 'No issuance event source' : undefined },
    { l: 'Expired Points Today', v: d.atAGlance.expiredPoints == null ? '—' : num(d.atAGlance.expiredPoints), note: d.atAGlance.expiredPoints == null ? 'No expiration ledger' : undefined },
    { l: 'Liability Change', v: d.atAGlance.liabilityChangeCents == null ? '—' : money(d.atAGlance.liabilityChangeCents), note: d.atAGlance.liabilityChangeCents == null ? 'Needs a liability snapshot series' : undefined },
    { l: 'Flagged Cases Open', v: num(d.atAGlance.flaggedCasesOpen) },
  ];

  return (
    <div className="screen p-5" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="flex gap-3 flex-col lg:flex-row justify-between">
        <div>
          <h1 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 26, display: 'flex', alignItems: 'center', gap: 8 }}>Loyalty Programs <span style={{ color: GOLD }} aria-hidden>★</span></h1>
          <div className="sub" style={{ color: 'var(--muted)', fontSize: 13 }}>Manages platform loyalty capabilities and monitors tenant loyalty programs.{d.tenantCount ? ` · ${d.tenantCount} ${d.tenantCount === 1 ? 'salon' : 'salons'} with loyalty` : ''}</div>
        </div>
        <div className="self-baseline" style={{ display: 'flex', gap: 8 }}>
          <button className="btn ghost"  onClick={() => doExport('csv')}>Export Report</button>
          <button className="btn" onClick={openSettings}>+ Create Loyalty Program</button>
        </div>
      </div>
      {flash ? <div role="status" style={{ fontSize: 12.5, color: GOLD, background: 'var(--cream,#FBF6EC)', border: '1px solid #E7D6B8', borderRadius: 10, padding: '7px 12px' }}>{flash}</div> : null}

      {/* 12 KPI cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {kpis.map((c) => (
          <div key={c.l} className="kpi" style={{ background: 'var(--card,#fff)', border: '1px solid var(--line,#eee)', borderRadius: 12, padding: '12px 12px' }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>{c.l}</div>
            <div style={{ fontFamily: 'Playfair Display, serif', fontSize: 21, marginTop: 4 }}>{c.v}</div>
            {c.note ? <div className="muted" style={{ fontSize: 10, marginTop: 2 }}>{c.note}</div> : null}
          </div>
        ))}
      </div>

      {/* Platform Loyalty Controls + Tenant Loyalty Oversight */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ControlPanel title="Platform Loyalty Controls" subtitle="Configure loyalty capabilities and reusable defaults across the platform." items={platformControls} onClick={openSettings} />
        <ControlPanel title="Tenant Loyalty Oversight" subtitle="Monitor tenant loyalty programs and enforce policy compliance." items={tenantOversight} onClick={(t) => t === 'Export Loyalty Reports' ? doExport('csv') : t === 'Review Suspicious Activity' ? runDetection() : t === 'Correct Platform Calculation Errors' ? openCorrections() : openSettings()} />
      </div>

      {/* Analytics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        <Panel title="Points Activity Trend">
          {d.pointsActivityTrend.length === 0 ? <NotConnected>No redemptions in range.</NotConnected> : <AreaLine series={d.pointsActivityTrend.map((x) => ({ label: x.day.slice(5), valueCents: x.redeemed }))} height={130} />}
          <div className="muted" style={{ fontSize: 10, marginTop: 6 }}>Points redeemed is from real redemptions. Points issued / expired over time need a points-event ledger (not connected).</div>
        </Panel>
        <Panel title="Member Growth vs Engagement">
          {d.memberGrowth.length === 0 ? <NotConnected>No new members in range.</NotConnected> : <MiniBars data={d.memberGrowth.map((x) => ({ label: x.day.slice(5), value: x.members, tip: `${x.day}: ${x.members} new members` }))} />}
        </Panel>
        <Panel title="Member Tier Distribution">
          <Donut data={d.tierDistribution.slices.map((s) => ({ label: s.tier, value: s.count }))} centerLabel={`${d.tierDistribution.total}`} />
        </Panel>
        <Panel title="Redemption Status">
          <Donut data={d.redemptionStatus.slices.map((s) => ({ label: TITLE(s.status), value: s.count }))} centerLabel={`${d.redemptionStatus.total}`} />
        </Panel>
      </div>

      {/* Tables */}
      <div className="grid grid-cols-1  sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <Panel title="Top Loyalty Programs This Week">
          {d.topPrograms.length === 0 ? <NotConnected>No loyalty programs yet.</NotConnected> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10 }}>{['Program', 'Type', 'Members', 'Issued', 'Redeemed', 'Rate', 'Liability', 'Status'].map((h) => <th key={h} style={{ padding: '5px 5px', fontWeight: 700 }}>{h}</th>)}</tr></thead>
              <tbody>{d.topPrograms.map((p) => (
                <tr key={p.tenantId} style={{ borderTop: '1px solid var(--line,#eee)' }}>
                  <td style={{ padding: '5px 5px', fontWeight: 700 }}>{p.name}</td><td style={{ padding: '5px 5px' }}>{p.type}</td><td style={{ padding: '5px 5px' }}>{num(p.members)}</td>
                  <td style={{ padding: '5px 5px' }}>{num(p.pointsIssued)}</td><td style={{ padding: '5px 5px' }}>{num(p.pointsRedeemed)}</td><td style={{ padding: '5px 5px' }}>{p.redemptionRatePct}%</td>
                  <td style={{ padding: '5px 5px' }}>{moneyK(p.liabilityCents)}</td><td style={{ padding: '5px 5px' }}><Pill label={p.status} good={p.status === 'Active'} /></td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </Panel>
        <Panel title="Program Performance by Tenant">
          {d.tenantPerformance.length === 0 ? <NotConnected>No tenant loyalty data.</NotConnected> : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
              <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10 }}>{['Tenant', 'Programs', 'Members', 'Engagement', 'Rate', 'Liability', 'Status'].map((h) => <th key={h} style={{ padding: '5px 5px', fontWeight: 700 }}>{h}</th>)}</tr></thead>
              <tbody>{d.tenantPerformance.map((t) => (
                <tr key={t.tenantId} style={{ borderTop: '1px solid var(--line,#eee)' }}>
                  <td style={{ padding: '5px 5px', fontWeight: 700 }}>{t.tenantName ?? '—'}</td><td style={{ padding: '5px 5px' }}>{t.activePrograms}</td><td style={{ padding: '5px 5px' }}>{num(t.members)}</td>
                  <td style={{ padding: '5px 5px' }}>{t.engagementPct}%</td><td style={{ padding: '5px 5px' }}>{t.redemptionRatePct}%</td><td style={{ padding: '5px 5px' }}>{moneyK(t.liabilityCents)}</td>
                  <td style={{ padding: '5px 5px' }}><Pill label={t.status} good={t.status !== 'Watch'} /></td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </Panel>
        <Panel title="Suspicious Redemption Review">
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 6 }}><button className="linkbtn" onClick={runDetection}>Run Detection</button></div>
          {!d.suspiciousReview.available ? <NotConnected>{d.suspiciousReview.reason}. Run detection to scan real redemption activity.</NotConnected>
            : d.suspiciousReview.rows.length === 0 ? <div className="muted" style={{ fontSize: 12 }}>No open suspicious cases — redemption activity looks clean.</div>
              : d.suspiciousReview.rows.map((c) => (
                <div key={c.id} style={{ borderTop: '1px solid var(--line,#eee)', padding: '7px 0', fontSize: 11.5 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                    <span style={{ fontWeight: 700 }}>{TITLE(c.signalType)} <Pill label={c.severity} good={c.severity === 'low'} /></span>
                    <span className="muted">{c.tenantName ?? '—'}</span>
                  </div>
                  <div className="muted" style={{ fontSize: 10.5, marginTop: 2 }}>{c.detail?.count ? `${c.detail.count} redemptions` : c.detail?.points ? `${c.detail.points.toLocaleString()} pts` : ''}{c.detail?.day ? ` · ${c.detail.day}` : ''}</div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                    <button className="linkbtn" style={{ fontSize: 10.5 }} onClick={() => reviewCase(c.id, 'reviewing')}>Review</button>
                    <button className="linkbtn" style={{ fontSize: 10.5 }} onClick={() => reviewCase(c.id, 'resolved')}>Resolve</button>
                    <button className="linkbtn" style={{ fontSize: 10.5 }} onClick={() => reviewCase(c.id, 'dismissed')}>Dismiss</button>
                  </div>
                </div>
              ))}
        </Panel>
      </div>

      {/* Quick Actions */}
      <section style={{ background: 'var(--card,#fff)', border: '1px solid var(--line,#eee)', borderRadius: 12, padding: 12 }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 14 }}>Quick Actions</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-8  gap-2.5">
          {quickActions.map((a) => <button key={a} onClick={() => a === 'Export Loyalty Reports' ? doExport('xlsx') : a === 'Review Suspicious Activity' ? runDetection() : a === 'Correct Calculation Errors' ? openCorrections() : openSettings()} style={{ background: 'var(--cream,#FBF6EC)', border: '1px solid #EFE3CB', borderRadius: 10, padding: '9px 8px', fontSize: 10.5, fontWeight: 600, cursor: 'pointer', color: 'var(--ink,#3a3a3a)' }}>{a}</button>)}
        </div>
      </section>

      {/* At-a-Glance */}
      <section style={{ background: 'var(--card,#fff)', border: '1px solid var(--line,#eee)', borderRadius: 12, padding: 12 }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 14 }}>At-a-Glance Summary (Today)</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6  gap-2.5">
          {glance.map((g) => (
            <div key={g.l} style={{ minWidth: 0, background: '#FBF6EC', border: '1px solid var(--line,#eee)', borderRadius: 12, padding: 12 }}>
              <div className="muted" style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.03em' }}>{g.l}</div>
              <div style={{ fontFamily: 'Playfair Display, serif', fontSize: 18, marginTop: 3 }}>{g.v}</div>
              {g.note ? <div className="muted" style={{ fontSize: 9.5, marginTop: 1 }}>{g.note}</div> : null}
            </div>
          ))}
        </div>
      </section>

      {settingsOpen ? <LoyaltySettingsModal config={config} templates={templates} onClose={() => setSettingsOpen(false)} onSave={saveConfig} onAddTemplate={addTemplate} /> : null}
      {correctionsOpen ? <CorrectionsModal corrections={corrections} onClose={() => setCorrectionsOpen(false)} onReview={reviewCorrection} /> : null}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section style={{ background: 'var(--card,#fff)', border: '1px solid var(--line,#eee)', borderRadius: 12, padding: 12, minWidth: 0 }}><div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}><h2 style={{ margin: 0, fontSize: 13.5 }}>{title}</h2></div>{children}</section>;
}
function ControlPanel({ title, subtitle, items, onClick }: { title: string; subtitle: string; items: readonly (readonly [string, string])[]; onClick: (t: string) => void }) {
  return (
    <section style={{ background: 'var(--card,#fff)', border: '1px solid var(--line,#eee)', borderRadius: 12, padding: 14 }}>
      <h2 style={{ margin: '0 0 2px', fontSize: 14 }}>{title}</h2>
      <div className="muted" style={{ fontSize: 11.5, marginBottom: 10 }}>{subtitle}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {items.map(([t, desc]) => (
          <button key={t} onClick={() => onClick(t)} style={{ textAlign: 'left', background: 'var(--cream,#FBF6EC)', border: '1px solid #EFE3CB', borderRadius: 10, padding: '10px 11px', cursor: 'pointer' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink,#3a3a3a)' }}>{t}</div>
            <div className="muted" style={{ fontSize: 10.5, marginTop: 2 }}>{desc}</div>
          </button>
        ))}
      </div>
    </section>
  );
}
function Pill({ label, good }: { label: string; good: boolean }) {
  return <span style={{ background: good ? '#E4F0E8' : '#FBF1DC', color: good ? '#3E8F57' : '#B7841F', fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 20 }}>{label}</span>;
}
export default LoyaltyProgramsScreen;

function LoyaltySettingsModal({ config, templates, onClose, onSave, onAddTemplate }: {
  config: import('../api/superAdminLoyaltyApi').SALoyaltyConfig | null;
  templates: import('../api/superAdminLoyaltyApi').SALoyaltyTemplate[];
  onClose: () => void; onSave: (patch: Partial<import('../api/superAdminLoyaltyApi').SALoyaltyConfig>) => void; onAddTemplate: (name: string, type: string) => void;
}) {
  const [draft, setDraft] = useState(config);
  const [tplName, setTplName] = useState('');
  const [tplType, setTplType] = useState('points');
  useEffect(() => { setDraft(config); }, [config]);

  const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(30,24,16,.35)', display: 'grid', placeItems: 'center', zIndex: 50, padding: 20 };
  const card: React.CSSProperties = { background: 'var(--card,#fff)', borderRadius: 14, padding: 20, width: 'min(680px, 96vw)', maxHeight: '88vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.25)' };
  const numField = (label: string, val: number, set: (n: number) => void) => (
    <label style={{ display: 'block' }}><span className="flabel" style={{ fontSize: 11, color: 'var(--muted)' }}>{label}</span>
      <input type="number" value={val} min={0} onChange={(e) => set(Math.max(0, Math.trunc(Number(e.target.value) || 0)))} style={{ ...inp2 }} aria-label={label} /></label>
  );
  const toggle = (label: string, val: boolean, set: (b: boolean) => void) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, padding: '4px 0' }}><input type="checkbox" checked={val} onChange={(e) => set(e.target.checked)} aria-label={label} />{label}</label>
  );

  if (!draft) return (<div style={overlay} role="dialog" aria-label="Loyalty settings"><div style={card}><h2 style={{ margin: 0, fontSize: 16 }}>Loyalty Settings</h2><div className="muted" style={{ marginTop: 10 }}>Loading configuration…</div><div style={{ textAlign: 'right', marginTop: 12 }}><button className="linkbtn" onClick={onClose}>Close</button></div></div></div>);
  const d = draft;
  const set = (patch: Partial<typeof d>) => setDraft({ ...d, ...patch });

  return (
    <div style={overlay} role="dialog" aria-label="Loyalty settings">
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontFamily: 'Playfair Display, serif' }}>Loyalty Settings</h2>
          <button className="linkbtn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="muted" style={{ fontSize: 11.5, marginBottom: 12 }}>Configures platform loyalty capabilities only — tenant point balances, tiers, and redemption history are never changed here. Saving is audited.</div>

        <Section title="Set Points & Reward Limits">
          <div style={grid2}>
            {numField('Max points per transaction', d.limits.maxPointsPerTxn, (n) => set({ limits: { ...d.limits, maxPointsPerTxn: n } }))}
            {numField('Max redemption per transaction', d.limits.maxRedemptionPerTxn, (n) => set({ limits: { ...d.limits, maxRedemptionPerTxn: n } }))}
            {numField('Min redemption threshold', d.limits.minRedemptionThreshold, (n) => set({ limits: { ...d.limits, minRedemptionThreshold: n } }))}
            {numField('Max points / day / member', d.limits.maxPointsPerDayPerMember, (n) => set({ limits: { ...d.limits, maxPointsPerDayPerMember: n } }))}
            {numField('Point value (cents per point)', d.valuation.centsPerPoint, (n) => set({ valuation: { centsPerPoint: n } }))}
          </div>
        </Section>

        <Section title="Configure Expiration Rules">
          {toggle('Enable point expiration', d.expiration.enabled, (b) => set({ expiration: { ...d.expiration, enabled: b } }))}
          <div style={grid2}>
            {numField('Point expiry window (days)', d.expiration.pointExpiryDays, (n) => set({ expiration: { ...d.expiration, pointExpiryDays: n } }))}
            {numField('Reward validity (days)', d.expiration.rewardValidityDays, (n) => set({ expiration: { ...d.expiration, rewardValidityDays: n } }))}
          </div>
        </Section>

        <Section title="Configure Program Types">
          <div style={grid2}>
            {toggle('Points', d.programTypes.points, (b) => set({ programTypes: { ...d.programTypes, points: b } }))}
            {toggle('Tiered', d.programTypes.tiered, (b) => set({ programTypes: { ...d.programTypes, tiered: b } }))}
            {toggle('Visit-based', d.programTypes.visit_based, (b) => set({ programTypes: { ...d.programTypes, visit_based: b } }))}
            {toggle('Spend-based', d.programTypes.spend_based, (b) => set({ programTypes: { ...d.programTypes, spend_based: b } }))}
          </div>
        </Section>

        <Section title="Enable / Disable Loyalty Features by Plan">
          <div style={grid2}>
            {Object.keys(d.planFeatures).map((plan) => toggle(TITLE(plan), d.planFeatures[plan], (b) => set({ planFeatures: { ...d.planFeatures, [plan]: b } })))}
          </div>
        </Section>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', margin: '8px 0 18px' }}>
          <button className="linkbtn" onClick={() => setDraft(config)}>Revert</button>
          <button onClick={() => onSave(d)} style={{ background: GOLD, color: '#fff', border: 0, borderRadius: 8, padding: '8px 16px', fontWeight: 700, cursor: 'pointer' }}>Save Configuration</button>
        </div>

        <Section title="Create Default Loyalty Template">
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <label style={{ flex: 1, minWidth: 180 }}><span className="flabel" style={{ fontSize: 11, color: 'var(--muted)' }}>Template name</span><input value={tplName} onChange={(e) => setTplName(e.target.value)} style={inp2} aria-label="Template name" /></label>
            <label><span className="flabel" style={{ fontSize: 11, color: 'var(--muted)' }}>Type</span><select value={tplType} onChange={(e) => setTplType(e.target.value)} style={inp2} aria-label="Template type">{['points', 'tiered', 'visit_based', 'spend_based'].map((t) => <option key={t} value={t}>{TITLE(t)}</option>)}</select></label>
            <button disabled={!tplName.trim()} onClick={() => { onAddTemplate(tplName.trim(), tplType); setTplName(''); }} style={{ background: GOLD, color: '#fff', border: 0, borderRadius: 8, padding: '8px 14px', fontWeight: 700, cursor: tplName.trim() ? 'pointer' : 'not-allowed', opacity: tplName.trim() ? 1 : 0.6 }}>Create Template</button>
          </div>
          {templates.length > 0 ? <div style={{ marginTop: 8, fontSize: 12 }} className="muted">{templates.length} template{templates.length === 1 ? '' : 's'}: {templates.slice(0, 6).map((t) => t.name).join(', ')}</div> : <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>No templates yet.</div>}
        </Section>
      </div>
    </div>
  );
}

const inp2: React.CSSProperties = { width: '100%', padding: '7px 9px', border: '1px solid var(--line,#ddd)', borderRadius: 8, fontSize: 12.5, boxSizing: 'border-box', marginTop: 3 };
const grid2: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 };
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section style={{ borderTop: '1px solid var(--line,#eee)', paddingTop: 10, marginBottom: 10 }}><h3 style={{ margin: '0 0 8px', fontSize: 13 }}>{title}</h3>{children}</section>;
}

function CorrectionsModal({ corrections, onClose, onReview }: {
  corrections: import('../api/superAdminLoyaltyApi').SALoyaltyCorrection[];
  onClose: () => void; onReview: (id: string, to: 'approved' | 'rejected', reason: string) => void;
}) {
  const [reason, setReason] = useState<Record<string, string>>({});
  const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(30,24,16,.35)', display: 'grid', placeItems: 'center', zIndex: 50, padding: 20 };
  const card: React.CSSProperties = { background: 'var(--card,#fff)', borderRadius: 14, padding: 20, width: 'min(720px, 96vw)', maxHeight: '88vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.25)' };
  return (
    <div style={overlay} role="dialog" aria-label="Correct platform calculation errors">
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontFamily: 'Playfair Display, serif' }}>Correct Platform Calculation Errors</h2>
          <button className="linkbtn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="muted" style={{ fontSize: 11.5, marginBottom: 12 }}>Detected from verifiable arithmetic inconsistencies in real data (balance vs earned−redeemed, redeemed vs actual redemptions, negative balances). Approving records an append-only compensating correction with your reason — it does <strong>not</strong> silently edit customer balances; reconciling tenant points requires the immutable points ledger.</div>
        {corrections.length === 0 ? <div className="muted" style={{ fontSize: 12.5 }}>No open calculation discrepancies detected.</div> : corrections.map((c) => (
          <div key={c.id} style={{ borderTop: '1px solid var(--line,#eee)', padding: '10px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12.5 }}>
              <span style={{ fontWeight: 700 }}>{TITLE(c.discrepancyType)}</span>
              <span className="muted">expected {c.expectedPoints.toLocaleString()} · actual {c.actualPoints.toLocaleString()} · diff <strong style={{ color: c.differencePoints === 0 ? '#3E8F57' : '#B84A3D' }}>{c.differencePoints > 0 ? '+' : ''}{c.differencePoints.toLocaleString()}</strong></span>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
              <input value={reason[c.id] ?? ''} onChange={(e) => setReason((r) => ({ ...r, [c.id]: e.target.value }))} placeholder="Reason / evidence (required)" style={{ ...inp2, marginTop: 0, flex: 1 }} aria-label={`Reason for ${c.id}`} />
              <button disabled={!(reason[c.id] ?? '').trim()} onClick={() => onReview(c.id, 'approved', (reason[c.id] ?? '').trim())} style={{ background: GOLD, color: '#fff', border: 0, borderRadius: 8, padding: '7px 12px', fontWeight: 700, fontSize: 11.5, cursor: (reason[c.id] ?? '').trim() ? 'pointer' : 'not-allowed', opacity: (reason[c.id] ?? '').trim() ? 1 : 0.6 }}>Approve</button>
              <button disabled={!(reason[c.id] ?? '').trim()} onClick={() => onReview(c.id, 'rejected', (reason[c.id] ?? '').trim())} className="linkbtn" style={{ fontSize: 11.5 }}>Reject</button>
            </div>
          </div>
        ))}
        <div style={{ textAlign: 'right', marginTop: 12 }}><button className="linkbtn" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}
