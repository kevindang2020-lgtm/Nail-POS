// followup-queue.postgres-race — Follow-Up Queue guide §07 / §12 / §17 on REAL Postgres with real concurrency (four
// sessions). The queue's actions are the existing ones; what this proves is that two staff acting on the same task at the
// same moment always leave ONE outcome:
//   • Send racing Skip → the task ends sent (one Customer App message) OR skipped (no message) — never both, never two;
//   • Approve racing Reject on an awaiting-approval task → one decision;
//   • FORCED interleaving: a Skip that read "pending" lands after a Send committed → refused; the task stays sent.
// (duplicate sends, cooldown, expiry-vs-send and generation races are covered by eod-followups.postgres-race.)
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { KyselyDailyFollowUpRepository } from './end-of-day-followups.kysely.repository';
import { DailyFollowUpService } from './end-of-day-followups.service';
import type { FollowUpContext } from './end-of-day-followups.dto';

const url = process.env.PG_RACE_URL;
const TAG = `fuq${process.pid}${Date.now().toString(36)}`.slice(0, 16);
const T = randomUUID(), B = randomUUID(), OWNER = randomUUID(), MGR2 = randomUUID(), T1 = randomUUID();

describe.skipIf(!url)('Follow-Up Queue on real Postgres: two staff, one task, one outcome', () => {
  const mk = () => new Kysely<any>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 4 }) }) });
  const dbs = url ? [mk(), mk(), mk(), mk()] : [];
  const svcs = dbs.map((d) => new DailyFollowUpService(new KyselyDailyFollowUpRepository(d, null)));
  const q = async (s: any) => (await s.execute(dbs[0])).rows as any[];
  const mgr = (u: string): FollowUpContext => ({ tenantId: T, branchId: B, userId: u, role: 'OWNER', permissions: ['customers.edit'] });
  let n = 0;
  async function task(status: 'pending' | 'pending_manager_approval') {
    const c = randomUUID(), u = randomUUID(); n++;
    await q(sql`insert into users (id, tenant_id, full_name, email, status, role) values (${u}, ${T}, ${'C' + n}, ${`${TAG}-c${n}@race.test`}, 'active', 'CUSTOMER')`);
    await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, status, user_id) values (${c}, ${T}, ${B}, 'C', ${String(n)}, ${'C ' + n}, 'active', ${u})`);
    return String((await q(sql`insert into service_follow_up_tasks (tenant_id, branch_id, business_date, customer_id, technician_id, ticket_id, ticket_service_line_id, technician_name_snapshot,
        customer_app_user_id, status, suggested_message, submitted_at)
      values (${T}, ${B}, current_date, ${c}, ${T1}, ${randomUUID()}, ${randomUUID()}, 'Ana One', ${u}, ${status}, 'Thanks!', ${status === 'pending' ? null : new Date().toISOString()}::timestamptz) returning id`))[0].id);
  }
  const final = async (t: string) => (await q(sql`select status, (select count(*)::int from customer_notifications where reference = ${t}) as msgs from service_follow_up_tasks where id = ${t}::uuid`))[0];

  beforeAll(async () => {
    await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, ${TAG}, ${TAG}, ${TAG}, ${TAG.toUpperCase().slice(-10)}, 'active')`);
    await q(sql`insert into branches (id, tenant_id, name, timezone, status) values (${B}, ${T}, 'Main', 'America/New_York', 'active')`);
    for (const u of [OWNER, MGR2]) await q(sql`insert into users (id, tenant_id, full_name, email, status, role) values (${u}, ${T}, 'M', ${`${TAG}-${u.slice(0, 6)}@race.test`}, 'active', 'OWNER')`);
    await q(sql`insert into technicians (id, tenant_id, branch_id, first_name, last_name, full_name, is_active) values (${T1}, ${T}, ${B}, 'Ana', 'One', 'Ana One', true)`);
  }, 120_000);
  afterAll(async () => { await Promise.all(dbs.map((d) => d.destroy())); });

  it('Send racing Skip (two each, four sessions) — five rounds: always one outcome, a message only when sent, exactly one', async () => {
    for (let round = 0; round < 5; round++) {
      const t = await task('pending');
      await Promise.allSettled([
        svcs[0].managerSend(mgr(OWNER), t), svcs[1].managerSkip(mgr(MGR2), t, 'customer_declined'),
        svcs[2].managerSend(mgr(MGR2), t), svcs[3].managerSkip(mgr(OWNER), t, 'customer_declined'),
      ]);
      const f = await final(t);
      expect(['sent', 'skipped']).toContain(f.status);
      expect(f.msgs).toBe(f.status === 'sent' ? 1 : 0);
    }
  });

  it('Approve racing Reject (four sessions) — one decision, and a message only if approved', async () => {
    for (let round = 0; round < 5; round++) {
      const t = await task('pending_manager_approval');
      await Promise.allSettled([
        svcs[0].managerApprove(mgr(OWNER), t), svcs[1].managerReject(mgr(MGR2), t, 'please add the aftercare tip'),
        svcs[2].managerApprove(mgr(MGR2), t), svcs[3].managerReject(mgr(OWNER), t, 'please add the aftercare tip'),
      ]);
      const f = await final(t);
      expect(['sent', 'rejected']).toContain(f.status);
      expect(f.msgs).toBe(f.status === 'sent' ? 1 : 0);
    }
  });

  it('forced interleaving: a Skip that read "pending" reaches the row only after a Send committed → refused, task stays sent', async () => {
    const t = await task('pending');
    let skip: Promise<unknown> | null = null;
    await dbs[0].transaction().execute(async (trx: any) => {
      await sql`select id from service_follow_up_tasks where id = ${t}::uuid for update`.execute(trx);
      skip = svcs[1].managerSkip(mgr(MGR2), t, 'customer_declined');      // reads "pending" (no lock), then waits on the row
      await new Promise((r) => setTimeout(r, 400));
      await sql`update service_follow_up_tasks set status = 'sent', sent_at = now() where id = ${t}::uuid`.execute(trx);
      await sql`insert into customer_notifications (tenant_id, customer_id, type, title, body, reference)
        select tenant_id, customer_id, 'service_follow_up', 'Follow-up', 'Thanks!', ${t} from service_follow_up_tasks where id = ${t}::uuid`.execute(trx);
    });
    const r = await Promise.allSettled([skip!]);
    expect(r[0].status).toBe('rejected');
    expect(String((r[0] as PromiseRejectedResult).reason?.message)).toMatch(/cannot move from sent to skipped/);
    expect(await final(t)).toEqual({ status: 'sent', msgs: 1 });
  });
});
