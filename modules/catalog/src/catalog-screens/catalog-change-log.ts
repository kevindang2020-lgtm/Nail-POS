// catalog-change-log.ts — the durable catalog audit trail (migration 718, append-only). One row per changed field: a
// service's price / duration / category / name / status, a category rename or archive, an add-on edit. Written in the SAME
// transaction as the change it describes, so a change without its history row cannot exist. Never read to re-price a
// ticket: completed tickets carry their own snapshots.
import { sql } from 'kysely';
/** a Kysely handle or a transaction — anything a raw `sql` statement executes on */
type Executor = Parameters<ReturnType<typeof sql>['execute']>[0];

export interface CatalogChangeCtx { tenantId: string; branchId?: string | null; userId?: string | null }
export interface CatalogChange {
  entityType: 'service' | 'category' | 'add_on'; entityId: string; serviceId?: string | null; field: string;
  oldValue: unknown; newValue: unknown; reason?: string | null; source?: string;
  /** D4 gaps (Nov 5 2026): when the change takes effect (a scheduled price applies at its time); default: now */
  effectiveAt?: string | null;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (v: unknown) => (v == null ? null : typeof v === 'string' ? v : String(v));

/** The fields that differ between two snapshots ({ field: value }), as change rows. */
export function diffFields(entityType: CatalogChange['entityType'], entityId: string, before: Record<string, unknown>, after: Record<string, unknown>, extra: Partial<CatalogChange> = {}): CatalogChange[] {
  const out: CatalogChange[] = [];
  for (const k of Object.keys(after)) {
    if (after[k] === undefined) continue;
    if (text(before[k]) !== text(after[k])) out.push({ entityType, entityId, field: k, oldValue: before[k], newValue: after[k], ...extra });
  }
  return out;
}

export async function recordCatalogChanges(db: Executor, ctx: CatalogChangeCtx, changes: CatalogChange[]): Promise<number> {
  if (!changes.length) return 0;
  const branch = ctx.branchId && UUID.test(ctx.branchId) ? ctx.branchId : null;
  const actor = ctx.userId && UUID.test(ctx.userId) ? ctx.userId : null;
  for (const c of changes) {
    await sql`insert into catalog_change_log (tenant_id, branch_id, entity_type, entity_id, service_id, field, old_value, new_value, reason, source, actor_user_id, effective_at)
      values (${ctx.tenantId}, ${branch}, ${c.entityType}, ${c.entityId}, ${c.serviceId && UUID.test(c.serviceId) ? c.serviceId : null}, ${c.field},
        ${text(c.oldValue)}, ${text(c.newValue)}, ${c.reason ? String(c.reason).slice(0, 500) : null}, ${c.source ?? 'pos'}, ${actor}, coalesce(${c.effectiveAt ?? null}::timestamptz, now()))`.execute(db);
  }
  return changes.length;
}
