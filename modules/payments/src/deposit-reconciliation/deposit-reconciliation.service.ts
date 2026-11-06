// deposit-reconciliation.service.ts — orchestrates the reconciliation overview and the human-controlled write
// actions. The matching itself is the pure engine in the DTO; this layer adds auth, validation, and the
// deliberate rule that LINKING a deposit to a settlement is a human action (reconciliation.manage) — nothing
// here moves money, issues refunds, or auto-resolves a discrepancy.
import {
  buildReconState, expectedDepositCents, validateBankAccount, validateDeposit, sanitizeLast4, DEFAULT_RECON_OPTIONS,
  type ReconContext, type ReconState, type BankAccount, type BankDeposit, type ReconOptions,
} from './deposit-reconciliation.dto';
import type { ReconRepositoryPort, CreateBankAccountInput, CreateDepositInput } from './deposit-reconciliation.repository';
import { withCode, ERROR_REGISTRY, isRegisteredCode } from '@aipowersalon/api-contracts';   // V-5: a refusal's registry code beside its English

export class ReconForbiddenError extends Error {}
export class ReconValidationError extends Error {}
/** §74: the HTTP status for a reconciliation refusal — the registry's status for its code (a foreign or unknown
 *  case id → RECON_CASE_NOT_FOUND 404), else 403 / 400 by class; null when `e` is not a reconciliation refusal. */
export function reconRefusalStatus(e: unknown): number | null {
  if (!(e instanceof ReconForbiddenError) && !(e instanceof ReconValidationError)) return null;
  const code = (e as { apiCode?: unknown }).apiCode;
  if (isRegisteredCode(code)) return ERROR_REGISTRY[code].status;
  return e instanceof ReconForbiddenError ? 403 : 400;
}

export class DepositReconciliationService {
  constructor(private readonly repo: ReconRepositoryPort) {}

  private auth(ctx: ReconContext) { if (!ctx?.userId || !ctx?.tenantId) throw new ReconForbiddenError('Not authenticated'); }
  private options(): ReconOptions { return { ...DEFAULT_RECON_OPTIONS, nowIso: new Date().toISOString() }; }

  async getState(ctx: ReconContext): Promise<ReconState & { accounts: BankAccount[] }> {
    this.auth(ctx);
    const [settlements, deposits, accounts] = await Promise.all([this.repo.listSettlements(ctx), this.repo.listDeposits(ctx), this.repo.listBankAccounts(ctx)]);
    // Reconcile only deposits not already manually matched to a different settlement stay in the pool; the pure
    // engine still recomputes deterministically so the view is always consistent with current data.
    const state = buildReconState(settlements, deposits, this.options());
    return { ...state, accounts };
  }

  async listBankAccounts(ctx: ReconContext): Promise<BankAccount[]> { this.auth(ctx); return this.repo.listBankAccounts(ctx); }

  async createBankAccount(ctx: ReconContext, input: CreateBankAccountInput): Promise<BankAccount> {
    this.auth(ctx);
    const v = validateBankAccount(input);
    if (!v.ok) throw new ReconValidationError(v.error || 'Invalid bank account');
    // Security: only ever persist last4 — never a full account number (repo/migration enforce this too).
    return this.repo.createBankAccount(ctx, { nickname: String(input.nickname).trim(), bankName: input.bankName ?? null, accountType: input.accountType || 'checking', accountLast4: sanitizeLast4(input.accountLast4), currency: input.currency || 'USD' });
  }

  async listDeposits(ctx: ReconContext): Promise<BankDeposit[]> { this.auth(ctx); return this.repo.listDeposits(ctx); }

  async createDeposit(ctx: ReconContext, input: CreateDepositInput): Promise<BankDeposit> {
    this.auth(ctx);
    const v = validateDeposit(input);
    if (!v.ok) throw new ReconValidationError(v.error || 'Invalid deposit');
    // the bank account must belong to this tenant
    const accounts = await this.repo.listBankAccounts(ctx);
    if (!accounts.some((a) => a.id === input.bankAccountId)) throw withCode(new ReconValidationError('Bank account not found'), 'BANK_ACCOUNT_NOT_FOUND');
    return this.repo.createDeposit(ctx, { ...input, amountCents: Math.round(Number(input.amountCents)) });
  }

  // Human action: confirm (or clear) the link between a bank deposit and a settlement. Both must belong to the
  // tenant. The reconciliation status is derived deterministically from the amounts — never fabricated.
  async linkDeposit(ctx: ReconContext, depositId: string, settlementId: string | null): Promise<BankDeposit> {
    this.auth(ctx);
    const deposit = await this.repo.findDeposit(ctx, depositId);
    if (!deposit) throw withCode(new ReconValidationError('Deposit not found'), 'BANK_DEPOSIT_NOT_FOUND');
    if (settlementId == null) {
      const cleared = await this.repo.linkDeposit(ctx, depositId, null, 'unmatched');
      if (!cleared) throw withCode(new ReconValidationError('Deposit not found'), 'BANK_DEPOSIT_NOT_FOUND');
      return cleared;
    }
    const settlement = await this.repo.findSettlement(ctx, settlementId);
    if (!settlement) throw withCode(new ReconValidationError('Settlement not found'), 'SETTLEMENT_NOT_FOUND');
    const expected = expectedDepositCents(settlement);
    const status = deposit.amountCents === expected ? 'matched' : 'matched_with_tolerance';
    const linked = await this.repo.linkDeposit(ctx, depositId, settlementId, status);
    if (!linked) throw withCode(new ReconValidationError('Deposit not found'), 'BANK_DEPOSIT_NOT_FOUND');
    return linked;
  }
}
