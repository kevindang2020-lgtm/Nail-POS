// ops-dashboards.pgtest — BUILD_PLAN Phase 14 B (Constitution 11 §145, §149–155): every dashboard reads an EXISTING source on
// the real migrated schema — the platform's tables, or the live processes' heartbeats (process_heartbeats, migration 562).
//   • a heartbeat carries this process's registry digest; the dashboards sum LIVE processes only (a dead boot's counters
//     never count) and merge histograms across processes;
//   • an empty source is an empty list / null — never zeros presented as data.
// A fixed clock throughout; nothing compares with the database's now().
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { instrumentStore, providerCalls, providerDuration, providerCircuitOpen, webhookEvents, redisCommands, redisConnectionState, redisMemoryBytes, redisCommandDuration, BUILD } from '@aipowersalon/observability';
import { ProcessHeartbeat, metricsDigest, LIVE_WINDOW_MS } from './process-heartbeat';
import { OpsDashboardsService, releaseHistory, quantileBy, sumBy, commsChannel, type HeartbeatRow } from './ops-dashboards';
import { clientEvents } from './client-events.controller';
import { seedRow } from '../events/pgtest-seed';

const NOW = new Date('2026-10-01T12:00:00Z');
const at = (min: number) => new Date(NOW.getTime() + min * 60_000);
const T = '6a6a6a6a-6a6a-46a6-86a6-6a6a6a6a6a6a', BR = '6b6b6b6b-6b6b-46b6-86b6-6b6b6b6b6b6b';
let pg: any; let db: any; let svc: OpsDashboardsService;

const otherProcess = (bootId: string, lastSeen: Date, metrics: object, extra: Record<string, unknown> = {}) => sql`insert into process_heartbeats
    (boot_id, process_role, instance, version, git_commit, deployment, environment, started_at, last_seen_at, metrics, rss_bytes)
  values (${bootId}, ${(extra.role as string) ?? 'worker'}, 'worker-1', ${(extra.version as string) ?? '1.0.0+abc1234'}, ${(extra.commit as string) ?? 'abc1234'}, 'dep-1', 'production',
          ${(extra.startedAt as Date) ?? at(-120)}, ${lastSeen}, ${JSON.stringify(metrics)}::jsonb, 1000)`.execute(db);

beforeAll(async () => {
  pg = await migratedPglite(); db = kyselyFor(pg);
  svc = new OpsDashboardsService(db);
  await seedRow(pg, 'tenants', { id: T, legal_name: 'T', display_name: 'Tango Nails', tenant_slug: 'tango6', tenant_code: 'TANG06', status: 'active' });
  await seedRow(pg, 'branches', { id: BR, tenant_id: T, name: 'Tango Main', status: 'active' });
});

describe('empty sources say so', () => {
  it('no heartbeats: no stores, no Redis roles, no providers, live.processes 0', async () => {
    const s = await svc.storage(NOW);
    expect(s.stores).toEqual([]); expect(s.live).toEqual({ processes: 0, roles: [], oldestStartedAt: null });
    expect(s.lifecycle.job).toBeNull(); expect(s.usage.top).toEqual([]); expect(s.malwareScanFailures).toBeNull();
    expect((await svc.redis(NOW)).roles).toEqual([]);
    const p = await svc.payments(NOW);
    expect(p.providers).toEqual([]); expect(p.attempts.total).toBe(0);
    expect((await svc.incidents(NOW))).toMatchObject({ active: [], recent: [] });
    expect((await svc.mobile(NOW)).apps).toEqual([]);
  });
});

