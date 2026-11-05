// state-machine.ts — BUILD_PLAN Phase 12 / Constitution 5 §74–§78 (API_DEFINITION_OF_DONE #27): explicit state transitions.
//
// Every domain with a lifecycle (a `status` column with a Phase 10 vocabulary CHECK) declares ONE transition table in its
// own module — defineStateMachine({ name, table, column, states, transitions, permissions }) — and every writer of that
// column goes through it:
//   * assertTransition(machine, from, to, { permissions }) — refuses a move the table does not list (409
//     INVALID_STATE_TRANSITION, with { machine, from, to, allowed }), and a move whose permission the actor lacks;
//   * transitionStatus(db, machine, { where, to, from?, set? }) — the CONDITIONAL update: `… WHERE <column> IN (<the
//     states `to` may be reached from>)`, so two concurrent writers cannot both move the same row (a lost update becomes
//     a 409 for the second one) and a row that changed underneath the caller is refused, not overwritten.
// check:state-transitions (apps/api/scripts/audit-state-transitions.mjs) finds every status write and fails one that is
// outside its domain's machine (a shrinking baseline holds the writers not yet moved).
import { sql, type Kysely } from 'kysely';

export interface StateMachineDef<S extends string> {
  /** Stable name (snake_case) — in error details, logs and the gate's inventory. */
  readonly name: string;
  /** The table and column the machine governs (the column carries the Phase 10 vocabulary CHECK). */
  readonly table: string;
  readonly column?: string;
  /** Every state the machine knows (a subset of the column's CHECK vocabulary — the pgtest asserts it). */
  readonly states: readonly S[];
  /** The ONLY allowed moves: from → the states it may go to. A state with no entry is terminal. */
  readonly transitions: { readonly [K in S]?: readonly S[] };
  /** A move that needs more than the route's own permission: 'from->to' (or '*->to') → permission key. */
  readonly permissions?: { readonly [move: string]: string };
  /** States a new row may start in (inserts) — informative; the gate reports inserts outside them. */
  readonly initial?: readonly S[];
}

export interface StateMachine<S extends string = string> extends StateMachineDef<S> {
  readonly column: string;
  /** Is `from → to` a listed move? */
  can(from: string | null | undefined, to: string): boolean;
  /** The states `to` may be reached from (the conditional update's `IN (…)` list). */
  sourcesOf(to: string): S[];
  /** The permission a move needs beyond the route's, if any. */
  permissionFor(from: string, to: string): string | undefined;
}

/** 409 INVALID_STATE_TRANSITION. Framework-free; exposed (http-errors convention) so the API's exception filter answers it. */
export class InvalidStateTransitionError extends Error {
  readonly code = 'INVALID_STATE_TRANSITION';
  readonly status = 409;
  readonly expose = true;
  readonly details: { machine: string; from: string | null; to: string; allowed: string[]; reason?: 'not_allowed' | 'permission' | 'concurrent' };
  constructor(machine: StateMachine<any>, from: string | null, to: string, reason: 'not_allowed' | 'permission' | 'concurrent' = 'not_allowed') {
    super(reason === 'permission'
      ? `You do not have permission to move this ${machine.name.replace(/_/g, ' ')} from ${from} to ${to}.`
      : reason === 'concurrent'
        ? `This ${machine.name.replace(/_/g, ' ')} changed while you were working on it (it is now ${from ?? 'gone'}). Refresh and try again.`
        : `A ${machine.name.replace(/_/g, ' ')} cannot move from ${from ?? 'nothing'} to ${to}.`);
    this.name = 'InvalidStateTransitionError';
    this.details = { machine: machine.name, from, to, allowed: from ? [...(machine.transitions[from as never] ?? [])] as string[] : [], reason };
  }
}

/** Declare a lifecycle. Throws at module load when the table is inconsistent (a move to an unknown state). */
export function defineStateMachine<S extends string>(def: StateMachineDef<S>): StateMachine<S> {
  const states = new Set<string>(def.states);
  for (const [from, tos] of Object.entries(def.transitions) as Array<[string, readonly string[] | undefined]>) {
    if (!states.has(from)) throw new Error(`state machine ${def.name}: transition from unknown state '${from}'`);
    for (const to of tos ?? []) if (!states.has(to)) throw new Error(`state machine ${def.name}: transition ${from} → unknown state '${to}'`);
  }
  for (const s of def.initial ?? []) if (!states.has(s)) throw new Error(`state machine ${def.name}: unknown initial state '${s}'`);
  const sources = new Map<string, S[]>();
  for (const [from, tos] of Object.entries(def.transitions) as Array<[S, readonly S[] | undefined]>) for (const to of tos ?? []) sources.set(to, [...(sources.get(to) ?? []), from]);
  const m: StateMachine<S> = Object.freeze({
    ...def,
    column: def.column ?? 'status',
    can: (from: string | null | undefined, to: string) => !!from && !!(def.transitions[from as S] ?? []).includes(to as S),
    sourcesOf: (to: string) => [...(sources.get(to) ?? [])],
    permissionFor: (from: string, to: string) => def.permissions?.[`${from}->${to}`] ?? def.permissions?.[`*->${to}`],
  });
  return m;
}

