// checkout-lock.repository.ts — persistence for the checkout-session lock.
// Two implementations behind one port: InMemory (deterministic tests) and Kysely (production). The Kysely impl relies on
// the partial unique index ux_checkout_locks_active so two concurrent acquires can never both insert an active row —
// the loser hits a unique violation, which the service treats as contention and re-reads.

import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { ActiveLockView, LockSource } from './checkout-lock-core';

export interface CheckoutLockInsert {
  tenantId: string;
  branchId?: string | null;
  ticketId: string;
  ownerUserId: string;
  ownerDeviceId?: string;
  sessionId: string;
  source: LockSource;
  expiresAt: string;
  /** 690: the checkout version the claim is made against */
  checkoutVersion?: string | null;
}

export class LockContentionError extends Error {
  constructor(msg = 'Lock contention') { super(msg); this.name = 'LockContentionError'; }
}

export interface CheckoutLockPort {
  /** The active (released_at IS NULL) lock for a ticket, if any — even if expired (the core decides expiry). */
  getActive(tenantId: string, ticketId: string): Promise<ActiveLockView | null>;
  /** Insert a new active lock. Throws LockContentionError if an active lock already exists (unique violation). */
  insert(input: CheckoutLockInsert): Promise<ActiveLockView>;
  /** Extend the caller's active lock; true if a row was updated. `checkoutVersion` (a re-claim) replaces the stored
   *  version; undefined (a heartbeat) keeps it. */
  refresh(tenantId: string, ticketId: string, sessionId: string, expiresAt: string, checkoutVersion?: string | null): Promise<boolean>;
  /** Release the caller's active lock; true if a row was updated. */
  release(tenantId: string, ticketId: string, sessionId: string, reason: string): Promise<boolean>;
  /** Release any active lock for the ticket (used to clear a stale/expired lock before takeover). */
  releaseStale(tenantId: string, ticketId: string, reason: string): Promise<void>;
  /** Mandate §120: the unreleased locks of one SOURCE in one branch held by this user OR this device (expiry is the
   *  service's call). Optional so older fakes keep compiling; the service treats a port without it as "none". */
  activeHeldBy?(tenantId: string, by: HeldByQuery): Promise<HeldLockView[]>;
}

export interface HeldByQuery { branchId: string; source: LockSource; userId?: string | null; deviceId?: string | null }
export interface HeldLockView extends ActiveLockView { ticketId: string }

// ── In-memory (tests / no-DB dev) ──────────────────────────────────────────────────────────────────────────────────
interface MemRow extends CheckoutLockInsert { releasedAt: string | null; }
export class InMemoryCheckoutLockRepository implements CheckoutLockPort {
  private rows: MemRow[] = [];
  private key(t: string, k: string) { return `${t}:${k}`; }
  private activeRow(tenantId: string, ticketId: string): MemRow | undefined {
    return this.rows.find((r) => this.key(r.tenantId, r.ticketId) === this.key(tenantId, ticketId) && r.releasedAt === null);
  }
  async getActive(tenantId: string, ticketId: string): Promise<ActiveLockView | null> {
    const r = this.activeRow(tenantId, ticketId);
    return r ? { ownerUserId: r.ownerUserId, ownerDeviceId: r.ownerDeviceId, sessionId: r.sessionId, source: r.source, expiresAt: r.expiresAt, checkoutVersion: r.checkoutVersion ?? null } : null;
  }
  async insert(input: CheckoutLockInsert): Promise<ActiveLockView> {
    if (this.activeRow(input.tenantId, input.ticketId)) throw new LockContentionError();
    this.rows.push({ ...input, releasedAt: null });
    return { ownerUserId: input.ownerUserId, ownerDeviceId: input.ownerDeviceId, sessionId: input.sessionId, source: input.source, expiresAt: input.expiresAt, checkoutVersion: input.checkoutVersion ?? null };
  }
  async refresh(tenantId: string, ticketId: string, sessionId: string, expiresAt: string, checkoutVersion?: string | null): Promise<boolean> {
    const r = this.activeRow(tenantId, ticketId);
    if (!r || r.sessionId !== sessionId) return false;
    r.expiresAt = expiresAt;
    if (checkoutVersion !== undefined) r.checkoutVersion = checkoutVersion;
    return true;
  }
  async release(tenantId: string, ticketId: string, sessionId: string, reason: string): Promise<boolean> {
    const r = this.activeRow(tenantId, ticketId);
    if (!r || r.sessionId !== sessionId) return false;
    r.releasedAt = new Date().toISOString();
    return true;
  }
  async releaseStale(tenantId: string, ticketId: string): Promise<void> {
    const r = this.activeRow(tenantId, ticketId);
    if (r) r.releasedAt = new Date().toISOString();
  }
  async activeHeldBy(tenantId: string, by: HeldByQuery): Promise<HeldLockView[]> {
    if (!by.userId && !by.deviceId) return [];
    return this.rows
      .filter((r) => r.tenantId === tenantId && r.releasedAt === null && r.source === by.source && (r.branchId ?? null) === by.branchId
        && ((!!by.userId && r.ownerUserId === by.userId) || (!!by.deviceId && r.ownerDeviceId === by.deviceId)))
      .map((r) => ({ ticketId: r.ticketId, ownerUserId: r.ownerUserId, ownerDeviceId: r.ownerDeviceId, sessionId: r.sessionId, source: r.source, expiresAt: r.expiresAt }));
  }
}

