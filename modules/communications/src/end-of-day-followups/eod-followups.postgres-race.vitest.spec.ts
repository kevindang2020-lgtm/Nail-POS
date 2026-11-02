// eod-followups.postgres-race — End-of-Day Follow-Ups guide §8, §10, §16 on REAL Postgres with REAL concurrency (four
// sessions). PGlite is one session, so only this lane proves:
//   • one task, 8 simultaneous sends (double taps / retries over four sessions) → ONE Customer App message
//   • two technicians' tasks for the SAME client sent at once → one is sent, the other refused "recently contacted"
//   • the 24-hour expiry racing a send → exactly one outcome (sent XOR expired) and no message after expiry
//   • four generation runs at once (two workers + a manager's Generate Now) → each line becomes ONE task, one alert per technician
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { KyselyDailyFollowUpRepository } from './end-of-day-followups.kysely.repository';
import { DailyFollowUpService } from './end-of-day-followups.service';
import type { FollowUpContext } from './end-of-day-followups.dto';

const url = process.env.PG_RACE_URL;
const TAG = `eod${process.pid}${Date.now().toString(36)}`.slice(0, 16);
const T = randomUUID(), B = randomUUID(), OWNER = randomUUID(), U1 = randomUUID(), U2 = randomUUID(), T1 = randomUUID(), T2 = randomUUID(), CAT = randomUUID(), SVC = randomUUID();
const TZ = 'America/New_York';

