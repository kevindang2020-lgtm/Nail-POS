// perf.mjs — Customers one-screen scale check (Oct 29 2026): one TEST salon with 100,000 customers, ~600,000 settled
// tickets, 40,000 loyalty members (one ledger entry each), 2,000 redemptions, 10,000 memberships with payments and
// activity — built with generate_series on a copy of the migrated schema, ANALYZEd — then each read the three screens
// make, timed (median of 3, server-side, the real repositories). Tooling only.
//   FST_PG_TEMPLATE=aps node --no-warnings --experimental-strip-types --import ./tooling/full-system-test/unit-standin/register.mjs tooling/customers-one-screen/perf.mjs
import { PGlite } from '@electric-sql/pglite';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { kyselyFor } from '../../packages/testing/src/pgtest-schema.mjs';
import { LoyaltyProgramRepository } from '../../modules/customers/src/loyalty/loyalty-program.repository.ts';
import { RetentionRepository } from '../../modules/customers/src/retention/retention.repository.ts';
import { MembershipListsRepository } from '../../modules/memberships/src/membership-lists.ts';
import { KyselyMembershipsRepository } from '../../modules/memberships/src/memberships.kysely.repository.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const N = Number(process.env.CUSTOMERS || 100000);
const T = 'c0610000-0000-4000-8000-000000000001', B = 'b0610000-0000-4000-8000-000000000001';
const pg = await PGlite.create({ loadDataDir: true }); const db = kyselyFor(pg);
const q = (s, p = []) => pg.query(s, p);
const t0 = Date.now();
await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Big LLC','Big Salon','big-perf','BIG001','active')`, [T]);
await q(`insert into branches (id, tenant_id, name, status, timezone) values ($1,$2,'Main','active','America/New_York')`, [B, T]);
await q(`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name, normalized_phone, marketing_sms_opt_in, created_at)
  select ('e0610000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid, $1, $2, 'First' || g, 'Last' || (g % 997), 'First' || g || ' Last' || (g % 997),
         case when g % 17 = 0 then null else '+1215' || lpad((g % 10000000)::text, 7, '0') end, g % 3 <> 0, now() - make_interval(days => g % 900)
  from generate_series(1, ${N}) g`, [T, B]);
await q(`insert into tickets (tenant_id, branch_id, customer_id, status, total_cents, created_at)
  select $1, $2, ('e0610000-0000-4000-8000-' || lpad(to_hex(c), 12, '0'))::uuid, 'closed', 3000 + (c * v) % 7000, now() - make_interval(days => ((c * 7 + v * 31) % 600))
  from generate_series(1, ${N}) c, generate_series(1, 7) v where c % 8 <> 0 and v <= 1 + c % 7`, [T, B]);
await q(`insert into customer_loyalty_profiles (tenant_id, branch_id, customer_id, loyalty_tier, points_balance, total_earned_points, created_at)
  select $1, $2, ('e0610000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid, (array['Regular','Silver','Gold','Platinum'])[1 + g % 4], (g % 50) * 10, (g % 50) * 10, now() - make_interval(mins => g)
  from generate_series(1, ${Math.round(N * 0.4)}) g`, [T, B]);
await q(`insert into loyalty_ledger (tenant_id, branch_id, customer_id, entry_type, delta, balance_after, reason, source_table, source_id)
  select p.tenant_id, p.branch_id, p.customer_id, 'earn', p.points_balance, p.points_balance, 'Visit', 'perf_seed', gen_random_uuid() from customer_loyalty_profiles p where p.tenant_id = $1 and p.points_balance > 0`, [T]);
await q(`insert into loyalty_rewards (tenant_id, title, points_cost, active, reward_type, value_cents, created_at) select $1, 'Reward ' || g, 100 * g, g % 4 <> 0, 'amount_off', 500 * g, now() - make_interval(days => g) from generate_series(1, 40) g`, [T]);
await q(`insert into loyalty_redemptions (tenant_id, customer_id, reward_id, reward_title, points_spent, code, status, created_at)
  select $1, ('e0610000-0000-4000-8000-' || lpad(to_hex(g * 7), 12, '0'))::uuid, (select id from loyalty_rewards where tenant_id = $1 order by created_at limit 1), 'Reward', 100, 'PERF' || g, (array['issued','used','void'])[1 + g % 3], now() - make_interval(hours => g)
  from generate_series(1, 2000) g`, [T]);
