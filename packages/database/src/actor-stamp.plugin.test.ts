import { describe, it, expect } from 'vitest';
import { Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler, sql } from 'kysely';
import { ActorStampPlugin, stampableActor } from './actor-stamp.plugin';
import { ACTOR_COLUMNS } from './actor-columns.generated';

const U1 = '11111111-1111-4111-8111-111111111111';
const MAP = { tickets: 'ut', pos_queue_items: 'cut', branches: 'ud', strict_tbl: 'u!t', platform_cfg: 'c' };

function recording(actor: () => string | null, map: Record<string, string> = MAP) {
  const sent: { sql: string; params: readonly unknown[] }[] = [];
  const conn = { async executeQuery(q: any) { sent.push({ sql: q.sql, params: q.parameters }); return { rows: [] }; }, async *streamQuery() {} };
  const driver = { async init() {}, async acquireConnection() { return conn; }, async beginTransaction() {}, async commitTransaction() {}, async rollbackTransaction() {}, async releaseConnection() {}, async destroy() {} };
  const db = new Kysely<any>({
    dialect: { createAdapter: () => new PostgresAdapter(), createDriver: () => driver as any, createIntrospector: (d) => new PostgresIntrospector(d), createQueryCompiler: () => new PostgresQueryCompiler() },
    plugins: [new ActorStampPlugin({ currentActor: actor, columns: map })],
  });
  return { db, sent };
}

