// operations-expiry.repository.ts — BUILD_PLAN Phase 12 (Constitution 5 §33): the 24 h expiry sweep over api_operations.
// Cross-salon BY DESIGN: the api.operations.expire tick deletes every salon's expired result files and marks those rows
// `expired`; it returns counts only and no HTTP path reaches it. Kept apart from operations.repository.ts (whose every
// query names the salon) so the tenant-isolation baseline covers exactly this.
import { sql } from 'kysely';
import { canMoveToSql } from '@aipowersalon/database';
import { API_OPERATION } from './operation-lifecycle';

export class OperationsExpiryRepository {
  constructor(private readonly db: any) {}
  /** Successes past their time (oldest first). */
  async dueForExpiry(limit = 200): Promise<Array<{ id: string; result_key: string | null }>> {
    const r: any = await sql`select id, result_key from api_operations where status = 'succeeded' and expires_at <= now()
      order by expires_at limit ${limit}`.execute(this.db);
    return r.rows;
  }
  async markExpired(id: string): Promise<boolean> {
    const r: any = await sql`update api_operations set status = 'expired', result_key = null, updated_at = now()
      where id = ${id} and status = 'succeeded' and ${canMoveToSql(API_OPERATION, 'expired')} and expires_at <= now() returning id`.execute(this.db);
    return r.rows.length === 1;
  }
}
