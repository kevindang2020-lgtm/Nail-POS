// retention-executor.pgtest — the central retention executor (Constitution 1 §55–57, Phase 10) against the REAL migrated
// schema: deletes past the cutoff only, respects customer + audit legal holds, never touches a financial / audit table,
// batches, anonymises, keeps a referenced row, honours the Super Admin rule, records each executed run and — a dry run —
// writes nothing at all. The last test runs the REAL policy file: every entry the executor owns names a live table/column.
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { RetentionExecutorService } from './retention-executor.service';
import { retentionTick } from './retention-executor.scheduler';
import type { RetentionPolicyFile } from './retention-executor-core';

const A = 'a1000000-0000-4000-8000-00000000000a';
const B = 'b1000000-0000-4000-8000-00000000000b';
const BR = 'c1000000-0000-4000-8000-00000000000c';
let pg: any; let db: any;
const q = async (s: string, p: unknown[] = []) => (await pg.query(s, p)).rows;
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
const policy = (tables: RetentionPolicyFile['tables']): RetentionPolicyFile => ({ version: 1, classes: {}, tables });
const LOGIN = { login_attempts: { retention_class: 'security', delete_policy: 'hard_delete_after_days' as const, days: 90, timestamp_column: 'created_at', executor: 'central', data_class: 'login_attempts' } };
const loginRows = async () => (await q(`select tenant_id, (created_at < now() - interval '90 days') as old from login_attempts order by tenant_id, old`)).map((r: any) => `${r.tenant_id === A ? 'A' : 'B'}:${r.old ? 'old' : 'new'}`);
const runs = async () => Number((await q(`select count(*)::int c from data_retention_purge_runs`))[0].c);

beforeAll(async () => { pg = await migratedPglite(); db = kyselyFor(pg); });
beforeEach(async () => {
  await pg.exec(`delete from login_attempts; delete from customer_legal_holds; delete from audit_legal_holds; delete from data_retention_purge_runs; delete from data_retention_rules;`);
  for (const t of [A, B]) for (const d of [100, 120, 10]) await q(`insert into login_attempts (tenant_id, success, created_at) values ($1, false, $2)`, [t, daysAgo(d)]);
});

describe('retention executor — deletes', () => {
  it('deletes rows older than the cutoff, keeps the rest, and records one run row with the counts', async () => {
    const svc = new RetentionExecutorService(db, { policy: policy(LOGIN) });
    const r = await svc.run({ dryRun: false, trigger: 'manual', actorUserId: A });
    expect(r.results[0]).toMatchObject({ table: 'login_attempts', action: 'delete', eligible: 4, held: 0, processed: 4, batches: 1 });
    expect(await loginRows()).toEqual(['A:new', 'B:new']);
    const [run] = await q(`select data_class, mode, table_name, action, eligible_count, net_count, held_count, batches, triggered_by, actor_user_id, error from data_retention_purge_runs`);
    expect(run).toMatchObject({ data_class: 'login_attempts', mode: 'executed', table_name: 'login_attempts', action: 'delete', eligible_count: 4, net_count: 4, held_count: 0, batches: 1, triggered_by: 'manual', actor_user_id: A, error: null });
  });
  it('a DRY RUN returns the same counts and writes nothing — no deletion, no run row', async () => {
    const svc = new RetentionExecutorService(db, { policy: policy(LOGIN) });
    const r = await svc.run({ dryRun: true, trigger: 'manual' });
    expect(r.mode).toBe('dry_run');
    expect(r.results[0]).toMatchObject({ eligible: 4, processed: 4, batches: 0 });
    expect((await loginRows()).length).toBe(6);
    expect(await runs()).toBe(0);
  });
  it('batches: 1 batch per `batchSize` rows, each its own transaction', async () => {
    const svc = new RetentionExecutorService(db, { policy: policy(LOGIN), batchSize: 3 });
    const r = await svc.run({ dryRun: false, trigger: 'job' });
    expect(r.results[0]).toMatchObject({ processed: 4, batches: 2 });
    const capped = new RetentionExecutorService(db, { policy: policy(LOGIN), batchSize: 1, maxBatches: 1 });
    for (const d of [100, 101]) await q(`insert into login_attempts (tenant_id, success, created_at) values ($1, false, $2)`, [A, daysAgo(d)]);
    expect((await capped.run({ dryRun: false, trigger: 'job' })).results[0]).toMatchObject({ processed: 1, batches: 1 });   // the rest: next run
  });
});

