// OpsDashboardsScreen.test.tsx — BUILD_PLAN Phase 14 B (Constitution 11 §145, §149–155): the seven System Operations
// dashboards. Each tab reads its own endpoint; an empty live source says "no data yet" (never a zero row); a failed read
// says so; a missing measurement renders "—", never 0.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { configure, render, screen, fireEvent, within, cleanup } from '@testing-library/react';
vi.mock('../api/client', () => ({ api: { get: vi.fn() } }));
import { api } from '../api/client';
configure({ asyncUtilTimeout: 5000 });   // the full admin-web run is slow under load; 1 s findBy defaults flake
import { OpsDashboardsScreen, fmtBytes } from './OpsDashboardsScreen';

const T = '2026-10-09T10:00:00.000Z';
const live = { processes: 2, roles: ['api', 'worker'], oldestStartedAt: T };
const noLive = { processes: 0, roles: [], oldestStartedAt: null };
const fixtures: Record<string, any> = {
  storage: {
    generatedAt: T, live,
    stores: [{ store: 'media', ok: 12, errors: 3, misses: 1, bytesWritten: 2048, bytesRead: 10, latencyP95Ms: 42, errorsByOp: { put: 3 } }],
    lifecycle: { runs: [{ store: 'media', ok: 4, errors: 1, removed: 9 }], job: { lastStartedAt: T, lastFinishedAt: T, lastOutcome: 'succeeded', runs: 5, failures: 1 } },
    usage: { tenants: 2, totalBytes: 3 * 1024 * 1024, totalUploads: 7, top: [{ tenantId: 't1', tenantName: 'Lily Nails', bytesUsed: 1024 * 1024, uploads: 5, limitBytes: null, share: null }] },
    malwareScanFailures: null,
  },
  mobile: {
    generatedAt: T, live,
    apps: [{ app: 'tech', platform: 'ios', events: 40, errors: 2, updateRequired: 6, launchP95Ms: 900, apiP95Ms: null, topEvents: [{ event: 'login', count: 10 }] }],
    errorsByKind: [{ app: 'tech', platform: 'ios', kind: 'js', count: 2 }],
    versions: [{ app: 'tech', platform: 'ios', version: '1.3.0', activeInstalls7d: 4 }],
    policy: [{ app: 'tech', platform: 'ios', minSupported: '1.4.0', recommended: null, latest: '1.6.0' }],
  },
  deployments: {
    generatedAt: T, releaseNotesUrl: 'https://example.com/notes',
    releases: [{ version: '2.1.0', commit: 'abcdef1234567', deployment: 'd1', environment: 'production', firstStartedAt: T, lastSeenAt: T, boots: 3, liveProcesses: 2, healthChangesAfterDeploy: 1, rollback: true }],
    processes: [{ bootId: 'b1', processRole: 'worker', instance: 'w-1', version: '2.1.0', commit: 'abcdef1', deployment: 'd1', environment: 'production', startedAt: T, lastSeenAt: T, live: true, uptimeSeconds: 7260, rssBytes: 100 * 1024 * 1024, heapUsedBytes: null, cpuSeconds: 12.5, eventLoopP99Ms: 8 }],
    schema: { status: 'pending', latest: '562_branch_health_process_heartbeats.sql', pending: ['563_x.sql'], mismatches: [] },
  },
  redis: { generatedAt: T, live, roles: [{ role: 'cache', processes: 2, up: 1, commands: 500, errors: 4, latencyP95Ms: 2, reconnects: 1, memoryBytes: null, memoryRatio: 0.5, evictedKeys: 0, hitRatio: 0.9, blockedClients: null }] },
  payments: {
    generatedAt: T, windowHours: 24, live,
    attempts: { total: 10, approved: 7, declined: 2, technicalFailures: 1, canceled: 0, pending: 0, refunded: 0 },
    byProcessor: [{ processor: 'fiserv', total: 10, approved: 7, declined: 2, technicalFailures: 1 }],
    stranded: { open: 1, resolved24h: 2 },
    providers: [{ provider: 'fiserv', calls: 10, failures: 1, byCategory: { timeout: 1 }, latencyP95Ms: 300, circuitOpen: true }],
    webhooks: [{ provider: 'fiserv', byOutcome: { processed: 5, duplicate: 1 } }],
  },
  communications: {
    generatedAt: T, windowHours: 24, live: noLive,
    sms: [{ provider: 'twilio', status: 'failed', count: 3 }], systemSms: [], notifications: [{ channel: 'email', status: 'sent', count: 8 }],
    providers: [], webhooks: [],
  },
  incidents: {
    generatedAt: T,
    active: [{ id: 'i1', reference: 'INC-7', title: 'Payments slow', status: 'investigating', severity: 'SEV2', impact: 'degraded', componentKey: 'payments', affectedTenants: 3,
      commander: 'Kim', startedAt: T, detectedAt: T, resolvedAt: null, etaAt: null, nextMilestone: 'provider reply',
      timeline: [{ at: T, kind: 'update', body: 'Provider contacted', actor: 'Kim' }] }],
    recent: [],
  },
};
const route = (p: string) => p.split('/').pop()!;

