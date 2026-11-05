// Super-Admin → System Operations → Dashboards — BUILD_PLAN Phase 14 B (Constitution 11 §145, §149–155).
//
// One screen, seven tabs, each reading its own endpoint (GET /super-admin/system/dashboards/<tab>) — nothing here duplicates
// the Database page (/database) or the Mobile app versions policy editor (/mobile-versions).
//   • `live` sections are summed over the LIVE processes' heartbeats and are "since each live process started" — the tab
//     says how many processes it summed. A missing source is shown as "no data yet", NEVER as a zero.
//   • a failed read says so (never an empty table that looks like "nothing happened").
import { useEffect, useState, type ReactNode } from 'react';
import type {
  CommunicationsDashboard, DeploymentDashboard, IncidentDashboard, LiveSource, MobileDashboard, PaymentsDashboard, ProviderRow,
  RedisDashboard, StorageDashboard, WebhookRow,
} from '@aipowersalon/api-contracts/platform';
import { opsDashboardsApi } from '../api/opsDashboardsApi';

export const DASHBOARD_TABS = [
  ['storage', 'Storage'], ['mobile', 'Mobile'], ['deployments', 'Deployment'], ['redis', 'Redis'],
  ['payments', 'Payments'], ['communications', 'Communications'], ['incidents', 'Incidents'],
] as const;
export type DashboardTab = (typeof DASHBOARD_TABS)[number][0];