describe('actor-stamp plugin (Constitution 1 §34)', () => {
  it('insert: adds created_by = the actor when the table has it and the row does not name it', async () => {
    const { db, sent } = recording(() => U1);
    await db.insertInto('pos_queue_items').values({ tenant_id: 't', name: 'x' }).execute();
    expect(sent[0].sql).toBe('insert into "pos_queue_items" ("tenant_id", "name", "created_by") values ($1, $2, $3)');
    expect(sent[0].params).toEqual(['t', 'x', U1]);
  });
  it('insert: a row that names created_by itself is left alone', async () => {
    const { db, sent } = recording(() => U1);
    await db.insertInto('pos_queue_items').values({ tenant_id: 't', created_by: null }).execute();
    expect(sent[0].sql).toBe('insert into "pos_queue_items" ("tenant_id", "created_by") values ($1, $2)');
    expect(sent[0].params).toEqual(['t', null]);
  });
  it('insert: every row of a multi-row insert gets the actor', async () => {
    const { db, sent } = recording(() => U1);
    await db.insertInto('pos_queue_items').values([{ tenant_id: 'a' }, { tenant_id: 'b' }]).execute();
    expect(sent[0].sql).toBe('insert into "pos_queue_items" ("tenant_id", "created_by") values ($1, $2), ($3, $4)');
    expect(sent[0].params).toEqual(['a', U1, 'b', U1]);
  });
  it('insert … select and tables without the column are untouched', async () => {
    const { db, sent } = recording(() => U1);
    await db.insertInto('pos_queue_items').columns(['tenant_id']).expression(db.selectFrom('tickets').select('tenant_id')).execute();
    await db.insertInto('tickets').values({ tenant_id: 't' }).execute();          // tickets has no created_by in the map
    await db.insertInto('not_in_map').values({ a: 1 }).execute();
    expect(sent.map((s) => s.sql)).toEqual([
      'insert into "pos_queue_items" ("tenant_id") select "tenant_id" from "tickets"',
      'insert into "tickets" ("tenant_id") values ($1)',
      'insert into "not_in_map" ("a") values ($1)',
    ]);
  });
  it('update: sets updated_by = the actor and bumps updated_at when the table has them', async () => {
    const { db, sent } = recording(() => U1);
    await db.updateTable('tickets').set({ status: 'paid' }).where('id', '=', 'x').execute();
    expect(sent[0].sql).toBe('update "tickets" set "status" = $1, "updated_by" = $2, "updated_at" = now() where "id" = $3');
    expect(sent[0].params).toEqual(['paid', U1, 'x']);
  });
  it('update: an explicit updated_by / updated_at wins; an aliased table is still recognised', async () => {
    const { db, sent } = recording(() => U1);
    await db.updateTable('tickets as t').set({ updated_by: null, updated_at: sql`clock_timestamp()` }).execute();
    expect(sent[0].sql).toBe('update "tickets" as "t" set "updated_by" = $1, "updated_at" = clock_timestamp()');
    await db.updateTable('tickets as t').set({ status: 'x' }).execute();
    expect(sent[1].sql).toBe('update "tickets" as "t" set "status" = $1, "updated_by" = $2, "updated_at" = now()');
  });
  it('soft delete (an update setting deleted_at) stamps deleted_by; a restore (deleted_at = null) clears it', async () => {
    const { db, sent } = recording(() => U1);
    await db.updateTable('branches').set({ deleted_at: sql`now()` }).where('id', '=', 'b').execute();
    expect(sent[0].sql).toBe('update "branches" set "deleted_at" = now(), "updated_by" = $1, "deleted_by" = $2 where "id" = $3');
    expect(sent[0].params).toEqual([U1, U1, 'b']);
    await db.updateTable('branches').set({ deleted_at: null }).where('id', '=', 'b').execute();
    expect(sent[1].sql).toBe('update "branches" set "deleted_at" = $1, "updated_by" = $2, "deleted_by" = $3 where "id" = $4');
    expect(sent[1].params).toEqual([null, U1, null, 'b']);
  });
  it("a worker principal ('worker:<job>') or any non-uuid actor is NEVER stamped: inserts add nothing, updates record NULL", async () => {
    const { db, sent } = recording(() => 'worker:dormant-accounts');
    await db.insertInto('pos_queue_items').values({ tenant_id: 't' }).execute();
    await db.updateTable('tickets').set({ status: 'x' }).execute();
    expect(sent[0].sql).toBe('insert into "pos_queue_items" ("tenant_id") values ($1)');
    expect(sent[1].sql).toBe('update "tickets" set "status" = $1, "updated_by" = $2, "updated_at" = now()');
    expect(sent[1].params).toEqual(['x', null]);
    expect(sent.flatMap((s) => s.params)).not.toContain('worker:dormant-accounts');
  });
  it('a NOT NULL actor column is never given NULL', async () => {
    const { db, sent } = recording(() => null);
    await db.updateTable('strict_tbl').set({ a: 1 }).execute();
    expect(sent[0].sql).toBe('update "strict_tbl" set "a" = $1, "updated_at" = now()');
  });
  it('never throws: an actor lookup that throws stamps as "no actor"; a malformed node passes through unchanged', async () => {
    const { db, sent } = recording(() => { throw new Error('context exploded'); });
    await db.insertInto('pos_queue_items').values({ tenant_id: 't' }).execute();
    await db.updateTable('tickets').set({ status: 'x' }).execute();
    expect(sent[0].sql).toBe('insert into "pos_queue_items" ("tenant_id") values ($1)');
    expect(sent[1].params).toEqual(['x', null]);
    const plugin = new ActorStampPlugin({ currentActor: () => U1, columns: MAP });
    const weird: any = { kind: 'UpdateQueryNode', table: undefined, updates: undefined };
    expect(plugin.transformQuery({ node: weird, queryId: { queryId: 'q' } } as any)).toBe(weird);
    // a node whose shape makes the transform itself throw (values not a list) is returned as it was
    const broken: any = { kind: 'InsertQueryNode', into: { kind: 'TableNode', table: { kind: 'SchemableIdentifierNode', identifier: { kind: 'IdentifierNode', name: 'pos_queue_items' } } }, columns: [], values: { kind: 'ValuesNode', values: null } };
    expect(plugin.transformQuery({ node: broken, queryId: { queryId: 'q' } } as any)).toBe(broken);
  });
  it('raw sql and selects / deletes pass through', async () => {
    const { db, sent } = recording(() => U1);
    await sql`update tickets set status = 'x'`.execute(db);
    await db.selectFrom('tickets').selectAll().execute();
    await db.deleteFrom('tickets').where('id', '=', 'x').execute();
    expect(sent.map((s) => s.sql)).toEqual(["update tickets set status = 'x'", 'select * from "tickets"', 'delete from "tickets" where "id" = $1']);
  });
  it('stampableActor accepts a uuid only', () => {
    expect(stampableActor(U1)).toBe(U1);
    expect(stampableActor('worker:x')).toBeNull();
    expect(stampableActor('system')).toBeNull();
    expect(stampableActor('')).toBeNull();
    expect(stampableActor(undefined as any)).toBeNull();
  });
  it('the generated map covers the core tables (and is not vacuous)', () => {
    expect(Object.keys(ACTOR_COLUMNS).length).toBeGreaterThan(200);
    expect(ACTOR_COLUMNS.pos_queue_items).toMatch(/c/);
    expect(ACTOR_COLUMNS.pos_tech_appointments).toMatch(/c/);
    expect(ACTOR_COLUMNS.tickets).toMatch(/u/);
    expect(ACTOR_COLUMNS.branches).toMatch(/d/);
  });
});
