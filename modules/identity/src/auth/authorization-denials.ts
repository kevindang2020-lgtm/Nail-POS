// authorization-denials.ts — BUILD_PLAN Phase 9 (Constitution 2 §denial metrics): the Postgres sink behind the tenant
// permission guard's AUTHZ_DENIAL_SINK. Every refusal lands in authorization_denials (migration 531), SAMPLED: one row per
// salon + user + key + reason per minute (a burst becomes a count, not a thousand rows), and a burst inside one process
// is folded in memory so a probing client cannot turn denials into a write storm. It never blocks or fails a request:
// record() is fire-and-forget and swallows its own errors.
import { sql } from 'kysely';
import type { AuthzDenialRecord, AuthzDenialSink } from '@aipowersalon/permissions/guards';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrNull = (v: string | null | undefined) => (v && UUID.test(v) ? v : null);

export class KyselyAuthzDenialSink implements AuthzDenialSink {
  private readonly pending = new Map<string, { n: number; lastWrite: number }>();
  constructor(private readonly db: any, private readonly minGapMs = 2_000, private readonly clock: () => number = () => Date.now()) {}

  record(d: AuthzDenialRecord): void {
    void this.write(d).catch(() => undefined);
  }

  /** Exposed for tests: resolves when the (possibly folded) write is done. */
  async write(d: AuthzDenialRecord): Promise<void> {
    if (!d?.permission || !d.reason) return;
    const tenantId = uuidOrNull(d.tenantId); const userId = uuidOrNull(d.userId);
    const key = [tenantId ?? '', userId ?? '', d.permission, d.reason].join('|');
    const now = this.clock();
    const p = this.pending.get(key);
    if (p && now - p.lastWrite < this.minGapMs) { p.n += 1; return; }   // folded into the next write of this bucket
    const n = (p?.n ?? 0) + 1;
    this.pending.set(key, { n: 0, lastWrite: now });
    if (this.pending.size > 10_000) { const first = this.pending.keys().next().value; if (first !== undefined) this.pending.delete(first); }
    const permission = String(d.permission).slice(0, 200); const reason = String(d.reason).slice(0, 60);
    const role = d.role ? String(d.role).slice(0, 40) : null; const route = d.route ? String(d.route).slice(0, 300) : null;
    await sql`with upd as (
        update authorization_denials set count = count + ${n}, last_at = now(), route = coalesce(${route}, route)
         where tenant_id is not distinct from ${tenantId}::uuid and user_id is not distinct from ${userId}::uuid
           and permission = ${permission} and reason = ${reason} and first_at > now() - interval '1 minute'
        returning id)
      insert into authorization_denials (tenant_id, user_id, role, permission, reason, route, count)
      select ${tenantId}::uuid, ${userId}::uuid, ${role}, ${permission}, ${reason}, ${route}, ${n}
       where not exists (select 1 from upd)`.execute(this.db);
  }
}
