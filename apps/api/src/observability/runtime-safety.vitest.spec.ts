// runtime-safety.vitest.spec.ts — BUILD_PLAN Phase 11: System Operations' runtime-safety read (schema version,
// break-glass, limiter, Redis, stranded payments). Real-DB half with PG_RACE_URL.
import { describe, it, expect, afterEach, afterAll } from 'vitest';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import { RuntimeSafetyService, RuntimeSafetyController } from './runtime-safety';
import { _resetSchemaVersionCache } from './schema-version';

afterEach(() => { delete process.env.MAINTENANCE_BREAK_GLASS; delete process.env.TENANT_RATE_LIMIT; delete process.env.API_REPLICAS; _resetSchemaVersionCache(); });

describe('RuntimeSafetyService without a database', () => {
  it('shows the env switches as this instance reads them, and the schema as unknown', async () => {
    process.env.MAINTENANCE_BREAK_GLASS = 'read_only'; process.env.API_REPLICAS = '2';
    const r = await new RuntimeSafetyService(undefined).read();
    expect(r.breakGlass.mode).toBe('read_only');
    expect(r.rateLimiter).toMatchObject({ enabled: true, store: 'memory', keyedBy: 'location' });
    expect(r.redis.requiredBecause).toEqual(['API_REPLICAS=2']);
    expect(r.schema.status).toBe('unknown');
    expect(r.strandedPayments).toMatchObject({ thresholdMinutes: 15, needsReview: 0, recent: [] });
  });
  it('is a Super Admin route behind super_admin.system_operations.view', () => {
    const meta = Reflect.getMetadataKeys(RuntimeSafetyController.prototype.runtimeSafety).map(String);
    expect(meta.length).toBeGreaterThan(0);
    const perm = Reflect.getMetadataKeys(RuntimeSafetyController.prototype.runtimeSafety).map((k) => Reflect.getMetadata(k, RuntimeSafetyController.prototype.runtimeSafety)).flat();
    expect(JSON.stringify(perm)).toContain('super_admin.system_operations.view');
  });
});

const url = process.env.PG_RACE_URL;
describe.skipIf(!url)('RuntimeSafetyService on a real database', () => {
  const pool = url ? new pg.Pool({ connectionString: url, max: 2 }) : null;
  const db = pool ? new Kysely<any>({ dialect: new PostgresDialect({ pool }) }) : null;
  const T = 'a5490000-0000-4000-8000-00000000a0a0', B = 'b5490000-0000-4000-8000-00000000b0b0', C = 'c5490000-0000-4000-8000-00000000c0c0', TK = 'f5490000-0000-4000-8000-00000000f0f0';
  afterAll(async () => {
    if (!db) return;
    await sql`delete from payment_attempts where tenant_id = ${T}`.execute(db); await sql`delete from payments where tenant_id = ${T}`.execute(db);
    await db.destroy();
  });
  it('lists the attempts the sweep handed to a human, newest first, with the salon name; schema ok', async () => {
    await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'Ops Salon', 'Ops Salon', 'ops-salon-549', 'OPS549', 'active') on conflict (id) do nothing`.execute(db!);
    await sql`insert into branches (id, tenant_id, name, status) values (${B}, ${T}, 'Main', 'active') on conflict (id) do nothing`.execute(db!);
    await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values (${C}, ${T}, ${B}, 'A', 'B', 'A B') on conflict (id) do nothing`.execute(db!);
    await sql`insert into tickets (id, tenant_id, branch_id, customer_id) values (${TK}, ${T}, ${B}, ${C}) on conflict (id) do nothing`.execute(db!);
    await sql`insert into payment_attempts (tenant_id, branch_id, ticket_id, amount_cents, method, status, idempotency_key, resolution, stranded_at)
      values (${T}, ${B}, ${TK}, 4200, 'card', 'needs_review', 'ops-k1', 'provider_approved_unrecorded', now() - interval '1 minute')`.execute(db!);
    await sql`insert into payments (tenant_id, branch_id, ticket_id, method, amount_cents, status, stranded_at) values (${T}, ${B}, ${TK}, 'card', 5000, 'processing', now())`.execute(db!);
    const r = await new RuntimeSafetyService(db).read();
    expect(r.strandedPayments.needsReview).toBeGreaterThanOrEqual(1);
    expect(r.strandedPayments.unverifiedCards).toBeGreaterThanOrEqual(1);
    const mine = r.strandedPayments.recent.filter((x) => x.tenantId === T);
    expect(mine.map((x) => x.kind)).toEqual(['card_payment', 'split_attempt']);
    expect(mine[1]).toMatchObject({ tenantName: 'Ops Salon', amountCents: 4200, resolution: 'provider_approved_unrecorded', status: 'needs_review' });
    expect(r.schema.status).toBe('ok');
  });
});
