// deposit-reconciliation.kysely.repository.ts — Postgres adapter. Tenant scoping is server-derived from ctx and
// applied to EVERY query. Settlements are read from the existing payment_settlements table; the bank layer uses
// the new bank_accounts / bank_deposits tables. Raw sql keeps us independent of generated table types.
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { ReconContext, Settlement, BankAccount, BankDeposit } from './deposit-reconciliation.dto';
import type { ReconRepositoryPort, CreateBankAccountInput, CreateDepositInput } from './deposit-reconciliation.repository';

const iso = (v: any): string | null => (v == null ? null : (typeof v === 'string' ? v : new Date(v).toISOString()));
const dateStr = (v: any): string | null => (v == null ? null : (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)));

function settlement(r: any): Settlement {
  return { id: String(r.id), branchId: r.branch_id ? String(r.branch_id) : null, processorType: r.processor_type ?? null, settlementRef: r.settlement_id ?? null, grossCents: Number(r.gross_cents || 0), feeCents: Number(r.fee_cents || 0), netCents: Number(r.net_cents || 0), currency: String(r.currency || 'USD'), status: String(r.status || 'settled'), settledAt: iso(r.settled_at) };
}
function account(r: any): BankAccount {
  return { id: String(r.id), nickname: String(r.nickname), bankName: r.bank_name ?? null, accountType: String(r.account_type || 'checking'), accountLast4: r.account_last4 ?? null, currency: String(r.currency || 'USD'), status: String(r.status || 'active') };
}
function deposit(r: any): BankDeposit {
  return { id: String(r.id), branchId: r.branch_id ? String(r.branch_id) : null, bankAccountId: String(r.bank_account_id), amountCents: Number(r.amount_cents || 0), currency: String(r.currency || 'USD'), depositDate: dateStr(r.deposit_date), postedAt: iso(r.posted_at), description: r.description ?? null, reference: r.reference ?? null, externalBankTxnId: r.external_bank_txn_id ?? null, source: String(r.source || 'manual'), status: String(r.status || 'posted'), matchedSettlementId: r.matched_settlement_id ? String(r.matched_settlement_id) : null, reconciliationStatus: String(r.reconciliation_status || 'unmatched') };
}

export class KyselyReconRepository implements ReconRepositoryPort {
  constructor(private readonly db: Kysely<DB>) {}

  async listSettlements(ctx: ReconContext): Promise<Settlement[]> {
    const res: any = await sql`
      SELECT id, branch_id, processor_type, settlement_id, gross_cents, fee_cents, net_cents, currency, status, settled_at
      FROM payment_settlements WHERE tenant_id = ${ctx.tenantId}
      ORDER BY settled_at DESC NULLS LAST LIMIT 1000
    `.execute(this.db as any).catch(() => ({ rows: [] }));
    return (res.rows ?? []).map(settlement);
  }
  async listBankAccounts(ctx: ReconContext): Promise<BankAccount[]> {
    const res: any = await sql`SELECT id, nickname, bank_name, account_type, account_last4, currency, status FROM bank_accounts WHERE tenant_id = ${ctx.tenantId} ORDER BY created_at DESC`.execute(this.db as any).catch(() => ({ rows: [] }));
    return (res.rows ?? []).map(account);
  }
  async createBankAccount(ctx: ReconContext, input: CreateBankAccountInput): Promise<BankAccount> {
    const res: any = await sql`
      INSERT INTO bank_accounts (tenant_id, nickname, bank_name, account_type, account_last4, currency)
      VALUES (${ctx.tenantId}, ${input.nickname}, ${input.bankName ?? null}, ${input.accountType || 'checking'}, ${input.accountLast4 ?? null}, ${input.currency || 'USD'})
      RETURNING id, nickname, bank_name, account_type, account_last4, currency, status
    `.execute(this.db as any);
    return account(res.rows[0]);
  }
  async listDeposits(ctx: ReconContext): Promise<BankDeposit[]> {
    const res: any = await sql`
      SELECT id, branch_id, bank_account_id, amount_cents, currency, deposit_date, posted_at, description, reference, external_bank_txn_id, source, status, matched_settlement_id, reconciliation_status
      FROM bank_deposits WHERE tenant_id = ${ctx.tenantId} ORDER BY deposit_date DESC NULLS LAST, created_at DESC LIMIT 1000
    `.execute(this.db as any).catch(() => ({ rows: [] }));
    return (res.rows ?? []).map(deposit);
  }
  async createDeposit(ctx: ReconContext, input: CreateDepositInput): Promise<BankDeposit> {
    const res: any = await sql`
      INSERT INTO bank_deposits (tenant_id, branch_id, bank_account_id, amount_cents, currency, deposit_date, description, reference, external_bank_txn_id, source, status)
      VALUES (${ctx.tenantId}, ${input.branchId ?? null}, ${input.bankAccountId}, ${Number(input.amountCents)}, ${input.currency || 'USD'}, ${input.depositDate ?? null}, ${input.description ?? null}, ${input.reference ?? null}, ${input.externalBankTxnId ?? null}, ${input.source || 'manual'}, ${input.status || 'posted'})
      RETURNING id, branch_id, bank_account_id, amount_cents, currency, deposit_date, posted_at, description, reference, external_bank_txn_id, source, status, matched_settlement_id, reconciliation_status
    `.execute(this.db as any);
    return deposit(res.rows[0]);
  }
  async findDeposit(ctx: ReconContext, id: string): Promise<BankDeposit | null> {
    const res: any = await sql`SELECT id, branch_id, bank_account_id, amount_cents, currency, deposit_date, posted_at, description, reference, external_bank_txn_id, source, status, matched_settlement_id, reconciliation_status FROM bank_deposits WHERE tenant_id = ${ctx.tenantId} AND id = ${id} LIMIT 1`.execute(this.db as any).catch(() => ({ rows: [] }));
    return res.rows?.[0] ? deposit(res.rows[0]) : null;
  }
  async findSettlement(ctx: ReconContext, id: string): Promise<Settlement | null> {
    const res: any = await sql`SELECT id, branch_id, processor_type, settlement_id, gross_cents, fee_cents, net_cents, currency, status, settled_at FROM payment_settlements WHERE tenant_id = ${ctx.tenantId} AND id = ${id} LIMIT 1`.execute(this.db as any).catch(() => ({ rows: [] }));
    return res.rows?.[0] ? settlement(res.rows[0]) : null;
  }
  async linkDeposit(ctx: ReconContext, depositId: string, settlementId: string | null, reconciliationStatus: string): Promise<BankDeposit | null> {
    const res: any = await sql`
      UPDATE bank_deposits SET matched_settlement_id = ${settlementId}, reconciliation_status = ${reconciliationStatus}, updated_at = now()
      WHERE tenant_id = ${ctx.tenantId} AND id = ${depositId}
      RETURNING id, branch_id, bank_account_id, amount_cents, currency, deposit_date, posted_at, description, reference, external_bank_txn_id, source, status, matched_settlement_id, reconciliation_status
    `.execute(this.db as any).catch(() => ({ rows: [] }));
    return res.rows?.[0] ? deposit(res.rows[0]) : null;
  }
}