describe('retention executor — legal holds', () => {
  it("a tenant-scoped customer legal hold protects that salon's rows (counted as held)", async () => {
    await q(`insert into customer_legal_holds (tenant_id, scope, matter_ref, reason) values ($1, 'tenant', 'M-1', 'litigation')`, [A]);
    const r = await new RetentionExecutorService(db, { policy: policy(LOGIN) }).run({ dryRun: false, trigger: 'job' });
    expect(r.results[0]).toMatchObject({ eligible: 4, held: 2, processed: 2 });
    expect(await loginRows()).toEqual(['A:new', 'A:old', 'A:old', 'B:new']);
  });
  it('a RELEASED hold protects nothing', async () => {
    await q(`insert into customer_legal_holds (tenant_id, scope, matter_ref, reason, status) values ($1, 'tenant', 'M-1', 'litigation', 'released')`, [A]);
    expect((await new RetentionExecutorService(db, { policy: policy(LOGIN) }).run({ dryRun: false, trigger: 'job' })).results[0]).toMatchObject({ held: 0, processed: 4 });
  });
  it('an audit legal hold (tenant scope) protects security rows of that tenant; a GLOBAL one protects every row', async () => {
    await q(`insert into audit_legal_holds (hold_ref, scope_type, scope_value, reason) values ('H-1', 'tenant', $1, 'investigation')`, [B]);
    expect((await new RetentionExecutorService(db, { policy: policy(LOGIN) }).run({ dryRun: false, trigger: 'job' })).results[0]).toMatchObject({ held: 2, processed: 2 });
    expect(await loginRows()).toEqual(['A:new', 'B:new', 'B:old', 'B:old']);
    await q(`insert into audit_legal_holds (hold_ref, scope_type, reason) values ('H-2', 'global', 'regulator')`);
    for (const d of [100]) await q(`insert into login_attempts (tenant_id, success, created_at) values ($1, false, $2)`, [A, daysAgo(d)]);
    expect((await new RetentionExecutorService(db, { policy: policy(LOGIN) }).run({ dryRun: false, trigger: 'job' })).results[0]).toMatchObject({ eligible: 3, held: 3, processed: 0 });
  });
});

describe('retention executor — what it refuses', () => {
  it('financial and audit classes are never executed, whatever the file says (reported as invalid, nothing deleted)', async () => {
    const svc = new RetentionExecutorService(db, { policy: policy({
      payments: { retention_class: 'financial', delete_policy: 'hard_delete_after_days', days: 1, timestamp_column: 'created_at', executor: 'central' },
      audit_events: { retention_class: 'audit', delete_policy: 'hard_delete_after_days', days: 1, timestamp_column: 'occurred_at', executor: 'central' },
      login_attempts: { retention_class: 'security', delete_policy: 'soft_delete', executor: 'central' },
    }) });
    const r = await svc.run({ dryRun: false, trigger: 'job' });
    expect(r.results).toEqual([]);
    expect(r.invalidEntries.map((e) => e.table).sort()).toEqual(['audit_events', 'login_attempts', 'payments']);
    expect((await loginRows()).length).toBe(6);
  });
  it('a table or column that does not exist is skipped and reported — never guessed', async () => {
    const r = await new RetentionExecutorService(db, { policy: policy({
      no_such_table: { retention_class: 'temporary', delete_policy: 'hard_delete_after_days', days: 1, timestamp_column: 'created_at', executor: 'central' },
      login_attempts: { retention_class: 'security', delete_policy: 'hard_delete_after_days', days: 1, timestamp_column: 'no_such_col', executor: 'central' },
    }) }).run({ dryRun: false, trigger: 'job' });
    expect(r.results.map((x) => x.skipped)).toEqual(['table does not exist', 'column(s) not found: no_such_col']);
    expect(await runs()).toBe(0);
  });
  it("an entry owned by another sweep (executor: '<path>') is not run by the central executor", async () => {
    const r = await new RetentionExecutorService(db, { policy: policy({ login_attempts: { ...LOGIN.login_attempts, executor: 'apps/api/src/somewhere.ts' } }) }).run({ dryRun: false, trigger: 'job' });
    expect(r.results).toEqual([]);
  });
});