// ── Kysely (production) ────────────────────────────────────────────────────────────────────────────────────────────
function isUniqueViolation(e: any): boolean {
  return e && (e.code === '23505' || /duplicate key|unique/i.test(String(e?.message || '')));
}

export class KyselyCheckoutLockRepository implements CheckoutLockPort {
  constructor(private readonly db: Kysely<DB>) {}

  async getActive(tenantId: string, ticketId: string): Promise<ActiveLockView | null> {
    const row: any = await this.db
      .selectFrom('checkout_locks')
      .select(['owner_user_id', 'owner_device_id', 'session_id', 'source', 'expires_at', 'checkout_version'])
      .where('tenant_id', '=', tenantId)
      .where('ticket_id', '=', ticketId)
      .where('released_at', 'is', null)
      .limit(1)
      .executeTakeFirst();
    if (!row) return null;
    return {
      ownerUserId: row.owner_user_id,
      ownerDeviceId: row.owner_device_id ?? undefined,
      sessionId: row.session_id,
      source: (row.source as LockSource) ?? 'mobile',
      expiresAt: new Date(row.expires_at).toISOString(),
      checkoutVersion: row.checkout_version ?? null,
    };
  }

  async insert(input: CheckoutLockInsert): Promise<ActiveLockView> {
    try {
      await this.db.insertInto('checkout_locks').values({
        tenant_id: input.tenantId,
        branch_id: input.branchId ?? null,
        ticket_id: input.ticketId,
        owner_user_id: input.ownerUserId,
        owner_device_id: input.ownerDeviceId ?? null,
        session_id: input.sessionId,
        source: input.source,
        expires_at: input.expiresAt,
        checkout_version: input.checkoutVersion ?? null,
      }).execute();
    } catch (e) {
      if (isUniqueViolation(e)) throw new LockContentionError();
      throw e;
    }
    return { ownerUserId: input.ownerUserId, ownerDeviceId: input.ownerDeviceId, sessionId: input.sessionId, source: input.source, expiresAt: input.expiresAt, checkoutVersion: input.checkoutVersion ?? null };
  }

  async refresh(tenantId: string, ticketId: string, sessionId: string, expiresAt: string, checkoutVersion?: string | null): Promise<boolean> {
    const res: any = await this.db.updateTable('checkout_locks')
      .set({ refreshed_at: sql`now()`, expires_at: expiresAt, updated_at: sql`now()`, ...(checkoutVersion !== undefined ? { checkout_version: checkoutVersion } : {}) })
      .where('tenant_id', '=', tenantId).where('ticket_id', '=', ticketId)
      .where('session_id', '=', sessionId).where('released_at', 'is', null)
      .executeTakeFirst();
    return Number(res?.numUpdatedRows ?? 0) > 0;
  }

  async release(tenantId: string, ticketId: string, sessionId: string, reason: string): Promise<boolean> {
    const res: any = await this.db.updateTable('checkout_locks')
      .set({ released_at: sql`now()`, release_reason: reason, updated_at: sql`now()` })
      .where('tenant_id', '=', tenantId).where('ticket_id', '=', ticketId)
      .where('session_id', '=', sessionId).where('released_at', 'is', null)
      .executeTakeFirst();
    return Number(res?.numUpdatedRows ?? 0) > 0;
  }

  async releaseStale(tenantId: string, ticketId: string, reason: string): Promise<void> {
    await this.db.updateTable('checkout_locks')
      .set({ released_at: sql`now()`, release_reason: reason, updated_at: sql`now()` })
      .where('tenant_id', '=', tenantId).where('ticket_id', '=', ticketId).where('released_at', 'is', null)
      .execute();
  }
  async activeHeldBy(tenantId: string, by: HeldByQuery): Promise<HeldLockView[]> {
    if (!by.userId && !by.deviceId) return [];
    const rows: any[] = await this.db.selectFrom('checkout_locks')
      .select(['ticket_id', 'owner_user_id', 'owner_device_id', 'session_id', 'source', 'expires_at'])
      .where('tenant_id', '=', tenantId).where('branch_id', '=', by.branchId).where('source', '=', by.source).where('released_at', 'is', null)
      .where((eb: any) => eb.or([
        ...(by.userId ? [eb('owner_user_id', '=', by.userId)] : []),
        ...(by.deviceId ? [eb('owner_device_id', '=', by.deviceId)] : []),
      ]))
      .limit(20).execute();
    return rows.map((r) => ({ ticketId: String(r.ticket_id), ownerUserId: r.owner_user_id, ownerDeviceId: r.owner_device_id ?? undefined, sessionId: r.session_id, source: (r.source as LockSource) ?? 'mobile', expiresAt: new Date(r.expires_at).toISOString() }));
  }
}
