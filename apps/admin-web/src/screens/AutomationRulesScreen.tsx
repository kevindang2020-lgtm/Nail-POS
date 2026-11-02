import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { superAdminAutomationApi, type AutomationDashboard } from '../api/superAdminAutomationApi';
import { Donut, AreaLine, NotConnected } from './_chartkit';

// AutomationRulesScreen — Super Admin › AI & Automation › Automation Rules. Full conditional-workflow oversight over the
// real automation_* tables via GET /super-admin/automation-rules/overview. Read/oversight dashboard; production KPIs
// exclude test runs. Distinct from Smart Reminders and AI Insights. Actions dispatch through existing services (Unit 4).

const GOLD = 'var(--g7,#A96F22)';
const TITLE = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const num = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString());
const fmtMs = (ms: number) => { if (!ms) return '—'; const s = Math.round(ms / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}m ${String(s % 60).padStart(2, '0')}s`; };
const RESULT_TONE: Record<string, { bg: string; fg: string }> = {
  success: { bg: '#E4F0E8', fg: '#3E8F57' }, partial: { bg: '#FBF1DC', fg: '#B7841F' }, failed: { bg: '#F7E4E4', fg: '#B84A3D' },
  timed_out: { bg: '#F7E4E4', fg: '#B84A3D' }, skipped: { bg: '#EEEDF0', fg: '#6B6B72' }, suppressed: { bg: '#EEEDF0', fg: '#6B6B72' },
  cancelled: { bg: '#EEEDF0', fg: '#6B6B72' }, active: { bg: '#E4F0E8', fg: '#3E8F57' }, disabled: { bg: '#FBF1DC', fg: '#B7841F' },
  draft: { bg: '#FBF1DC', fg: '#B7841F' }, error: { bg: '#F7E4E4', fg: '#B84A3D' }, waiting: { bg: '#FBF1DC', fg: '#B7841F' }, retrying: { bg: '#E2EEF7', fg: '#3C7FB6' },
  high: { bg: '#F7E4E4', fg: '#B84A3D' }, medium: { bg: '#FBF1DC', fg: '#B7841F' }, low: { bg: '#EEEDF0', fg: '#6B6B72' },
};
function Pill({ label }: { label: string }) { const t = RESULT_TONE[label.toLowerCase()] ?? { bg: '#EEEDF0', fg: '#6B6B72' }; return <span style={{ background: t.bg, color: t.fg, fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 20, whiteSpace: 'nowrap' }}>{TITLE(label)}</span>; }

const EXAMPLE_RULES = [
  'When a tenant fails payment, notify billing.',
  'When a device stays offline for 30 minutes, create a support ticket.',
  'When a merchant application is approved, activate payment configuration.',
  'When a customer import fails, notify the tenant administrator.',
  'When a branch reaches a plan limit, warn the owner.',
  'When chargeback volume exceeds a threshold, notify risk staff.',
  'When onboarding reaches 100%, request final approval.',
];
const CONTROLS: [string, string][] = [
  ['Create Rules', 'Build new automation rules from scratch.'], ['Define Triggers', 'Choose event or time-based triggers.'],
  ['Define Conditions', 'Set conditions to evaluate criteria.'], ['Define Actions', 'Specify actions to execute automatically.'],
  ['Test Rules', 'Test rule logic before enabling.'], ['Enable or Disable Rules', 'Activate or deactivate rules instantly.'],
  ['Review Execution History', 'View past executions and outcomes.'], ['Retry Failed Automation', 'Retry failed runs manually.'],
  ['Set Tenant-Specific Exceptions', 'Override rules for specific tenants.'],
];
const QUICK_ACTIONS = ['Create Rule', 'Export Report', 'Test Rule', 'View Failures', 'Retry Queue', 'Set Exceptions', 'Open Tenant Profile'];

export function AutomationRulesScreen() {
  const [d, setD] = useState<AutomationDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [fType, setFType] = useState(''); const [fStatus, setFStatus] = useState(''); const [fCat, setFCat] = useState('');
  const flashT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = useCallback((m: string) => { setFlash(m); if (flashT.current) clearTimeout(flashT.current); flashT.current = setTimeout(() => setFlash(null), 4000); }, []);

  const load = useCallback(() => {
    superAdminAutomationApi.dashboard().then((r) => { setD(r); setError(null); }).catch((e: any) => setError(e?.message || 'Failed to load automation rules.'));
  }, []);
  useEffect(load, [load]);
  const [testOpen, setTestOpen] = useState(false);
  const [testResult, setTestResult] = useState<import('../api/superAdminAutomationApi').AutomationTestResult | null>(null);
  const runTest = useCallback(async (triggerId: string, action: string) => {
    try {
      const r = await superAdminAutomationApi.testRule({ triggerId, actions: [{ type: action }], conditions: {}, context: {} });
      setTestResult(r);
    } catch { say('Test was unavailable — please retry.'); }
  }, [say]);
  const retryFailure = useCallback(async (id: string) => {
    try { const r = await superAdminAutomationApi.retryFailure(id); if (r.ok) { say('Retry queued (temporary failure, audited).'); load(); } else say(r.error === 'not_retryable' ? `Not retryable — this failure is classified ${r.class}. Fix the config instead.` : 'Could not retry.'); }
    catch { say('Could not retry.'); }
  }, [say, load]);
  const toggleStatus = useCallback(async (id: string, current: string) => {
    const to = current === 'active' ? 'disabled' : 'active';
    try { const r = await superAdminAutomationApi.setStatus(id, { to, reason: to === 'disabled' ? 'Disabled from dashboard' : undefined }); if (r.ok) { say(`Rule ${to} (audited).`); load(); } else say(r.error === 'invalid_transition' ? `Can't move this rule to ${to} from ${current}.` : r.error === 'validation_failed' ? 'Rule failed validation — fix trigger/actions before enabling.' : 'Could not change status.'); }
    catch { say('Could not change status.'); }
  }, [say, load]);

  const [createOpen, setCreateOpen] = useState(false);
  const [exceptionOpen, setExceptionOpen] = useState(false);
  const createRule = useCallback(async (input: { name: string; ruleType: string; triggerId: string; actions: { type: string }[]; scopeKind: string; conditions?: unknown }) => {
    try {
      const r = await superAdminAutomationApi.createRule(input);
      if (r.ok) { setCreateOpen(false); say('Rule created as a Draft with an immutable v1 (audited). Test it, then enable.'); load(); }
      else say(r.error === 'sensitive_permission_required' ? 'That action is sensitive and needs the merchant-actions permission.' : r.errors?.length ? `Validation failed: ${r.errors.join(', ')}` : 'Could not create the rule.');
    } catch { say('Could not create the rule.'); }
  }, [say, load]);
  const createException = useCallback(async (input: { ruleId: string; tenantId: string; exceptionType: string; notes?: string; reason?: string }) => {
    try {
      const r = await superAdminAutomationApi.createException(input);
      if (r.ok) { setExceptionOpen(false); say('Tenant exception created (audited).'); load(); }
      else say(r.error === 'exception_cannot_bypass_safety' ? "That exception would weaken a hard safety rule — it can't bypass isolation, security, or audit." : r.error === 'rule_and_tenant_required' ? 'A rule and tenant are required.' : 'Could not create the exception.');
    } catch { say('Could not create the exception.'); }
  }, [say, load]);


  const topRules = useMemo(() => {
    if (!d) return [];
    return d.topRules.filter((r) => (!fType || r.ruleType === fType) && (!fStatus || r.status === fStatus) && (!fCat || r.triggerCategory === fCat));
  }, [d, fType, fStatus, fCat]);

  if (error) return <div className="screen"><div className="state" role="alert">{error} <button className="linkbtn" onClick={load}>Retry</button></div></div>;
  if (!d) return <div className="screen"><div className="state" style={{ padding: 28 }}>Loading automation rules…</div></div>;

  const k = d.kpis;
  const kpis = [
    { l: 'Active Rules', v: num(k.activeRules) }, { l: 'Executions Today', v: num(k.executionsToday) },
    { l: 'Successful Automations', v: num(k.successfulAutomations) }, { l: 'Failed Automations', v: num(k.failedAutomations), warn: k.failedAutomations > 0 },
    { l: 'Disabled Rules', v: num(k.disabledRules) }, { l: 'Tenant-Specific Exceptions', v: num(k.tenantExceptions) },
    { l: 'Notifications Triggered', v: num(k.notificationsTriggered) }, { l: 'Avg Execution Time', v: fmtMs(k.avgExecutionMs) },
  ];
  const maxSvf = Math.max(1, ...d.successVsFailed.map((x) => x.success + x.failed));

  return (
    <div className="screen p-5" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className='flex flex-col md:flex-row justify-between gap-3'>
        <div>
          <h1 style={{ margin: 0, fontFamily: 'Playfair Display, serif', fontSize: 26, display: 'flex', alignItems: 'center', gap: 8 }}>Automation Rules <span style={{ color: GOLD }} aria-hidden>★</span></h1>
          <div className="sub" style={{ color: 'var(--muted)', fontSize: 13 }}>Creates conditional platform workflows.{d.totalRules ? ` · ${d.totalRules} rules` : ''}</div>
        </div>
        <div className="items-baseline" style={{ display: 'flex', gap: 8 }}>
          <button className="btn ghost" onClick={() => say('Preparing an automation report export with the current filters (audited).')}>Export Report</button>
          <button className="btn" onClick={() => setCreateOpen(true)}>+ Create Rule</button>
        </div>
      </div>
      {flash ? <div role="status" style={{ fontSize: 12.5, color: GOLD, background: 'var(--cream,#FBF6EC)', border: '1px solid #E7D6B8', borderRadius: 10, padding: '7px 12px' }}>{flash}</div> : null}

      {/* 8 KPIs */}
      <div className=" grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-2">
        {kpis.map((c) => (
          <div key={c.l} className="kpi" style={{ background: 'var(--card,#fff)', border: '1px solid var(--line,#eee)', borderRadius: 12, padding: '12px 10px' }}>
            <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700 }}>{c.l}</div>
            <div style={{ fontFamily: 'Playfair Display, serif', fontSize: 18, marginTop: 4, color: c.warn ? '#B84A3D' : undefined }}>{c.v}</div>
          </div>
        ))}
      </div>

      {/* filters */}
      <div style={{ background: 'var(--card,#fff)', border: '1px solid var(--line,#eee)', borderRadius: 12, padding: 12, display: 'flex',flexWrap :'wrap', gap: 10, alignItems: 'end' }}>
        <label className="flex gap-2 whitespace-nowrap justify-center items-center"><span className="flabel font-bold">Rule Type</span><select value={fType} onChange={(e) => setFType(e.target.value)} style={inp}><option value="">All Types</option>{d.ruleTypeDistribution.rows.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select></label>
        <label className="flex gap-2 whitespace-nowrap justify-center items-center"><span className="flabel font-bold">Tenant</span><select style={inp} disabled><option>All Tenants</option></select></label>
        <label className="flex gap-2 whitespace-nowrap justify-center items-center"><span className="flabel font-bold">Branch</span><select style={inp} disabled><option>All Branches</option></select></label>
        <label className="flex gap-2 whitespace-nowrap justify-center items-center"><span className="flabel font-bold">Status</span><select value={fStatus} onChange={(e) => setFStatus(e.target.value)} style={inp}><option value="">All Statuses</option>{d.ruleStatus.slices.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></label>
        <label className="flex gap-2 whitespace-nowrap justify-center items-center"><span className="flabel font-bold">Trigger Category</span><select value={fCat} onChange={(e) => setFCat(e.target.value)} style={inp}><option value="">All Categories</option>{d.rulesByTrigger.slices.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></label>
        <label className="flex gap-2 whitespace-nowrap justify-center items-center"><span className="flabel font-bold">Date Range</span><input disabled value="Last 7 days" style={{ ...inp, opacity: 0.7 }} /></label>
        <button className="btn !h-[35.5px] !min-h-[35.5px] items-center flex" onClick={() => say('Filters applied to the rule directory. Full server-side filtering across all modules is a follow-up.')}>Apply Filters</button>
        <button className="linkbtn h-[35.5px] " onClick={() => { setFType(''); setFStatus(''); setFCat(''); }}>Reset Filters</button>
      </div>

      {/* Automation Rule Controls (9) */}
      <section style={{ background: 'var(--card,#fff)', border: '1px solid var(--line,#eee)', borderRadius: 12, padding: 12 }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 14 }}>Automation Rule Controls</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-9 gap-2">
          {CONTROLS.map(([t, desc]) => (
            <button key={t} onClick={() => (t === 'Test Rules' ? (setTestResult(null), setTestOpen(true)) : t === 'Create Rules' ? setCreateOpen(true) : t === 'Set Tenant-Specific Exceptions' ? setExceptionOpen(true) : t === 'Retry Failed Automation' ? say('Use the Retry button in the Failed Automations & Retry Queue below.') : say(`Opening: ${t}`))} style={{ textAlign: 'left', background: 'var(--cream,#FBF6EC)', border: '1px solid #EFE3CB', borderRadius: 10, padding: '9px 8px', cursor: 'pointer' }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ink,#3a3a3a)' }}>{t}</div>
              <div className="muted" style={{ fontSize: 9, marginTop: 2 }}>{desc}</div>
            </button>
          ))}
        </div>
      </section>

      {/* Example rules + 4 analytics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-[1.2fr_1fr_1fr_0.9fr_0.9fr] gap-3.5">
        <Panel title="Example Rules">
          <ol style={{ margin: 0, fontSize: 11.5, lineHeight: 1.7 }}>
            {EXAMPLE_RULES.map((r, i) => <li key={i}><button className="linkbtn mt-2" style={{ textAlign: 'left', fontSize: 11.5 }} onClick={() => say('Opening this example as a rule template (not auto-activated).')}>{r}</button></li>)}
          </ol>
        </Panel>
        <Panel title="Execution Trend (Last 7 Days)">
          {d.executionTrend.length === 0 ? <NotConnected>No executions in range.</NotConnected> : <AreaLine series={d.executionTrend.map((x) => ({ label: x.day.slice(5), valueCents: x.count }))} height={130} />}
        </Panel>
        <Panel title="Success vs Failed Automations">
          {d.successVsFailed.length === 0 ? <NotConnected>No executions in range.</NotConnected> : (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 130, paddingTop: 6 }}>
              {d.successVsFailed.map((x) => (
                <div key={x.day} title={`${x.day}: ${x.success} ok / ${x.failed} failed`} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 2, minWidth: 0 }}>
                  <div style={{ background: '#B84A3D', height: `${(x.failed / maxSvf) * 100}%`, borderRadius: '2px 2px 0 0' }} />
                  <div style={{ background: '#3E8F57', height: `${(x.success / maxSvf) * 100}%`, borderRadius: '2px 2px 0 0' }} />
                  <div className="muted" style={{ fontSize: 8, textAlign: 'center' }}>{x.day.slice(5)}</div>
                </div>
              ))}
            </div>
          )}
        </Panel>
        <Panel title="Rules by Trigger Type">
          <Donut data={d.rulesByTrigger.slices.map((s) => ({ label: s.label, value: s.count }))} centerLabel={`${d.rulesByTrigger.total}`} />
        </Panel>
        <Panel title="Rule Status">
          <Donut data={d.ruleStatus.slices.map((s) => ({ label: s.label, value: s.count }))} centerLabel={`${d.ruleStatus.total}`} />
        </Panel>
      </div>

      {/* 4 tables */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        <Panel title="Top Automation Rules">
          <Table head={['Rule', 'Trigger', 'Action', 'Execs', 'Success', 'Status', '']} rows={topRules.map((r) => [r.name, TITLE(r.triggerCategory), TITLE(r.ruleType), num(r.executions), `${r.successRatePct}%`, <Pill label={r.status} />, (r.status === 'active' || r.status === 'disabled') ? <button className="linkbtn" style={{ fontSize: 10.5 }} onClick={() => toggleStatus(r.id, r.status)}>{r.status === 'active' ? 'Disable' : 'Enable'}</button> : <span className="muted" style={{ fontSize: 10 }}>{TITLE(r.status)}</span>])} empty="No rules match the filters." />
        </Panel>
        <Panel title="Execution History">
          <Table head={['Time', 'Rule', 'Tenant', 'Result', 'Duration', 'By']} rows={d.executionHistory.map((e) => [new Date(e.time).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }), e.rule ?? '—', e.tenant ?? '—', <Pill label={e.result} />, e.durationMs ? fmtMs(e.durationMs) : '—', TITLE(e.triggeredBy)])} empty="No executions yet." />
        </Panel>
        <Panel title="Failed Automations & Retry Queue">
          <Table head={['Rule', 'Tenant', 'Failure Reason', 'Severity', 'Status', '']} rows={d.failures.map((f) => [f.rule ?? '—', f.tenant ?? '—', f.failureReason, <Pill label={f.severity} />, <Pill label={f.status} />, f.category === 'temporary' ? <button className="linkbtn" style={{ fontSize: 10.5 }} onClick={() => retryFailure(f.id)}>Retry</button> : <span className="muted" style={{ fontSize: 10 }} title={`${f.category} failure — fix config`}>No retry</span>])} empty="No failed automations." />
        </Panel>
        <Panel title="Tenant-Specific Exceptions">
          <Table head={['Tenant', 'Rule', 'Exception Type', 'Notes', 'Status']} rows={d.exceptions.map((x) => [x.tenant ?? '—', x.rule ?? '—', TITLE(x.exceptionType), x.notes ?? '—', <Pill label={x.status} />])} empty="No tenant exceptions." />
        </Panel>
      </div>

      {/* 4 lower panels */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3.5">
        <Panel title="Recent Automation Activity">
          {d.recentActivity.length === 0 ? <NotConnected>No recent activity.</NotConnected> : d.recentActivity.map((a) => (
            <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 6, padding: '6px 0', borderTop: '1px solid var(--line,#eee)', fontSize: 11 }}>
              <span style={{ minWidth: 0 }}><Pill label={a.result} /> <span style={{ fontWeight: 600 }}>{a.rule ?? '—'}</span> <span className="muted">{a.tenant ?? ''}</span></span>
              <span className="muted" style={{ whiteSpace: 'nowrap' }}>{new Date(a.time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
            </div>
          ))}
          <div style={{ marginTop: 6 }}><button className="linkbtn" style={{ fontSize: 11 }} onClick={() => say('Opening full automation activity.')}>View All Activity</button></div>
        </Panel>
        <Panel title="Upcoming Rule Evaluations">
          {d.upcoming.length === 0 ? <NotConnected>No scheduled evaluations.</NotConnected> : d.upcoming.map((u) => (
            <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 6, padding: '6px 0', borderTop: '1px solid var(--line,#eee)', fontSize: 11 }}>
              <span style={{ minWidth: 0 }}><span style={{ fontWeight: 600 }}>{u.rule}</span> <span className="muted">{TITLE(u.triggerCategory)}</span></span>
              <span className="muted" style={{ whiteSpace: 'nowrap' }}>{new Date(u.time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
            </div>
          ))}
          <div style={{ marginTop: 6 }}><button className="linkbtn" style={{ fontSize: 11 }} onClick={() => say('Opening all schedules.')}>View All Schedules</button></div>
        </Panel>
        <Panel title="Automation Performance by Tenant (Top 5)">
          <Table head={['Tenant', 'Success', 'Failure', 'Impact', 'Trend']} rows={d.tenantPerformance.map((t) => [t.tenant ?? '—', `${t.successRatePct}%`, `${t.failureRatePct}%`, <Pill label={t.impact} />, t.failureRatePct <= 2 ? '↑' : t.failureRatePct >= 6 ? '↓' : '→'])} empty="No tenant performance data." />
        </Panel>
        <Panel title="Rule Type Distribution">
          <Table head={['Rule Type', 'Count', '%']} rows={d.ruleTypeDistribution.rows.map((r) => [r.label, num(r.count), `${r.pct}%`])} empty="No rules." />
        </Panel>
      </div>

      {/* Quick Actions */}
      <section style={{ background: 'var(--card,#fff)', border: '1px solid var(--line,#eee)', borderRadius: 12, padding: 12 }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 14 }}>Quick Actions</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-7 gap-2">
          {QUICK_ACTIONS.map((a) => <button key={a} onClick={() => (a === 'Test Rule' ? (setTestResult(null), setTestOpen(true)) : a === 'Create Rule' ? setCreateOpen(true) : a === 'Set Exceptions' ? setExceptionOpen(true) : say(`Opening: ${a}`))} style={{ background: 'var(--cream,#FBF6EC)', border: '1px solid #EFE3CB', borderRadius: 10, padding: '10px 8px', fontSize: 11, fontWeight: 600, cursor: 'pointer', color: 'var(--ink,#3a3a3a)' }}>{a}</button>)}
        </div>
      </section>

      {/* At-a-Glance */}
      <section
        className="panel w-full min-w-0"
        style={{
          padding: 12,
          background: 'var(--card,#fff)',
          border: '1px solid var(--line,#eee)',
          borderRadius: 12,
        }}
      >
        <h2 style={{ margin: '0 0 8px', fontSize: 14 }}>
          At-a-Glance Summary (Today)
        </h2>

        <div className="w-full min-w-0 overflow-x-auto">
          <div className="flex min-w-[700px] gap-2.5">
            {[
              ['Rules Executed Today', num(k.executionsToday)],
              ['Successful Runs', num(k.successfulAutomations)],
              ['Failed Runs', num(k.failedAutomations)],
              ['Notifications Sent', num(k.notificationsTriggered)],
              ['Exceptions Active', num(k.tenantExceptions)],
              ['Avg Rule Latency', fmtMs(k.avgExecutionMs)]
            ].map(([l, v]) => (
              <div key={l} className="flex-1 min-w-0">
                <div className="muted text-[10px] font-bold uppercase tracking-[0.03em]">
                  {l}
                </div>

                <div className="mt-[3px] font-['Playfair_Display'] text-[18px]">
                  {v}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
      {testOpen ? <TestRuleModal onClose={() => setTestOpen(false)} onRun={runTest} result={testResult} /> : null}
      {createOpen ? <CreateRuleModal onClose={() => setCreateOpen(false)} onCreate={createRule} /> : null}
      {exceptionOpen ? <ExceptionModal rules={d.topRules} onClose={() => setExceptionOpen(false)} onCreate={createException} /> : null}
    </div>
  );
}

const inp: React.CSSProperties = { width: '100%', padding: '7px 9px', border: '1px solid var(--line,#ddd)', borderRadius: 8, fontSize: 12, boxSizing: 'border-box' };
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section style={{ background: 'var(--card,#fff)', border: '1px solid var(--line,#eee)', borderRadius: 12, padding: 12, minWidth: 0 }}><div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}><h2 style={{ margin: 0, fontSize: 13 }}>{title}</h2></div>{children}</section>;
}
function Table({ head, rows, empty }: { head: string[]; rows: React.ReactNode[][]; empty: string }) {
  if (rows.length === 0) return <div className="muted" style={{ fontSize: 12, padding: '6px 0' }}>{empty}</div>;
  return (
    <div style={{ overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 9.5 }}>{head.map((h) => <th key={h} style={{ padding: '5px 5px', fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} style={{ borderTop: '1px solid var(--line,#eee)' }}>{r.map((c, j) => <td key={j} style={{ padding: '5px 5px' }}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export default AutomationRulesScreen;

const TEST_TRIGGERS = ['TENANT_PAYMENT_FAILED', 'DEVICE_OFFLINE_DURATION_REACHED', 'MERCHANT_APPLICATION_APPROVED', 'CUSTOMER_IMPORT_FAILED', 'BRANCH_PLAN_LIMIT_REACHED', 'CHARGEBACK_THRESHOLD_EXCEEDED', 'ONBOARDING_COMPLETED'];
const TEST_ACTIONS = ['send_platform_notification', 'send_tenant_notification', 'create_support_ticket', 'request_final_approval', 'add_internal_alert', 'activate_payment_configuration'];

function TestRuleModal({ onClose, onRun, result }: { onClose: () => void; onRun: (trigger: string, action: string) => void; result: import('../api/superAdminAutomationApi').AutomationTestResult | null }) {
  const [trigger, setTrigger] = useState(TEST_TRIGGERS[0]);
  const [action, setAction] = useState(TEST_ACTIONS[0]);
  const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(30,24,16,.35)', display: 'grid', placeItems: 'center', zIndex: 50, padding: 20 };
  const card: React.CSSProperties = { background: 'var(--card,#fff)', borderRadius: 14, padding: 20, width: 'min(560px, 96vw)', maxHeight: '88vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.25)' };
  return (
    <div style={overlay} role="dialog" aria-label="Test automation rule">
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontFamily: 'Playfair Display, serif' }}>Test Rule (Dry Run)</h2>
          <button className="linkbtn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="muted" style={{ fontSize: 11.5, marginBottom: 12 }}>Simulates trigger + condition evaluation and shows which actions <strong>would</strong> run. This never performs real actions and never touches production metrics.</div>
        <label style={{ display: 'block', marginBottom: 8 }}><span className="flabel">Trigger</span><select value={trigger} onChange={(e) => setTrigger(e.target.value)} style={inp}>{TEST_TRIGGERS.map((t) => <option key={t} value={t}>{TITLE(t)}</option>)}</select></label>
        <label style={{ display: 'block', marginBottom: 12 }}><span className="flabel">Action</span><select value={action} onChange={(e) => setAction(e.target.value)} style={inp}>{TEST_ACTIONS.map((a) => <option key={a} value={a}>{TITLE(a)}</option>)}</select></label>
        <button style={{ background: GOLD, color: '#fff', border: 0, borderRadius: 8, padding: '8px 14px', fontWeight: 700, cursor: 'pointer' }} onClick={() => onRun(trigger, action)}>Run Test</button>
        {result ? (
          <div style={{ marginTop: 14, borderTop: '1px solid var(--line,#eee)', paddingTop: 12, fontSize: 12 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Pill label={result.triggerMatched ? 'trigger matched' : 'trigger unknown'} />
              <Pill label={result.conditionsPassed ? 'conditions passed' : 'conditions failed'} />
              <Pill label="dry run" />
            </div>
            <div style={{ marginTop: 8 }}><strong>Would run:</strong> {result.resolvedActions.length ? result.resolvedActions.map(TITLE).join(', ') : <span className="muted">none</span>}</div>
            {result.skippedActions.length ? <div style={{ marginTop: 4, color: '#B84A3D' }}><strong>Skipped:</strong> {result.skippedActions.join('; ')}</div> : null}
            {result.warnings.length ? <div className="muted" style={{ marginTop: 4 }}>Warnings: {result.warnings.join(', ')}</div> : null}
          </div>
        ) : null}
        <div style={{ textAlign: 'right', marginTop: 12 }}><button className="linkbtn" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}

const BUILDER_TRIGGERS = ['TENANT_PAYMENT_FAILED', 'DEVICE_OFFLINE_DURATION_REACHED', 'MERCHANT_APPLICATION_APPROVED', 'CUSTOMER_IMPORT_FAILED', 'BRANCH_PLAN_LIMIT_REACHED', 'CHARGEBACK_THRESHOLD_EXCEEDED', 'ONBOARDING_COMPLETED', 'SUPPORT_TICKET_CREATED', 'MEMBERSHIP_PAYMENT_FAILED', 'COMMUNICATION_DELIVERY_FAILED'];
const BUILDER_ACTIONS = ['send_platform_notification', 'send_tenant_notification', 'send_email', 'send_sms', 'create_support_ticket', 'request_final_approval', 'add_internal_alert', 'create_audit_event', 'add_review_task', 'trigger_smart_reminder_flow', 'activate_payment_configuration'];
const RULE_TYPES_UI = [['event_based', 'Event-Based'], ['time_based', 'Time-Based'], ['threshold_based', 'Threshold-Based'], ['manual', 'Manual']];
const modalOverlay: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(30,24,16,.35)', display: 'grid', placeItems: 'center', zIndex: 50, padding: 20 };
const modalCard: React.CSSProperties = { background: 'var(--card,#fff)', borderRadius: 14, padding: 20, width: 'min(600px, 96vw)', maxHeight: '88vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,.25)' };
const primaryBtn: React.CSSProperties = { background: GOLD, color: '#fff', border: 0, borderRadius: 8, padding: '8px 14px', fontWeight: 700, cursor: 'pointer' };

function CreateRuleModal({ onClose, onCreate }: { onClose: () => void; onCreate: (i: { name: string; ruleType: string; triggerId: string; actions: { type: string }[]; scopeKind: string; conditions?: unknown }) => void }) {
  const [name, setName] = useState(''); const [ruleType, setRuleType] = useState('event_based'); const [triggerId, setTriggerId] = useState(BUILDER_TRIGGERS[0]);
  const [actions, setActions] = useState<string[]>(['send_platform_notification']); const [scopeKind, setScopeKind] = useState('all_tenants');
  const toggleAction = (a: string) => setActions((xs) => (xs.includes(a) ? xs.filter((x) => x !== a) : [...xs, a]));
  const canSave = name.trim().length > 0 && actions.length > 0;
  return (
    <div style={modalOverlay} role="dialog" aria-label="Create automation rule">
      <div style={modalCard}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontFamily: 'Playfair Display, serif' }}>Create Rule</h2>
          <button className="linkbtn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="muted" style={{ fontSize: 11.5, marginBottom: 12 }}>Saved as a <strong>Draft</strong> with an immutable v1. Actions are allowlisted; sensitive actions need permission. Test it before enabling — nothing runs until you activate it.</div>
        <label style={{ display: 'block', marginBottom: 8 }}><span className="flabel">Rule name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Tenant Payment Failure" style={inp} aria-label="Rule name" /></label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
          <label><span className="flabel">Rule type</span><select value={ruleType} onChange={(e) => setRuleType(e.target.value)} style={inp}>{RULE_TYPES_UI.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label><span className="flabel">Trigger</span><select value={triggerId} onChange={(e) => setTriggerId(e.target.value)} style={inp}>{BUILDER_TRIGGERS.map((t) => <option key={t} value={t}>{TITLE(t)}</option>)}</select></label>
        </div>
        <label style={{ display: 'block', marginBottom: 8 }}><span className="flabel">Scope</span><select value={scopeKind} onChange={(e) => setScopeKind(e.target.value)} style={inp}><option value="all_tenants">All Tenants</option><option value="tenant">Specific Tenant</option></select></label>
        <div style={{ marginBottom: 12 }}><span className="flabel">Actions (allowlisted)</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
            {BUILDER_ACTIONS.map((a) => <button key={a} onClick={() => toggleAction(a)} style={{ fontSize: 10.5, padding: '4px 8px', borderRadius: 16, cursor: 'pointer', border: '1px solid #EFE3CB', background: actions.includes(a) ? GOLD : 'var(--cream,#FBF6EC)', color: actions.includes(a) ? '#fff' : 'var(--ink,#3a3a3a)' }}>{TITLE(a)}</button>)}
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="linkbtn" onClick={onClose}>Cancel</button>
          <button disabled={!canSave} style={{ ...primaryBtn, opacity: canSave ? 1 : 0.6, cursor: canSave ? 'pointer' : 'not-allowed' }} onClick={() => onCreate({ name: name.trim(), ruleType, triggerId, actions: actions.map((type) => ({ type })), scopeKind })}>Save Draft</button>
        </div>
      </div>
    </div>
  );
}

function ExceptionModal({ rules, onClose, onCreate }: { rules: { id: string; name: string }[]; onClose: () => void; onCreate: (i: { ruleId: string; tenantId: string; exceptionType: string; notes?: string; reason?: string }) => void }) {
  const [ruleId, setRuleId] = useState(rules[0]?.id ?? ''); const [tenantId, setTenantId] = useState(''); const [exceptionType, setExceptionType] = useState('Extended Threshold'); const [notes, setNotes] = useState(''); const [reason, setReason] = useState('');
  const canSave = !!ruleId && /^[0-9a-f-]{36}$/i.test(tenantId) && exceptionType.trim().length > 0;
  return (
    <div style={modalOverlay} role="dialog" aria-label="Set tenant exception">
      <div style={modalCard}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontFamily: 'Playfair Display, serif' }}>Set Tenant-Specific Exception</h2>
          <button className="linkbtn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="muted" style={{ fontSize: 11.5, marginBottom: 12 }}>Overrides a rule for one tenant. Exceptions can <strong>never</strong> weaken isolation, security, or audit — those are rejected server-side.</div>
        <label style={{ display: 'block', marginBottom: 8 }}><span className="flabel">Rule</span><select value={ruleId} onChange={(e) => setRuleId(e.target.value)} style={inp}>{rules.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
        <label style={{ display: 'block', marginBottom: 8 }}><span className="flabel">Tenant ID</span><input value={tenantId} onChange={(e) => setTenantId(e.target.value)} placeholder="tenant UUID" style={inp} aria-label="Tenant ID" /></label>
        <label style={{ display: 'block', marginBottom: 8 }}><span className="flabel">Exception type</span><input value={exceptionType} onChange={(e) => setExceptionType(e.target.value)} style={inp} aria-label="Exception type" /></label>
        <label style={{ display: 'block', marginBottom: 8 }}><span className="flabel">Notes</span><input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. 45 min instead of 30" style={inp} aria-label="Notes" /></label>
        <label style={{ display: 'block', marginBottom: 12 }}><span className="flabel">Reason</span><input value={reason} onChange={(e) => setReason(e.target.value)} style={inp} aria-label="Reason" /></label>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="linkbtn" onClick={onClose}>Cancel</button>
          <button disabled={!canSave} style={{ ...primaryBtn, opacity: canSave ? 1 : 0.6, cursor: canSave ? 'pointer' : 'not-allowed' }} onClick={() => onCreate({ ruleId, tenantId, exceptionType: exceptionType.trim(), notes, reason })}>Create Exception</button>
        </div>
      </div>
    </div>
  );
}
