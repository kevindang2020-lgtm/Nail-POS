// winback-center.postgres-race — Customer Retention & Win-Back guide §09 / §10 on REAL Postgres with REAL concurrency
// (four Kysely instances = four sessions):
//   • "Check Retention Data" tapped 8 times at once → ONE recorded run; the other 7 are told to wait (rate limit decided
//     under the per-salon advisory lock — without it every tap records a run)
//   • "Save audience" for the same idempotency key from 6 sessions at once → ONE win_back audience draft, nothing sent
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { RetentionRepository, RetentionError } from './retention.repository';
import { WinBackCenter } from './winback-center';

const url = process.env.PG_RACE_URL;
const TAG = `wbr${process.pid}${Date.now().toString(36)}`.slice(0, 16);
const T = randomUUID(), B = randomUUID(), C1 = randomUUID(), C2 = randomUUID(), U = randomUUID();

describe.skipIf(!url)('Win-Back Center on real Postgres: one health run per minute, one audience per key', () => {
  const mk = () => new Kysely<any>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 4 }) }) });
  const dbs = url ? [mk(), mk(), mk(), mk()] : [];
  const wbs = dbs.map((d) => new WinBackCenter(d, new RetentionRepository(d)));
  const ctx = { tenantId: T, branchId: B, userId: U, role: 'OWNER', permissions: ['pos.customers.view', 'pos.marketing.manage', 'pos.marketing.view'] };
  const q = async (s: any) => (await s.execute(dbs[0])).rows as any[];

  beforeAll(async () => {
    await q(sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, ${TAG}, ${TAG}, ${TAG}, ${TAG.slice(-10).toUpperCase()}, 'active')`);
    await q(sql`insert into branches (id, tenant_id, name, status, timezone) values (${B}, ${T}, 'Main', 'active', 'America/New_York')`);
    for (const [c, ph] of [[C1, '+1215555' + String(Math.floor(1000 + Math.random() * 8999))], [C2, '+1215556' + String(Math.floor(1000 + Math.random() * 8999))]]) {
      await q(sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, marketing_sms_opt_in) values (${c}, ${T}, ${B}, 'Race', 'X', 'Race X', ${ph}, true)`);
      await q(sql`insert into tickets (tenant_id, branch_id, customer_id, status, total_cents, created_at, paid_at) values (${T}, ${B}, ${c}, 'closed', 4000, now() - interval '90 days', now() - interval '90 days')`);
    }
  }, 60_000);
  afterAll(async () => { await Promise.all(dbs.map((d) => d.destroy())); });

  it('8 simultaneous "Check Retention Data" taps record ONE run; 7 are asked to wait', async () => {
    const out = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => wbs[i % 4].runHealth(ctx)));
    const ok = out.filter((o) => o.status === 'fulfilled');
    const codes = out.filter((o) => o.status === 'rejected').map((o: any) => (o.reason instanceof RetentionError ? o.reason.code : String(o.reason?.message ?? o.reason)));
    expect(ok.length).toBe(1);
    expect(codes).toEqual(Array(7).fill('WINBACK_HEALTH_RATE_LIMITED'));
    expect(Number((await q(sql`select count(*)::int as n from retention_health_runs where tenant_id = ${T}`))[0].n)).toBe(1);
  });

  it('6 simultaneous "Save audience" with one key → ONE win_back draft, nothing sent or queued', async () => {
    const audits: unknown[] = [];
    const out = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => wbs[i % 4].saveAudience(ctx, { goal: 'inactive_risk', channel: 'sms', idempotencyKey: `${TAG}-aud-1` }, async (_t, m) => { audits.push(m); })));
    expect(out.filter((o) => o.status === 'rejected').map((o: any) => String(o.reason?.message ?? o.reason))).toEqual([]);
    expect(Number((await q(sql`select count(*)::int as n from segment_audience_drafts where tenant_id = ${T}`))[0].n)).toBe(1);
    expect(audits.length).toBe(1);
    expect(Number((await q(sql`select count(*)::int as n from notifications where tenant_id = ${T}`))[0].n)).toBe(0);
    expect(Number((await q(sql`select count(*)::int as n from retention_sms_recipients where tenant_id = ${T}`))[0].n)).toBe(0);
  });
});
