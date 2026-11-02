// state-machine.test.ts — BUILD_PLAN Phase 12 (#27): the transition primitive. Allowed / refused / permission-gated moves,
// the conditional update (a row that moved underneath the caller is refused, never overwritten), not-found, and the
// concurrent case (two writers race the same move: exactly one wins).
import { describe, it, expect, beforeAll } from 'vitest';
import { sql, type Kysely } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { defineStateMachine, assertTransition, transitionStatus, InvalidStateTransitionError, canMoveToSql } from './state-machine';

const M = defineStateMachine({
  name: 'test_order', table: '_sm_orders', states: ['draft', 'approved', 'ordered', 'received', 'cancelled'] as const,
  transitions: { draft: ['approved', 'cancelled'], approved: ['ordered', 'cancelled'], ordered: ['received', 'cancelled'] },
  permissions: { 'approved->ordered': 'purchase_orders.order' },
});

let db: Kysely<any>;
beforeAll(async () => {
  const pg = await migratedPglite();
  db = kyselyFor(pg);
  await sql`CREATE TABLE _sm_orders (id int PRIMARY KEY, tenant_id text NOT NULL, status text NOT NULL, ordered_at timestamptz)`.execute(db);
  await sql`INSERT INTO _sm_orders VALUES (1,'t1','draft',null), (2,'t1','approved',null), (3,'t2','draft',null), (4,'t1','received',null)`.execute(db);
});
const statusOf = async (id: number) => (await sql<{ status: string }>`SELECT status FROM _sm_orders WHERE id = ${id}`.execute(db)).rows[0]?.status;

describe('defineStateMachine / assertTransition', () => {
  it('a move the table lists passes; anything else is 409 INVALID_STATE_TRANSITION with the allowed moves', () => {
    expect(() => assertTransition(M, 'draft', 'approved')).not.toThrow();
    const e = (() => { try { assertTransition(M, 'received', 'draft'); } catch (x) { return x as InvalidStateTransitionError; } })()!;
    expect(e).toBeInstanceOf(InvalidStateTransitionError);
    expect([e.status, e.code, e.expose]).toEqual([409, 'INVALID_STATE_TRANSITION', true]);
    expect(e.details).toMatchObject({ machine: 'test_order', from: 'received', to: 'draft', allowed: [] });
    expect(() => assertTransition(M, 'draft', 'ordered')).toThrow(/cannot move from draft to ordered/);
    expect(() => assertTransition(M, null, 'draft')).toThrow(InvalidStateTransitionError);
  });
  it('a permission-gated move needs the permission (when the caller passes its permissions)', () => {
    expect(() => assertTransition(M, 'approved', 'ordered', { permissions: ['x'] })).toThrow(/permission/);
    expect(() => assertTransition(M, 'approved', 'ordered', { permissions: ['purchase_orders.order'] })).not.toThrow();
  });
  it('an inconsistent table is refused at load (a move to an unknown state)', () => {
    expect(() => defineStateMachine({ name: 'bad', table: 't', states: ['a', 'b'] as const, transitions: { a: ['c' as any] } })).toThrow(/unknown state 'c'/);
  });
  it('sourcesOf: the states a target may be reached from', () => {
    expect(M.sourcesOf('cancelled').sort()).toEqual(['approved', 'draft', 'ordered']);
    expect(M.sourcesOf('draft')).toEqual([]);
  });
});

describe('transitionStatus — the conditional update', () => {
  it('moves an allowed row, writes the extra columns, returns the state it left', async () => {
    const r = await transitionStatus(db, M, { where: { id: 2, tenant_id: 't1' }, to: 'ordered', set: { ordered_at: new Date('2026-10-08T12:00:00Z') } });
    expect(r).toEqual({ from: 'approved' });
    expect(await statusOf(2)).toBe('ordered');
  });
  it('a row in a state the move is not allowed from is refused and left untouched', async () => {
    await expect(transitionStatus(db, M, { where: { id: 4, tenant_id: 't1' }, to: 'cancelled' })).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION', details: { from: 'received', to: 'cancelled' } });
    expect(await statusOf(4)).toBe('received');
  });
  it('another tenant\'s row is not found (null), never moved', async () => {
    expect(await transitionStatus(db, M, { where: { id: 3, tenant_id: 't1' }, to: 'approved' })).toBeNull();
    expect(await statusOf(3)).toBe('draft');
  });
  it('optimistic: the caller read "draft" but the row is now "approved" → refused as concurrent, not overwritten', async () => {
    await sql`UPDATE _sm_orders SET status = 'approved' WHERE id = 1`.execute(db);
    await expect(transitionStatus(db, M, { where: { id: 1, tenant_id: 't1' }, from: 'draft', to: 'cancelled' })).rejects.toMatchObject({ details: { reason: 'concurrent', from: 'approved' } });
    expect(await statusOf(1)).toBe('approved');
  });
  it('two writers race the same move: exactly one wins, the other gets 409', async () => {
    await sql`INSERT INTO _sm_orders VALUES (9,'t1','draft',null)`.execute(db);
    const results = await Promise.allSettled([
      transitionStatus(db, M, { where: { id: 9, tenant_id: 't1' }, from: 'draft', to: 'approved' }),
      transitionStatus(db, M, { where: { id: 9, tenant_id: 't1' }, from: 'draft', to: 'cancelled' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected').map((r: any) => r.reason.code)).toEqual(['INVALID_STATE_TRANSITION']);
  });
});

describe('canMoveToSql — §163 run 3 (Oct 27 2026)', () => {
  it('a value outside the lifecycle is the caller\'s input: an exposed 400 VALIDATION_FAILED (the platform filter shows it), not a 500', () => {
    let err: any; try { canMoveToSql(M, "' OR '1'='1"); } catch (e) { err = e; }
    expect(err).toMatchObject({ status: 400, code: 'VALIDATION_FAILED', expose: true, details: { field: 'status' } });
    expect(err.details.allowed).toEqual(['draft', 'approved', 'ordered', 'received', 'cancelled']);
  });
  it('a known state still compiles to its source list', () => {
    expect(() => canMoveToSql(M, 'ordered')).not.toThrow();
  });
});
