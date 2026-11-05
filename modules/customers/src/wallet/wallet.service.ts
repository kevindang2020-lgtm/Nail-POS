// wallet.service.ts — store-credit posting service. Validates amounts, enforces idempotency (a repeated idempotency key
// returns the existing posting instead of double-posting), applies the sign by direction, and never allows a debit to
// overdraw the balance. Tenant + customer scoped. Pure rules live in wallet-ledger.ts.
import { isPostableAmount, WalletError, type WalletEntry, type WalletEntryType, type WalletState, CREDIT_TYPES } from './wallet-ledger';
import type { WalletLedgerPort } from './wallet.repository';

export interface CreditInput { amountCents: number; type?: Extract<WalletEntryType, 'top_up' | 'refund' | 'promo' | 'adjustment'>; currency?: string; reference?: string | null; idempotencyKey?: string | null; createdByUserId?: string | null }
export interface DebitInput { amountCents: number; type?: Extract<WalletEntryType, 'payment' | 'adjustment'>; currency?: string; reference?: string | null; idempotencyKey?: string | null; createdByUserId?: string | null }
const TX_LIMIT = 100;

export class WalletLedgerService {
  constructor(private readonly repo: WalletLedgerPort) {}

  async resolveCustomerId(tenantId: string, userId: string): Promise<string | null> { return this.repo.resolveCustomerId(tenantId, userId); }

  async getWallet(tenantId: string, customerId: string, currency = 'USD'): Promise<WalletState> {
    const [balanceCents, transactions] = await Promise.all([this.repo.balance(tenantId, customerId), this.repo.transactions(tenantId, customerId, TX_LIMIT)]);
    return { balanceCents, currency, transactions };
  }

  /** Add store credit (e.g. a funded top-up, a refund-to-wallet, a promo). Idempotent on idempotencyKey. */
  async credit(tenantId: string, customerId: string, input: CreditInput): Promise<WalletEntry> {
    if (!isPostableAmount(input.amountCents)) throw new WalletError('invalid_amount', 'Amount must be a positive whole number of cents.');
    const type = input.type ?? 'top_up';
    if (input.idempotencyKey) { const existing = await this.repo.findByIdempotencyKey(tenantId, input.idempotencyKey); if (existing) return existing; }
    return this.repo.insertEntry({ tenantId, customerId, amountCents: Math.abs(input.amountCents), entryType: type, currency: input.currency ?? 'USD', reference: input.reference, idempotencyKey: input.idempotencyKey, createdByUserId: input.createdByUserId });
  }

  /** Spend store credit (e.g. paying for a ticket). Atomic; throws insufficient_funds rather than overdrawing. Idempotent. */
  async debit(tenantId: string, customerId: string, input: DebitInput): Promise<WalletEntry> {
    if (!isPostableAmount(input.amountCents)) throw new WalletError('invalid_amount', 'Amount must be a positive whole number of cents.');
    const type = input.type ?? 'payment';
    if (input.idempotencyKey) { const existing = await this.repo.findByIdempotencyKey(tenantId, input.idempotencyKey); if (existing) return existing; }
    const res = await this.repo.postDebitAtomic({ tenantId, customerId, amountCents: -Math.abs(input.amountCents), entryType: type, currency: input.currency ?? 'USD', reference: input.reference, idempotencyKey: input.idempotencyKey, createdByUserId: input.createdByUserId });
    if (!res.ok) throw new WalletError('insufficient_funds', 'Insufficient store credit for this amount.');
    return res.entry;
  }
}
// re-export CREDIT_TYPES so consumers don't need to import the core directly
export { CREDIT_TYPES };