describe('Operations dashboards (§145, §149–155)', () => {
  beforeEach(() => { cleanup(); vi.clearAllMocks(); (api.get as any).mockImplementation((p: string) => Promise.resolve(fixtures[route(p)])); });

  it('every tab reads its own endpoint', async () => {
    render(<OpsDashboardsScreen />);
    await screen.findByTestId('storage-stores');
    for (const name of ['Mobile', 'Deployment', 'Redis', 'Payments', 'Communications', 'Incidents']) {
      fireEvent.click(screen.getByRole('tab', { name }));
      await screen.findByText(/Generated/);
    }
    const paths = (api.get as any).mock.calls.map((c: any[]) => c[0]);
    expect(paths).toEqual(['storage', 'mobile', 'deployments', 'redis', 'payments', 'communications', 'incidents'].map((t) => `/super-admin/system/dashboards/${t}`));
  });

  it('Storage: bytes / ops / errors by store, lifecycle, top tenants; an unreported scanner is not a zero', async () => {
    render(<OpsDashboardsScreen />);
    const stores = await screen.findByTestId('storage-stores');
    expect(within(stores).getByText('2.0 KB')).toBeTruthy();
    expect(within(stores).getByText('put 3')).toBeTruthy();
    expect(within(stores).getByText(/2 live processes \(api, worker\)/)).toBeTruthy();
    expect(within(stores).getByText(/no scanner has reported/)).toBeTruthy();
    expect(within(screen.getByTestId('storage-lifecycle')).getByText('9')).toBeTruthy();
    const usage = screen.getByTestId('storage-usage');
    expect(within(usage).getByText('Lily Nails')).toBeTruthy();
    expect(within(usage).getByText('no limit')).toBeTruthy();
  });

  it('Mobile: counters by app + platform, version distribution with its policy, unmeasured p95 is "—"', async () => {
    render(<OpsDashboardsScreen initialTab="mobile" />);
    const apps = await screen.findByTestId('mobile-apps');
    const row = within(apps).getAllByRole('row')[1];
    expect(within(row).getByText('6')).toBeTruthy();   // update-required hits
    expect(within(row).getByText('—')).toBeTruthy();   // apiP95Ms null
    expect(within(screen.getByTestId('mobile-versions')).getByText('1.4.0 / — / 1.6.0')).toBeTruthy();
  });

  it('Deployment: releases with rollback + health after deploy, processes with uptime, schema pending, release notes link', async () => {
    render(<OpsDashboardsScreen initialTab="deployments" />);
    const rel = await screen.findByTestId('deploy-releases');
    expect(within(rel).getByText('Rollback')).toBeTruthy();
    expect(within(rel).getByText(/1 degradation\(s\) within 30 min/)).toBeTruthy();
    expect((within(rel).getByRole('link', { name: 'Release notes' }) as HTMLAnchorElement).href).toBe('https://example.com/notes');
    expect(within(screen.getByTestId('deploy-processes')).getByText('2h 1m')).toBeTruthy();
    expect(within(screen.getByTestId('deploy-schema')).getByText(/1 pending migration\(s\): 563_x.sql/)).toBeTruthy();
  });

  it('Redis: per role up / processes, memory not reported is "—"', async () => {
    render(<OpsDashboardsScreen initialTab="redis" />);
    const t = await screen.findByTestId('redis-roles');
    expect(within(t).getByText('1/2')).toBeTruthy();
    expect(within(t).getByText('90.0%')).toBeTruthy();
    const row = within(t).getAllByRole('row')[1];
    expect(within(row).getAllByText('—')).toHaveLength(2);   // memory bytes + blocked clients not reported — never 0
  });

  it('Payments: approval / decline / stranded counts, provider breaker state, webhook outcomes', async () => {
    render(<OpsDashboardsScreen initialTab="payments" />);
    expect(await screen.findByText(/7 approved · 2 declined · 1 technical failures/)).toBeTruthy();
    expect(screen.getByTestId('pay-stranded').textContent).toMatch(/1 open · 2 resolved/);
    expect(within(screen.getByTestId('providers')).getByText('Open')).toBeTruthy();
    expect(within(screen.getByTestId('webhooks')).getByText('processed 5 · duplicate 1')).toBeTruthy();
  });

  it('Communications: sent / failed by provider; no live process → "no data yet", not a zero row', async () => {
    render(<OpsDashboardsScreen initialTab="communications" />);
    const msgs = await screen.findByTestId('comms-messages');
    expect(within(msgs).getByText('twilio')).toBeTruthy();
    expect(screen.getByText(/No live process has reported a heartbeat/)).toBeTruthy();
    expect(screen.getByText(/No provider calls recorded/)).toBeTruthy();
    expect(screen.queryByTestId('providers')).toBeNull();
  });

  it('Incidents: active incident with its commander and timeline', async () => {
    render(<OpsDashboardsScreen initialTab="incidents" />);
    const a = await screen.findByTestId('inc-active');
    expect(within(a).getByText(/Commander: Kim/)).toBeTruthy();
    expect(within(a).getByText(/Provider contacted \(Kim\)/)).toBeTruthy();
    expect(screen.getByText('No incident in the recent window.')).toBeTruthy();
  });

  it('a failed read says so (never an empty dashboard)', async () => {
    (api.get as any).mockRejectedValue(new Error('down'));
    render(<OpsDashboardsScreen initialTab="redis" />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/Redis dashboard could not be read/);
  });

  it('fmtBytes scales units', () => {
    expect(fmtBytes(0)).toBe('0 B'); expect(fmtBytes(1536)).toBe('1.5 KB'); expect(fmtBytes(null)).toBe('—');
  });
});