describe('process heartbeat → fleet dashboards', () => {
  it('beat() upserts ONE row per boot with the build, process facts and the registry digest', async () => {
    const store = instrumentStore({ put: async () => ({ url: 'x' }), get: async () => null, remove: async () => undefined }, 'media');
    await store.put('t/a.png', Buffer.alloc(2048));
    providerCalls.inc({ provider: 'cardpointe', operation: 'auth', category: 'ok' }, 8);
    providerCalls.inc({ provider: 'cardpointe', operation: 'auth', category: 'timeout' }, 2);
    providerDuration.observe(0.3, { provider: 'cardpointe', operation: 'auth' });
    providerCalls.inc({ provider: 'twilio', operation: 'messages', category: 'ok' }, 5);
    providerCircuitOpen.set(1, { provider: 'twilio' });
    webhookEvents.inc({ provider: 'cardpointe', outcome: 'processed' }, 3);
    redisCommands.inc({ role: 'cache', command: 'get' }, 40); redisConnectionState.set(1, { role: 'cache' }); redisMemoryBytes.set(5_000_000, { role: 'cache' });
    redisCommandDuration.observe(0.002, { role: 'cache', command: 'get' });
    clientEvents.inc({ app: 'customer', platform: 'ios', event: 'app_open' }, 7);
    const hb = new ProcessHeartbeat(db);
    expect(await hb.beat(at(-1))).toBe(true);
    expect(await hb.beat(NOW)).toBe(true);
    const rows = (await sql<any>`select * from process_heartbeats`.execute(db)).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ boot_id: hb.bootId, version: BUILD.version, git_commit: BUILD.commit });
    expect(new Date(rows[0].last_seen_at).toISOString()).toBe(NOW.toISOString());
    expect(Number(rows[0].rss_bytes)).toBeGreaterThan(0);
    const m = rows[0].metrics;
    expect(m.aipowersalon_storage_bytes_total.find((s: any) => s.l.store === 'media' && s.l.direction === 'written').v).toBeGreaterThanOrEqual(2048);
    expect(Object.keys(m).every((k) => k.startsWith('aipowersalon_'))).toBe(true);
    expect(m.aipowersalon_api_requests_total).toBeUndefined();   // only the dashboard series travel
  });

  it('storage sums LIVE processes only; a boot not seen for 3 minutes is not counted', async () => {
    const digest = { aipowersalon_storage_operations_total: [{ l: { store: 'media', op: 'put', outcome: 'ok' }, v: 5 }, { l: { store: 'media', op: 'put', outcome: 'error' }, v: 2 }],
      aipowersalon_storage_bytes_total: [{ l: { store: 'media', direction: 'written' }, v: 1000 }] };
    await otherProcess('00000000-0000-4000-8000-0000000000f1', at(-1), digest);
    await otherProcess('00000000-0000-4000-8000-0000000000f2', new Date(NOW.getTime() - LIVE_WINDOW_MS - 1000), digest);   // dead
    const own = (await sql<any>`select metrics from process_heartbeats where process_role <> 'worker'`.execute(db)).rows[0].metrics;
    const ownOk = own.aipowersalon_storage_operations_total.filter((s: any) => s.l.store === 'media' && s.l.outcome === 'ok').reduce((a: number, s: any) => a + s.v, 0);
    const s = await svc.storage(NOW);
    expect(s.live.processes).toBe(2);
    const media = s.stores.find((x) => x.store === 'media')!;
    expect(media.ok).toBe(ownOk + 5);
    expect(media.errors).toBe(2); expect(media.errorsByOp).toEqual({ put: 2 });
    expect(media.bytesWritten).toBeGreaterThanOrEqual(3048);
  });

  it('storage usage: top salons by bytes with their quota share; lifecycle job from scheduler_runs', async () => {
    await sql`insert into tenant_storage_usage (tenant_id, bytes_used, uploads) values (${T}, 500, 3)`.execute(db);
    await sql`insert into tenant_quotas (tenant_id, storage_bytes) values (${T}, 1000)`.execute(db);
    await sql`insert into scheduler_runs (name, last_started_at, last_finished_at, last_outcome, runs, failures) values ('media.lifecycle', ${at(-60)}, ${at(-59)}, 'failed', 4, 1)`.execute(db);
    const s = await svc.storage(NOW);
    expect(s.usage).toMatchObject({ tenants: 1, totalBytes: 500, totalUploads: 3 });
    expect(s.usage.top[0]).toMatchObject({ tenantId: T, tenantName: 'Tango Nails', bytesUsed: 500, limitBytes: 1000, share: 0.5 });
    expect(s.lifecycle.job).toMatchObject({ lastOutcome: 'failed', runs: 4, failures: 1 });
  });

  it('payments: attempts by class over 24 h from payment_attempts, stranded, providers + webhooks from heartbeats', async () => {
    const t = '00000000-0000-4000-8000-00000000aaaa';
    const pa = (k: string, status: string, created: Date, extra: Record<string, unknown> = {}) => seedRow(pg, 'payment_attempts', { tenant_id: T, branch_id: BR, ticket_id: t, amount_cents: 100, method: 'card', processor: 'cardpointe', status, idempotency_key: k, created_at: created.toISOString(), updated_at: created.toISOString(), ...extra });
    await pa('p1', 'succeeded', at(-30)); await pa('p2', 'declined', at(-30)); await pa('p3', 'timed_out', at(-30)); await pa('p4', 'processing', at(-30));
    await pa('p5', 'succeeded', at(-60 * 30));   // two days ago: outside the window
    await pa('p6', 'unknown', at(-60), { stranded_at: at(-50).toISOString() });
    const p = await svc.payments(NOW);
    expect(p.attempts).toEqual({ total: 5, approved: 1, declined: 1, technicalFailures: 2, canceled: 0, pending: 1, refunded: 0 });
    expect(p.byProcessor[0]).toMatchObject({ processor: 'cardpointe', total: 5, approved: 1, declined: 1, technicalFailures: 2 });
    expect(p.stranded).toEqual({ open: 1, resolved24h: 0 });
    const cp = p.providers.find((r) => r.provider === 'cardpointe')!;
    expect(cp.byCategory.timeout).toBeGreaterThanOrEqual(2); expect(cp.failures).toBe(cp.byCategory.timeout);
    expect(cp.latencyP95Ms).not.toBeNull();
    expect(p.providers.some((r) => r.provider === 'twilio')).toBe(false);   // not a payment provider
    expect(p.webhooks.find((w) => w.provider === 'cardpointe')!.byOutcome.processed).toBeGreaterThanOrEqual(3);
  });

  it('communications: SMS ledger + system SMS + notifications from the tables; Twilio breaker open from heartbeats', async () => {
    await seedRow(pg, 'sms_usage_records', { tenant_id: T, branch_id: BR, purpose: 'BOOKING_VERIFICATION', status: 'FAILED', created_at: at(-10).toISOString() });
    await seedRow(pg, 'sms_delivery_logs', { tenant_id: T, phone_masked: '***1234', template: 'otp', status: 'delivered', created_at: at(-10).toISOString() });
    await seedRow(pg, 'notification_delivery_logs', { tenant_id: T, channel: 'email', target_masked: 'a***@x', template: 't', status: 'failed', created_at: at(-10).toISOString() });
    const c = await svc.communications(NOW);
    expect(c.sms).toEqual([{ provider: 'twilio', status: 'FAILED', count: 1 }]);
    expect(c.systemSms).toEqual([{ status: 'delivered', count: 1 }]);
    expect(c.notifications).toEqual([{ channel: 'email', status: 'failed', count: 1 }]);
    expect(c.providers.find((r) => r.provider === 'twilio')).toMatchObject({ channel: 'sms', circuitOpen: true });
  });

  it('redis per role: up, commands, p95, memory', async () => {
    const r = (await svc.redis(NOW)).roles.find((x) => x.role === 'cache')!;
    expect(r).toMatchObject({ up: 1, processes: 1, memoryBytes: 5_000_000 });
    expect(r.commands).toBeGreaterThanOrEqual(40);
    expect(r.latencyP95Ms).not.toBeNull();
  });

  it('mobile: client counters by app + platform, version distribution from installs, the version policy', async () => {
    await sql`insert into mobile_app_installs_seen (app, platform, device_hash, app_version, last_seen_at) values
      ('customer', 'ios', ${'a'.repeat(64)}, '2.1.0', ${at(-60)}), ('customer', 'ios', ${'b'.repeat(64)}, '2.1.0', ${at(-60)}), ('customer', 'ios', ${'c'.repeat(64)}, '2.0.0', ${at(-60 * 24 * 10)})`.execute(db);
    await sql`insert into mobile_app_versions (app, platform, min_supported, store_url) values ('customer', 'ios', '2.0.0', 'https://apps.apple.com/x')`.execute(db);
    const m = await svc.mobile(NOW);
    expect(m.apps.find((a) => a.app === 'customer' && a.platform === 'ios')!.events).toBeGreaterThanOrEqual(7);
    expect(m.versions).toEqual([{ app: 'customer', platform: 'ios', version: '2.1.0', activeInstalls7d: 2 }]);   // the 10-day-old install is not active
    expect(m.policy).toEqual([{ app: 'customer', platform: 'ios', minSupported: '2.0.0', recommended: null, latest: null }]);
  });

  it('deployments: releases newest first with rollback + health after deploy; live processes with uptime', async () => {
    await otherProcess('00000000-0000-4000-8000-0000000000f3', at(-200), {}, { version: '0.9.0+old0000', commit: 'old0000', startedAt: at(-600) });
    await sql`insert into system_health_snapshots (component_key, status, previous, reason_code, observed_at) values ('database', 'DEGRADED', 'HEALTHY', 'x', ${at(-110)})`.execute(db);
    const d = await svc.deployments(NOW, { RELEASE_NOTES_URL: 'https://github.com/x/releases' } as any);
    expect(d.releaseNotesUrl).toBe('https://github.com/x/releases');
    expect(d.releases.map((r) => r.commit)).toContain('old0000');
    const cur = d.releases.find((r) => r.commit === 'abc1234')!;
    expect(cur.healthChangesAfterDeploy).toBe(1);   // the database went DEGRADED 10 minutes after that release booted
    expect(d.processes.every((p) => p.live)).toBe(true);
    expect(d.processes.find((p) => p.bootId === '00000000-0000-4000-8000-0000000000f1')!.uptimeSeconds).toBe(119 * 60);
    expect((await svc.deployments(NOW, { RELEASE_NOTES_URL: 'javascript:alert(1)' } as any)).releaseNotesUrl).toBeNull();
  });

  it('incidents: active first with the commander and timeline; resolved ones in recent', async () => {
    const inc = (await sql<any>`insert into status_incidents (title, status, impact, started_at, created_at, severity, recovery_owner, affected_tenants, component_key)
        values ('Card payments failing', 'investigating', 'major', ${at(-30)}, ${at(-30)}, 'critical', 'Kevin', 12, 'payments') returning id`.execute(db)).rows[0].id;
    await sql`insert into status_incidents (title, status, impact, started_at, created_at, resolved_at) values ('Old blip', 'resolved', 'minor', ${at(-3000)}, ${at(-3000)}, ${at(-2900)})`.execute(db);
    await sql`insert into status_incident_events (incident_id, kind, body, actor, created_at) values (${inc}, 'commander_assigned', 'Processor confirmed', 'Kevin', ${at(-20)}), (${inc}, 'detected', 'Opened', null, ${at(-30)})`.execute(db);
    const i = await svc.incidents(NOW);
    expect(i.active).toHaveLength(1);
    expect(i.active[0]).toMatchObject({ title: 'Card payments failing', commander: 'Kevin', severity: 'critical', affectedTenants: 12, componentKey: 'payments' });
    expect(i.active[0].timeline.map((e) => e.body)).toEqual(['Opened', 'Processor confirmed']);
    expect(i.recent.map((r) => r.title)).toEqual(['Old blip']);
  });
});

