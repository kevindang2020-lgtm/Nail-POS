// deposit-reconciliation.repository.ts — repository port + in-memory adapter. Every method is tenant-scoped;
// the in-memory adapter is used for dev/offline/tests. Settlements are READ from the existing
// payment_settlements domain (not duplicated).
import type { ReconContext, Settlement, BankAccount, BankDeposit } from './deposit-reconciliation.dto';

export interface CreateBankAccountInput { nickname: string; bankName?: string | null; accountType?: string; accountLast4?: string | null; currency?: string }
export interface CreateDepositInput { bankAccountId: string; branchId?: string | null; amountCents: number; currency?: string; depositDate?: string | null; description?: string | null; reference?: string | null; externalBankTxnId?: string | null; source?: string; status?: string }

export interface ReconRepositoryPort {
  listSettlements(ctx: ReconContext): Promise<Settlement[]>;
  listBankAccounts(ctx: ReconContext): Promise<BankAccount[]>;
  createBankAccount(ctx: ReconContext, input: CreateBankAccountInput): Promise<BankAccount>;
  listDeposits(ctx: ReconContext): Promise<BankDeposit[]>;
  createDeposit(ctx: ReconContext, input: CreateDepositInput): Promise<BankDeposit>;
  findDeposit(ctx: ReconContext, id: string): Promise<BankDeposit | null>;
  findSettlement(ctx: ReconContext, id: string): Promise<Settlement | null>;
  linkDeposit(ctx: ReconContext, depositId: string, settlementId: string | null, reconciliationStatus: string): Promise<BankDeposit | null>;
}

export class InMemoryReconRepository implements ReconRepositoryPort {
  private accounts: (BankAccount & { tenantId: string })[] = [];
  private deposits: (BankDeposit & { tenantId: string })[] = [];
  private settlements: (Settlement & { tenantId: string })[] = [];
  constructor(seed: { settlements?: (Settlement & { tenantId: string })[]; accounts?: (BankAccount & { tenantId: string })[]; deposits?: (BankDeposit & { tenantId: string })[] } = {}) {
    this.settlements = (seed.settlements || []).slice();
    this.accounts = (seed.accounts || []).slice();
    this.deposits = (seed.deposits || []).slice();
  }
  async listSettlements(ctx: ReconContext): Promise<Settlement[]> { return this.settlements.filter((x) => x.tenantId === ctx.tenantId).map(strip); }
  async listBankAccounts(ctx: ReconContext): Promise<BankAccount[]> { return this.accounts.filter((x) => x.tenantId === ctx.tenantId).map(strip); }
  async createBankAccount(ctx: ReconContext, input: CreateBankAccountInput): Promise<BankAccount> {
    const row = { tenantId: ctx.tenantId, id: 'bank_' + (this.accounts.length + 1), nickname: input.nickname, bankName: input.bankName ?? null, accountType: input.accountType || 'checking', accountLast4: input.accountLast4 ?? null, currency: input.currency || 'USD', status: 'active' };
    this.accounts.push(row); return strip(row);
  }
  async listDeposits(ctx: ReconContext): Promise<BankDeposit[]> { return this.deposits.filter((x) => x.tenantId === ctx.tenantId).map(strip); }
  async createDeposit(ctx: ReconContext, input: CreateDepositInput): Promise<BankDeposit> {
    const row = { tenantId: ctx.tenantId, id: 'dep_' + (this.deposits.length + 1), branchId: input.branchId ?? null, bankAccountId: input.bankAccountId, amountCents: Number(input.amountCents), currency: input.currency || 'USD', depositDate: input.depositDate ?? null, postedAt: null, description: input.description ?? null, reference: input.reference ?? null, externalBankTxnId: input.externalBankTxnId ?? null, source: input.source || 'manual', status: input.status || 'posted', matchedSettlementId: null, reconciliationStatus: 'unmatched' };
    this.deposits.push(row); return strip(row);
  }
  async findDeposit(ctx: ReconContext, id: string): Promise<BankDeposit | null> { const r = this.deposits.find((x) => x.tenantId === ctx.tenantId && x.id === id); return r ? strip(r) : null; }
  async findSettlement(ctx: ReconContext, id: string): Promise<Settlement | null> { const r = this.settlements.find((x) => x.tenantId === ctx.tenantId && x.id === id); return r ? strip(r) : null; }
  async linkDeposit(ctx: ReconContext, depositId: string, settlementId: string | null, reconciliationStatus: string): Promise<BankDeposit | null> {
    const r = this.deposits.find((x) => x.tenantId === ctx.tenantId && x.id === depositId); if (!r) return null;
    r.matchedSettlementId = settlementId; r.reconciliationStatus = reconciliationStatus; return strip(r);
  }
}
function strip<T extends { tenantId?: string }>(r: T): Omit<T, 'tenantId'> { const { tenantId, ...rest } = r as any; return rest; }
