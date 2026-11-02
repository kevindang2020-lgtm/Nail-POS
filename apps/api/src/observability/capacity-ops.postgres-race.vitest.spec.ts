// capacity-ops.postgres-race.vitest.spec.ts — BUILD_PLAN Phase 11 (Constitution 4 §35/§113 noisy neighbour, §96/§171
// cost, §160 quotas) on a real Postgres (PG_RACE_URL): the per-tenant minute flush from the request interceptor, the
// top-10 load view with slow queries, the >50 % alert raised once and resolved, cost from the ledgers with UNKNOWN when
// no price is set, price and quota edits audited.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { AuditService, KyselyAuditRepository } from '@aipowersalon/audit';
import { CapacityOpsService, NoisyNeighbourWatch, noisyNeighbour, priceLine } from './capacity-ops';
import { HttpMetricsInterceptor } from './http-metrics';
import { QuotaService } from '../common/tenant-quotas';

const url = process.env.PG_RACE_URL;
const A = 'a5530000-0000-4000-8000-00000000000a', B = 'a5530000-0000-4000-8000-00000000000b', C = 'a5530000-0000-4000-8000-00000000000c';
const U = '83838383-8383-4838-8838-838383838383';

describe('pure rules', () => {
  const row = (id: string, req: number, db: number, tot: { r: number; d: number }) => ({ tenantId: id, tenantName: null, requests: req, requestMs: 0, dbMs: db, dbQueries: 0, slowQueries: 0, requestShare: req / tot.r, dbShare: db / tot.d });
  it('noisy neighbour: > 50 % of DB time or requests, with ≥ 2 salons and enough traffic', () => {
    const tot = { r: 1000, d: 10_000 };
    const rows = [row(A, 300, 6_000, tot), row(B, 700, 4_000, tot)];
    expect(noisyNeighbour(rows, { requests: 1000, requestMs: 0, dbMs: 10_000, activeTenants: 2 })?.tenantId).toBe(B);   // 70 % of requests beats 60 % of DB
    expect(noisyNeighbour([row(A, 500, 5_000, tot), row(B, 500, 5_000, tot)], { requests: 1000, requestMs: 0, dbMs: 10_000, activeTenants: 2 })).toBeNull();   // exactly half is not more than half
    expect(noisyNeighbour(rows, { requests: 100, requestMs: 0, dbMs: 10_000, activeTenants: 2 })).toBeNull();       // too quiet to mean anything
    expect(noisyNeighbour([row(A, 1000, 10_000, tot)], { requests: 1000, requestMs: 0, dbMs: 10_000, activeTenants: 1 })).toBeNull();   // one salon is 100 % by definition
  });
  it('priceLine: ledger cost where recorded, price × the rest, and UNKNOWN (never a made-up number) without a price', () => {
    const q = { tenantId: A, day: '2026-10-08', provider: 'sms:twilio', unit: 'message', quantity: 10, knownCostMicros: 15_800, pricedQuantity: 2 };
    expect(priceLine(q, {})).toMatchObject({ estimatedMicros: 15_800, unknownQuantity: 8 });
    expect(priceLine(q, { 'cost.unit_price.sms.message': 0.0079 })).toMatchObject({ estimatedMicros: 15_800 + 63_200, unknownQuantity: 0 });
    expect(priceLine({ ...q, provider: 'ai:openai', unit: 'token', quantity: 2_000_000, knownCostMicros: 0, pricedQuantity: 0 }, { 'cost.unit_price.ai.million_tokens': 3 })).toMatchObject({ estimatedMicros: 6_000_000 });
    expect(priceLine({ ...q, provider: 'storage:uploads', unit: 'byte_day', quantity: 30e9, knownCostMicros: 0, pricedQuantity: 0 }, { 'cost.unit_price.storage.gb_month': 0.02 })).toMatchObject({ estimatedMicros: 20_000 });
  });
});

