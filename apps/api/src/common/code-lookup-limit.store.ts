// code-lookup-limit.store.ts — the Postgres store behind @CodeLookupLimited (BUILD_PLAN Phase 14, migration 564).
//
// admit(): one short transaction — an advisory lock per key (caller, IP, salon; taken in a fixed order so two admits
// never deadlock), the three weighted sums over the window, and either a refusal (with how long until the oldest row
// that blocks leaves the window) or a 'pending' row at full miss weight. The lock makes the check-and-record atomic: N
// concurrent guesses by one caller admit exactly as many as the budget has room for. Every time comparison uses the
// DATABASE clock (now()), never the process clock — one clock, so replicas with skewed clocks agree.
import { sql, type Kysely } from 'kysely';
import {
  CODE_LOOKUP_BUDGET, CODE_LOOKUP_WINDOW_MS, MISS_WEIGHT, blockedDimension, weightFor,
  type CodeLookupAdmission, type CodeLookupKeys, type CodeLookupOutcome, type CodeLookupStore,
} from '@aipowersalon/security';

export class PostgresCodeLookupStore implements CodeLookupStore {
  constructor(private readonly db: Kysely<any>, private readonly budget = CODE_LOOKUP_BUDGET, private readonly windowMs = CODE_LOOKUP_WINDOW_MS) {}

  async admit(k: CodeLookupKeys): Promise<CodeLookupAdmission> {
    const win = `${Math.round(this.windowMs)} milliseconds`;
    const lockKeys = ['caller:' + k.caller, ...(k.ip ? ['ip:' + k.ip] : []), ...(k.tenantId ? ['tenant:' + k.tenantId] : [])].sort();
    return this.db.transaction().execute(async (trx) => {
      for (const key of lockKeys) await sql`select pg_advisory_xact_lock(hashtextextended(${'codelookup:' + key}, 0))`.execute(trx);
      const r: any = (await sql`
        select coalesce(sum(weight) filter (where caller_key = ${k.caller}), 0)::float8 as caller,
               coalesce(sum(weight) filter (where ${k.ip}::text is not null and ip = ${k.ip}), 0)::float8 as ip,
               coalesce(sum(weight) filter (where ${k.tenantId}::uuid is not null and tenant_id = ${k.tenantId}::uuid), 0)::float8 as tenant
          from code_lookup_attempts
         where created_at > now() - ${win}::interval
           and (caller_key = ${k.caller} or (${k.ip}::text is not null and ip = ${k.ip}) or (${k.tenantId}::uuid is not null and tenant_id = ${k.tenantId}::uuid))`.execute(trx)).rows[0];
      const dim = blockedDimension({ caller: Number(r.caller), ip: Number(r.ip), tenant: Number(r.tenant) }, k, this.budget);
      if (dim) {
        const col = dim === 'caller' ? sql`caller_key = ${k.caller}` : dim === 'ip' ? sql`ip = ${k.ip}` : sql`tenant_id = ${k.tenantId}::uuid`;
        const o: any = (await sql`select greatest(1000, extract(epoch from (min(created_at) + ${win}::interval - now())) * 1000)::float8 as ms
                                    from code_lookup_attempts where ${col} and created_at > now() - ${win}::interval`.execute(trx)).rows[0];
        return { allowed: false, attemptId: null, retryAfterMs: Math.ceil(Number(o?.ms ?? this.windowMs)), blockedBy: dim };
      }
      const ins: any = (await sql`insert into code_lookup_attempts (kind, tenant_id, caller_key, ip, outcome, weight)
                                   values (${k.kind}, ${k.tenantId}::uuid, ${k.caller}, ${k.ip}, 'pending', ${MISS_WEIGHT}) returning id`.execute(trx)).rows[0];
      return { allowed: true, attemptId: String(ins.id), retryAfterMs: 0 };
    });
  }

  async settle(attemptId: string, outcome: CodeLookupOutcome): Promise<void> {
    if (!/^\d+$/.test(attemptId)) return;
    if (outcome === 'neutral') { await sql`delete from code_lookup_attempts where id = ${attemptId}::bigint and outcome = 'pending'`.execute(this.db); return; }
    await sql`update code_lookup_attempts set outcome = ${outcome}, weight = ${weightFor(outcome)} where id = ${attemptId}::bigint and outcome = 'pending'`.execute(this.db);
  }
}