await q(`insert into membership_plans (id, tenant_id, name, status) values ('a0640000-0000-4000-8000-000000000001', $1, 'Club', 'active')`, [T]);
await q(`insert into membership_plan_versions (id, plan_id, tenant_id, version_number, billing_interval, price_cents) values ('a0650000-0000-4000-8000-000000000001', 'a0640000-0000-4000-8000-000000000001', $1, 1, 'month', 3900)`, [T]);
await q(`update membership_plans set current_version_id = 'a0650000-0000-4000-8000-000000000001' where id = 'a0640000-0000-4000-8000-000000000001'`);
await q(`insert into customer_memberships (id, tenant_id, branch_id, customer_id, plan_id, plan_version_id, status, started_at, next_billing_at)
  select ('a0660000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid, $1, $2, ('e0610000-0000-4000-8000-' || lpad(to_hex(g * 9), 12, '0'))::uuid, 'a0640000-0000-4000-8000-000000000001', 'a0650000-0000-4000-8000-000000000001',
         (array['active','active','active','paused','canceled','trial'])[1 + g % 6], now() - make_interval(days => g % 400), now() + make_interval(days => g % 30)
  from generate_series(1, ${Math.round(N / 10)}) g`, [T, B]);
await q(`insert into membership_payments (tenant_id, branch_id, customer_membership_id, customer_id, kind, amount_cents, status, idempotency_key, created_at, settled_at)
  select m.tenant_id, m.branch_id, m.id, m.customer_id, 'renewal', 3900, 'succeeded', m.id::text, now() - make_interval(days => (hashtext(m.id::text) & 63)), now() - make_interval(days => (hashtext(m.id::text) & 63)) from customer_memberships m where m.tenant_id = $1`, [T]);
await q(`insert into membership_activity (tenant_id, customer_membership_id, customer_id, activity_type, customer_name_snapshot, plan_name_snapshot, occurred_at)
  select m.tenant_id, m.id, m.customer_id, 'renewed', 'Member', 'Club', m.started_at from customer_memberships m where m.tenant_id = $1`, [T]);
await q('analyze');
const counts = (await q(`select (select count(*) from customers where tenant_id = $1)::int customers, (select count(*) from tickets where tenant_id = $1)::int tickets, (select count(*) from customer_loyalty_profiles where tenant_id = $1)::int members, (select count(*) from customer_memberships where tenant_id = $1)::int memberships`, [T])).rows[0];
console.log('seeded', counts, 'in', Date.now() - t0, 'ms');

const ctx = { tenantId: T, branchId: B, userId: 'a0610000-0000-4000-8000-000000000001', role: 'OWNER', permissions: [] };
const L = new LoyaltyProgramRepository(db), R = new RetentionRepository(db), M = new MembershipListsRepository(db), O = new KyselyMembershipsRepository(db);
const cases = [
  ['loyalty overview (5 KPIs + tiers)', () => L.overview(ctx)],
  ['loyalty members page 1', () => L.members(ctx, { page: 1, pageSize: 10 })],
  ['loyalty members last page', () => L.members(ctx, { page: 99999, pageSize: 10 })],
  ['loyalty members search', () => L.members(ctx, { page: 1, pageSize: 10, q: 'First1234' })],
  ['loyalty rewards page 1', () => L.rewards(ctx, { page: 1, pageSize: 10 })],
  ['loyalty redemptions page 1', () => L.redemptions(ctx, { page: 1, pageSize: 10 })],
  ['loyalty ledger page 1', () => L.ledger(ctx, { page: 1, pageSize: 10 })],
  ['retention summary (KPIs + segment counts)', () => R.summary(ctx)],
  ['retention at risk page 1 (oldest first)', () => R.customers(ctx, { segment: 'at_risk', page: 1, pageSize: 12 })],
  ['retention at risk page 500', () => R.customers(ctx, { segment: 'at_risk', page: 500, pageSize: 12 })],
  ['retention never visited page 1', () => R.customers(ctx, { segment: 'never', page: 1, pageSize: 12 })],
  ['retention SMS-eligible page 1', () => R.customers(ctx, { segment: 'contactable', page: 1, pageSize: 12 })],
  ['retention search', () => R.customers(ctx, { segment: 'all', page: 1, pageSize: 12, q: '1215000123' })],
  ['memberships overview', () => O.overview(ctx, {})],
  ['memberships members page 1', () => M.members(ctx, { filter: 'active', page: 1, pageSize: 10 })],
  ['memberships activity page 1', () => M.activity(ctx, { page: 1, pageSize: 10 })],
  ['memberships plan performance', () => M.planPerformance(ctx)],
];
const out = [];
for (const [name, fn] of cases) {
  const ms = []; let total = null;
  for (let i = 0; i < 3; i++) { const a = performance.now(); const r = await fn(); ms.push(performance.now() - a); total = r?.totalItems ?? r?.kpis?.loyaltyMembers ?? r?.kpis?.atRisk ?? r?.kpis?.totalMembers ?? null; }
  ms.sort((x, y) => x - y); out.push({ name, medianMs: Math.round(ms[1]), maxMs: Math.round(ms[2]), total });
  console.log(`${String(Math.round(ms[1])).padStart(6)} ms  ${name}${total != null ? `  (${total})` : ''}`);
}
mkdirSync(join(HERE, 'results', 'perf'), { recursive: true });
writeFileSync(join(HERE, 'results', 'perf', 'perf.json'), JSON.stringify({ at: new Date().toISOString(), counts, results: out }, null, 1));
await pg.close();