const NONE = '—';
export const fmtNum = (n: number | null | undefined) => (n == null ? NONE : n.toLocaleString('en-US'));
export const fmtMs = (n: number | null | undefined) => (n == null ? NONE : `${Math.round(n)} ms`);
export function fmtBytes(n: number | null | undefined): string {
  if (n == null) return NONE;
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n, i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${i === 0 ? v : v.toFixed(1)} ${u[i]}`;
}
const fmtPct = (n: number | null | undefined) => (n == null ? NONE : `${(n * 100).toFixed(1)}%`);
const fmtAt = (s: string | null | undefined) => (s ? new Date(s).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : NONE);
function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}
const kv = (o: Record<string, number>) => {
  const e = Object.entries(o);
  return e.length ? e.map(([k, v]) => `${k} ${v}`).join(' · ') : NONE;
};

function Panel({ title, note, children, testId }: { title: string; note?: string; children: ReactNode; testId?: string }) {
  return (
    <div className="panel" style={{ marginBottom: 12 }} data-testid={testId}>
      <div className="phead"><h2>{title}</h2>{note ? <span className="muted" style={{ fontSize: 11, marginLeft: 8 }}>{note}</span> : null}</div>
      {children}
    </div>
  );
}
const Empty = ({ children }: { children: ReactNode }) => <div className="state">{children}</div>;

function LiveNote({ live }: { live: LiveSource }) {
  return (
    <p className="muted" style={{ fontSize: 12 }} data-testid="live-source">
      {live.processes === 0
        ? 'No live process has reported a heartbeat — counters have no data yet.'
        : `Summed over ${live.processes} live process${live.processes === 1 ? '' : 'es'} (${live.roles.join(', ')}), since each started${live.oldestStartedAt ? ` (oldest ${fmtAt(live.oldestStartedAt)})` : ''}.`}
    </p>
  );
}

function ProvidersTable({ rows, channel }: { rows: Array<ProviderRow & { channel?: string }>; channel?: boolean }) {
  if (!rows.length) return <Empty>No provider calls recorded by the live processes yet.</Empty>;
  return (
    <table className="table" data-testid="providers">
      <thead><tr>{channel ? <th>Channel</th> : null}<th>Provider</th><th>Calls</th><th>Failures</th><th>By category</th><th>p95</th><th>Breaker</th></tr></thead>
      <tbody>{rows.map((p) => (
        <tr key={`${p.channel ?? ''}/${p.provider}`}>
          {channel ? <td>{p.channel}</td> : null}<td>{p.provider}</td><td>{fmtNum(p.calls)}</td><td>{fmtNum(p.failures)}</td>
          <td>{kv(p.byCategory)}</td><td>{fmtMs(p.latencyP95Ms)}</td>
          <td><span className="badge" style={{ color: p.circuitOpen ? '#B85B4D' : '#3E8F57' }}>{p.circuitOpen ? 'Open' : 'Closed'}</span></td>
        </tr>
      ))}</tbody>
    </table>
  );
}
function WebhooksTable({ rows }: { rows: WebhookRow[] }) {
  if (!rows.length) return <Empty>No webhooks received by the live processes yet.</Empty>;
  return (
    <table className="table" data-testid="webhooks">
      <thead><tr><th>Provider</th><th>Outcomes</th></tr></thead>
      <tbody>{rows.map((w) => <tr key={w.provider}><td>{w.provider}</td><td>{kv(w.byOutcome)}</td></tr>)}</tbody>
    </table>
  );
}

export function StorageTab({ d }: { d: StorageDashboard }) {
  return (
    <>
      <Panel title="Stores" testId="storage-stores">
        <LiveNote live={d.live} />
        {d.stores.length === 0 ? <Empty>No store operation recorded by the live processes yet.</Empty> : (
          <table className="table">
            <thead><tr><th>Store</th><th>OK</th><th>Errors</th><th>Misses</th><th>Written</th><th>Read</th><th>p95</th><th>Errors by op</th></tr></thead>
            <tbody>{d.stores.map((s) => (
              <tr key={s.store}><td>{s.store}</td><td>{fmtNum(s.ok)}</td><td>{fmtNum(s.errors)}</td><td>{fmtNum(s.misses)}</td>
                <td>{fmtBytes(s.bytesWritten)}</td><td>{fmtBytes(s.bytesRead)}</td><td>{fmtMs(s.latencyP95Ms)}</td><td>{kv(s.errorsByOp)}</td></tr>
            ))}</tbody>
          </table>
        )}
        <p style={{ fontSize: 13 }}>Malware scan failures: {d.malwareScanFailures == null ? 'no scanner has reported' : fmtNum(d.malwareScanFailures)}</p>
      </Panel>
      <Panel title="Lifecycle" testId="storage-lifecycle">
        {d.lifecycle.job ? (
          <p style={{ fontSize: 13 }}>Lifecycle job: last run {fmtAt(d.lifecycle.job.lastStartedAt)} · outcome {d.lifecycle.job.lastOutcome ?? NONE} · {fmtNum(d.lifecycle.job.runs)} runs, {fmtNum(d.lifecycle.job.failures)} failed</p>
        ) : <Empty>The media lifecycle job has not run yet.</Empty>}
        {d.lifecycle.runs.length ? (
          <table className="table">
            <thead><tr><th>Store</th><th>OK sweeps</th><th>Failed sweeps</th><th>Objects removed</th></tr></thead>
            <tbody>{d.lifecycle.runs.map((r) => <tr key={r.store}><td>{r.store}</td><td>{fmtNum(r.ok)}</td><td>{fmtNum(r.errors)}</td><td>{fmtNum(r.removed)}</td></tr>)}</tbody>
          </table>
        ) : null}
      </Panel>
      <Panel title="Quota usage — top salons" note={`${fmtNum(d.usage.tenants)} salons · ${fmtBytes(d.usage.totalBytes)} · ${fmtNum(d.usage.totalUploads)} uploads`} testId="storage-usage">
        {d.usage.top.length === 0 ? <Empty>No salon has uploaded media yet.</Empty> : (
          <table className="table">
            <thead><tr><th>Salon</th><th>Used</th><th>Uploads</th><th>Limit</th><th>Share of limit</th></tr></thead>
            <tbody>{d.usage.top.map((t) => (
              <tr key={t.tenantId}><td>{t.tenantName ?? t.tenantId}</td><td>{fmtBytes(t.bytesUsed)}</td><td>{fmtNum(t.uploads)}</td>
                <td>{t.limitBytes == null ? 'no limit' : fmtBytes(t.limitBytes)}</td><td>{fmtPct(t.share)}</td></tr>
            ))}</tbody>
          </table>
        )}
      </Panel>
    </>
  );
}

export function MobileTab({ d }: { d: MobileDashboard }) {
  return (
    <>
      <Panel title="Apps" testId="mobile-apps">
        <LiveNote live={d.live} />
        {d.apps.length === 0 ? <Empty>No mobile telemetry received by the live processes yet.</Empty> : (
          <table className="table">
            <thead><tr><th>App</th><th>Platform</th><th>Events</th><th>Errors</th><th>Update-required hits</th><th>Launch p95</th><th>API p95</th><th>Top events</th></tr></thead>
            <tbody>{d.apps.map((a) => (
              <tr key={`${a.app}/${a.platform}`}><td>{a.app}</td><td>{a.platform}</td><td>{fmtNum(a.events)}</td><td>{fmtNum(a.errors)}</td><td>{fmtNum(a.updateRequired)}</td>
                <td>{fmtMs(a.launchP95Ms)}</td><td>{fmtMs(a.apiP95Ms)}</td><td>{a.topEvents.map((e) => `${e.event} ${e.count}`).join(' · ') || NONE}</td></tr>
            ))}</tbody>
          </table>
        )}
      </Panel>
      {d.errorsByKind.length ? (
        <Panel title="Errors by kind">
          <table className="table"><thead><tr><th>App</th><th>Platform</th><th>Kind</th><th>Count</th></tr></thead>
            <tbody>{d.errorsByKind.map((e) => <tr key={`${e.app}/${e.platform}/${e.kind}`}><td>{e.app}</td><td>{e.platform}</td><td>{e.kind}</td><td>{fmtNum(e.count)}</td></tr>)}</tbody></table>
        </Panel>
      ) : null}
      <Panel title="Version distribution" note="active installs, last 7 days" testId="mobile-versions">
        {d.versions.length === 0 ? <Empty>No app has reported its version in the last 7 days.</Empty> : (
          <table className="table"><thead><tr><th>App</th><th>Platform</th><th>Version</th><th>Installs</th><th>Policy (min / recommended / latest)</th></tr></thead>
            <tbody>{d.versions.map((v) => {
              const p = d.policy.find((x) => x.app === v.app && x.platform === v.platform);
              return <tr key={`${v.app}/${v.platform}/${v.version}`}><td>{v.app}</td><td>{v.platform}</td><td>{v.version}</td><td>{fmtNum(v.activeInstalls7d)}</td>
                <td>{p ? `${p.minSupported ?? NONE} / ${p.recommended ?? NONE} / ${p.latest ?? NONE}` : 'no policy'}</td></tr>;
            })}</tbody></table>
        )}
        <p className="muted" style={{ fontSize: 12 }}>Edit version policies on <a href="/mobile-versions">Mobile App Versions</a>.</p>
      </Panel>
    </>
  );
}

export function DeploymentTab({ d }: { d: DeploymentDashboard }) {
  return (
    <>
      <Panel title="Releases" testId="deploy-releases" note={d.releaseNotesUrl ? undefined : 'no release-notes link configured'}>
        {d.releaseNotesUrl ? <p style={{ fontSize: 13 }}><a href={d.releaseNotesUrl} target="_blank" rel="noreferrer">Release notes</a></p> : null}
        {d.releases.length === 0 ? <Empty>No process has recorded a boot yet.</Empty> : (
          <table className="table"><thead><tr><th>Version</th><th>Commit</th><th>Environment</th><th>First boot</th><th>Last seen</th><th>Boots</th><th>Live</th><th>Health after deploy</th><th /></tr></thead>
            <tbody>{d.releases.map((r) => (
              <tr key={`${r.version}/${r.commit}/${r.deployment}`}><td>{r.version}</td><td><code>{r.commit.slice(0, 10)}</code></td><td>{r.environment}</td>
                <td>{fmtAt(r.firstStartedAt)}</td><td>{fmtAt(r.lastSeenAt)}</td><td>{fmtNum(r.boots)}</td><td>{fmtNum(r.liveProcesses)}</td>
                <td>{r.healthChangesAfterDeploy == null ? 'not measured' : r.healthChangesAfterDeploy === 0 ? 'no degradations' : `${r.healthChangesAfterDeploy} degradation(s) within 30 min`}</td>
                <td>{r.rollback ? <span className="badge" style={{ color: '#A0711B' }}>Rollback</span> : null}</td></tr>
            ))}</tbody></table>
        )}
      </Panel>
      <Panel title="Schema" testId="deploy-schema">
        {d.schema == null ? <Empty>Schema version not available.</Empty> : (
          <p style={{ fontSize: 13 }}>Status {d.schema.status} · latest {d.schema.latest ?? NONE} · {d.schema.pending.length} pending migration(s){d.schema.pending.length ? `: ${d.schema.pending.join(', ')}` : ''}
            {d.schema.mismatches.length ? ` · ${d.schema.mismatches.length} checksum mismatch(es)` : ''}{d.schema.error ? ` · ${d.schema.error}` : ''}</p>
        )}
      </Panel>
      <Panel title="Processes" testId="deploy-processes">
        {d.processes.length === 0 ? <Empty>No process heartbeat recorded.</Empty> : (
          <table className="table"><thead><tr><th>Role</th><th>Instance</th><th>Version</th><th>Started</th><th>Uptime</th><th>State</th><th>RSS</th><th>Heap</th><th>CPU</th><th>Loop p99</th></tr></thead>
            <tbody>{d.processes.map((p) => (
              <tr key={p.bootId}><td>{p.processRole}</td><td>{p.instance}</td><td>{p.version}</td><td>{fmtAt(p.startedAt)}</td><td>{fmtUptime(p.uptimeSeconds)}</td>
                <td>{p.live ? 'live' : `gone (last seen ${fmtAt(p.lastSeenAt)})`}</td><td>{fmtBytes(p.rssBytes)}</td><td>{fmtBytes(p.heapUsedBytes)}</td>
                <td>{p.cpuSeconds == null ? NONE : `${p.cpuSeconds.toFixed(1)} s`}</td><td>{fmtMs(p.eventLoopP99Ms)}</td></tr>
            ))}</tbody></table>
        )}
      </Panel>
    </>
  );
}

export function RedisTab({ d }: { d: RedisDashboard }) {
  return (
    <Panel title="Redis by role" testId="redis-roles">
      <LiveNote live={d.live} />
      {d.roles.length === 0 ? <Empty>No Redis client reported by the live processes (Redis may not be configured).</Empty> : (
        <table className="table"><thead><tr><th>Role</th><th>Up</th><th>Commands</th><th>Errors</th><th>p95</th><th>Reconnects</th><th>Memory</th><th>Memory / max</th><th>Evicted</th><th>Hit ratio</th><th>Blocked</th></tr></thead>
          <tbody>{d.roles.map((r) => (
            <tr key={r.role}><td>{r.role}</td>
              <td><span className="badge" style={{ color: r.up === r.processes ? '#3E8F57' : '#B85B4D' }}>{r.up}/{r.processes}</span></td>
              <td>{fmtNum(r.commands)}</td><td>{fmtNum(r.errors)}</td><td>{fmtMs(r.latencyP95Ms)}</td><td>{fmtNum(r.reconnects)}</td>
              <td>{fmtBytes(r.memoryBytes)}</td><td>{fmtPct(r.memoryRatio)}</td><td>{fmtNum(r.evictedKeys)}</td><td>{fmtPct(r.hitRatio)}</td><td>{fmtNum(r.blockedClients)}</td></tr>
          ))}</tbody></table>
      )}
    </Panel>
  );
}

export function PaymentsTab({ d }: { d: PaymentsDashboard }) {
  const a = d.attempts;
  return (
    <>
      <Panel title="Payment attempts" note={`last ${d.windowHours} h`} testId="pay-attempts">
        <p style={{ fontSize: 13 }}>{fmtNum(a.total)} attempts · {fmtNum(a.approved)} approved · {fmtNum(a.declined)} declined · {fmtNum(a.technicalFailures)} technical failures · {fmtNum(a.canceled)} canceled · {fmtNum(a.pending)} pending · {fmtNum(a.refunded)} refunded</p>
        {d.byProcessor.length ? (
          <table className="table"><thead><tr><th>Processor</th><th>Total</th><th>Approved</th><th>Declined</th><th>Technical failures</th></tr></thead>
            <tbody>{d.byProcessor.map((p) => <tr key={p.processor}><td>{p.processor}</td><td>{fmtNum(p.total)}</td><td>{fmtNum(p.approved)}</td><td>{fmtNum(p.declined)}</td><td>{fmtNum(p.technicalFailures)}</td></tr>)}</tbody></table>
        ) : <Empty>No payment attempts in the window.</Empty>}
        <p style={{ fontSize: 13 }} data-testid="pay-stranded">Stranded attempts: {fmtNum(d.stranded.open)} open · {fmtNum(d.stranded.resolved24h)} resolved in 24 h</p>
      </Panel>
      <Panel title="Providers"><LiveNote live={d.live} /><ProvidersTable rows={d.providers} /></Panel>
      <Panel title="Webhooks"><WebhooksTable rows={d.webhooks} /></Panel>
    </>
  );
}

export function CommunicationsTab({ d }: { d: CommunicationsDashboard }) {
  return (
    <>
      <Panel title="Messages" note={`last ${d.windowHours} h`} testId="comms-messages">
        {d.sms.length + d.systemSms.length + d.notifications.length === 0 ? <Empty>No messages sent in the window.</Empty> : (
          <table className="table"><thead><tr><th>Kind</th><th>Provider / channel</th><th>Status</th><th>Count</th></tr></thead>
            <tbody>
              {d.sms.map((r) => <tr key={`sms/${r.provider}/${r.status}`}><td>Salon SMS</td><td>{r.provider}</td><td>{r.status}</td><td>{fmtNum(r.count)}</td></tr>)}
              {d.systemSms.map((r) => <tr key={`sys/${r.status}`}><td>System SMS</td><td>{NONE}</td><td>{r.status}</td><td>{fmtNum(r.count)}</td></tr>)}
              {d.notifications.map((r) => <tr key={`n/${r.channel}/${r.status}`}><td>Notification</td><td>{r.channel}</td><td>{r.status}</td><td>{fmtNum(r.count)}</td></tr>)}
            </tbody></table>
        )}
      </Panel>
      <Panel title="Providers"><LiveNote live={d.live} /><ProvidersTable rows={d.providers} channel /></Panel>
      <Panel title="Webhooks"><WebhooksTable rows={d.webhooks} /></Panel>
    </>
  );
}

export function IncidentsTab({ d }: { d: IncidentDashboard }) {
  const list = (rows: IncidentDashboard['active'], empty: string, testId: string) => rows.length === 0 ? <Empty>{empty}</Empty> : (
    <div data-testid={testId}>{rows.map((i) => (
      <div key={i.id} style={{ borderTop: '1px solid var(--line, #ddd)', padding: '8px 0' }}>
        <b>{i.reference ? `${i.reference} · ` : ''}{i.title}</b>
        <div style={{ fontSize: 13 }}>{i.status} · {i.severity ?? 'no severity'} · {i.impact}{i.componentKey ? ` · ${i.componentKey}` : ''} · {i.affectedTenants} salon(s) affected</div>
        <div style={{ fontSize: 13 }}>Commander: {i.commander ?? 'not assigned'} · started {fmtAt(i.startedAt)}{i.resolvedAt ? ` · resolved ${fmtAt(i.resolvedAt)}` : ''}{i.etaAt ? ` · ETA ${fmtAt(i.etaAt)}` : ''}{i.nextMilestone ? ` · next: ${i.nextMilestone}` : ''}</div>
        {i.timeline.length ? (
          <ol style={{ fontSize: 12, margin: '4px 0 0 18px' }}>{i.timeline.map((t, k) => <li key={k}>{fmtAt(t.at)} — {t.kind}: {t.body}{t.actor ? ` (${t.actor})` : ''}</li>)}</ol>
        ) : <div className="muted" style={{ fontSize: 12 }}>No timeline entries.</div>}
      </div>
    ))}</div>
  );
  return (
    <>
      <Panel title="Active incidents">{list(d.active, 'No active incident.', 'inc-active')}</Panel>
      <Panel title="Recent incidents">{list(d.recent, 'No incident in the recent window.', 'inc-recent')}</Panel>
    </>
  );
}

const LOADERS: Record<DashboardTab, () => Promise<any>> = {
  storage: opsDashboardsApi.storage, mobile: opsDashboardsApi.mobile, deployments: opsDashboardsApi.deployments, redis: opsDashboardsApi.redis,
  payments: opsDashboardsApi.payments, communications: opsDashboardsApi.communications, incidents: opsDashboardsApi.incidents,
};

export function OpsDashboardsScreen({ initialTab = 'storage' }: { initialTab?: DashboardTab }) {
  const [tab, setTab] = useState<DashboardTab>(initialTab);
  const [data, setData] = useState<{ tab: DashboardTab; d: any } | 'error' | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let live = true;
    setData(null);
    LOADERS[tab]().then((d) => { if (live) setData({ tab, d }); }).catch(() => { if (live) setData('error'); });
    return () => { live = false; };
  }, [tab, nonce]);
  const label = DASHBOARD_TABS.find(([k]) => k === tab)![1];
  const body = data === null || (data !== 'error' && data.tab !== tab) ? <div className="state">Loading…</div>
    : data === 'error' ? <div className="state" role="alert">The {label} dashboard could not be read.</div>
    : tab === 'storage' ? <StorageTab d={data.d} />
    : tab === 'mobile' ? <MobileTab d={data.d} />
    : tab === 'deployments' ? <DeploymentTab d={data.d} />
    : tab === 'redis' ? <RedisTab d={data.d} />
    : tab === 'payments' ? <PaymentsTab d={data.d} />
    : tab === 'communications' ? <CommunicationsTab d={data.d} />
    : <IncidentsTab d={data.d} />;
  return (
    <div className="page">
      <div className="phead"><h1>Operations dashboards</h1>
        <button className="btn ghost" style={{ marginLeft: 'auto' }} onClick={() => setNonce((n) => n + 1)}>Refresh</button></div>
      <div role="tablist" style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 12 }}>
        {DASHBOARD_TABS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'btn' : 'btn ghost'} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {data !== null && data !== 'error' && data.tab === tab ? <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>Generated {fmtAt(data.d.generatedAt)}</div> : null}
      {body}
    </div>
  );
}