describe('retention executor — rules, references, anonymisation, the daily job', () => {
  it("the Super Admin rule for the table's data class replaces the policy days (200 days → the 100/120-day rows stay)", async () => {
    await q(`insert into data_retention_rules (data_class, version, status, retention_days, action) values ('login_attempts', 1, 'active', 200, 'delete')`);
    const r = await new RetentionExecutorService(db, { policy: policy(LOGIN) }).run({ dryRun: false, trigger: 'job' });
    expect(r.results[0]).toMatchObject({ days: 200, source: 'super_admin_rule', eligible: 0, processed: 0 });
    expect((await loginRows()).length).toBe(6);
  });
  it('not_referenced_by: an expired booking hold a verification session still names is kept', async () => {
    await pg.exec(`delete from booking_verification_sessions; delete from booking_holds;`);
    const [kept] = await q(`insert into booking_holds (tenant_id, branch_id, start_time, end_time, expires_at) values ($1, $2, now(), now() + interval '1 hour', $3) returning id`, [A, BR, daysAgo(40)]);
    await q(`insert into booking_holds (tenant_id, branch_id, start_time, end_time, expires_at) values ($1, $2, now(), now() + interval '1 hour', $3)`, [A, BR, daysAgo(40)]);
    await q(`insert into booking_verification_sessions (tenant_id, branch_id, booking_session_id, phone_hash, phone_mask, channel, expires_at, booking_hold_id) values ($1, $2, gen_random_uuid(), 'h', '***', 'online', now(), $3)`, [A, BR, kept.id]);
    const svc = new RetentionExecutorService(db, { policy: policy({ booking_holds: { retention_class: 'temporary', delete_policy: 'hard_delete_after_days', days: 30, timestamp_column: 'expires_at', executor: 'central', not_referenced_by: [{ table: 'booking_verification_sessions', column: 'booking_hold_id' }] } }) });
    expect((await svc.run({ dryRun: false, trigger: 'job' })).results[0]).toMatchObject({ eligible: 1, processed: 1 });
    expect((await q(`select id from booking_holds`)).map((r: any) => r.id)).toEqual([kept.id]);
  });
  it('anonymize: clears the contact columns of rows past the cutoff once; a second run finds nothing to do', async () => {
    await pg.exec(`delete from website_leads;`);
    await q(`insert into website_leads (name, email, phone, archived_at) values ('Old Lead', 'old@example.test', '5550001', $1), ('New Lead', 'new@example.test', '5550002', $2), ('Open', 'o@example.test', null, null)`, [daysAgo(800), daysAgo(5)]);
    const svc = new RetentionExecutorService(db, { policy: policy({ website_leads: { retention_class: 'customer_history', delete_policy: 'anonymize_after_days', days: 730, timestamp_column: 'archived_at', executor: 'central', anonymize: { columns: ['name', 'email', 'phone', 'notes'] } } }) });
    await q(`update website_leads set notes = '[{"t":"called"}]'::jsonb`);
    expect((await svc.run({ dryRun: false, trigger: 'job' })).results[0]).toMatchObject({ action: 'anonymize', processed: 1 });
    const rows = await q(`select name, email, phone, notes from website_leads order by archived_at nulls last`);
    expect(rows[0]).toEqual({ name: null, email: null, phone: null, notes: [] });              // nullable → NULL; NOT NULL jsonb → empty
    expect(rows.slice(1).map((r: any) => [r.email, r.notes])).toEqual([['new@example.test', [{ t: 'called' }]], ['o@example.test', [{ t: 'called' }]]]);
    expect((await svc.run({ dryRun: false, trigger: 'job' })).results[0]).toMatchObject({ eligible: 0, processed: 0 });
  });
  it('the daily job runs once per UTC day (a second tick the same day does nothing)', async () => {
    const svc = new RetentionExecutorService(db, { policy: policy(LOGIN) });
    const quiet = { log() {}, warn() {} };
    expect(await retentionTick(svc, 'on', new Date(), quiet)).not.toBeNull();
    expect(await retentionTick(svc, 'on', new Date(), quiet)).toBeNull();
    expect(await svc.lastJobRunDay()).toBe(new Date().toISOString().slice(0, 10));
    expect((await svc.recentRuns(5))[0]).toMatchObject({ table: 'login_attempts', trigger: 'job', processed: 4 });
  });
});

