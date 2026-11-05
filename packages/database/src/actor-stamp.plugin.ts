// actor-stamp.plugin.ts — Constitution 1 §34 / §37 / §55: WHO created, last changed and soft-deleted a row, written by the
// data layer instead of by hand in hundreds of repositories (before Phase 10: created_by on 129 tables, updated_by on 47,
// deleted_by on none — and most writers filled none of them).
//
// A Kysely plugin over the QUERY-BUILDER statements (raw `sql` templates are opaque and pass through untouched):
//   insert  → `created_by` = the actor, when the table has it and the row does not name it;
//   update  → `updated_by` = the actor and `updated_at` = now(), when the table has them and the statement does not set them;
//   update that sets `deleted_at` (a soft delete) → `deleted_by` = the actor (a restore, deleted_at = NULL, clears it).
// The actor comes from an injected `currentActor()` (the API passes the request's person from @aipowersalon/observability —
// this package never imports the app). Only a UUID is ever stamped: a worker principal (`worker:<job>`), 'system', an
// empty or unknown actor stamps NOTHING on insert and NULL on update (the change was not made by a person; the audit row
// names the worker). Which tables have which column is the generated map (actor-columns.generated.ts, from the migrated
// schema; the gate check:actor-stamp keeps it current). The plugin never throws: any failure returns the statement as it was.
import {
  ColumnNode, ColumnUpdateNode, InsertQueryNode, PrimitiveValueListNode, UpdateQueryNode, ValueListNode, ValueNode, ValuesNode,
  sql, type KyselyPlugin, type OperationNode, type PluginTransformQueryArgs, type PluginTransformResultArgs, type QueryResult,
  type RootOperationNode, type UnknownRow,
} from 'kysely';
import { ACTOR_COLUMNS } from './actor-columns.generated';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The actor as it may be stamped: a uuid, or null for anything else (worker principals, 'system', '', undefined). */
export function stampableActor(actor: unknown): string | null {
  return typeof actor === 'string' && UUID.test(actor) ? actor : null;
}

export interface ActorStampOptions {
  currentActor: () => string | null | undefined;
  /** table → flags (c created_by, u updated_by, d deleted_by — '!' after one = NOT NULL; t updated_at). Default: generated. */
  columns?: Readonly<Record<string, string>>;
}

interface Flags { c: 0 | 1 | 2; u: 0 | 1 | 2; d: 0 | 1 | 2; t: boolean }   // 0 absent, 1 nullable, 2 NOT NULL
function parse(f: string | undefined): Flags | null {
  if (!f) return null;
  const at = (k: string): 0 | 1 | 2 => { const i = f.indexOf(k); return i < 0 ? 0 : f[i + 1] === '!' ? 2 : 1; };
  return { c: at('c'), u: at('u'), d: at('d'), t: f.includes('t') };
}

function tableName(node: OperationNode | undefined): string | null {
  let n: any = node;
  if (n?.kind === 'AliasNode') n = n.node;
  if (n?.kind !== 'TableNode') return null;
  const name = n.table?.identifier?.name;
  return typeof name === 'string' ? name : null;
}
const colName = (n: any): string | null => (n?.kind === 'ColumnNode' ? n.column?.name ?? null : null);

export class ActorStampPlugin implements KyselyPlugin {
  private readonly columns: Readonly<Record<string, string>>;
  private readonly cache = new Map<string, Flags | null>();
  constructor(private readonly opts: ActorStampOptions) { this.columns = opts.columns ?? ACTOR_COLUMNS; }

  private flags(table: string | null): Flags | null {
    if (!table) return null;
    if (!this.cache.has(table)) this.cache.set(table, parse(this.columns[table]));
    return this.cache.get(table) ?? null;
  }
  private actor(): string | null {
    try { return stampableActor(this.opts.currentActor()); } catch { return null; }
  }

  transformQuery(args: PluginTransformQueryArgs): RootOperationNode {
    const node = args.node;
    try {
      if (InsertQueryNode.is(node)) return this.insert(node);
      if (UpdateQueryNode.is(node)) return this.update(node);
    } catch { /* never break a write over a stamp */ }
    return node;
  }
  async transformResult(args: PluginTransformResultArgs): Promise<QueryResult<UnknownRow>> { return args.result; }

  private insert(node: InsertQueryNode): RootOperationNode {
    const f = this.flags(tableName(node.into));
    if (!f || !f.c || !node.columns || !node.values || !ValuesNode.is(node.values)) return node;   // insert … select / defaults: untouched
    if (node.columns.some((c) => colName(c) === 'created_by')) return node;
    const actor = this.actor();
    if (actor === null) return node;                       // nothing to record: leave the column to its default
    const rows = node.values.values.map((row) => (PrimitiveValueListNode.is(row)
      ? PrimitiveValueListNode.create([...row.values, actor])
      : ValueListNode.create([...(row as ValueListNode).values, ValueNode.create(actor)])));
    return InsertQueryNode.cloneWith(node, { columns: [...node.columns, ColumnNode.create('created_by')], values: ValuesNode.create(rows) });
  }

  private update(node: UpdateQueryNode): RootOperationNode {
    const f = this.flags(tableName(node.table));
    if (!f || !node.updates) return node;
    const named = new Set(node.updates.map((u) => colName(u.column)));
    const actor = this.actor();
    const extra: ColumnUpdateNode[] = [];
    if (f.u && !named.has('updated_by') && (actor !== null || f.u === 1)) extra.push(ColumnUpdateNode.create(ColumnNode.create('updated_by'), ValueNode.create(actor)));
    if (f.t && !named.has('updated_at')) extra.push(ColumnUpdateNode.create(ColumnNode.create('updated_at'), sql`now()`.toOperationNode()));
    if (f.d && named.has('deleted_at') && !named.has('deleted_by')) {
      const del = node.updates.find((u) => colName(u.column) === 'deleted_at')!;
      const restoring = ValueNode.is(del.value) && del.value.value === null;
      const who = restoring ? null : actor;
      if (who !== null || f.d === 1) extra.push(ColumnUpdateNode.create(ColumnNode.create('deleted_by'), ValueNode.create(who)));
    }
    return extra.length ? UpdateQueryNode.cloneWithUpdates(node, extra) : node;
  }
}

/** The plugin, or none when DB_ACTOR_STAMP=off (an escape hatch; on by default wherever the API passes an actor). */
export function actorStampPlugins(currentActor: (() => string | null | undefined) | undefined, env: NodeJS.ProcessEnv = process.env): KyselyPlugin[] {
  if (!currentActor) return [];
  if (['off', '0', 'false', 'no'].includes(String(env.DB_ACTOR_STAMP ?? '').trim().toLowerCase())) return [];
  return [new ActorStampPlugin({ currentActor })];
}
