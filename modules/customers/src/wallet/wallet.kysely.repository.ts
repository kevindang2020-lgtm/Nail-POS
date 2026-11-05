// wallet.kysely.repository.ts — Postgres adapter for the wallet ledger. Append-only inserts; balance = SUM(amount_cents).
// Tenant-scoped on every query. Resolves the customer from the session via customers.user_id. Debits use an advisory
// lock + re-sum so a concurrent debit can't overspend.
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { WalletLedgerPort, InsertWalletEntry } from './wallet.repository';
import type { WalletEntry } from './wallet-ledger';

const iso = (v: unknown): string => (v == null ? '' : v instanceof Date ? v.toISOString() : new Date(v as string).toISOString());
const toEntry = (r: any): WalletEntry => ({ id: r.id, amountCents: Number(r.amount_cents), type: r.entry_type, currency: r.currency, reference: r.reference ?? null, createdAt: iso(r.created_at) });

export class KyselyWalletLedgerRepository implements WalletLedgerPort {
  constructor(private readonly db: Kysely<DB>) {}

  async resolveCustomerId(tenantId: string, userId: string): Promise<string | null> {
    const row = await this.db.selectFrom('customers').select('id')
      .where('user_id', '=', userId).where('archived_at', 'is', null).executeTakeFirst();
    return (row as any)?.id ?? null;
  }

  async balance(tenantId: string, customerId: string): Promise<number> {
    const row = await this.db.selectFrom('customer_wallet_ledger').select((eb) => eb.fn.sum<string>('amount_cents').as('s'))
      .where('customer_id', '=', customerId).executeTakeFirst();
    return Number((row as any)?.s ?? 0);
  }

  async transactions(tenantId: string, customerId: string, limit: number): Promise<WalletEntry[]> {
    const rows = await this.db.selectFrom('customer_wallet_ledger').select(['id', 'amount_cents', 'entry_type', 'currency', 'reference', 'created_at'])
      .where('customer_id', '=', customerId).orderBy('created_at', 'desc').limit(limit).execute();
    return (rows as any[]).map(toEntry);
  }

  async findByIdempotencyKey(tenantId: string, key: string): Promise<WalletEntry | null> {
    const row = await this.db.selectFrom('customer_wallet_ledger').select(['id', 'amount_cents', 'entry_type', 'currency', 'reference', 'created_at'])
      .where('tenant_id', '=', tenantId).where('idempotency_key', '=', key).executeTakeFirst();
    return row ? toEntry(row) : null;
  }

  private values(e: InsertWalletEntry) {
    return { tenant_id: e.tenantId, customer_id: e.customerId, amount_cents: Math.trunc(e.amountCents), entry_type: e.entryType, currency: e.currency, reference: e.reference ?? null, idempotency_key: e.idempotencyKey ?? null, created_by_user_id: e.createdByUserId ?? null } as any;
  }

  async insertEntry(e: InsertWalletEntry): Promise<WalletEntry> {
    const row = await this.db.insertInto('customer_wallet_ledger').values(this.values(e))
      .returning(['id', 'amount_cents', 'entry_type', 'currency', 'reference', 'created_at']).executeTakeFirstOrThrow();
    return toEntry(row);
  }

  async postDebitAtomic(e: InsertWalletEntry): Promise<{ ok: true; entry: WalletEntry } | { ok: false; balanceCents: number }> {
    return this.db.transaction().execute(async (trx) => {
      const key = `${e.tenantId}|${e.customerId}|wallet`;
      await sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`.execute(trx);
      const bal = await trx.selectFrom('customer_wallet_ledger').select((eb) => eb.fn.sum<string>('amount_cents').as('s'))
        .where('tenant_id', '=', e.tenantId).where('customer_id', '=', e.customerId).executeTakeFirst();
      const balanceCents = Number((bal as any)?.s ?? 0);
      if (balanceCents + Math.trunc(e.amountCents) < 0) return { ok: false as const, balanceCents }; // amountCents is negative for a debit
      const row = await trx.insertInto('customer_wallet_ledger').values(this.values(e))
        .returning(['id', 'amount_cents', 'entry_type', 'currency', 'reference', 'created_at']).executeTakeFirstOrThrow();
      return { ok: true as const, entry: toEntry(row) };
    });
  }
}
