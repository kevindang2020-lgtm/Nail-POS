// setup-health.pgtest — Four-Module Completion Guide (Oct 30 2026) HL-01 / HL-02, against the REAL schema:
//   • Ready only from verified, fresh evidence; a stale provider check is Unknown; a stored "approved" registration that the
//     provider never confirmed is not green; traffic without status callbacks is a warning; failures are visible
//   • results stored with provenance (source, verified_at, expires_at, last good); a stored Ready past expiry shows Unknown
//   • alerts deduplicated per check × branch, refreshed (not duplicated) on rerun, resolved when fixed, escalated once
//   • the nightly run is idempotent per salon-local date; the scheduler enqueues once per salon per date; a failed night retries
//   • branch authorization and tenant isolation; release evidence needs a reference and turns release.ci_run Ready
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { SetupHealthRepository, SetupHealthError, appVersion } from './setup-health.repository';

const P = 'c5e85000-0000-4000-8000-0000000';
const id = (n: string) => P + n.padStart(5, '0');
const T = id('a1'), T2 = id('a2'), B1 = id('b1'), B2 = id('b2'), BX = id('b9'), OWNER = id('e1');
const ENV = { PUBLIC_API_BASE_URL: 'https://api.pilot.test', TWILIO_STATUS_CALLBACK_URL: 'https://api.pilot.test/webhooks/twilio/sms/status' };
const owner = { tenantId: T, userId: OWNER, role: 'OWNER', permissions: ['settings.view', 'settings.edit'], branchIds: null };
const manager = { tenantId: T, userId: id('e2'), role: 'MANAGER', permissions: ['settings.view'], branchIds: [B2] };
const other = { tenantId: T2, userId: id('e3'), role: 'OWNER', permissions: ['settings.view', 'settings.edit'], branchIds: null };
let pg: any; let db: any; let repo: SetupHealthRepository; let repo2: SetupHealthRepository;
const q = (s: string, p: unknown[] = []) => pg.query(s, p);
async function code(p: Promise<unknown>) { try { await p; return 'ok'; } catch (e) { return e instanceof SetupHealthError ? e.code : String((e as Error).message); } }
const unthrottle = () => q(`update health_check_runs set started_at = started_at - interval '5 minutes'`);
const byKey = (s: any) => Object.fromEntries(s.checks.map((c: any) => [`${c.key}:${c.branchId ?? 'all'}`, c]));

