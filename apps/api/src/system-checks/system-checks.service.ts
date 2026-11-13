// system-checks.service.ts — runs one page's read-only checks (system-checks.registry.ts). Each check runs on its own, in a
// read-only transaction with a short statement timeout, so one slow or failing query never hides the others: it reports
// NOT_TESTED (never a pass). Nothing is written and no row data leaves the database — only counts.
import { Logger } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { SystemCheckDomain, SystemCheckItem, SystemCheckResult, SystemCheckRows, SystemCheckSourceRow } from '@aipowersalon/api-contracts/tenant';
import { SYSTEM_CHECKS } from './system-checks.registry';

const log = new Logger('SystemChecks');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class SystemChecksService {
  constructor(private readonly db: Kysely<DB> | null) {}

  async run(domain: SystemCheckDomain, ctx: { tenantId?: string; branchId?: string | null }): Promise<SystemCheckResult> {
    const def = SYSTEM_CHECKS[domain];
    const branchId = ctx.branchId && UUID.test(ctx.branchId) ? ctx.branchId : null;
    const checks: SystemCheckItem[] = [];
    for (const c of def.checks) {
      if (!this.db || !ctx.tenantId || !UUID.test(ctx.tenantId)) { checks.push({ key: c.key, state: 'NOT_TESTED', count: null }); continue; }
      try {
        const count = await this.db.transaction().execute(async (tx) => {
          await sql`SET TRANSACTION READ ONLY`.execute(tx);
          await sql`SET LOCAL statement_timeout = '5s'`.execute(tx);
          return Number((await c.count(ctx.tenantId!, branchId).execute(tx)).rows[0]?.n ?? 0);
        });
        checks.push({ key: c.key, state: count > 0 ? c.severity : 'READY', count });
      } catch (e) {
        log.warn(`${domain}.${c.key} could not run: ${String((e as Error)?.message ?? e).slice(0, 200)}`);
        checks.push({ key: c.key, state: 'NOT_TESTED', count: null });
      }
    }
    const has = (s: string) => checks.some((x) => x.state === s);
    const overall = has('FAILED') ? 'FAILED' : has('WARNING') ? 'WARNING' : has('NOT_TESTED') ? 'NOT_TESTED' : 'READY';
    return { domain, overall, checkedAt: new Date().toISOString(), branchId, checks };
  }

  /** extras Membership Overview 16 · 15 — Reconciliation Drill-Down: the source rows behind ONE check (the same predicate as
   *  its count), newest first, at most `limit`, with the member number / name and the ticket number joined in. Read-only
   *  transaction; the salon from the session; the person's branch when the request has one. */
  async rows(domain: SystemCheckDomain, key: string, ctx: { tenantId?: string; branchId?: string | null }, limit = 25): Promise<SystemCheckRows> {
    const branchId = ctx.branchId && UUID.test(ctx.branchId) ? ctx.branchId : null;
    const base = { domain, key, checkedAt: new Date().toISOString(), branchId, limit };
    const c = SYSTEM_CHECKS[domain]?.checks.find((x) => x.key === key);
    if (!c) throw new SystemCheckNotFound();
    if (!c.rows || !this.db || !ctx.tenantId || !UUID.test(ctx.tenantId)) return { ...base, available: false, rows: [], truncated: false };
    const t = ctx.tenantId;
    try {
      const out = await this.db.transaction().execute(async (tx) => {
        await sql`SET TRANSACTION READ ONLY`.execute(tx);
        await sql`SET LOCAL statement_timeout = '5s'`.execute(tx);
        return (await sql<{ membership_id: string; source: SystemCheckSourceRow['source']; source_id: string | null; ticket_id: string | null; amount_cents: number | null; at: string | null; detail: string | null;
            member_number: string | null; customer_name: string | null; ticket_number: string | null }>`
          SELECT z.membership_id, z.source, z.source_id, z.ticket_id, z.amount_cents, z.at, z.detail,
                 cm.member_number::text AS member_number, cu.full_name AS customer_name, tk.ticket_number::text AS ticket_number
            FROM (${c.rows!(t, branchId)} LIMIT ${limit + 1}) z
            LEFT JOIN customer_memberships cm ON cm.tenant_id = ${t}::uuid AND cm.id::text = z.membership_id
            LEFT JOIN customers cu ON cu.tenant_id = cm.tenant_id AND cu.id = cm.customer_id
            LEFT JOIN tickets tk ON tk.tenant_id = ${t}::uuid AND tk.id::text = z.ticket_id`.execute(tx)).rows;
      });
      const rows = out.slice(0, limit).map((r): SystemCheckSourceRow => ({ membershipId: String(r.membership_id), memberNumber: r.member_number ?? null, customerName: r.customer_name ?? null,
        source: r.source, sourceId: r.source_id ?? null, ticketId: r.ticket_id ?? null, ticketNumber: r.ticket_number ?? null,
        amountCents: r.amount_cents == null ? null : Number(r.amount_cents), at: r.at ? new Date(r.at).toISOString() : null, detail: r.detail ?? null }));
      return { ...base, available: true, rows, truncated: out.length > limit };
    } catch (e) {
      log.warn(`${domain}.${key} rows could not run: ${String((e as Error)?.message ?? e).slice(0, 200)}`);
      return { ...base, available: false, rows: [], truncated: false };
    }
  }
}

/** an unknown check key for the domain (the route answers 404 with RESOURCE_NOT_FOUND) */
export class SystemCheckNotFound extends Error { readonly code = 'RESOURCE_NOT_FOUND'; constructor() { super('That check was not found.'); } }
