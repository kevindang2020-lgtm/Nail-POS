import { describe, it, expect } from 'vitest';
import { KyselyCheckoutRepository } from './checkout.kysely.repository';
import { PaymentPersistenceError, type CheckoutContext } from './checkout.repository';
import type { PaymentRecord } from './checkout.dto';

// Regression guard for the "silent missing revenue" bug.
//
// BEFORE: recordPayment wrapped its INSERT in `.catch(() => undefined)` and, when no row persisted and there was no
// idempotency row to recover, RETURNED `{ ...rec, paymentId: rec.paymentId }` — a phantom-success record. Each pay path
// then ran `setStatus(ticket, 'paid')` on the very next line (payCash 129→130, payCard 192→193, payGiftCard 208→209) or
// committed recordSplitAtomic — so the ticket went `paid` with NO payment row behind it. Revenue silently disappeared.
//
// AFTER: a genuine non-recoverable INSERT failure throws PaymentPersistenceError. Because every paid-flip is a separate
// await AFTER recordPayment (and recordSplitAtomic is a single DB transaction), the throw means the ticket is NEVER
// marked paid / the split rolls back, and the controller surfaces it as an error the POS can retry.
//
// These run the REAL repository method with an injected fake `exec`/`db` (recordPayment takes exec as a parameter), so no
// live Postgres is needed — we drive the exact branch behaviour.

const ctx: CheckoutContext = { tenantId: 'luxe001', branchId: 'br_cherryhill', userId: 'u_owner', role: 'OWNER', permissions: [] } as any;

function makeSelect(result: any) {
  const b: any = {};
  b.where = () => b;
  b.select = () => b;
  b.executeTakeFirst = async () => result;
  b.execute = async () => (result == null ? [] : Array.isArray(result) ? result : [result]);
  return b;
}
function makeInsert(run: () => Promise<any>) {
  const b: any = {};
  b.values = () => b;
  b.returning = () => b;
  b.executeTakeFirst = () => run();
  b.execute = () => run();
  return b;
}
// Minimal Kysely-shaped fake. `selects` is a queue: each selectFrom('payments') consumes the next entry, so we can give
// the pre-insert dup check and the post-insert race re-read different results.
function makeDb(opts: { insert: () => Promise<any>; selects?: any[] }) {
  const selects = [...(opts.selects ?? [])];
  const calls = { inserts: 0, selects: 0 };
  const db: any = {
    insertInto: () => { calls.inserts++; return makeInsert(opts.insert); },
    selectFrom: () => { calls.selects++; return makeSelect(selects.length ? selects.shift() : undefined); },
  };
  return { db, calls };
}

const baseCash: PaymentRecord = { paymentId: '', ticketId: 'tk_1', method: 'cash', amountCents: 3000, tipCents: 0, status: 'approved', changeDueCents: 0, createdAt: new Date().toISOString() } as any;
const existingRow = { id: 'pay_real', ticket_id: 'tk_1', method: 'card', amount_cents: 5000, tip_cents: 0, status: 'approved', processor_transaction_id: 'RET-9', change_due_cents: 0, created_at: new Date().toISOString() };

describe('recordPayment — never reports a phantom success', () => {
  it('THROWS when the INSERT fails and there is nothing to recover (cash / no idempotency key)', async () => {
    const { db, calls } = makeDb({ insert: () => Promise.reject(new Error('insert into "payments" violates foreign key constraint')) });
    const repo = new KyselyCheckoutRepository(db);
    await expect(repo.recordPayment(ctx, { ...baseCash })).rejects.toBeInstanceOf(PaymentPersistenceError);
    expect(calls.inserts).toBe(1);   // the insert was attempted
    expect(calls.selects).toBe(0);   // no idempotency key → no dup check, no race re-read
  });

  it('THROWS when an idempotent INSERT fails AND no existing row can be found (real failure, not a race)', async () => {
    const { db, calls } = makeDb({ insert: () => Promise.reject(new Error('deadlock detected')), selects: [undefined, undefined] });
    const repo = new KyselyCheckoutRepository(db);
    const rec: PaymentRecord = { ...baseCash, method: 'card', amountCents: 5000, idempotencyKey: 'IDEM-X' } as any;
    await expect(repo.recordPayment(ctx, rec)).rejects.toBeInstanceOf(PaymentPersistenceError);
    expect(calls.inserts).toBe(1);
    expect(calls.selects).toBe(2);   // pre-insert dup check (miss) + post-insert race re-read (miss)
  });

  it('RECOVERS the real row on a concurrent same-key race (insert loses, existing row found) — no throw', async () => {
    const { db, calls } = makeDb({ insert: () => Promise.reject(new Error('duplicate key value violates unique constraint "payments_tenant_idem_uq"')), selects: [undefined, existingRow] });
    const repo = new KyselyCheckoutRepository(db);
    const rec: PaymentRecord = { ...baseCash, paymentId: 'client_placeholder', method: 'card', amountCents: 5000, idempotencyKey: 'IDEM-RACE' } as any;
    const out = await repo.recordPayment(ctx, rec);
    expect(out.paymentId).toBe('pay_real');  // the REAL persisted row, not the client placeholder
    expect(calls.inserts).toBe(1);
    expect(calls.selects).toBe(2);
  });

  it('SHORT-CIRCUITS on an idempotency replay (existing row found before insert) — insert never runs', async () => {
    const { db, calls } = makeDb({ insert: () => Promise.reject(new Error('should not be called')), selects: [existingRow] });
    const repo = new KyselyCheckoutRepository(db);
    const rec: PaymentRecord = { ...baseCash, paymentId: 'client_placeholder', method: 'card', amountCents: 5000, idempotencyKey: 'IDEM-DUP' } as any;
    const out = await repo.recordPayment(ctx, rec);
    expect(out.paymentId).toBe('pay_real');
    expect(calls.inserts).toBe(0);   // replay returned before attempting an insert
    expect(calls.selects).toBe(1);
  });

  it('HAPPY PATH still returns the real inserted row id', async () => {
    const { db, calls } = makeDb({ insert: () => Promise.resolve({ id: 'pay_new' }) });
    const repo = new KyselyCheckoutRepository(db);
    const out = await repo.recordPayment(ctx, { ...baseCash });
    expect(out.paymentId).toBe('pay_new');
    expect(calls.inserts).toBe(1);
  });
});
