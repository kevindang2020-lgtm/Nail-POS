// membership-export-audit.pgtest — extras Membership Overview 16 · 08 (round 10): a membership export writes ONE immutable
// membership_audit row (actor, list, location, row count — never the exported rows) on the real schema.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyMembershipsRepository } from './memberships.kysely.repository';
import { MembershipsService } from './memberships.service';

const T = '7c950000-0000-4000-8000-000000000001', B1 = '7c950000-0000-4000-8000-0000000000b1', B2 = '7c950000-0000-4000-8000-0000000000b2';
const U = '7c950000-0000-4000-8000-0000000000e1', C = '7c950000-0000-4000-8000-0000000000d1', PL = '7c950000-0000-4000-8000-0000000000f1', PV = '7c950000-0000-4000-8000-0000000000f2';
let db: any; let svc: MembershipsService;
beforeAll(async () => {
  db = kyselyFor(await migratedPglite());
  await sql`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values (${T}, 'E', 'E', 'mexp950', 'MEXP950', 'active')`.execute(db);
  await sql`insert into branches (id, tenant_id, name) values (${B1}, ${T}, 'One'), (${B2}, ${T}, 'Two')`.execute(db);
  await sql`insert into customers (id, tenant_id, branch_id, first_name, last_name, full_name) values (${C}, ${T}, ${B1}, 'A', 'B', 'A B')`.execute(db);
  await sql`insert into membership_plans (id, tenant_id, name, status) values (${PL}, ${T}, 'Gold', 'active')`.execute(db);
  await sql`insert into membership_plan_versions (id, plan_id, tenant_id, version_number, price_cents) values (${PV}, ${PL}, ${T}, 1, 4900)`.execute(db);
  await sql`insert into customer_memberships (tenant_id, branch_id, customer_id, plan_id, plan_version_id, status) values (${T}, ${B1}, ${C}, ${PL}, ${PV}, 'active'), (${T}, ${B2}, ${C}, ${PL}, ${PV}, 'active')`.execute(db);
  svc = new MembershipsService(new KyselyMembershipsRepository(db));
}, 120_000);

describe('membership export audit (16·08)', () => {
  it('each export appends one audit row with the actor, list, location and row count; a refused export writes none', async () => {
    const ctx = { tenantId: T, branchId: B1, userId: U, role: 'MANAGER', permissions: ['pos.memberships.view'], authz: { scope: 'BRANCH', branchIds: null } };
    const rows = await svc.exportMembers(ctx);
    expect(rows).toHaveLength(1);                                  // confined to B1
    await expect(svc.exportMembers(ctx, B2)).rejects.toMatchObject({ apiCode: 'BRANCH_ACCESS_DENIED' });
    await svc.exportPayments({ ...ctx, authz: null }, undefined);   // whole-salon user, every location
    const audit = (await sql<{ action: string; branch_id: string | null; actor_user_id: string | null; actor_role: string | null; result: string | null; customer_id: string | null }>`
      select action, branch_id, actor_user_id, actor_role, result, customer_id from membership_audit where tenant_id = ${T} order by created_at, action`.execute(db)).rows;
    expect(audit).toEqual([
      { action: 'export.members', branch_id: B1, actor_user_id: U, actor_role: 'MANAGER', result: 'rows=1', customer_id: null },
      { action: 'export.payments', branch_id: null, actor_user_id: U, actor_role: 'MANAGER', result: 'rows=0', customer_id: null },
    ]);
  });
});