describe('the REAL policy file (apps/api/db/retention-policy.json)', () => {
  it('every entry the executor owns is valid and names a live table + column; a dry run of all of them runs clean', async () => {
    const svc = new RetentionExecutorService(db);
    const plan = await svc.plan();
    expect(plan.invalidEntries).toEqual([]);
    expect(plan.rules.length).toBeGreaterThanOrEqual(10);
    expect(plan.rules.every((r) => !['financial', 'audit'].includes(r.retentionClass))).toBe(true);
    const r = await svc.run({ dryRun: true, trigger: 'manual' });
    expect(r.results.filter((x) => x.skipped || x.error)).toEqual([]);
    expect(await runs()).toBe(0);
  });
  it('Batch C decision 3 (Nov 6 2026): inbox message TEXT is kept 24 months, then replaced — the row (direction, channel, status, time) stays', async () => {
    const real = new RetentionExecutorService(db);
    const plan = await real.plan();
    const msg = plan.rules.find((r) => r.table === 'communication_messages');
    expect(msg).toMatchObject({ action: 'anonymize', days: 730, anonymizeColumns: ['body'] });
    expect(plan.rules.find((r) => r.table === 'communication_threads')).toMatchObject({ action: 'anonymize', days: 730, anonymizeColumns: ['last_message_preview'] });
    await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'M','M','ret-msg','RETMSG','active') on conflict do nothing`, [A]);
    const th = (await q(`insert into communication_threads (tenant_id, channel, status, last_message_preview, last_message_at) values ($1,'sms','open','old text',$2) returning id`, [A, daysAgo(800)]))[0].id;
    await q(`insert into communication_messages (tenant_id, thread_id, direction, channel, body, status, created_at) values ($1,$2,'inbound','sms','my old private message','delivered',$3), ($1,$2,'outbound','sms','a recent reply','sent',$4)`, [A, th, daysAgo(800), daysAgo(20)]);
    const svc = new RetentionExecutorService(db, { policy: policy({ communication_messages: { retention_class: 'communication', delete_policy: 'anonymize_after_days', days: 730, timestamp_column: 'created_at', executor: 'central', anonymize: { columns: ['body'] } } }) });
    expect((await svc.run({ dryRun: false, trigger: 'job' })).results[0]).toMatchObject({ action: 'anonymize', processed: 1 });
    expect(await q(`select direction, status, body from communication_messages where thread_id = $1 order by created_at`, [th])).toEqual([
      { direction: 'inbound', status: 'delivered', body: '[removed]' }, { direction: 'outbound', status: 'sent', body: 'a recent reply' }]);
  });
  it('financial and audit tables are listed as never (the ownership registry reads these)', async () => {
    const file = new RetentionExecutorService(db).policy()!;
    for (const t of ['payments', 'payment_refunds', 'tickets', 'loyalty_ledger', 'audit_events', 'audit_logs']) expect(file.tables[t]?.delete_policy, t).toBe('never');
    expect(await sql`select 1 as ok`.execute(db).then((x: any) => x.rows[0].ok)).toBe(1);
  });
});