/** Refuse a move the machine does not list, or one whose extra permission the actor lacks. */
export function assertTransition(m: StateMachine<any>, from: string | null | undefined, to: string, opts: { permissions?: readonly string[] } = {}): void {
  if (!m.can(from, to)) throw new InvalidStateTransitionError(m, from ?? null, to);
  const need = m.permissionFor(String(from), to);
  if (need && opts.permissions && !opts.permissions.includes(need)) throw new InvalidStateTransitionError(m, from ?? null, to, 'permission');
}

export interface TransitionArgs<S extends string> {
  /** Identifies the row (always include tenant_id for a tenant table). */
  where: Record<string, unknown>;
  to: S;
  /** The state the caller read (optimistic: the update only lands if it is still that). Default: any state `to` may come from. */
  from?: S | readonly S[];
  /** Other columns written in the same statement (completed_at, approved_by …). */
  set?: Record<string, unknown>;
  /** The actor's permissions, for moves that need one (machine.permissions). */
  permissions?: readonly string[];
}

/**
 * The conditional update: moves the row to `to` only from a state the machine allows (and, when given, only from the
 * state the caller read). Returns { from } — the state it left — or null when no row matches `where`. A row in any other
 * state is refused with InvalidStateTransitionError (409), never overwritten: the lost-update guard.
 */
export async function transitionStatus<S extends string>(db: Kysely<any>, m: StateMachine<S>, a: TransitionArgs<S>): Promise<{ from: S } | null> {
  const expected = a.from === undefined ? m.sourcesOf(a.to) : (Array.isArray(a.from) ? [...a.from] : [a.from as S]);
  for (const f of expected) assertTransition(m, f, a.to, { permissions: a.permissions });
  const where = Object.entries(a.where);
  if (!where.length) throw new Error(`transitionStatus(${m.name}): a where clause is required`);
  if (!expected.length) throw new InvalidStateTransitionError(m, null, a.to);
  const col = sql.ref(m.column);
  const sets = [sql`${col} = ${a.to}`, ...Object.entries(a.set ?? {}).map(([k, v]) => sql`${sql.ref(k)} = ${v}`)];
  const cond = where.map(([k, v]) => (v === null ? sql`${sql.ref(k)} IS NULL` : sql`${sql.ref(k)} = ${v}`));
  // the old value comes back from the pre-update snapshot of the same row (FROM a self-join on ctid would be faster;
  // this stays portable): one statement, so the check and the write cannot be separated by another writer
  const r = await sql<{ old: S }>`
    UPDATE ${sql.table(m.table)} AS t SET ${sql.join(sets)}
      FROM (SELECT ctid AS rid, ${col} AS old FROM ${sql.table(m.table)} WHERE ${sql.join(cond, sql` AND `)} AND ${col} IN (${sql.join(expected)}) FOR UPDATE) AS prev
     WHERE t.ctid = prev.rid
     RETURNING prev.old AS old`.execute(db);
  if (r.rows.length) return { from: r.rows[0].old };
  const now = await sql<{ s: string }>`SELECT ${col} AS s FROM ${sql.table(m.table)} WHERE ${sql.join(cond, sql` AND `)} LIMIT 1`.execute(db);
  if (!now.rows.length) return null;
  const current = now.rows[0].s;
  // the caller read another state than the row has now: it changed underneath them (a lost update averted)
  throw new InvalidStateTransitionError(m, current, a.to, a.from !== undefined && !expected.includes(current as S) ? 'concurrent' : 'not_allowed');
}

/**
 * For a set-based write (a sweep, an UPDATE … WHERE id IN (…), an upsert's DO UPDATE): the SQL predicate
 * `<column> IN (<the states \`to\` may be reached from>)`, optionally qualified by a table alias. The write then moves
 * only rows the machine allows — the same rule transitionStatus applies to one row.
 */
export function canMoveToSql(m: StateMachine<any>, to: string, alias?: string) {
  const from = m.sourcesOf(to);
  if (!from.length) throw new Error(`canMoveToSql(${m.name}): no state may move to '${to}'`);
  return sql`${sql.ref(alias ? `${alias}.${m.column}` : m.column)} IN (${sql.join(from)})`;
}
