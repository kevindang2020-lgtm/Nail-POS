// wallet.repository.ts — data port for the wallet ledger + an in-memory adapter (used by tests and DB-less deploys).
// The Kysely adapter is the production implementation. The service owns validation/idempotency; the port does I/O only.
import { computeBalance, type WalletEntry } from './wallet-ledger';

export interface InsertWalletEntry {
  tenantId: string; customerId: string; amountCents: number; entryType: string; currency: string;
  reference?: string | null; idempotencyKey?: string | null; createdByUserId?: string | null;
}
export interface WalletLedgerPort {
  resolveCustomerId(tenantId: string, userId: string): Promise<string | null>;
  balance(tenantId: string, customerId: string): Promise<number>;
  transactions(tenantId: string, customerId: string, limit: number): Promise<WalletEntry[]>;
  findByIdempotencyKey(tenantId: string, key: string): Promise<WalletEntry | null>;
  insertEntry(e: InsertWalletEntry): Promise<WalletEntry>;
  /** Atomic debit: serialize per (tenant,customer), re-check balance against committed rows, then insert the negative
   *  entry. Returns ok:false (with the current balance) instead of posting when funds are insufficient. */
  postDebitAtomic(e: InsertWalletEntry): Promise<{ ok: true; entry: WalletEntry } | { ok: false; balanceCents: number }>;
}

export class InMemoryWalletLedgerRepository implements WalletLedgerPort {
  private rows: (WalletEntry & { tenantId: string; customerId: string; idempotencyKey: string | null })[] = [];
  private seq = 0;
  async resolveCustomerId(): Promise<string | null> { return null; } // no customer↔user link without a DB
  private of(tenantId: string, customerId: string) { return this.rows.filter((r) => r.tenantId === tenantId && r.customerId === customerId); }
  async balance(tenantId: string, customerId: string): Promise<number> { return computeBalance(this.of(tenantId, customerId)); }
  async transactions(tenantId: string, customerId: string, limit: number): Promise<WalletEntry[]> {
    return this.of(tenantId, customerId).slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, limit)
      .map(({ id, amountCents, type, currency, reference, createdAt }) => ({ id, amountCents, type, currency, reference, createdAt }));
  }
  async findByIdempotencyKey(tenantId: string, key: string): Promise<WalletEntry | null> {
    const r = this.rows.find((x) => x.tenantId === tenantId && x.idempotencyKey === key);
    return r ? { id: r.id, amountCents: r.amountCents, type: r.type, currency: r.currency, reference: r.reference, createdAt: r.createdAt } : null;
  }
  async insertEntry(e: InsertWalletEntry): Promise<WalletEntry> {
    const row = { id: `mem_${++this.seq}`, tenantId: e.tenantId, customerId: e.customerId, amountCents: Math.trunc(e.amountCents), type: e.entryType, currency: e.currency, reference: e.reference ?? null, idempotencyKey: e.idempotencyKey ?? null, createdAt: new Date(Date.now() + this.seq).toISOString() };
    this.rows.push(row);
    return { id: row.id, amountCents: row.amountCents, type: row.type, currency: row.currency, reference: row.reference, createdAt: row.createdAt };
  }
  async postDebitAtomic(e: InsertWalletEntry): Promise<{ ok: true; entry: WalletEntry } | { ok: false; balanceCents: number }> {
    const bal = await this.balance(e.tenantId, e.customerId);
    if (bal + e.amountCents < 0) return { ok: false, balanceCents: bal }; // e.amountCents is negative for a debit
    return { ok: true, entry: await this.insertEntry(e) };
  }
}
