// deposit-reconciliation.sweep.repository.ts — cross-tenant helper for the background sweep: which tenants have
// reconciliation activity worth scanning. Read-only, counts/ids only.
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DB } from '@aipowersalon/database';

export interface SweepRepositoryPort { listActiveTenantIds(): Promise<string[]> }

export class InMemorySweepRepository implements SweepRepositoryPort {
  constructor(private ids: string[] = []) {}
  async listActiveTenantIds(): Promise<string[]> { return this.ids.slice(); }
}

export class KyselySweepRepository implements SweepRepositoryPort {
  constructor(private readonly db: Kysely<DB>) {}
  async listActiveTenantIds(): Promise<string[]> {
    const res: any = await sql`
      SELECT DISTINCT tenant_id FROM (
        SELECT tenant_id FROM payment_settlements
        UNION SELECT tenant_id FROM bank_deposits
      ) t
    `.execute(this.db).catch(() => ({ rows: [] }));
    return (res.rows ?? []).map((r: any) => String(r.tenant_id));
  }
}
