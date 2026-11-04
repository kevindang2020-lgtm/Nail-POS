// deposit-reconciliation.sweep.repository.ts — cross-tenant helper for the background sweep: which tenants have
// reconciliation activity worth scanning. Read-only, counts/ids only.
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DB } from '@aipowersalon/database';

export interface SweepRepositoryPort {
  listActiveTenantIds(): Promise<string[]>;
  /** Deposit Recon guide audit (Nov 4 2026): per settlement, what the reconciliation WORKSPACE already allocated to it (person-made
   *  matches) and its provider status — the sweep must not call a payout "missing" that a person matched, or that never paid out */
  workspaceState?(tenantId: string): Promise<Map<string, { allocatedCents: number; status: string }>>;
}

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
  async workspaceState(tenantId: string): Promise<Map<string, { allocatedCents: number; status: string }>> {
    const res: any = await sql`
      SELECT s.id::text AS id, s.status, COALESCE((SELECT SUM(a.amount_cents) FROM reconciliation_allocations a
        WHERE a.tenant_id = s.tenant_id AND a.settlement_id = s.id AND a.unmatched_at IS NULL), 0)::bigint AS allocated
      FROM payment_settlements s WHERE s.tenant_id = ${tenantId}
    `.execute(this.db);
    return new Map((res.rows ?? []).map((r: any) => [String(r.id), { allocatedCents: Number(r.allocated), status: String(r.status ?? '') }]));
  }
}
