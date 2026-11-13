// logs-page.pgtest — Device & Integration Logs SUNMI guide (Nov 9 2026) on the REAL schema: dated, numbered pages,
// newest first, the range's counts, and the real device events (audit_logs / go_checkin_logs) read where they live.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyLogsRepository } from './logs.kysely.repository';
import { LogsService, ValidationError, ForbiddenError, ExportUnavailableError } from './logs.service';
import { redactLogText } from './logs-core';

const T = 'c8460000-0000-4000-8000-000000000001', B = 'c8460000-0000-4000-8000-000000000002', X = 'c8460000-0000-4000-8000-000000000003', U = 'c8460000-0000-4000-8000-000000000004';
const ctx = { tenantId: T, branchId: B, userId: U, role: 'OWNER', permissions: ['pos.logs.view'] };
let db: any; let svc: LogsService;
const q = async (s: any) => (await s.execute(db)).rows;

beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  svc = new LogsService(new KyselyLogsRepository(db));
  await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'S', 'Pilot', 'lg-846', 'LG846', 'active'), (${X}, 'X', 'Other', 'lg-846x', 'LG846X', 'active')`);
  await q(sql`insert into branches (id, tenant_id, name) values (${B}, ${T}, 'Main')`);
  await q(sql`insert into tenant_event_logs (tenant_id, branch_id, category, severity, source, message, created_at) values
    (${T}, ${B}, 'integration', 'error', 'webhook', 'delivery failed 500', '2026-11-08T10:00:00Z'),
    (${T}, ${B}, 'integration', 'info', 'webhook', 'delivered', '2026-11-07T10:00:00Z'),
    (${X}, null, 'integration', 'error', 'webhook', 'other salon', '2026-11-08T10:00:00Z')`);
  await q(sql`insert into audit_logs (tenant_id, branch_id, action_type, entity_type, entity_id, created_at) values
    (${T}, ${B}, 'customer_display_revoked', 'customer_display', ${B}, '2026-11-09T09:00:00Z'), (${T}, ${B}, 'customer_note_reviewed', 'customer', ${B}, '2026-11-09T09:30:00Z')`);
  await q(sql`insert into go_checkin_logs (tenant_id, branch_id, event_type, safe_message, created_at) values (${T}, ${B}, 'check_in_completed', 'guest checked in', '2026-11-06T10:00:00Z')`);
}, 180_000);

describe('Device & Integration Logs — pages', () => {
  it('LG-01 newest first across the log store and the device events; other salons and non-device audits excluded', async () => {
    const r = await svc.query(ctx, { page: 1, pageSize: 10 });
    expect(r.logs.map((l) => l.message)).toEqual(['customer display revoked', 'delivery failed 500', 'delivered', 'guest checked in']);
    expect(r.summary).toEqual({ events: 4, warnings: 1, errors: 1, device: 2, integration: 2 });
    expect(r).toMatchObject({ total: 4, page: 1, pageSize: 10, totalPages: 1 });
  });
  it('LG-02 filters + date range + pages agree with the counts', async () => {
    const r = await svc.query(ctx, { page: 1, pageSize: 10, category: 'device' });
    expect(r.logs.every((l) => l.category === 'device')).toBe(true); expect(r.summary!.events).toBe(2);
    const d = await svc.query(ctx, { page: 1, pageSize: 10, from: '2026-11-07', to: '2026-11-08' });
    expect(d.logs.map((l) => l.message)).toEqual(['delivery failed 500', 'delivered']);
    const p2 = await svc.query(ctx, { page: 2, pageSize: 10, search: 'deliver' });
    expect(p2.logs).toHaveLength(0); expect(p2.total).toBe(2);
    await expect(svc.query(ctx, { page: 1, from: '2026-11-09', to: '2026-11-01' })).rejects.toBeInstanceOf(ValidationError);
  });
  // Device Integration Logs backlog · 03: one device's connection timeline — only the events that point at that device, newest first
  it('LG-04 one device\'s history: relatedId keeps that device\'s events only (newest first) and the counts follow', async () => {
    const D1 = 'c8460000-0000-4000-8000-0000000000d1', D2 = 'c8460000-0000-4000-8000-0000000000d2';
    await q(sql`insert into audit_logs (tenant_id, branch_id, action_type, entity_type, entity_id, created_at) values
      (${T}, ${B}, 'customer_display_registered', 'customer_display', ${D1}, '2026-11-01T09:00:00Z'),
      (${T}, ${B}, 'customer_display_offline', 'customer_display', ${D1}, '2026-11-02T09:00:00Z'),
      (${T}, ${B}, 'customer_display_reconnected', 'customer_display', ${D1}, '2026-11-02T09:05:00Z'),
      (${T}, ${B}, 'customer_display_registered', 'customer_display', ${D2}, '2026-11-02T10:00:00Z'),
      (${X}, null, 'customer_display_registered', 'customer_display', ${D1}, '2026-11-02T11:00:00Z')`);
    const r = await svc.query(ctx, { page: 1, pageSize: 10, relatedId: D1 });
    expect(r.logs.map((l) => l.message)).toEqual(['customer display reconnected', 'customer display offline', 'customer display registered']);
    expect(r.logs.every((l) => l.relatedId === D1)).toBe(true);
    expect(r.summary).toEqual({ events: 3, warnings: 1, errors: 0, device: 3, integration: 0 });   // "offline" is a warning; another salon's row is not here
    expect((await svc.query(ctx, { page: 1, pageSize: 10, relatedId: "x' or 1=1 --" })).total).toBe(8);   // an unsafe id is ignored, never interpolated
  });
  it('LG-03 the legacy shape (no page) is unchanged', async () => {
    const r = await svc.query(ctx, { limit: 50 });
    expect(Object.keys(r)).toEqual(['logs']);
    expect(r.logs.map((l) => l.message)).toEqual(['delivery failed 500', 'delivered']);
  });
});

describe('Device Integration Logs 06 (Nov 12 2026): payment environment label', () => {
  it('the salon default when the branch has no merchant of its own; a branch merchant wins; the latest production validation is reported only for an exact provider', async () => {
    await q(sql`insert into tenant_payment_config (tenant_id, processor, environment) values (${T}, 'clover', 'sandbox') on conflict (tenant_id) do update set processor = excluded.processor, environment = excluded.environment`);
    let r: any = await svc.query(ctx, { page: 1, pageSize: 10 });
    expect(r.paymentEnvironment).toEqual({ environment: 'sandbox', source: 'salon', processor: 'clover', certification: null });
    await q(sql`insert into payment_platform_validations (provider, scope_version, environment, status) values ('clover', 'bolt v1', 'production', 'testing')`);
    r = await svc.query(ctx, { page: 1, pageSize: 10 });
    expect(r.paymentEnvironment.certification).toBe('testing');
    await q(sql`insert into payment_merchant_accounts (tenant_id, branch_id, processor, environment) values (${T}, ${B}, 'clover', 'production')`);
    r = await svc.query(ctx, { page: 1, pageSize: 10 });
    expect(r.paymentEnvironment).toEqual({ environment: 'production', source: 'branch', processor: 'clover', certification: 'testing' });
    // another salon with nothing configured: no label (never someone else's)
    r = await svc.query({ ...ctx, tenantId: X, branchId: '' }, { page: 1, pageSize: 10 });
    expect(r.paymentEnvironment).toEqual({ environment: null, source: null, processor: null, certification: null });
  });
  // Device Integration Logs backlog · 02: a terminal trace — every event recorded under one correlation id, read in order
  it('LG-05 one trace: correlationId keeps the events of that payment-terminal request only; another salon and an unsafe id never', async () => {
    const C = 'trm-req.7f3a:01';
    await q(sql`insert into tenant_event_logs (tenant_id, branch_id, category, severity, source, message, correlation_id, created_at) values
      (${T}, ${B}, 'device', 'info', 'payment_terminal', 'sale command sent', ${C}, '2026-11-05T10:00:00Z'),
      (${T}, ${B}, 'integration', 'warning', 'payment_terminal', 'provider response timeout', ${C}, '2026-11-05T10:00:30Z'),
      (${T}, ${B}, 'integration', 'info', 'payment_terminal', 'status inquiry: approved', ${C}, '2026-11-05T10:01:00Z'),
      (${T}, ${B}, 'device', 'info', 'payment_terminal', 'another request', 'trm-req.other', '2026-11-05T10:02:00Z'),
      (${X}, null, 'device', 'info', 'payment_terminal', 'other salon same id', ${C}, '2026-11-05T10:03:00Z')`);
    const r = await svc.query(ctx, { page: 1, pageSize: 10, correlationId: C });
    expect(r.logs.map((l) => l.message)).toEqual(['status inquiry: approved', 'provider response timeout', 'sale command sent']);
    expect(r.logs.every((l) => l.correlationId === C)).toBe(true);
    expect(r.summary).toEqual({ events: 3, warnings: 1, errors: 0, device: 1, integration: 2 });
    const all = (await svc.query(ctx, { page: 1, pageSize: 10 })).total;
    expect((await svc.query(ctx, { page: 1, pageSize: 10, correlationId: "x' or 1=1 --" })).total).toBe(all);   // unsafe → ignored, never interpolated
    expect((await svc.query(ctx, { limit: 50, correlationId: C })).logs).toHaveLength(3);                       // the legacy shape filters too
  });
});

// Device Integration Logs backlog · 08 (Nov 12 2026): the sanitized, role-gated, audited export of one fixed range
describe('Device Integration Logs 08: sanitized export', () => {
  const exp = { ...ctx, permissions: ['pos.logs.view', 'pos.reports.export'] };
  it('LG-08a needs pos.reports.export as well as view; needs a from + to of at most 31 days', async () => {
    await expect(svc.exportCsv(ctx, { from: '2026-11-01', to: '2026-11-10' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc.exportCsv(exp, { from: '2026-11-01' })).rejects.toMatchObject({ code: 'LOGS_INVALID_PERIOD' });
    await expect(svc.exportCsv(exp, { from: '2026-11-10', to: '2026-11-01' })).rejects.toMatchObject({ code: 'LOGS_INVALID_PERIOD' });
    await expect(svc.exportCsv(exp, { from: '2026-10-01', to: '2026-11-01' })).rejects.toMatchObject({ code: 'LOGS_EXPORT_RANGE_TOO_LONG' });   // 32 days
    expect(await auditCount()).toBe(0);   // nothing refused was recorded as an export
  });
  it('LG-08b redacts messages, never writes metadata, keeps the range + filters, stays in the salon, and is audited (counts only)', async () => {
    await q(sql`insert into tenant_event_logs (tenant_id, branch_id, category, severity, source, message, metadata, created_at) values
      (${T}, ${B}, 'integration', 'error', 'sms', 'send to (215) 555-0142 failed for ann@example.com token=abc123', '{"apiKey":"zz","body":"hello"}', '2026-11-03T10:00:00Z'),
      (${T}, ${B}, 'integration', 'warning', 'payment_terminal', '=HYPERLINK("x") card 4111 1111 1111 1111 declined', null, '2026-11-03T11:00:00Z'),
      (${X}, null, 'integration', 'error', 'sms', 'other salon secret', null, '2026-11-03T10:00:00Z')`);
    const csv = await svc.exportCsv(exp, { from: '2026-11-03', to: '2026-11-03', category: 'integration' });
    expect(csv).toContain('Period,"2026-11-03 to 2026-11-03');
    expect(csv).toContain('Category,integration');
    expect(csv).toContain('Rows,2'); expect(csv).toContain('Truncated,no');
    expect(csv).toContain('•••0142'); expect(csv).toContain('[email]'); expect(csv).toContain('token=[redacted]'); expect(csv).toContain('•••1111');
    for (const leak of ['555-0142', 'ann@example.com', 'abc123', '4111 1111', 'apiKey', 'hello', 'other salon']) expect(csv).not.toContain(leak);
    expect(csv).toContain(`"'=HYPERLINK(""x"") card •••1111 declined"`);   // formula-safe cell
    expect(csv.indexOf('payment_terminal')).toBeLessThan(csv.indexOf(',sms,'));   // newest first
    const a = (await q(sql`select actor_user_id, module, action, resource_type, metadata from audit_events where tenant_id = ${T} and action = 'logs_exported'`))[0];
    expect(a).toMatchObject({ actor_user_id: U, module: 'logs', action: 'logs_exported', resource_type: 'tenant_event_logs' });
    expect(a.metadata).toMatchObject({ from: '2026-11-03', to: '2026-11-03', rows: 2, total: 2, category: 'integration', search: 'no' });
    expect(JSON.stringify(a.metadata)).not.toContain('example.com');
  });
  it('LG-08c no audit store → no file (fail-closed)', async () => {
    const bare = new LogsService({ insert: async () => { throw new Error('unused'); }, query: async () => [] });
    await expect(bare.exportCsv(exp, { from: '2026-11-03', to: '2026-11-03' })).rejects.toBeInstanceOf(ExportUnavailableError);
  });
  it('LG-08d redactLogText keeps dates and ids readable', () => {
    expect(redactLogText('sync 2026-11-03 for c8460000-0000-4000-8000-000000000001 ok')).toBe('sync 2026-11-03 for c8460000-0000-4000-8000-000000000001 ok');
    expect(redactLogText('retry at 2026-11-03 10:00 failed')).toBe('retry at 2026-11-03 10:00 failed');
    expect(redactLogText('call +1 215 555 0142; password: "p w"')).toBe('call •••0142; password: [redacted]');
  });
});
// Device Integration Logs backlog · 09: Worker Delay & Retry Visibility — the salon's rows in the existing retry stores
describe('Device Integration Logs 09 — retry queue visibility', () => {
  it('LG-09 jobs + webhook deliveries: state, attempt n of max, lag of a due item, dead letters (7 days); no payload; redacted; other salon excluded', async () => {
    const W = 'c8460000-0000-4000-8000-0000000000e1';
    await q(sql`insert into tenant_webhooks (id, tenant_id, name, url, signing_secret_enc) values (${W}, ${T}, 'Hook', 'https://hooks.example.test/x', 'enc')`);
    await q(sql`insert into jobs (job_class, job_type, tenant_id, payload, status, attempts, max_attempts, run_after, last_error, correlation_id, updated_at) values
      ('standard', 'customer.phone.sync', ${T}, '{"phone":"+12155550142"}'::jsonb, 'queued', 2, 5, now() - interval '90 seconds', 'provider said token=abc123 for owner@example.com
  at stack line 2', 'corr-lg09', now() - interval '1 minute'),
      ('standard', 'report.build', ${T}, '{}'::jsonb, 'queued', 0, 5, now() + interval '10 minutes', null, null, now() - interval '2 minutes'),
      ('critical', 'receipt.send', ${T}, '{}'::jsonb, 'dead', 5, 5, now() - interval '1 day', 'gave up', null, now() - interval '1 day'),
      ('critical', 'receipt.send', ${T}, '{}'::jsonb, 'dead', 5, 5, now() - interval '20 days', 'too old', null, now() - interval '20 days'),
      ('standard', 'customer.phone.sync', ${T}, '{}'::jsonb, 'succeeded', 1, 5, now() - interval '1 hour', null, null, now()),
      ('standard', 'customer.phone.sync', ${X}, '{}'::jsonb, 'dead', 5, 5, now(), 'other salon', null, now())`);
    await q(sql`update jobs set finished_at = updated_at where status = 'dead'`);
    await q(sql`insert into tenant_webhook_deliveries (tenant_id, webhook_id, event_type, payload, status, attempt_count, max_attempts, next_attempt_at, last_error, created_at, updated_at) values
      (${T}, ${W}, 'appointment.created', '{"customer":"secret"}'::jsonb, 'failed', 3, 8, now() - interval '30 seconds', 'HTTP 500', now(), now() - interval '3 minutes'),
      (${T}, ${W}, 'appointment.updated', '{}'::jsonb, 'delivered', 1, 8, null, null, now(), now())`);
    const r = await svc.retryQueue(ctx, { page: 1, pageSize: 10 });
    expect(r.jobs).toMatchObject({ waiting: 1, retrying: 1, running: 0, dead: 1 });
    expect(r.webhooks).toMatchObject({ waiting: 0, retrying: 1, dead: 0 });
    expect(r.jobs.oldestDueLagSeconds).toBeGreaterThanOrEqual(85);
    expect(r.total).toBe(4);
    expect(r.items.map((i) => `${i.store}:${i.state}:${i.type}`)).toEqual(['job:dead:receipt.send', 'job:retrying:customer.phone.sync', 'webhook:retrying:appointment.created', 'job:waiting:report.build']);
    const retry = r.items[1];
    expect(retry).toMatchObject({ attempt: 2, maxAttempts: 5, correlationId: 'corr-lg09' });
    expect(retry.lagSeconds).toBeGreaterThanOrEqual(85);
    expect(retry.lastError).toBe('provider said token=[redacted] for [email]');   // one line, redacted
    expect(r.items[3].lagSeconds).toBeNull();                                         // not due yet → no lag
    expect(JSON.stringify(r)).not.toMatch(/12155550142|secret|other salon|too old/);
    const p2 = await svc.retryQueue(ctx, { page: 2, pageSize: 10 });
    expect(p2.items).toHaveLength(0); expect(p2.totalPages).toBe(1);
    await expect(svc.retryQueue({ ...ctx, permissions: [] }, {})).rejects.toBeInstanceOf(ForbiddenError);
  });
});
async function auditCount(): Promise<number> { return Number((await q(sql`select count(*)::int as n from audit_events where action = 'logs_exported'`))[0].n); }

describe('Device & Integration Logs — salon days and disconnects (leftovers fixed Nov 13 2026)', () => {
  const T2 = 'c8460000-0000-4000-8000-0000000000a1', B2 = 'c8460000-0000-4000-8000-0000000000a2';
  const ctx2 = { tenantId: T2, branchId: B2, userId: U, role: 'OWNER', permissions: ['pos.logs.view'] };
  it('LG-10 From / To are the salon\'s calendar days (branch time zone), not UTC days; a disconnected device is a warning', async () => {
    await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T2}, 'W', 'West', 'lg-846w', 'LG846W', 'active')`);
    await q(sql`insert into branches (id, tenant_id, name, timezone) values (${B2}, ${T2}, 'West', 'America/Los_Angeles')`);
    // 21:30 on Nov 11 in Los Angeles = 05:30 UTC on Nov 12
    await q(sql`insert into tenant_event_logs (tenant_id, branch_id, category, severity, source, message, created_at) values (${T2}, ${B2}, 'integration', 'info', 'webhook', 'late evening delivery', '2026-11-12T05:30:00Z')`);
    await q(sql`insert into audit_logs (tenant_id, branch_id, action_type, entity_type, entity_id, created_at) values (${T2}, ${B2}, 'customer_display_disconnected', 'customer_display', ${B2}, '2026-11-11T20:00:00Z')`);
    const nov11 = await svc.query(ctx2, { page: 1, pageSize: 10, from: '2026-11-11', to: '2026-11-11' });
    expect(nov11.logs.map((l) => l.message)).toEqual(['late evening delivery', 'customer display disconnected']);
    expect((await svc.query(ctx2, { page: 1, pageSize: 10, from: '2026-11-12', to: '2026-11-12' })).logs).toEqual([]);
    expect(nov11.logs.find((l) => l.message === 'customer display disconnected')!.severity).toBe('warning');
    expect(nov11.summary!.warnings).toBe(1);
  });
});
