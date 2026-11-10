// system-checks.service.ts — runs one page's read-only checks (system-checks.registry.ts). Each check runs on its own, in a
// read-only transaction with a short statement timeout, so one slow or failing query never hides the others: it reports
// NOT_TESTED (never a pass). Nothing is written and no row data leaves the database — only counts.
import { Logger } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { SystemCheckDomain, SystemCheckItem, SystemCheckResult } from '@aipowersalon/api-contracts/tenant';
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
}
