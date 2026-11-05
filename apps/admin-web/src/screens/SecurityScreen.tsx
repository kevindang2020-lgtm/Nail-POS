import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { superAdminApi } from '../api/superAdminApi';
import { NotConnected } from './_chartkit';
import { SecurityIpBlockModal } from './SecurityIpBlockModal';
import { SecuritySessionRevokeModal } from './SecuritySessionRevokeModal';
import { SecurityIncidentModal } from './SecurityIncidentModal';
import { SecurityPolicyModal } from './SecurityPolicyModal';
import { SecurityLockdownModal } from './SecurityLockdownModal';
import { SecurityGrantModal } from './SecurityGrantModal';
import { SecurityRetentionModal } from './SecurityRetentionModal';

// SecurityScreen.tsx — Super Admin › System Settings › Security & Compliance. The central security-management surface.
// Real sources: users.mfa_enabled, login_attempts, sessions/refresh_tokens, customer_privacy_requests, report_exports,
// alerts, audit_events, tenant_backup_requests. Widgets with a real source show real data (IPs MASKED, locations
// approximate); everything unmodelled (security incidents, IP blocks, threat signals, compliance/PCI controls,
// encryption health, DR, session risk-tiers, policies) renders an honest "Not connected". No fabrication, no secrets.

type Kpi = { value: number | string | null; available: boolean; note?: string; deltaTone?: string };
type Gap = { available: false; note?: string };
/** Constitution 12 §270: key-ring, rotation, boot posture and security-event counts — names and counts only, never key material. */
type EncryptionHealth = {
  available: true;
  keys: Array<{ purpose: string; env: string; state: 'configured' | 'fallback' | 'optional_unset' }>;
  rotationOverdue: string[];
  posture: Array<{ variable: string; problem: string }>;
  events24h: { total: number; bySeverity: Record<string, number>; topTypes: Array<{ type: string; count: number }> };
};
type Overview = {
  kpis: Record<'twoFaEnabledUsers' | 'failedLoginActivity' | 'suspiciousSessions' | 'privilegedAccounts' | 'dataExportEvents' | 'privacyRequests' | 'securityIncidents' | 'complianceStatus' | 'encryptionStatus' | 'backupStatus' | 'sessionPolicyStatus' | 'passwordPolicyStatus', Kpi>;
  failedLoginTrend: { day: string; count: number }[];
  authOverview: { userId: string; name: string; role: string; mfaStatus: string; lastLogin: string | null; failedLogins: number; sessionStatus: string; privileged: boolean; riskLevel: string }[];
  activeSessions: { user: string; ip: string; device: string; location: string; role: string; lastActivity: string | null; status: string; tone: string }[];
  privacyRequests: { requestType: string; events: number; status: string; requester: string; dueDate: string | null; owner: string }[];
  roleRestrictions: { roleCategory: string; users: number; privileged: string }[];
  activePrivilegedGrants?: number;
  recentAlerts: { id: string; title: string; severity: string | null; tenant: string | null; createdAt: string | null }[];
  auditFeed: { id: string; occurredAt: string | null; actor: string; actorRole: string; module: string; action: string; status: string; severity: string; ip: string; tenant: string | null }[];
  atAGlance: Record<'failedLoginsToday' | 'incidentsOpened' | 'privacyRequestsPending' | 'sessionsRevoked' | 'blockedIps' | 'backupJobsCompleted', { value: number | null; available: boolean; note?: string; deltaTone?: string; completionPct?: number }>;
  suspiciousMix: Gap; complianceBreakdown: Gap; encryptionHealth: Gap | EncryptionHealth; pciControls: Gap; backupRecovery: Gap;
  securityIncidents: Gap | { available: true; rows: { incidentRef: string; severity: string; status: string; assignedTo: string; updatedAt: string | null }[] };
  incidentWorkflow: Gap | { available: true; stages: { detected: number; investigating: number; contained: number; remediating: number; closed: number } };
  blockedIps: Gap | { available: true; rows: { target: string; threatType: string; country: string; blockedAt: string | null; status: string }[]; activeCount: number };
};

