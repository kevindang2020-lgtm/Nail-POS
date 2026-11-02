// actor-stamp.pgtest — migration 543 + the Kysely actor-stamp plugin on the REAL migrated schema (Constitution 1 §34/§55):
// an insert through the API's Kysely records created_by, an update records updated_by (and bumps updated_at), a soft
// delete records deleted_by, and a worker principal stamps nothing — never its non-uuid name.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { ActorStampPlugin, ACTOR_COLUMNS } from '@aipowersalon/database';

const T = 'a5430000-0000-4000-8000-000000000001';
const U = 'a5430000-0000-4000-8000-0000000000aa';
let pg: any; let base: any;
let actor: string | null = U;
const q = async (s: string, p: unknown[] = []) => (await pg.query(s, p)).rows;

beforeAll(async () => {
  pg = await migratedPglite();
  base = kyselyFor(pg);
  await q(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, lifecycle_state) values ($1, 'T', 'T', 'stamp543', 'stamp543', 'active') on conflict do nothing`, [T]);
});
const stamped = () => base.withPlugin(new ActorStampPlugin({ currentActor: () => actor }));

describe('migration 543 — the actor columns exist', () => {
  it('every table with deleted_at has deleted_by; the two POS work tables have created_by; every tenant table with updated_at has updated_by', async () => {
    const missingDeletedBy = await q(`select c.table_name from information_schema.columns c where c.table_schema = 'public' and c.column_name = 'deleted_at'
      and not exists (select 1 from information_schema.columns x where x.table_schema = 'public' and x.table_name = c.table_name and x.column_name = 'deleted_by')`);
    expect(missingDeletedBy).toEqual([]);
    const created = await q(`select table_name from information_schema.columns where table_schema = 'public' and column_name = 'created_by' and table_name in ('pos_tech_appointments', 'pos_queue_items') order by 1`);
    expect(created.map((r: any) => r.table_name)).toEqual(['pos_queue_items', 'pos_tech_appointments']);
    const missingUpdatedBy = await q(`select c.table_name from information_schema.columns c join pg_tables t on t.schemaname = 'public' and t.tablename = c.table_name
      where c.table_schema = 'public' and c.column_name = 'updated_at'
        and exists (select 1 from information_schema.columns x where x.table_schema = 'public' and x.table_name = c.table_name and x.column_name = 'tenant_id')
        and not exists (select 1 from information_schema.columns x where x.table_schema = 'public' and x.table_name = c.table_name and x.column_name = 'updated_by')`);
    expect(missingUpdatedBy).toEqual([]);
    expect(Object.keys(ACTOR_COLUMNS).length).toBeGreaterThan(200);
  });
});

describe('the plugin through a real Kysely on the real schema', () => {
  it('insert → created_by; update → updated_by + updated_at bumped', async () => {
    actor = U;
    const db = stamped();
    const [row] = await db.insertInto('pos_queue_items').values({ tenant_id: T, customer_name: 'Ann' }).returning(['id', 'created_by', 'updated_at']).execute();
    expect(row.created_by).toBe(U);
    await q(`update pos_queue_items set updated_at = now() - interval '1 day' where id = $1`, [row.id]);
    await db.updateTable('pos_queue_items').set({ customer_name: 'Ann B' }).where('id', '=', row.id).execute();
    const [after] = await q(`select updated_by, updated_at > now() - interval '1 minute' as fresh from pos_queue_items where id = $1`, [row.id]);
    expect(after).toEqual({ updated_by: U, fresh: true });
  });
  it('soft delete → deleted_by; restore clears it', async () => {
    actor = U;
    const db = stamped();
    const [b] = await db.insertInto('branches').values({ tenant_id: T, name: 'Main' }).returning('id').execute();
    await db.updateTable('branches').set({ deleted_at: new Date().toISOString() }).where('id', '=', b.id).execute();
    expect((await q(`select deleted_by, updated_by from branches where id = $1`, [b.id]))[0]).toEqual({ deleted_by: U, updated_by: U });
    await db.updateTable('branches').set({ deleted_at: null }).where('id', '=', b.id).execute();
    expect((await q(`select deleted_by from branches where id = $1`, [b.id]))[0].deleted_by).toBeNull();
  });
  it("a worker principal ('worker:…') never reaches the uuid column: insert leaves created_by empty, update records NULL", async () => {
    actor = U;
    const [row] = await stamped().insertInto('pos_queue_items').values({ tenant_id: T, customer_name: 'W' }).returning('id').execute();
    actor = 'worker:queue-sweeper';
    const [w] = await stamped().insertInto('pos_queue_items').values({ tenant_id: T, customer_name: 'W2' }).returning('created_by').execute();
    expect(w.created_by).toBeNull();
    await stamped().updateTable('pos_queue_items').set({ customer_name: 'W1' }).where('id', '=', row.id).execute();
    expect((await q(`select updated_by from pos_queue_items where id = $1`, [row.id]))[0].updated_by).toBeNull();
  });
});
