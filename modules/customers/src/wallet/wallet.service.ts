// wallet.service.ts — store-credit posting service. Validates amounts, enforces idempotency (a repeated idempotency key
// returns the existing posting instead of double-posting), applies the sign by direction, and never allows a debit to
// overdraw the balance. Tenant + customer scoped. Pure rules live in wallet-ledger.ts.
import { isPostableAmount, WalletError, type WalletEntry, type WalletEntryType, type WalletState, CREDIT_TYPES } from './wallet-ledger';
import type { WalletLedgerPort } from './wallet.repository';

export interface CreditInput { amountCents: number; type?: Extract<WalletEntryType, 'top_up' | 'refund' | 'promo' | 'adjustment'>; currency?: string; reference?: string | null; idempotencyKey?: string | null; createdByUserId?: string | null }
export interface DebitInput { amountCents: number; type?: Extract<WalletEntryType, 'payment' | 'adjustment'>; currency?: string; reference?: string | null; idempotencyKey?: string | null; createdByUserId?: string | null }
const TX_LIMIT = 100;
/** PostgreSQL 23505 (or the in-memory adapter's equivalent message). */
const isUniqueViolation = (e: unknown): boolean => {
  const err = e as { code?: unknown; message?: unknown } | null;
  return err?.code === '23505' || /duplicate key|unique constraint/i.test(String(err?.message ?? e));
};

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
    try {
      return await this.repo.insertEntry({ tenantId, customerId, amountCents: Math.abs(input.amountCents), entryType: type, currency: input.currency ?? 'USD', reference: input.reference, idempotencyKey: input.idempotencyKey, createdByUserId: input.createdByUserId });
    } catch (e) {
      // B-79 race (Oct 23 2026, found by the real-Postgres top-up race test): two settlers both passed the check above and
      // the unique (tenant_id, idempotency_key) index let exactly one insert win. The loser is the SAME posting — answer
      // with it instead of a raw unique-violation 500.
      const winner = await this.afterIdempotencyRace(tenantId, input.idempotencyKey, e);
      if (winner) return winner;
      throw e;
    }
  }
  private async afterIdempotencyRace(tenantId: string, key: string | null | undefined, e: unknown): Promise<WalletEntry | null> {
    if (!key || !isUniqueViolation(e)) return null;
    return this.repo.findByIdempotencyKey(tenantId, key);
  }

  /** Spend store credit (e.g. paying for a ticket). Atomic; throws insufficient_funds rather than overdrawing. Idempotent. */
  async debit(tenantId: string, customerId: string, input: DebitInput): Promise<WalletEntry> {
    if (!isPostableAmount(input.amountCents)) throw new WalletError('invalid_amount', 'Amount must be a positive whole number of cents.');
    const type = input.type ?? 'payment';
    if (input.idempotencyKey) { const existing = await this.repo.findByIdempotencyKey(tenantId, input.idempotencyKey); if (existing) return existing; }
    let res: Awaited<ReturnType<WalletLedgerPort['postDebitAtomic']>>;
    try { res = await this.repo.postDebitAtomic({ tenantId, customerId, amountCents: -Math.abs(input.amountCents), entryType: type, currency: input.currency ?? 'USD', reference: input.reference, idempotencyKey: input.idempotencyKey, createdByUserId: input.createdByUserId });
    } catch (e) { const winner = await this.afterIdempotencyRace(tenantId, input.idempotencyKey, e); if (winner) return winner; throw e; }
    if (!res.ok) throw new WalletError('insufficient_funds', 'Insufficient store credit for this amount.');
    return res.entry;
  }
}
// re-export CREDIT_TYPES so consumers don't need to import the core directly
export { CREDIT_TYPES };