const fmtDate = (s: string | null) => { if (!s) return '—'; try { return new Date(s).toLocaleString(); } catch { return '—'; } };
const csvCell = (v: unknown) => { const s = String(v ?? ''); const g = /^[=+\-@]/.test(s) ? "'" + s : s; return '"' + g.replace(/"/g, '""') + '"'; };
const riskColor = (r: string) => ({ Low: '#1F9254', Medium: '#B7791F', High: '#C0392B', Critical: '#7C1D12' } as Record<string, string>)[r] || '#6B7280';
const toneColor = (t?: string) => ({ good: '#1F9254', bad: '#C0392B', review: '#7C3AED', neutral: '#2F6FED' } as Record<string, string>)[t || ''] || '#6B7280';

const CONTROLS = [
  ['Enforce Two-Factor Authentication', 'Require MFA for approved roles and users.'], ['Configure Password Policies', 'Manage password strength, rotation, and reset rules.'],
  ['Configure Session Timeouts', 'Control inactivity and maximum-session durations.'], ['Restrict Access by Role', 'Configure privileged and restricted permissions.'],
  ['Revoke Active Sessions', 'Invalidate selected user or platform sessions.'], ['Block IP Addresses', 'Block malicious or prohibited network sources.'],
  ['Review Security Alerts', 'Investigate active security warnings and risks.'], ['Manage Data-Retention Rules', 'Configure retention and deletion schedules.'],
  ['Configure Privacy Workflows', 'Manage access, export, deletion, and legal-hold workflows.'], ['Review PCI-Related Controls', 'Review payment-security control status.'],
  ['Manage Incident-Response Records', 'Create, assign, update, and close security incidents.'], ['Initiate Emergency Account Lockdown', 'Restrict account access during a critical security event.'],
] as const;
const QUICK = ['Lock Account', 'Revoke Sessions', 'Force Password Reset', 'Export Report', 'Review Alerts', 'Open Incident', 'Privacy Workflow'];
const FILTERS = [['Tenant', 'All Tenants'], ['Branch', 'All Branches'], ['Severity', 'All'], ['Compliance Scope', 'All Scopes'], ['Role Type', 'All Roles'], ['Status', 'All Statuses']] as const;

function TrendLine({ data }: { data: { day: string; count: number }[] }) {
  if (!data.length) return <NotConnected>No failed-login activity in range.</NotConnected>;
  const w = 320, h = 150, pad = 8; const max = Math.max(1, ...data.map((d) => d.count));
  const X = (i: number) => pad + (i * (w - 2 * pad)) / Math.max(1, data.length - 1);
  const pts = data.map((d, i) => `${X(i)},${h - pad - (d.count / max) * (h - 2 * pad)}`).join(' ');
  return <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="150" role="img" aria-label="Failed login trend, last 7 days"><polyline points={pts} fill="none" stroke="#F0820B" strokeWidth={2} />{data.map((d, i) => { const [x, y] = [X(i), h - pad - (d.count / max) * (h - 2 * pad)]; return <circle key={i} cx={x} cy={y} r={2.5} fill="#F0820B" />; })}</svg>;
}

type AuditRun = { id: string; trigger: string; status: string; startedAt: string; findingsOpen: number; findingsResolved: number };
type AuditFinding = { id: string; severity: string; status: string; title: string; detail: string | null; occurrences: number };

export function SecurityScreen() {
  const nav = useNavigate();
  const [o, setO] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ipModalOpen, setIpModalOpen] = useState(false);
  const [revokeModalOpen, setRevokeModalOpen] = useState(false);
  const [incidentModalOpen, setIncidentModalOpen] = useState(false);
  const [policyKind, setPolicyKind] = useState<'mfa' | 'password' | 'session' | null>(null);
  const [lockdownModalOpen, setLockdownModalOpen] = useState(false);
  const [grantModalOpen, setGrantModalOpen] = useState(false);
  const [retentionModalOpen, setRetentionModalOpen] = useState(false);

  useEffect(() => { (superAdminApi.securityOverview() as Promise<Overview>).then(setO).catch((e: any) => setError(e?.message || 'Failed to load security posture.')); }, []);
  const [auditRuns, setAuditRuns] = useState<AuditRun[]>([]);
  const [auditFindings, setAuditFindings] = useState<AuditFinding[]>([]);
  const [auditBusy, setAuditBusy] = useState(false);
  const [auditMsg, setAuditMsg] = useState('');
  const loadAudit = () => {
    (superAdminApi.securityAuditRuns(10) as Promise<AuditRun[]>).then(setAuditRuns).catch(() => {});
    (superAdminApi.securityAuditFindings() as Promise<AuditFinding[]>).then(setAuditFindings).catch(() => {});
  };
  useEffect(loadAudit, []);
  const runAuditNow = () => {
    setAuditBusy(true); setAuditMsg('');
    (superAdminApi.securityAuditRun() as Promise<any>)
      .then((r) => { setAuditMsg(r?.ran === false ? (r?.skippedReason || 'Skipped — already running.') : `Run complete: ${r?.open ?? 0} open, ${r?.resolved ?? 0} resolved.`); loadAudit(); })
      .catch((e: any) => setAuditMsg(e?.message || 'Run failed.'))
      .finally(() => setAuditBusy(false));
  };

  const exportReport = () => {
    if (!o) return;
    const head = ['User/Role', '2FA', 'Last Login', 'Failed Logins', 'Session', 'Privileged', 'Risk'];
    const body = o.authOverview.map((a) => [`${a.name} (${a.role})`, a.mfaStatus, fmtDate(a.lastLogin), a.failedLogins, a.sessionStatus, a.privileged ? 'Yes' : 'No', a.riskLevel].map(csvCell).join(','));
    const csv = [head.map(csvCell).join(','), ...body].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); const el = document.createElement('a'); el.href = url; el.download = `security-report-${new Date().toISOString().slice(0, 10)}.csv`; el.click(); URL.revokeObjectURL(url);
    setNotice('Exported the authentication & access overview (secrets and tokens excluded).');
  };
  const emergencyLockdown = () => setLockdownModalOpen(true);
  const controlAction = (label: string) => {
    if (label === 'Restrict Access by Role') return nav('/users-roles');
    if (label === 'Review Security Alerts') return nav('/audit-logs');
    if (label === 'Block IP Addresses') return setIpModalOpen(true);
    if (label === 'Revoke Active Sessions') return setRevokeModalOpen(true);
    if (label === 'Manage Incident-Response Records') return setIncidentModalOpen(true);
    if (label === 'Enforce Two-Factor Authentication') return setPolicyKind('mfa');
    if (label === 'Configure Password Policies') return setPolicyKind('password');
    if (label === 'Configure Session Timeouts') return setPolicyKind('session');
    if (label === 'Initiate Emergency Account Lockdown') return setLockdownModalOpen(true);
    if (label === 'Configure Privacy Workflows') return nav('/customer-data-oversight');
    if (label === 'Manage Data-Retention Rules') return setRetentionModalOpen(true);
    setNotice(`${label}: this security control requires its backend foundation (policy/IP-block/incident/lockdown schema), which isn't connected yet.`);
  };

  if (error) return <div className="screen"><div className="state">{error}</div></div>;
  if (!o) return <div className="screen"><div className="state">Loading security posture…</div></div>;

  const kpiCards: [string, Kpi, string][] = [
    ['2FA Enabled Users', o.kpis.twoFaEnabledUsers, '#E7F5EC'], ['Failed Login Activity', o.kpis.failedLoginActivity, '#FBE7E4'],
    ['Suspicious Sessions', o.kpis.suspiciousSessions, '#FBF0DC'], ['Privileged Accounts', o.kpis.privilegedAccounts, '#F3ECFB'],
    ['Data-Export Events', o.kpis.dataExportEvents, '#EAF1FF'], ['Privacy Requests', o.kpis.privacyRequests, '#EAF1FF'],
    ['Security Incidents', o.kpis.securityIncidents, '#FBE7E4'], ['Compliance Status', o.kpis.complianceStatus, '#E7F5EC'],
    ['Encryption Status', o.kpis.encryptionStatus, '#E7F5EC'], ['Backup Status', o.kpis.backupStatus, '#E7F5EC'],
    ['Session Policy Status', o.kpis.sessionPolicyStatus, '#EAF1FF'], ['Password Policy Status', o.kpis.passwordPolicyStatus, '#EAF1FF'],
  ];
  const glance: [string, { value: number | null; available: boolean; note?: string; deltaTone?: string; completionPct?: number }][] = [
    ['Failed Logins Today', o.atAGlance.failedLoginsToday], ['Incidents Opened', o.atAGlance.incidentsOpened], ['Privacy Requests Pending', o.atAGlance.privacyRequestsPending],
    ['Sessions Revoked', o.atAGlance.sessionsRevoked], ['Blocked IPs', o.atAGlance.blockedIps], ['Backup Jobs Completed Today', o.atAGlance.backupJobsCompleted],
  ];

  return (
    <div className="screen" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="flex flex-col lg:flex-row justify-between gap-3" >
        <div className="vh"><h1>Security &amp; Compliance <span style={{ color: '#DCB056' }}>★</span></h1><div className="sub">The central security-management area.</div></div>
        <div className="self-baseline flex-wrap" style={{ display: 'flex', gap: 8 }}><button className="btn ghost" onClick={exportReport}>Export Security Report</button><button className="btn" onClick={emergencyLockdown}> Emergency Lockdown</button></div>
      </div>

      <div className="state" role="note" style={{ fontSize: 12, background: '#EAF1FF', border: '1px solid #B8CCF0', borderRadius: 8, padding: '8px 12px', color: '#274690' }}>
        ⓘ Security administrators have special permissions. Ordinary support employees do not have access to privileged security controls.
      </div>

      {notice && <div className="state" role="status" style={{ fontSize: 12, background: '#FBF0DC', border: '1px solid #F0D9A8', borderRadius: 8, padding: '8px 12px', display: 'flex', justifyContent: 'space-between', gap: 12 }}><span>{notice}</span><button className="linkbtn" onClick={() => setNotice(null)}>Dismiss</button></div>}

      {/* 12 KPIs */}
      <div className=" grid  grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2.5 mb-3 mt-3">
        {kpiCards.map(([l, k, bg]) => (
          <div className="kpi" key={l} aria-label={`${l}: ${k.available ? k.value : 'not connected'}`}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ width: 24, height: 24, borderRadius: 999, background: bg, flex: 'none' }} /><div className="l" style={{ fontSize: 11 }}>{l}</div></div>
            <div className="font-medium text-base" style={{ marginTop: 4 }} title={k.note || ''}>{k.available ? k.value : <NotConnected>Not connected</NotConnected>}</div>
            {k.available && k.note ? <div className="muted" style={{ fontSize: 10, color: toneColor(k.deltaTone) }}>{k.note}</div> : null}
          </div>
        ))}
      </div>

      {/* Filters */}
      <section className="panel">
        <div className="flex flex-wrap items-end gap-1.5 whitespace-nowrap">
          {FILTERS.slice(0, 5).map(([l, d]) => (<label key={l}  className="muted text-[10.5px] flex items-center justify-center border border-[var(--line)] rounded-[10px] p-1">{l}<select className="inp" disabled title="The security overview is platform-wide — filtering it by tenant, branch, severity, scope, role or status is not available yet" style={{ width: '100%', height: 32, marginTop: 2 }}><option>{d}</option></select></label>))}
          <label className="muted text-[10.5px] flex items-center justify-center border border-[var(--line)] rounded-[10px] p-1">Date Range<input className="inp" disabled title="The security overview is platform-wide — filtering it by tenant, branch, severity, scope, role or status is not available yet" style={{ width: '100%', height: 32, marginTop: 2 }} defaultValue={`${new Date().toLocaleDateString()}`} /></label>
          <label className="muted text-[10.5px] flex items-center justify-center border border-[var(--line)] rounded-[10px] p-1">Status<select className="inp" disabled title="The security overview is platform-wide — filtering it by tenant, branch, severity, scope, role or status is not available yet" style={{ width: '100%', height: 32, marginTop: 2 }}><option>All Statuses</option></select></label>
          <button className="btn" disabled title="The security overview is platform-wide — filtering it by tenant, branch, severity, scope, role or status is not available yet">Apply Filters</button>
          <button className="btn ghost" disabled title="The security overview is platform-wide — filtering it by tenant, branch, severity, scope, role or status is not available yet">Reset Filters</button>
        </div>
      </section>

      {/* 12 Security Controls */}
      <section className="panel" data-testid="audit-engine">
        <div className="flex justify-between gap-2">
          <div className="div">

          <h2>Automated Security Audit </h2>
          <p className="muted" style={{ fontSize: 10 }}>(1:00 AM engine · deduplicated findings · critical/high escalate to Incidents)</p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <button className="btn whitespace-nowrap" disabled={auditBusy} onClick={runAuditNow}>{auditBusy ? 'Running…' : 'Run audit now'}</button>
            {auditMsg ? <span className="muted" style={{ fontSize: 11 }}>{auditMsg}</span> : null}
          </div>
        </div>
      
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1.4fr] gap-3">
          <div>
            <h3 className='font-semibold' style={{ fontSize: 14, margin: '4px 0' }}>Recent runs</h3>
            {auditRuns.length === 0 ? <div className="muted" style={{ fontSize: 11 }}>No runs yet.</div> : (
              <table className="table" style={{ fontSize: 11 }}>
                <thead><tr><th>Started</th><th>Trigger</th><th>Status</th><th>Open</th><th>Resolved</th></tr></thead>
                <tbody>{auditRuns.map((r) => (
                  <tr key={r.id}><td>{new Date(r.startedAt).toLocaleString()}</td><td>{r.trigger}</td><td>{r.status}</td><td>{r.findingsOpen}</td><td>{r.findingsResolved}</td></tr>
                ))}</tbody>
              </table>
            )}
          </div>
          <div>
            <h3 className='font-semibold' style={{ fontSize: 14, margin: '4px 0' }}>Findings</h3>
            {auditFindings.length === 0 ? <div className="muted" style={{ fontSize: 11 }}>No findings recorded — run the audit to populate.</div> : (
              <table className="table" style={{ fontSize: 11 }}>
                <thead><tr><th>Severity</th><th>Status</th><th>Finding</th><th>Seen</th></tr></thead>
                <tbody>{auditFindings.map((f) => (
                  <tr key={f.id}><td><span className={`chip chip-${f.severity}`}>{f.severity}</span></td><td>{f.status}</td><td title={f.detail || ''}>{f.title}</td><td>{f.occurrences}×</td></tr>
                ))}</tbody>
              </table>
            )}
          </div>
        </div>
      </section>

      <section className="panel"><h2>Security Controls</h2>
        <div className=" grid  grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2.5 mb-3 mt-3">
          {CONTROLS.map(([l, d]) => (
            <button key={l} className="qbtn" onClick={() => controlAction(l)} style={{ textAlign: 'left', padding: 8, display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-start', height: 'auto' }}>
              <b style={{ fontSize: 10.5 }}>{l}</b><span className="muted" style={{ fontSize: 9, fontWeight: 400 }}>{d}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Row 1 — 4 analytics */}
      <div className=" grid  grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-2.5  ">
        <section className="panel"><h2 style={{ fontSize: 13 }}>Authentication &amp; Access Overview</h2>
          <div style={{ overflowX: 'auto' }}><table className="tgrid" style={{ width: '100%', fontSize: 11 }}><thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10 }}><th>User / Role</th><th>2FA</th><th>Failed</th><th>Priv.</th><th>Risk</th></tr></thead>
            <tbody>{o.authOverview.map((a) => (<tr key={a.userId} style={{ cursor: 'pointer' }} onClick={() => nav('/users-roles')}><td style={{ fontWeight: 600 }}>{a.name}<span className="muted" style={{ fontSize: 9, display: 'block' }}>{a.role}</span></td><td><span style={{ color: a.mfaStatus === 'Enabled' ? '#1F9254' : '#C0392B', fontWeight: 600 }}>{a.mfaStatus}</span></td><td>{a.failedLogins}</td><td>{a.privileged ? 'Yes' : 'No'}</td><td><span style={{ fontWeight: 700, color: riskColor(a.riskLevel) }}>{a.riskLevel}</span></td></tr>))}</tbody></table></div>
          <button className="linkbtn" style={{ fontSize: 11, marginTop: 4 }} onClick={() => nav('/users-roles')}>View all users</button>
        </section>
        <section className="panel"><h2 style={{ fontSize: 13 }}>Failed Login Trend <span className="muted" style={{ fontSize: 10 }}>(Last 7 Days)</span></h2><TrendLine data={o.failedLoginTrend} /></section>
        <section className="panel"><h2 style={{ fontSize: 13 }}>Suspicious Session Activity</h2><NotConnected>{o.suspiciousMix.note || 'Not connected'}</NotConnected></section>
        <section className="panel"><h2 style={{ fontSize: 13 }}>Compliance Score Breakdown</h2><NotConnected>{o.complianceBreakdown.note || 'Not connected'}</NotConnected></section>
      </div>

      {/* Row 2 — 4 modules */}
      <div className=" grid  grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-2.5 mb-3 ">
        <section className="panel"><h2 style={{ fontSize: 13 }}>Encryption &amp; Backup Health</h2>
          {o.encryptionHealth.available ? <EncryptionHealthPanel h={o.encryptionHealth} /> : <NotConnected>{o.encryptionHealth.note || 'Not connected'}</NotConnected>}
        </section>
        <section className="panel"><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><h2 style={{ fontSize: 13 }}>Security Incident Log</h2><button className="linkbtn" style={{ fontSize: 10.5 }} onClick={() => setIncidentModalOpen(true)}>Manage</button></div>{o.securityIncidents.available ? (
          <table className="tgrid" style={{ width: '100%', fontSize: 11 }}><thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10 }}><th>Incident</th><th>Severity</th><th>Status</th><th>Assigned</th></tr></thead>
            <tbody>{o.securityIncidents.rows.map((r, i) => (<tr key={i}><td style={{ fontWeight: 600, fontFamily: 'monospace', fontSize: 10 }}>{r.incidentRef}</td><td>{r.severity}</td><td className="muted">{r.status}</td><td className="muted">{r.assignedTo}</td></tr>))}</tbody></table>
        ) : <NotConnected>{o.securityIncidents.note || 'Not connected'}</NotConnected>}</section>
        <section className="panel"><h2 style={{ fontSize: 13 }}>Privacy Requests &amp; Data Export Events</h2>
          {o.privacyRequests.length === 0 ? <NotConnected>No privacy requests.</NotConnected> : (
            <table className="tgrid" style={{ width: '100%', fontSize: 11 }}><thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10 }}><th>Type</th><th>Events</th><th>Status</th><th>Due</th></tr></thead>
              <tbody>{o.privacyRequests.map((p, i) => (<tr key={i}><td style={{ fontWeight: 600 }}>{p.requestType}</td><td>{p.events}</td><td className="muted">{p.status}</td><td className="muted">{p.dueDate ? new Date(p.dueDate).toLocaleDateString() : '—'}</td></tr>))}</tbody></table>
          )}
          <button className="linkbtn" style={{ fontSize: 11, marginTop: 4 }} onClick={() => nav('/customer-data-oversight')}>View all requests</button>
        </section>
        <section className="panel"><h2 style={{ fontSize: 13 }}>Active Session Monitor</h2>
          {o.activeSessions.length === 0 ? <NotConnected>No active sessions.</NotConnected> : (
            <table className="tgrid" style={{ width: '100%', fontSize: 11 }}><thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10 }}><th>User</th><th>IP</th><th>Role</th><th>Status</th></tr></thead>
              <tbody>{o.activeSessions.map((s, i) => (<tr key={i}><td style={{ fontWeight: 600 }}>{s.user}</td><td className="muted" style={{ fontFamily: 'monospace', fontSize: 10 }}>{s.ip}</td><td className="muted">{s.role}</td><td><span style={{ fontWeight: 600, color: toneColor(s.tone) }}>{s.status}</span></td></tr>))}</tbody></table>
          )}
          <button className="linkbtn" style={{ fontSize: 11, marginTop: 4 }} onClick={() => setRevokeModalOpen(true)}>Manage / revoke sessions</button>
        </section>
      </div>

      {/* Row 3 — 6 modules */}
      <div className=" grid  grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
        <section className="panel"><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><h2 style={{ fontSize: 13 }}>Blocked IPs &amp; Threat Signals</h2><button className="linkbtn" style={{ fontSize: 10.5 }} onClick={() => setIpModalOpen(true)}>Manage</button></div>{o.blockedIps.available ? (
          <table className="tgrid" style={{ width: '100%', fontSize: 11 }}><thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10 }}><th>IP Address</th><th>Threat Type</th><th>Country</th><th>Status</th></tr></thead>
            <tbody>{o.blockedIps.rows.map((b, i) => (<tr key={i}><td className="muted" style={{ fontFamily: 'monospace', fontSize: 10 }}>{b.target}</td><td>{b.threatType}</td><td className="muted">{b.country}</td><td><span style={{ fontWeight: 600, color: b.status === 'blocked' ? '#C0392B' : '#6B7280' }}>{b.status}</span></td></tr>))}</tbody></table>
        ) : <NotConnected>{o.blockedIps.note || 'Not connected'}</NotConnected>}</section>
        <section className="panel"><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><h2 style={{ fontSize: 13 }}>Role Restrictions &amp; Privileged Access</h2><button className="linkbtn" style={{ fontSize: 10.5 }} onClick={() => setGrantModalOpen(true)}>Manage access</button></div>
          {typeof o.activePrivilegedGrants === 'number' ? <div className="muted" style={{ fontSize: 10.5, marginBottom: 4 }}>{o.activePrivilegedGrants} active time-boxed elevation{o.activePrivilegedGrants === 1 ? '' : 's'}</div> : null}
          <table className="tgrid" style={{ width: '100%', fontSize: 11.5 }}><thead><tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 10 }}><th>Role</th><th>Users</th><th>Privileged Access</th><th></th></tr></thead>
            <tbody>{o.roleRestrictions.map((r, i) => (<tr key={i}><td style={{ fontWeight: 600 }}>{r.roleCategory}</td><td>{r.users}</td><td className="muted">{r.privileged}</td><td><button className="linkbtn" style={{ fontSize: 10.5 }} onClick={() => nav('/users-roles')}>Configure</button></td></tr>))}</tbody></table>
        </section>
        <section className="panel"><h2 style={{ fontSize: 13 }}>PCI-Related Controls</h2><NotConnected>{o.pciControls.note || 'Not connected'}</NotConnected></section>
        <section className="panel"><h2 style={{ fontSize: 13 }}>Incident Response Workflow</h2>{o.incidentWorkflow.available ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 4, marginTop: 8 }}>{([['Detected', o.incidentWorkflow.stages.detected], ['Investigating', o.incidentWorkflow.stages.investigating], ['Contained', o.incidentWorkflow.stages.contained], ['Remediating', o.incidentWorkflow.stages.remediating], ['Closed', o.incidentWorkflow.stages.closed]] as [string, number][]).map(([l, v]) => (<div key={l} style={{ textAlign: 'center', flex: 1 }}><div style={{ fontSize: 18, fontWeight: 700, color: '#F0820B' }}>{v}</div><div className="muted" style={{ fontSize: 9 }}>{l}</div></div>))}</div>
        ) : <NotConnected>{o.incidentWorkflow.note || 'Not connected'}</NotConnected>}</section>
        <section className="panel"><h2 style={{ fontSize: 13 }}>Recent Security Alerts</h2>
          {o.recentAlerts.length === 0 ? <NotConnected>No recent alerts.</NotConnected> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{o.recentAlerts.map((a) => (<div key={a.id} style={{ fontSize: 11.5, borderBottom: '1px solid var(--line)', paddingBottom: 4 }}><b>{a.title}</b><span className="muted" style={{ display: 'block', fontSize: 10 }}>{fmtDate(a.createdAt)}{a.severity ? ` · ${a.severity}` : ''}{a.tenant ? ` · ${a.tenant}` : ''}</span></div>))}</div>
          )}
          <button className="linkbtn" style={{ fontSize: 11, marginTop: 4 }} onClick={() => nav('/audit-logs')}>View all alerts</button>
        </section>
        <section className="panel"><h2 style={{ fontSize: 13 }}>Backup &amp; Recovery Compliance</h2><NotConnected>{o.backupRecovery.note || 'Not connected'}</NotConnected></section>
      </div>

      {/* Quick Actions */}
      <section className="panel"><h2>Quick Actions</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 gap-1.5">{QUICK.map((l) => <button key={l} className="qbtn" onClick={l === 'Export Report' ? exportReport : l === 'Review Alerts' ? () => nav('/audit-logs') : l === 'Privacy Workflow' ? () => nav('/customer-data-oversight') : l === 'Revoke Sessions' ? () => setRevokeModalOpen(true) : l === 'Open Incident' ? () => setIncidentModalOpen(true) : l === 'Lock Account' ? () => setLockdownModalOpen(true) : l === 'Lock Account' ? () => setLockdownModalOpen(true) : () => setNotice(`${l}: requires the corresponding security foundation (session/lockdown/incident engine) — not connected yet.`)} style={{ fontSize: 11 }}>{l}</button>)}</div>
      </section>

      {/* At-a-Glance */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-1.5">
        {glance.map(([l, k]) => (
          <div className="kpi" key={l} aria-label={`${l}: ${k.available ? k.value : 'not connected'}`}>
            <div className="l" style={{ fontSize: 11 }}>{l}</div>
            <div className="text-base font-semibold" title={k.note || ''}>{k.available ? (k.value ?? 0).toLocaleString() : <NotConnected>Not connected</NotConnected>}{k.available && k.completionPct != null ? <span className="muted" style={{ fontSize: 10, marginLeft: 4 }}>{k.completionPct}%</span> : null}</div>
          </div>
        ))}
      </div>
      {ipModalOpen && <SecurityIpBlockModal onClose={() => { setIpModalOpen(false); }} />}
      {revokeModalOpen && <SecuritySessionRevokeModal onClose={() => { setRevokeModalOpen(false); }} />}
      {incidentModalOpen && <SecurityIncidentModal onClose={() => { setIncidentModalOpen(false); }} />}
      {policyKind && <SecurityPolicyModal initialKind={policyKind} onClose={() => { setPolicyKind(null); }} />}
      {lockdownModalOpen && <SecurityLockdownModal onClose={() => { setLockdownModalOpen(false); }} />}
      {grantModalOpen && <SecurityGrantModal onClose={() => { setGrantModalOpen(false); }} />}
      {retentionModalOpen && <SecurityRetentionModal onClose={() => { setRetentionModalOpen(false); }} />}
    </div>
  );
}