describe.skipIf(!url)('capacity operations on real Postgres', () => {
  const db = url ? new Kysely<any>({ dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: url, max: 6 }) }) }) : (null as any);
  const audit = url ? new AuditService(new KyselyAuditRepository(db)) : (null as any);
  const now = new Date();
  const clean = async () => {
    await sql`delete from alerts where related_module = 'tenant_load'`.execute(db);
    await sql`delete from platform_settings where setting_key like 'cost.unit_price.%'`.execute(db);
    await sql`delete from platform_setting_changes where setting_key like 'cost.unit_price.%'`.execute(db);
    await sql`delete from db_slow_query_samples where tenant_id in (${A}, ${B}, ${C})`.execute(db);
    await sql`delete from ai_usage_logs where tenant_id in (${A}, ${B}, ${C})`.execute(db);
    await sql`delete from jobs where tenant_id in (${A}, ${B}, ${C})`.execute(db);
    await sql`delete from tenants where id in (${A}, ${B}, ${C})`.execute(db);
  };
  beforeAll(async () => {
    await clean();
    for (const [t, slug] of [[A, 'cap-a'], [B, 'cap-b'], [C, 'cap-c']]) await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, lifecycle_state) values (${t}, ${slug}, ${slug}, ${slug}, ${slug.toUpperCase()}, 'active')`.execute(db);
  });
  afterAll(async () => { if (!db) return; await clean(); await db.destroy(); });

  it('the request interceptor flushes per-tenant minutes additively; a vanished tenant never fails the batch', async () => {
    const m = new HttpMetricsInterceptor(db);
    const t = now.getTime() - 60_000;
    for (let i = 0; i < 400; i++) m.tenants.record(A, 10, 40, 3, t);
    for (let i = 0; i < 100; i++) m.tenants.record(B, 10, 5, 1, t);
    m.tenants.record('a5530000-0000-4000-8000-0000000000ff', 1, 1, 1, t);   // no such tenant
    await m.flushTenants();
    for (let i = 0; i < 100; i++) m.tenants.record(A, 10, 40, 3, t);        // a second process / flush, same minute
    await m.flushTenants();
    const r = (await sql<any>`select tenant_id, request_count, db_ms, db_queries from tenant_load_minute where tenant_id in (${A}, ${B}) order by tenant_id`.execute(db)).rows;
    expect(r.map((x: any) => [x.tenant_id, x.request_count, Number(x.db_ms), x.db_queries])).toEqual([[A, 500, 20_000, 1500], [B, 100, 500, 100]]);
  });

  it('load: top tenants by DB time with their slow queries; one salon over half raises ONE alert, resolved when it stops', async () => {
    await sql`insert into db_slow_query_samples (sampled_at, query_hash, fingerprint, operation, table_name, duration_ms, tenant_id) values (${now}, 'abcdef', 'select $?', 'select', 'tickets', 900, ${A})`.execute(db);
    const ops = new CapacityOpsService(db, new QuotaService(db), audit);
    const r = await ops.load(15, now);
    expect(r.top[0]).toMatchObject({ tenantId: A, requests: 500, dbMs: 20_000, slowQueries: 1, tenantName: 'cap-a' });
    expect(r.top[0].dbShare).toBeCloseTo(20_000 / 20_500, 5);
    expect(r.dominant?.tenantId).toBe(A);
    const watch = new NoisyNeighbourWatch(ops, db);
    expect(await watch.check(now)).toMatchObject({ dominant: A, raised: true });
    expect(await watch.check(new Date(now.getTime() + 1000))).toMatchObject({ dominant: A, raised: false });   // still one open alert
    const open = (await sql<any>`select title, severity, status from alerts where related_module = 'tenant_load' and status = 'unread'`.execute(db)).rows;
    expect(open).toHaveLength(1);
    expect(open[0].title).toMatch(/One salon is \d+% of platform load/);
    // B catches up → nobody is over half → resolved
    await sql`insert into tenant_load_minute (bucket_minute, tenant_id, request_count, sum_ms, db_ms, db_queries) values (${new Date(Math.floor(now.getTime() / 60_000) * 60_000)}, ${B}, 400, 0, 19500, 0)`.execute(db);   // now exactly half each
    expect(await watch.check(now)).toMatchObject({ dominant: null, resolved: 1 });
  });

  it('cost: quantities from the ledgers; unpriced = UNKNOWN; a price set (step-up route, reason, audited) turns it into an estimate', async () => {
    await sql`insert into ai_usage_logs (tenant_id, package_code, model_provider, total_tokens, cost_micro_usd) values (${A}, 'ai_basic', 'openai', 1000, 2500), (${A}, 'ai_basic', 'openai', 4000, 0)`.execute(db);
    await sql`insert into jobs (job_class, job_type, tenant_id, payload) values ('standard', 'cap.test', ${B}, '{}'::jsonb), ('standard', 'cap.test', ${B}, '{}'::jsonb)`.execute(db);
    const ops = new CapacityOpsService(db, new QuotaService(db), audit);
    let c = await ops.cost(1, now);
    const ai = c.perProvider.find((p: any) => p.provider === 'ai:openai');
    expect(ai).toMatchObject({ quantity: 5000, knownCostMicros: 2500, estimatedMicros: 2500, unknownQuantity: 4000, status: 'PARTIAL' });
    expect(c.perProvider.find((p: any) => p.provider === 'compute:jobs')).toMatchObject({ quantity: 2, estimatedMicros: 0, status: 'UNKNOWN' });
    expect(c.prices.every((p: any) => p.unknown)).toBe(true);
    await expect(ops.setPrices({ prices: [{ key: 'cost.unit_price.compute.thousand_jobs', usd: 5 }], reason: 'short' }, { userId: U })).rejects.toMatchObject({ status: 400 });
    await expect(ops.setPrices({ prices: [{ key: 'cost.unit_price.made_up', usd: 5 }], reason: 'compute price from invoice' }, { userId: U })).rejects.toMatchObject({ status: 400 });
    await ops.setPrices({ prices: [{ key: 'cost.unit_price.compute.thousand_jobs', usd: 5 }, { key: 'cost.unit_price.ai.million_tokens', usd: 2 }], reason: 'from the October provider invoices' }, { userId: U });
    c = await ops.cost(1, now);
    expect(c.perProvider.find((p: any) => p.provider === 'compute:jobs')).toMatchObject({ estimatedMicros: 10_000, status: 'ESTIMATED' });   // 2 jobs × $5 / 1000
    expect(c.perProvider.find((p: any) => p.provider === 'ai:openai')).toMatchObject({ estimatedMicros: 2500 + 8000, unknownQuantity: 0 });   // 4000 tokens × $2 / 1M
    expect(c.perTenant.find((t: any) => t.tenantId === B)).toMatchObject({ tenantName: 'cap-b', estimatedMicros: 10_000 });
    expect((await sql<any>`select count(*)::int n from audit_logs where action_type = 'system_operations.cost_unit_prices_changed'`.execute(db)).rows[0].n).toBeGreaterThanOrEqual(1);
    expect((await sql<any>`select count(*)::int n from platform_setting_changes where setting_key like 'cost.unit_price.%'`.execute(db)).rows[0].n).toBe(2);
  });

  it('quotas: a tenant override is validated, audited, and what limitFor answers next', async () => {
    const q = new QuotaService(db);
    const ops = new CapacityOpsService(db, q, audit);
    const audits = async () => (await sql<any>`select count(*)::int n from audit_logs where action_type = 'system_operations.tenant_quota_changed' and entity_id = ${C}`.execute(db)).rows[0].n;
    const before = await audits();   // audit_logs is append-only: count the change, not the table
    await expect(ops.setQuota('tenant', C, { jobs_in_flight: 99, reason: 'runaway import job loop' }, { userId: U })).rejects.toMatchObject({ status: 400 });
    const v = await ops.setQuota('tenant', C, { jobs_in_flight: 1, storage_bytes: 5_000_000, reason: 'runaway import job loop' }, { userId: U }) as any;
    expect(v.limits.find((l: any) => l.kind === 'jobs_in_flight')).toEqual({ kind: 'jobs_in_flight', limit: 1, source: 'tenant' });
    expect(v.limits.find((l: any) => l.kind === 'storage_bytes')).toEqual({ kind: 'storage_bytes', limit: 5_000_000, source: 'tenant' });
    expect(await audits()).toBe(before + 1);
  });
});