describe('pure helpers', () => {
  const beat = (metrics: any): HeartbeatRow => ({ bootId: 'x', processRole: 'api', startedAt: NOW, lastSeenAt: NOW, metrics });
  it('quantileBy merges histograms bucket by bucket across processes', () => {
    const h = (counts: number[]) => ({ aipowersalon_x: [{ l: { k: 'a' }, v: { b: [0.1, 1], c: counts, s: 0, n: counts.reduce((a, b) => a + b, 0) } }] });
    const q = quantileBy([beat(h([10, 0, 0])), beat(h([0, 0, 10]))], 'aipowersalon_x', ['k'], 0.95);
    expect(q.get(JSON.stringify({ k: 'a' }))).toBeGreaterThan(1);   // the slow process's samples are in the fleet p95
    expect(sumBy([beat({ aipowersalon_y: [{ l: { k: 'a' }, v: 2 }] }), beat({ aipowersalon_y: [{ l: { k: 'a' }, v: 3 }] })], 'aipowersalon_y', ['k']).get(JSON.stringify({ k: 'a' }))!.value).toBe(5);
  });
  it('releaseHistory flags an older release that booted again after a newer one', () => {
    const b = (version: string, min: number) => ({ version, commit: version, deployment: 'd', environment: 'p', startedAt: at(min), lastSeenAt: at(min + 5), live: false });
    const r = releaseHistory([b('v1', -100), b('v2', -50), b('v1', -10)]);
    expect(r.map((x) => [x.version, x.rollback])).toEqual([['v2', false], ['v1', true]]);
    expect(releaseHistory([b('v1', -100), b('v2', -50)]).map((x) => x.rollback)).toEqual([false, false]);
  });
  it('commsChannel classifies providers; metricsDigest keeps only dashboard series', () => {
    expect([commsChannel('twilio_verify'), commsChannel('sendgrid'), commsChannel('fcm'), commsChannel('retell'), commsChannel('cardpointe')]).toEqual(['sms', 'email', 'push', 'voice', null]);
    expect(Object.keys(metricsDigest({ aipowersalon_storage_bytes_total: [{ labels: { store: 'm' }, value: 1 }], aipowersalon_api_requests_total: [{ labels: {}, value: 1 }] }))).toEqual(['aipowersalon_storage_bytes_total']);
  });
});