beforeAll(async () => {
  pg = await migratedPglite();
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Lotus LLC','Lotus Nails','sh-lotus','SHL001','active'), ($2,'Other LLC','Other Nails','sh-other','SHL002','active')`, [T, T2]);
  await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$4,'Main','active','America/New_York'), ($2,$4,'Cherry Hill','active','America/New_York'), ($3,$5,'Other','active','America/New_York')`, [B1, B2, BX, T, T2]);
  // Twilio: tenant default connected + checked an hour ago; Cherry Hill has its own override whose last check failed
  await q(`insert into tenant_messaging_credentials (tenant_id, branch_id, provider, account_sid, status, from_number) values ($1, null, 'twilio', 'AC' || repeat('a', 32), 'configured', '+18565550123'), ($1, $2, 'twilio', 'AC' || repeat('b', 32), 'configured', '+18565550124')`, [T, B2]).catch(async () => {
    await q(`insert into tenant_messaging_credentials (tenant_id, branch_id, provider, account_sid, status) values ($1, null, 'twilio', 'AC' || repeat('a', 32), 'configured'), ($1, $2, 'twilio', 'AC' || repeat('b', 32), 'configured')`, [T, B2]);
  });
  await q(`insert into tenant_messaging_health_checks (tenant_id, branch_id, config_source, config_fingerprint, trigger_kind, account_state, sender_state, verify_state, checked_at)
    values ($1, null, 'tenant_default', 'f1', 'manual', 'connected', 'assigned', 'ok', now() - interval '1 hour'), ($1, $2, 'branch_override', 'f2', 'manual', 'invalid', 'unknown', 'unknown', now() - interval '2 hours')`, [T, B2]);
  await q(`insert into tenant_a2p_registrations (tenant_id, brand_status, campaign_status, status, updated_at) values ($1, 'APPROVED', 'IN_PROGRESS', 'campaign_submitted', now() - interval '3 days')`, [T]);
  await q(`insert into tenant_messaging_webhook_activity (tenant_id, webhook_kind, first_verified_at, last_verified_at, events_verified) values ($1, 'inbound', now() - interval '20 days', now() - interval '2 days', 4)`, [T]);
  await q(`insert into notifications (tenant_id, channel, to_address, body, status, provider_id, created_at) values ($1, 'sms', '+12155550000', 'x', 'sent', 'SM' || repeat('1', 32), now() - interval '1 day')`, [T]);
  await q(`insert into booking_verification_settings (tenant_id, branch_id, enabled) values ($1, null, true)`, [T]);
  await q(`insert into tenant_ai_subscriptions (tenant_id, package_code, status, price_cents, usage_limit) values ($1, 'ai_marketing_assistant', 'past_due', 5900, 500)`, [T]);
  await q(`insert into jobs (job_class, job_type, tenant_id, status, attempts, max_attempts, updated_at) values ('standard', 'retention.sms.send', $1, 'dead', 5, 5, now() - interval '1 day')`, [T]);
  // the other salon: everything healthy-looking of its own (must never leak into Lotus)
  await q(`insert into tenant_messaging_health_checks (tenant_id, config_source, config_fingerprint, trigger_kind, account_state, sender_state, verify_state, checked_at) values ($1, 'tenant_default', 'x', 'manual', 'connected', 'assigned', 'ok', now())`, [T2]);
  db = kyselyFor(pg); repo = new SetupHealthRepository(db, ENV); repo2 = new SetupHealthRepository(db, {});
}, 180_000);

describe('HL-01 checks and provenance', () => {
  it('reports each area from its authoritative record — never green from configuration alone', async () => {
    await repo.run(owner, 'manual');
    const s = await repo.summary(owner, {}); const k = byKey(s);
    expect(k['twilio.account:all']).toMatchObject({ status: 'ready', code: 'connected' });
    expect(k['twilio.account:all'].verifiedAt).not.toBeNull(); expect(k['twilio.account:all'].expiresAt).not.toBeNull();
    expect(k[`twilio.account:${B2}`]).toMatchObject({ status: 'action_required' });            // the branch override's own failed check
    expect(k['registration.carrier:all']).toMatchObject({ status: 'pending_external', code: 'in_review' });   // brand approved, campaign in review
    expect(k['sms.inbound_webhook:all'].status).toBe('ready');
    expect(k['sms.status_callback:all']).toMatchObject({ status: 'warning', code: 'traffic_without_callbacks' });   // messages went out, no verified callback came back
    expect(k['booking.verification:all'].status).toBe('ready');
    expect(k['ai.entitlement:all']).toMatchObject({ status: 'action_required', code: 'past_due' });
    expect(k['jobs.queue:all']).toMatchObject({ status: 'error', code: 'dead_letters' });
    expect(k['jobs.data_accuracy:all'].status).toBe('unknown');
    expect(k['release.ci_run:all']).toMatchObject({ status: 'pending_external', code: 'no_evidence_for_version' });
    expect(s.overall).toBe('error'); expect(s.technical).toBe(true);
    expect(JSON.stringify(s)).not.toMatch(/AC[a-b]{32}|\+1856555/);   // no SID / phone in the dashboard payload
  });

  it('a stale provider check is Unknown, missing env is Action Required, and a stored Ready past expiry shows Unknown', async () => {
    await unthrottle();
    const later = new SetupHealthRepository(db, {}, () => new Date(Date.now() + 3 * 86400000));   // the same check, seen three days later (checks are append-only)
    await later.run(owner, 'manual');   // and with no PUBLIC_API_BASE_URL / TWILIO_STATUS_CALLBACK_URL
    const k = byKey(await later.summary(owner, {}));
    expect(k['twilio.account:all']).toMatchObject({ status: 'unknown', code: 'stale' });
    expect(k['twilio.account:all'].lastGoodAt).not.toBeNull();
    expect(k['sms.inbound_webhook:all'].status).toBe('action_required'); expect(k['sms.status_callback:all'].status).toBe('action_required');
    await unthrottle(); await repo.run(owner, 'manual');
    await q(`update health_check_results set expires_at = now() - interval '1 minute' where tenant_id = $1 and check_key = 'twilio.account' and branch_id is null and status = 'ready'`, [T]);
    expect(byKey(await repo.summary(owner, {}))['twilio.account:all']).toMatchObject({ status: 'unknown', stale: true });
  });
});

describe('HL-01 alerts', () => {
  it('dedupes per check × branch, refreshes on rerun, resolves when fixed, escalates once', async () => {
    const open = async () => (await q(`select check_key, branch_id, status, occurrences, escalated_at from health_check_alerts where tenant_id = $1 order by check_key, branch_id nulls first`, [T])).rows;
    const before = await open();
    expect(before.filter((a: any) => a.check_key === 'jobs.queue')).toHaveLength(1);
    await unthrottle(); await repo.run(owner, 'manual');
    const after = await open();
    expect(after.length).toBe(before.length);                                                    // no duplicate alerts
    expect(after.find((a: any) => a.check_key === 'jobs.queue').occurrences).toBeGreaterThan(before.find((a: any) => a.check_key === 'jobs.queue').occurrences);
    await q(`update jobs set status = 'succeeded' where tenant_id = $1`, [T]);
    await unthrottle(); await repo.run(owner, 'manual');
    expect((await open()).find((a: any) => a.check_key === 'jobs.queue').status).toBe('resolved');
    await q(`update health_check_alerts set first_seen_at = now() - interval '3 days' where tenant_id = $1 and check_key = 'ai.entitlement'`, [T]);
    await unthrottle(); await repo.run(owner, 'manual');
    const esc1 = (await open()).find((a: any) => a.check_key === 'ai.entitlement').escalated_at;
    await unthrottle(); await repo.run(owner, 'manual');
    expect(esc1).not.toBeNull(); expect((await open()).find((a: any) => a.check_key === 'ai.entitlement').escalated_at).toEqual(esc1);   // once
    const s = await repo.summary(owner, {}); const a = s.alerts.find((x: any) => x.key === 'ai.entitlement')!;
    await repo.acknowledge(owner, a.id); expect(await code(repo.acknowledge(other, a.id))).toBe('HEALTH_ALERT_NOT_FOUND');
    expect(await repo.openCriticalCount(T)).toBeGreaterThan(0);
  });

  it('manual runs are rate-limited', async () => {
    await unthrottle(); await repo.run(owner, 'manual');
    expect(await code(repo.run(owner, 'manual'))).toBe('HEALTH_RUN_RATE_LIMITED');
  });
});

describe('HL-02 nightly', () => {
  it('one run per salon-local date; the scheduler enqueues once; a failed night is retried in place', async () => {
    const r1 = await repo.runNightlyJob({ tenantId: T, runDate: '2026-10-29' });
    const r2 = await repo.runNightlyJob({ tenantId: T, runDate: '2026-10-29' });
    expect(r1.duplicate).toBe(false); expect(r2).toEqual({ runId: r1.runId, duplicate: true });
    expect((await q(`select count(*)::int n from health_check_runs where tenant_id = $1 and trigger_kind = 'nightly' and run_date = '2026-10-29'`, [T])).rows[0].n).toBe(1);
    await q(`update health_check_runs set status = 'failed' where id = $1`, [r1.runId]);
    const r3 = await repo.runNightlyJob({ tenantId: T, runDate: '2026-10-29' });
    expect(r3.runId).toBe(r1.runId);
    expect((await q(`select status from health_check_runs where id = $1`, [r1.runId])).rows[0].status).toBe('succeeded');
    // 03:00 America/New_York on Oct 30 2026 = 07:00 UTC
    const at = new Date('2026-10-30T07:10:00Z');
    const s1 = await repo.scheduleNightly(at); const s2 = await repo.scheduleNightly(at);
    expect(s1.enqueued).toBe(2); expect(s2).toEqual({ enqueued: 0, duplicates: 2 });
    const jobs = (await q(`select tenant_id, payload->>'runDate' as d, run_after from jobs where job_type = 'setup_health.nightly' order by tenant_id`)).rows;
    expect(jobs.map((j: any) => j.d)).toEqual(['2026-10-30', '2026-10-30']);
    expect(await repo.scheduleNightly(new Date('2026-10-30T12:00:00Z'))).toEqual({ enqueued: 0, duplicates: 0 });   // not the nightly hour
    await expect(repo.runNightlyJob({ tenantId: 'nope', runDate: '2026-10-29' })).rejects.toThrow(/bad setup-health payload/);
  });
});

describe('HL-01 scope and isolation', () => {
  it('a manager sees only authorized branches; another salon sees nothing of Lotus', async () => {
    expect(await code(repo.summary(manager, { branchId: B1 }))).toBe('BRANCH_NOT_AUTHORIZED');
    const m = await repo.summary(manager, { branchId: B2 });
    expect(m.branches.map((b: any) => b.id)).toEqual([B2]); expect(m.checks.every((c: any) => c.branchId === null || c.branchId === B2)).toBe(true);
    expect(m.technical).toBe(false); expect(m.checks.every((c: any) => c.technical === null)).toBe(true);
    expect(await code(repo.summary(other, { branchId: B2 }))).toBe('BRANCH_NOT_AUTHORIZED');
    const o = await repo.summary(other, {});
    expect(o.run).toBeNull(); expect(o.checks).toHaveLength(0); expect(o.alerts).toHaveLength(0);
  });

  it('release evidence needs a reference and turns release.ci_run Ready for that version', async () => {
    expect(await code(repo.recordEvidence({}, { kind: 'ci_run', appVersion: appVersion(), outcome: 'passed' }))).toBe('EVIDENCE_INVALID');
    await repo.recordEvidence({}, { kind: 'ci_run', appVersion: appVersion(), outcome: 'passed', reference: 'github-actions run 123456', commitSha: 'abc123' });
    await unthrottle(); await repo.run(owner, 'manual');
    const k = byKey(await repo.summary(owner, {}));
    expect(k['release.ci_run:all'].status).toBe('ready'); expect(k['release.staging_run:all'].status).toBe('pending_external');
    expect((await repo.listEvidence({ appVersion: appVersion() })).items).toHaveLength(1);
  });
});

describe('HL-01 registration from the PM-03 provider snapshots (migration 725)', () => {
  it('Ready only when every item was confirmed by Twilio recently; a record-only "approved" or a rejection is not green', async () => {
    const T3 = id('a3'), O3 = { tenantId: T3, userId: id('e4'), role: 'OWNER', permissions: ['settings.view', 'settings.edit'], branchIds: null };
    await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Reg LLC','Reg Nails','sh-reg','SHL003','active')`, [T3]);
    const snap = (kind: string, state: string, verified: boolean, source = 'provider', ago = '1 hour') => q(`insert into tenant_messaging_registration_snapshots (tenant_id, item_kind, normalized_state, verified, source, checked_at, last_success_at)
      values ($1, $2, $3, $4, $5, now() - $6::interval, case when $4 then now() - $6::interval end)`, [T3, kind, state, verified, source, ago]);
    const reg = async () => { await q(`update health_check_runs set started_at = started_at - interval '5 minutes' where tenant_id = $1`, [T3]); await repo.run(O3, 'manual'); return byKey(await repo.summary(O3, {}))['registration.carrier:all']; };
    await snap('brand', 'approved', true); await snap('campaign', 'approved', false, 'registration_record'); await snap('tollfree_verification', 'not_applicable', false, 'not_configured');
    expect(await reg()).toMatchObject({ status: 'unknown', code: 'not_provider_verified' });     // the campaign is approved only on the stored record
    await snap('campaign', 'approved', true);
    const ok = await reg(); expect(ok).toMatchObject({ status: 'ready', code: 'provider_approved' }); expect(ok.verifiedAt).not.toBeNull();
    const later = new SetupHealthRepository(db, ENV, () => new Date(Date.now() + 4 * 86400000));   // the same confirmations, seen 4 days later (> 72 h)
    await q(`update health_check_runs set started_at = started_at - interval '5 minutes' where tenant_id = $1`, [T3]); await later.run(O3, 'manual');
    expect(byKey(await later.summary(O3, {}))['registration.carrier:all'].status).toBe('unknown');
    await snap('campaign', 'rejected', true);
    expect(await reg()).toMatchObject({ status: 'action_required', code: 'rejected' });
  });
});