/** Constitution 12 §270. A key on a FALLBACK is shown in the danger colour: in production the API would refuse to boot. */
export function EncryptionHealthPanel({ h }: { h: EncryptionHealth }) {
  const fallback = h.keys.filter((k) => k.state === 'fallback');
  const configured = h.keys.filter((k) => k.state === 'configured').length;
  return (
    <div style={{ fontSize: 11 }} data-testid="encryption-health">
      <div style={{ marginBottom: 6 }}>
        <strong>{configured}</strong> of {h.keys.filter((k) => k.state !== 'optional_unset').length} encryption keys configured
        {fallback.length > 0 && <div style={{ color: 'var(--danger, #c0392b)', marginTop: 4 }} data-testid="key-fallback">On a fallback key: {fallback.map((k) => k.env).join(', ')}</div>}
      </div>
      {h.rotationOverdue.length > 0 && <div style={{ color: 'var(--warn, #b7791f)', marginBottom: 6 }} data-testid="rotation-overdue">Rotation overdue: {h.rotationOverdue.join(', ')}</div>}
      {h.posture.map((p, i) => <div key={i} style={{ color: 'var(--warn, #b7791f)', marginBottom: 4 }} data-testid="posture-warning"><strong>{p.variable}</strong>: {p.problem}</div>)}
      <div className="muted" style={{ marginTop: 6 }}>
        Security events (24 h): <strong>{h.events24h.total}</strong>
        {Object.entries(h.events24h.bySeverity).map(([sev, n]) => <span key={sev} style={{ marginLeft: 8 }}>{sev.toLowerCase()} {n}</span>)}
      </div>
    </div>
  );
}