describe.skipIf(!url)('End-of-Day Follow-Ups on real Postgres: sends, cooldown, expiry and generation under concurrency', () => {
  const mk = () => new Kysely<any>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 4 }) }) });
  const dbs = url ? [mk(), mk(), mk(), mk()] : [];
  const svcs = dbs.map((d) => new DailyFollowUpService(new KyselyDailyFollowUpRepository(d, null)));
  const q = async (s: any) => (await s.execute(dbs[0])).rows as any[];
  const mgr: FollowUpContext = { tenantId: T, branchId: B, userId: OWNER, role: 'OWNER', permissions: ['customers.edit'] };
  const tech = (u: string): FollowUpContext => ({ tenantId: T, branchId: B, userId: u, role: 'TECHNICIAN', permissions: [] });
  let n = 0;
  async function customer(app = true) {
    const c = randomUUID(), u = app ? randomUUID() : null; n++;
    if (u) await q(sql`insert into users (id, tenant_id, full_name, email, status, role) values (${u}, ${T}, ${'C' + n}, ${`${TAG}-c${n}@race.test`}, 'active', 'CUSTOMER')`);
    await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, status, user_id) values (${c}, ${T}, ${B}, 'C', ${String(n)}, ${'C ' + n}, 'active', ${u})`);
    return { c, u };
  }
  async function task(cust: { c: string; u: string | null }, techId: string, createdAt?: string) {
    return String((await q(sql`insert into service_follow_up_tasks (tenant_id, branch_id, business_date, customer_id, technician_id, ticket_id, ticket_service_line_id, technician_name_snapshot,
        customer_app_user_id, status, suggested_message, created_at)
      values (${T}, ${B}, '2026-10-31', ${cust.c}, ${techId}, ${randomUUID()}, ${randomUUID()}, 'Tech', ${cust.u}, 'pending', 'Thanks!', ${createdAt ?? new Date().toISOString()}::timestamptz) returning id`))[0].id);
  }
  const settle = (ps: Promise<unknown>[]) => Promise.allSettled(ps);
  const codeOf = (r: PromiseSettledResult<any>) => (r.status === 'fulfilled' ? `ok:${r.value?.status}` : (r.reason?.apiCode ?? String(r.reason?.message ?? r.reason)));

  beforeAll(async () => {
    await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, ${TAG}, ${TAG}, ${TAG}, ${TAG.toUpperCase().slice(-10)}, 'active')`);
    await q(sql`insert into branches (id, tenant_id, name, timezone, status) values (${B}, ${T}, 'Main', ${TZ}, 'active')`);
    for (const [u, r] of [[OWNER, 'OWNER'], [U1, 'TECHNICIAN'], [U2, 'TECHNICIAN']]) await q(sql`insert into users (id, tenant_id, full_name, email, status, role) values (${u}, ${T}, 'U', ${`${TAG}-${u.slice(0, 6)}@race.test`}, 'active', ${r})`);
    await q(sql`insert into technicians (id, tenant_id, branch_id, user_id, first_name, last_name, full_name, is_active) values (${T1}, ${T}, ${B}, ${U1}, 'Ana', 'One', 'Ana One', true), (${T2}, ${T}, ${B}, ${U2}, 'Bo', 'Two', 'Bo Two', true)`);
    await q(sql`insert into service_categories (id, tenant_id, branch_id, name) values (${CAT}, ${T}, ${B}, 'Nails')`);
    await q(sql`insert into services (id, tenant_id, branch_id, category_id, name, duration_minutes, price_cents) values (${SVC}, ${T}, ${B}, ${CAT}, 'Gel', 60, 5000)`);
  }, 120_000);
  afterAll(async () => { await Promise.all(dbs.map((d) => d.destroy())); });

  it('one task, 8 simultaneous sends over four sessions → one message, every caller sees "sent", nothing fails', async () => {
    const t = await task(await customer(), T1);
    const out = await settle(Array.from({ length: 8 }, (_, i) => svcs[i % 4].techSend(tech(U1), t)));
    expect(out.map(codeOf)).toEqual(Array(8).fill('ok:sent'));
    expect(Number((await q(sql`select count(*)::int as n from customer_notifications where reference = ${t}`))[0].n)).toBe(1);
  });

  it('two technicians send to the SAME client at the same moment → exactly one message (the other: recently contacted)', async () => {
    // Deterministic gate: a fifth session holds an EXCLUSIVE lock on customer_notifications, so both sends get past
    // their checks and pile up at the insert before either commits. Only the per-customer lock in the send makes the
    // second one wait and then see the first one's send (without it both insert — the mutation check proves that).
    const cust = await customer();
    const [a, b] = [await task(cust, T1), await task(cust, T2)];
    const gate = mk(); let sends!: Promise<PromiseSettledResult<any>[]>;
    await gate.transaction().execute(async (trx: any) => {
      await sql`lock table customer_notifications in exclusive mode`.execute(trx);
      sends = settle([svcs[0].techSend(tech(U1), a), svcs[1].techSend(tech(U2), b)]);
      await new Promise((r) => setTimeout(r, 1500));
    });
    const codes = (await sends).map(codeOf).sort();
    await gate.destroy();
    expect(codes).toEqual(['FOLLOWUP_RECENTLY_CONTACTED', 'ok:sent']);
    expect(Number((await q(sql`select count(*)::int as n from customer_notifications where customer_id = ${cust.c}`))[0].n)).toBe(1);
  });

  it('the expiry sweep racing a send → exactly one outcome, and never a message for an expired task', async () => {
    const results: string[] = [];
    for (let k = 0; k < 6; k++) {
      const t = await task(await customer(), T1, new Date(Date.now() - 30 * 3600_000).toISOString());   // 30 h old: due to expire
      const out = await settle([svcs[k % 4].managerSend(mgr, t), svcs[(k + 1) % 4].expireStaleTasks(new Date()), svcs[(k + 2) % 4].managerSend(mgr, t)]);
      const row = (await q(sql`select status, (select count(*)::int from customer_notifications where reference = ${t}) as msgs from service_follow_up_tasks where id = ${t}`))[0];
      expect(['sent', 'expired']).toContain(row.status);
      expect(Number(row.msgs)).toBe(row.status === 'sent' ? 1 : 0);
      if (row.status === 'expired') expect(out.filter((o) => o.status === 'fulfilled' && (o as any).value?.status === 'sent').length).toBe(0);
      results.push(row.status);
    }
    expect(results.length).toBe(6);
  });

  it('four generation runs at once → each completed line becomes one task; one run row; one alert per technician', async () => {
    const custs = [await customer(), await customer(), await customer()];
    let i = 0;
    for (const cu of custs) for (const te of [T1, T2]) {
      i++;
      const tk = (await q(sql`insert into tickets (tenant_id, branch_id, customer_id, status, paid_at, total_cents) values (${T}, ${B}, ${cu.c}, 'paid', '2026-10-31T18:00:00Z', 5000) returning id`))[0].id;
      await q(sql`insert into ticket_service_lines (tenant_id, branch_id, ticket_id, service_id, service_name_snapshot, price_cents_snapshot, duration_minutes_snapshot, line_total_cents, technician_id, status, completed_at)
        values (${T}, ${B}, ${tk}, ${SVC}, 'Gel', 5000, 60, 5000, ${te}, 'completed', ${`2026-10-31T18:${String(10 + i).padStart(2, '0')}:00Z`})`);
    }
    await q(sql`delete from daily_follow_up_settings where tenant_id = ${T}`);
    await q(sql`insert into daily_follow_up_settings (tenant_id, branch_id, contact_cooldown_hours) values (${T}, ${B}, 0)`);   // cooldown off: every line is eligible
    const before = Number((await q(sql`select count(*)::int as n from service_follow_up_tasks where tenant_id = ${T} and business_date = '2026-10-31' and customer_id = any(${custs.map((c) => c.c)}::uuid[])`))[0].n);
    const now = new Date('2026-11-01T00:30:00Z');
    const out = await settle([0, 1, 2, 3].map((k) => svcs[k].generateForBranch(T, B, { now, triggerSource: k === 3 ? 'manual' : 'scheduler', force: k === 3 })));
    expect(out.filter((o) => o.status === 'rejected').map((o: any) => String(o.reason?.message ?? o.reason))).toEqual([]);
    const created = out.reduce((a, o: any) => a + (o.value?.created ?? 0), 0);
    const after = Number((await q(sql`select count(*)::int as n from service_follow_up_tasks where tenant_id = ${T} and business_date = '2026-10-31' and customer_id = any(${custs.map((c) => c.c)}::uuid[])`))[0].n);
    expect([before, after, created]).toEqual([0, 6, 6]);
    expect(Number((await q(sql`select count(*)::int as n from daily_follow_up_generation_runs where tenant_id = ${T} and business_date = '2026-10-31'`))[0].n)).toBe(1);
    expect(Number((await q(sql`select count(*)::int as n from technician_notifications where tenant_id = ${T} and type = 'daily_followup_ready' and reference = '2026-10-31'`))[0].n)).toBe(2);
  });
});
