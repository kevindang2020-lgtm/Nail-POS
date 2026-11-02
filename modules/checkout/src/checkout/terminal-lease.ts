// terminal-lease.ts — Functional Decision 34: a shared payment terminal runs ONE transaction at a time, across every API
// instance. One row per terminal (migration 485), taken atomically, self-expiring, released only by its holder.
import { sql, type Kysely } from 'kysely';

/** How long a lease lasts if its holder never releases it (a crashed server, a dropped connection). A Bolt card
 *  authorization waits up to ~2 minutes for the customer, so the lease outlives one honest transaction. */
export const TERMINAL_LEASE_TTL_SECONDS = 180;

export interface TerminalLeasePort {
  /** true = this holder now owns the terminal (or already did); false = another transaction is active on it. */
  acquire(tenantId: string, terminalId: string, holder: string, ttlSeconds?: number): Promise<boolean>;
  /** Releases ONLY if `holder` still owns it — never frees a lease another transaction took over after expiry. */
  release(tenantId: string, terminalId: string, holder: string): Promise<void>;
}

export class KyselyTerminalLeases implements TerminalLeasePort {
  constructor(private readonly db: Kysely<any>) {}
  async acquire(tenantId: string, terminalId: string, holder: string, ttlSeconds = TERMINAL_LEASE_TTL_SECONDS): Promise<boolean> {
    const r = await sql<{ holder: string }>`
      insert into payment_terminal_leases (tenant_id, terminal_id, holder, acquired_at, expires_at)
      values (${tenantId}, ${terminalId}, ${holder}, now(), now() + make_interval(secs => ${ttlSeconds}))
      on conflict (tenant_id, terminal_id) do update
        set holder = excluded.holder, acquired_at = now(), expires_at = excluded.expires_at
        where payment_terminal_leases.expires_at <= now() or payment_terminal_leases.holder = excluded.holder
      returning holder`.execute(this.db);
    return r.rows.length === 1;
  }
  async release(tenantId: string, terminalId: string, holder: string): Promise<void> {
    await sql`delete from payment_terminal_leases where tenant_id = ${tenantId} and terminal_id = ${terminalId} and holder = ${holder}`.execute(this.db);
  }
}

/** In-memory twin with the same rules (tests, and repositories without a database). */
export class InMemoryTerminalLeases implements TerminalLeasePort {
  private rows = new Map<string, { holder: string; expiresAt: number }>();
  constructor(private readonly now: () => number = Date.now) {}
  async acquire(tenantId: string, terminalId: string, holder: string, ttlSeconds = TERMINAL_LEASE_TTL_SECONDS): Promise<boolean> {
    const k = tenantId + '::' + terminalId; const cur = this.rows.get(k);
    if (cur && cur.expiresAt > this.now() && cur.holder !== holder) return false;
    this.rows.set(k, { holder, expiresAt: this.now() + ttlSeconds * 1000 }); return true;
  }
  async release(tenantId: string, terminalId: string, holder: string): Promise<void> {
    const k = tenantId + '::' + terminalId; if (this.rows.get(k)?.holder === holder) this.rows.delete(k);
  }
}
