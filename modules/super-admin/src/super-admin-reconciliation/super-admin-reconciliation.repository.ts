// super-admin-reconciliation.repository.ts — PLATFORM-LEVEL aggregates for reconciliation oversight. Returns
// COUNTS and operational rollups across all tenants ONLY — never tenant bank-deposit amounts, settlement
// details, or merchant IDs (spec: super admin must not freely view tenant financial data). In-memory for tests.
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DB } from '@aipowersalon/database';

export interface ReconOversight {
  tenantsWithBankAccounts: number;
  bankAccounts: number;
  bankDeposits: number;
  feeSchedules: number;
  exceptionsByStatus: Record<string, number>;
  criticalOpen: number;
  periods: number;
  periodsClosed: number;
  aiExplainRuns: number;
  aiErrors: number;
}

export interface SuperAdminReconRepositoryPort { overview(): Promise<ReconOversight> }

export class InMemorySuperAdminReconRepository implements SuperAdminReconRepositoryPort {
  constructor(private seed: Partial<ReconOversight> = {}) {}
  async overview(): Promise<ReconOversight> {
    return { tenantsWithBankAccounts: 0, bankAccounts: 0, bankDeposits: 0, feeSchedules: 0, exceptionsByStatus: {}, criticalOpen: 0, periods: 0, periodsClosed: 0, aiExplainRuns: 0, aiErrors: 0, ...this.seed };
  }
}

const num = (res: any): number => Number(res?.rows?.[0]?.n || 0);

export class KyselySuperAdminReconRepository implements SuperAdminReconRepositoryPort {
  constructor(private readonly db: Kysely<DB>) {}
  async overview(): Promise<ReconOversight> {
    const q = (s: any) => s.execute(this.db).catch(() => ({ rows: [] }));
    const [tenants, accounts, deposits, schedules, excByStatus, critical, periods, periodsClosed, aiRuns, aiErr] = await Promise.all([
      q(sql`SELECT COUNT(DISTINCT tenant_id)::int AS n FROM bank_accounts`),
      q(sql`SELECT COUNT(*)::int AS n FROM bank_accounts`),
      q(sql`SELECT COUNT(*)::int AS n FROM bank_deposits`),
      q(sql`SELECT COUNT(*)::int AS n FROM fee_schedules`),
      q(sql`SELECT status, COUNT(*)::int AS n FROM reconciliation_exceptions GROUP BY status`),
      q(sql`SELECT COUNT(*)::int AS n FROM reconciliation_exceptions WHERE severity = 'critical' AND status <> 'resolved'`),
      q(sql`SELECT COUNT(*)::int AS n FROM reconciliation_periods`),
      q(sql`SELECT COUNT(*)::int AS n FROM reconciliation_periods WHERE status = 'closed'`),
      q(sql`SELECT COUNT(*)::int AS n FROM ai_usage_logs WHERE package_code = 'deposit_reconciliation'`),
      q(sql`SELECT COUNT(*)::int AS n FROM ai_usage_logs WHERE package_code = 'deposit_reconciliation' AND status = 'provider_error'`),
    ]);
    const exceptionsByStatus: Record<string, number> = {};
    for (const r of excByStatus.rows ?? []) exceptionsByStatus[String(r.status)] = Number(r.n || 0);
    return { tenantsWithBankAccounts: num(tenants), bankAccounts: num(accounts), bankDeposits: num(deposits), feeSchedules: num(schedules), exceptionsByStatus, criticalOpen: num(critical), periods: num(periods), periodsClosed: num(periodsClosed), aiExplainRuns: num(aiRuns), aiErrors: num(aiErr) };
  }
}