// C3 audit (Nov 4 2026): retention snapshots are "fresh" only when yesterday's salon day has a completed, covered run
describe('retention snapshot freshness', () => {
  const ins = (d: string, status: string, coverage: string | null, finished = 'now()') => q(`insert into customer_retention_snapshot_runs (tenant_id, snapshot_local_date, definition_version, settings_version, segmentation_version, risk_days, approaching_days, time_zone, kind, status, coverage, finished_at)
    values ($1, ${d}, 'v-test-' || ${d}::text, 1, 's1', 60, 45, 'America/New_York', 'backfill', $2, $3, ${finished})`, [T, status, coverage]);
  const check = async () => { await unthrottle(); await repo.run(owner, 'manual'); return byKey(await repo.summary(owner, {}))['jobs.retention_snapshot:all']; };
  it('a backfill of an old day just finished is stale; an incomplete yesterday warns; a complete yesterday is ready', async () => {
    await ins(`'2026-03-01'::date`, 'completed', 'complete');
    expect(await check()).toMatchObject({ status: 'warning', code: 'stale' });
    await ins(`((now() at time zone 'America/New_York')::date - 1)`, 'completed', 'incomplete');
    expect(await check()).toMatchObject({ status: 'warning', code: 'incomplete_coverage' });
    await q(`update customer_retention_snapshot_runs set coverage = 'complete' where tenant_id = $1 and snapshot_local_date = (now() at time zone 'America/New_York')::date - 1`, [T]);
    expect(await check()).toMatchObject({ status: 'ready', code: 'fresh' });
  });
});
