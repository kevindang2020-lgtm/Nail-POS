// super-admin-idempotency.repository.ts — extras GLOBAL LOYALTY REWARDS 11 (round 10): the Super Admin's read-only
// idempotency center over rewards_idempotency_events. Cross-salon by design (the platform's own rewards network view,
// reached only through the Super Admin loyalty-network controller); each salon's rows are written by its own requests.
import { sql, type Kysely, type Transaction } from 'kysely';
type Exec = Kysely<any> | Transaction<any>;
type Row = Record<string, any>;
const n = (v: unknown): number => (v == null ? 0 : Number(v));
const iso = (v: unknown): string | null => (v ? new Date(v as string).toISOString() : null);

/** The Super Admin's read-only idempotency center: newest first, filter by outcome / scope, with how many times each key repeated. */
export async function listIdempotencyEvents(db: Exec, q: { outcome?: string | null; scope?: string | null; page?: number; pageSize?: number }) {
  const s = Math.max(1, Math.min(100, Math.floor(Number(q.pageSize) || 25))); const p = Math.max(1, Math.min(10_000, Math.floor(Number(q.page) || 1)));
  const outcome = q.outcome === 'replay' || q.outcome === 'conflict' ? q.outcome : null; const scope = q.scope === 'token_purchase' || q.scope === 'redemption' ? q.scope : null;
  const w = sql`${outcome ? sql`e.outcome = ${outcome}` : sql`true`} and ${scope ? sql`e.scope = ${scope}` : sql`true`}`;
  const tot = (await sql<Row>`SELECT count(*) AS c, count(*) FILTER (WHERE e.outcome = 'conflict') AS k FROM rewards_idempotency_events e WHERE ${w}`.execute(db)).rows[0];
  const rows = (await sql<Row>`SELECT e.id, e.tenant_id, t.display_name, e.scope, e.outcome, e.request_key, e.resource_id, e.detail, e.created_at,
      (SELECT count(*) FROM rewards_idempotency_events x WHERE x.tenant_id = e.tenant_id AND x.scope = e.scope AND x.request_key = e.request_key) AS repeats
    FROM rewards_idempotency_events e LEFT JOIN tenants t ON t.id = e.tenant_id WHERE ${w} ORDER BY e.created_at DESC, e.id DESC LIMIT ${s} OFFSET ${(p - 1) * s}`.execute(db)).rows;
  const total = n(tot?.c);
  return { total, conflicts: n(tot?.k), page: p, pageSize: s, pageCount: Math.max(1, Math.ceil(total / s)),
    items: rows.map((r) => ({ id: String(r.id), tenantId: String(r.tenant_id), salon: r.display_name ?? null, scope: String(r.scope), outcome: String(r.outcome),
      keyRef: '…' + String(r.request_key).slice(-8), resourceId: r.resource_id ? String(r.resource_id) : null, repeats: n(r.repeats), detail: (r.detail ?? {}) as Record<string, unknown>, at: iso(r.created_at) as string })) };
}
