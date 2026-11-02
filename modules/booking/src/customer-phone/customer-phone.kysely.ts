// customer-phone.kysely.ts — the drivers behind PhoneStore and SyncPort.
//
// All the SQL lives here and none of it lives in the service, which is the project's convention and the reason the
// service's 57 tests need no database. The decisions are there; the writes are here.
//
// ══ TWO THINGS THIS FILE IS RESPONSIBLE FOR ═══════════════════════════════════════════════════════════════
//
// 1. THE ACTIVATION IS ONE TRANSACTION, GUARDED BY record_version.
//
//    Retiring the old number and promoting the new one are not two operations that happen to run together — they
//    are one operation. Half of it is a customer with two active numbers, or none. And the version guard is what
//    stops a stale screen overwriting a NEWER number with an older one: two receptionists with the profile open,
//    both hit Save, and without the guard the second silently wins with whatever was on screen when they opened it.
//
// 2. DUPLICATE DETECTION NEVER LEAVES THE TENANT.
//
//    `matchesByHash` carries `tenant_id` as its leading predicate. A phone hash is a global value — the same number
//    hashes the same everywhere — so a query that forgot its tenant would happily return customers from other
//    salons, and the duplicate warning would become a cross-tenant customer directory.
import { sql } from 'kysely';
import { enqueueJob, type AppDatabase } from '@aipowersalon/database';
import { canMoveToSql } from '@aipowersalon/database';
import { CUSTOMER_PHONE } from '../booking-lifecycles';
import { createDomainEvent, DOMAIN_EVENTS, type OutboxWriter, type DomainEventType } from '@aipowersalon/events';
import type { CustomerPhoneStatus } from '@aipowersalon/api-contracts';
import { displayPhone, maskPhone } from '@aipowersalon/customers';
import type { PhoneStore, SyncPort, PhoneSettings } from './customer-phone-update.service';
import { KyselyPhoneSettingsStore } from './customer-phone-settings.kysely';
import { PHONE_SETTINGS_DEFAULTS } from './customer-phone-settings.service';
import type { PhoneMatch, PhoneStatus, UpdateState, UpdateSource } from './customer-phone-core';

/** How long a started change stays open before the expiry sweep closes it (unless proven). */
export const SESSION_TTL_MINUTES = 30;
/** The phone module's jobs on the ONE queue (Phase 2, migration 519). */
export const PHONE_JOB = { expiry: 'customer.phone.session_expiry', sync: 'customer.phone.sync' } as const;
/** A failed synchronisation is retried this many times (backoff + jitter) before the job goes dead. */
export const SYNC_MAX_ATTEMPTS = 8;



/** The wire shape lives in the shared contracts (one definition for the API, the POS and the customer app). */
export type PhoneStatusView = CustomerPhoneStatus;

/** A domain event the store writes in the SAME transaction as the fact it describes (Constitution 8). */
export interface PhoneEvent { type: DomainEventType; tenantId: string; branchId?: string | null; customerId: string; sessionId?: string | null; actorId?: string | null; payload: Record<string, unknown> }

export class KyselyPhoneStore implements PhoneStore {
  constructor(private readonly db: AppDatabase | null, private readonly outbox?: OutboxWriter | null) {}

  private async emit(trx: any, e: PhoneEvent | undefined | null): Promise<void> {
    if (!e || !this.outbox) return;
    await this.outbox.write(trx, createDomainEvent({
      eventType: e.type, tenantId: e.tenantId, branchId: e.branchId || undefined,
      aggregateType: 'customer', aggregateId: e.customerId, actorId: e.actorId ?? undefined, actorType: e.actorId ? 'user' : 'system',
      payload: { customerId: e.customerId, ...(e.sessionId ? { sessionId: e.sessionId } : {}), ...e.payload },
    }));
  }

  /** Record an event on its own (a fact with no row of its own, e.g. a failed code). */
  async recordEvent(e: PhoneEvent): Promise<void> {
    if (!this.db || !this.outbox) return;
    await this.db.transaction().execute((trx: any) => this.emit(trx, e)).catch(() => undefined);
  }

  /** ONE settings read (the settings store's) and ONE set of defaults — the audit found two copies that had drifted. */
  async settings(tenantId: string, branchId: string | null, customerId?: string): Promise<PhoneSettings> {
    // No branch in the request (a customer in the app; a staff session without a selected branch): the customer's
    // home branch decides — never silently the salon default when that branch has its own policy.
    let b = branchId || null;
    if (!b && customerId && this.db) {
      b = ((await sql`SELECT branch_id FROM customers WHERE id = ${customerId} AND tenant_id = ${tenantId}`.execute(this.db as any).catch(() => ({ rows: [] }))).rows?.[0] as any)?.branch_id ?? null;
    }
    return (await new KyselyPhoneSettingsStore(this.db).get(tenantId, b)) ?? PHONE_SETTINGS_DEFAULTS;
  }

  async customer(tenantId: string, customerId: string) {
    if (!this.db) return null;
    // TENANT-SCOPED. A customer id alone must never be enough to reach into another salon's records — this is what
    // makes a wrong id a "not found" rather than a breach.
    const r: any = await sql`
      SELECT id, full_name, record_version
      FROM customers
      WHERE id = ${customerId} AND tenant_id = ${tenantId}
      LIMIT 1`.execute(this.db).catch(() => ({ rows: [] }));
    const row = r.rows?.[0];
    return row ? { id: String(row.id), fullName: row.full_name ?? null, recordVersion: Number(row.record_version ?? 1) } : null;
  }

  async matchesByHash(tenantId: string, phoneHash: string, excludeCustomerId: string, normalizedPhone: string): Promise<PhoneMatch[]> {
    if (!this.db) return [];
    // A phone hash is GLOBAL — the same number hashes identically at every salon. So the tenant predicate is not a
    // performance detail, it is the isolation boundary: without it this query returns other salons' customers and
    // the duplicate warning becomes a cross-tenant directory.
    //
    // Reads BOTH the new `customer_phones` history AND the legacy `customers.normalized_phone`, because the
    // existing customer base has numbers only in the latter — a duplicate check that ignored them would find
    // nothing on day one.
    const r: any = await sql`
      SELECT c.id AS customer_id, c.full_name, coalesce(p.status, 'active_unverified') AS status
      FROM customers c
      LEFT JOIN customer_phones p
        ON p.customer_id = c.id AND p.tenant_id = c.tenant_id
       -- Active numbers only. A PENDING number is somebody's unfinished proposal — counting it made a canceled change
       -- look like another customer's number (audit E11).
       AND p.status IN ('active_verified','active_unverified')
      WHERE c.tenant_id = ${tenantId}
        AND c.id <> ${excludeCustomerId}
        -- Two sources, because the customer base lives in two places:
        --   customer_phones.phone_hash  -- the new status model
        --   customers.normalized_phone  -- the LEGACY column, where every EXISTING customer's number actually is
        --
        -- My first version hashed the legacy column in SQL with digest(). That was wrong twice over: pgcrypto is
        -- not guaranteed, and phoneKey is sha256 of a salted E.164 TRUNCATED TO 32 CHARS -- so the comparison could
        -- never have matched even where digest() existed. And a .catch() swallowed the error, so duplicate
        -- detection would have silently found NOTHING for the entire existing customer base, on every edit.
        --
        -- Comparing the plaintext E.164 directly is correct, needs no extension, and cannot drift from the hash
        -- function.
        AND (p.phone_hash = ${phoneHash} OR c.normalized_phone = ${normalizedPhone})
      LIMIT 20`.execute(this.db).catch(() => ({ rows: [] }));

    return (r.rows ?? []).map((row: any): PhoneMatch => ({
      customerId: String(row.customer_id),
      tenantId,
      fullName: row.full_name ?? null,
      isSameCustomer: false,
      status: String(row.status) as PhoneStatus,
    }));
  }

  async activePhone(tenantId: string, customerId: string) {
    if (!this.db) return null;
    const r: any = await sql`
      SELECT id, phone_mask, status FROM customer_phones
      WHERE tenant_id = ${tenantId} AND customer_id = ${customerId}
        AND status IN ('active_verified','active_unverified')
      LIMIT 1`.execute(this.db).catch(() => ({ rows: [] }));
    const row = r.rows?.[0];
    return row ? { id: String(row.id), mask: String(row.phone_mask), status: String(row.status) as PhoneStatus } : null;
  }

  async createSession(i: any): Promise<{ id: string }> {
    const r: any = await (this.db as any).transaction().execute(async (trx: any) => {
      const ins: any = await sql`
      INSERT INTO customer_phone_update_sessions
        (tenant_id, branch_id, customer_id, proposed_phone, proposed_phone_hash, proposed_phone_mask,
         previous_phone_id, state, update_source, requested_by_user_id, requested_by_role, change_reason,
         customer_version, idempotency_key, duplicate_outcome, new_phone_id, expires_at)
      VALUES
        (${i.tenantId}, coalesce(${i.branchId || null}::uuid, (SELECT c.branch_id FROM customers c WHERE c.id = ${i.customerId} AND c.tenant_id = ${i.tenantId})), ${i.customerId}, ${i.newPhoneMask}, ${i.newPhoneHash}, ${i.newPhoneMask},
         ${i.oldPhoneId}, ${i.state}, ${i.source}, ${i.userId}, ${i.role}, ${i.reason},
         ${i.customerVersion}, ${i.idempotencyKey}, ${i.duplicateOutcome}, ${i.newPhoneId},
         now() + ${`${Math.max(1, Math.floor(i.ttlMinutes ?? SESSION_TTL_MINUTES))} minutes`}::interval)
      RETURNING id, expires_at`.execute(trx);
      const sid = String(ins.rows?.[0]?.id ?? '');
      if (sid && i.event) await this.emit(trx, { ...i.event, sessionId: sid });
      return ins;
    });
    const id = String(r.rows?.[0]?.id ?? '');
    // Its deadline is a job on the ONE queue (Phase 2): it closes the session at expires_at if nobody finished it.
    // Best effort — the scheduler's sweep closes anything a lost job missed.
    if (id) await enqueueJob(this.db as any, {
      jobClass: 'standard', jobType: PHONE_JOB.expiry, tenantId: i.tenantId, payload: { sessionId: id },
      runAfter: new Date(r.rows[0].expires_at), idempotencyKey: id, maxAttempts: 3, priority: 2,
    }).catch(() => undefined);
    return { id };
  }

  async session(tenantId: string, sessionId: string) {
    if (!this.db) return null;
    const r: any = await sql`
      SELECT id, customer_id, state, proposed_phone_hash, proposed_phone_mask, previous_phone_id,
             update_source, customer_version, new_phone_id, branch_id, expires_at, completed_at, duplicate_outcome,
             requested_by_user_id, approved_at, (expires_at IS NOT NULL AND expires_at < now()) AS expired
      FROM customer_phone_update_sessions
      WHERE id = ${sessionId} AND tenant_id = ${tenantId}
      LIMIT 1`.execute(this.db).catch(() => ({ rows: [] }));
    return this.toSession(r.rows?.[0]);
  }

  private toSession(row: any) {
    if (!row) return null;
    return {
      newPhoneId: row.new_phone_id ? String(row.new_phone_id) : null,
      branchId: row.branch_id ? String(row.branch_id) : null,
      expired: !!row.expired,
      closed: row.completed_at != null,
      duplicateOutcome: row.duplicate_outcome ?? null,
      requestedBy: row.requested_by_user_id ? String(row.requested_by_user_id) : null,
      approved: row.approved_at != null,
      id: String(row.id),
      customerId: String(row.customer_id),
      state: String(row.state) as UpdateState,
      newPhoneHash: String(row.proposed_phone_hash),
      newPhoneMask: String(row.proposed_phone_mask),
      oldPhoneId: row.previous_phone_id ? String(row.previous_phone_id) : null,
      source: String(row.update_source) as UpdateSource,
      customerVersion: Number(row.customer_version ?? 1),
    };
  }

  async setSessionState(sessionId: string, state: UpdateState, patch?: Record<string, unknown>): Promise<void> {
    const event = patch?.event as PhoneEvent | undefined;
    if (event && this.outbox && this.db) {
      await this.db.transaction().execute(async (trx: any) => {
        await this.updateState(trx, sessionId, state, patch);
        await this.emit(trx, event);
      }).catch(() => undefined);
      return;
    }
    await this.updateState(this.db, sessionId, state, patch);
  }

  private async updateState(db: any, sessionId: string, state: UpdateState, patch?: Record<string, unknown>): Promise<void> {
    await sql`
      UPDATE customer_phone_update_sessions
      SET state = ${state},
          verification_session_id = coalesce(${(patch?.verificationSessionId as string) ?? null}::uuid, verification_session_id),
          approved_by_user_id = coalesce(${(patch?.approvedBy as string) ?? null}::uuid, approved_by_user_id),
          approved_at = CASE WHEN ${(patch?.approvedBy as string) ?? null}::uuid IS NOT NULL THEN now() ELSE approved_at END,
          completed_at = CASE WHEN ${state} IN ('customer_records_synchronized','update_canceled','rolled_back')
                              THEN now() ELSE completed_at END,
          updated_at = now()
      WHERE id = ${sessionId}`.execute(db).catch(() => undefined);
  }

  /** The customer's open change (at most one — uq_cpus_one_open). */
  async openSession(tenantId: string, customerId: string) {
    if (!this.db) return null;
    const r: any = await sql`
      SELECT id, customer_id, state, proposed_phone_hash, proposed_phone_mask, previous_phone_id,
             update_source, customer_version, new_phone_id, branch_id, expires_at, completed_at, duplicate_outcome,
             requested_by_user_id, approved_at, (expires_at IS NOT NULL AND expires_at < now()) AS expired
      FROM customer_phone_update_sessions
      WHERE tenant_id = ${tenantId} AND customer_id = ${customerId} AND completed_at IS NULL
      LIMIT 1`.execute(this.db).catch(() => ({ rows: [] }));
    return this.toSession(r.rows?.[0]);
  }

  /** A replayed request (same idempotency key) finds the session it already opened. */
  async sessionByIdempotencyKey(tenantId: string, key: string) {
    if (!this.db) return null;
    const r: any = await sql`
      SELECT id, customer_id, state, proposed_phone_hash, proposed_phone_mask, previous_phone_id,
             update_source, customer_version, new_phone_id, branch_id, expires_at, completed_at, duplicate_outcome,
             requested_by_user_id, approved_at, (expires_at IS NOT NULL AND expires_at < now()) AS expired
      FROM customer_phone_update_sessions
      WHERE tenant_id = ${tenantId} AND idempotency_key = ${key}
      LIMIT 1`.execute(this.db).catch(() => ({ rows: [] }));
    return this.toSession(r.rows?.[0]);
  }

  /**
   * End a session that will not complete (canceled, superseded, expired) and retire the number it proposed —
   * unless that number was already proven and activated. Audit E2/E11: before, a canceled session left its pending
   * row behind, and the next customer to use that number was told it belonged to somebody else.
   */
  async closeSession(tenantId: string, sessionId: string, state: UpdateState, phoneStatus: 'inactive' | 'verification_expired' = 'inactive'): Promise<void> {
    if (!this.db) return;
    await this.db.transaction().execute(async (trx: any) => {
      const r: any = await sql`
        UPDATE customer_phone_update_sessions
           SET state = ${state}, completed_at = coalesce(completed_at, now()), updated_at = now()
         WHERE id = ${sessionId} AND tenant_id = ${tenantId}
         RETURNING new_phone_id`.execute(trx);
      const phoneId = r.rows?.[0]?.new_phone_id;
      if (phoneId) {
        await sql`UPDATE customer_phones SET status = ${phoneStatus}, updated_at = now()
                   WHERE id = ${phoneId} AND tenant_id = ${tenantId} AND status = 'pending_verification' AND ${canMoveToSql(CUSTOMER_PHONE, phoneStatus, 'customer_phones')}`.execute(trx);
      }
    });
  }

  /**
   * Close every open session past its deadline that was never proven, and retire its pending number. Proven ones
   * are never expired: the customer answered the SMS, and a later failure must not un-prove it. Returns how many.
   */
  async expireStaleSessions(limit = 200): Promise<number> {
    if (!this.db) return 0;
    const r: any = await sql`
      WITH stale AS (
        SELECT id FROM customer_phone_update_sessions
         WHERE completed_at IS NULL AND expires_at IS NOT NULL AND expires_at < now()
           AND state NOT IN ('phone_verified', 'phone_activated', 'synchronization_failed', 'customer_records_synchronized')
         ORDER BY expires_at
         LIMIT ${Math.max(1, Math.min(1000, limit))}
         FOR UPDATE SKIP LOCKED
      ), closed AS (
        UPDATE customer_phone_update_sessions s
           SET state = 'verification_expired', completed_at = now(), updated_at = now()
          FROM stale WHERE s.id = stale.id
        RETURNING s.tenant_id, s.new_phone_id
      ), retired AS (
        UPDATE customer_phones p SET status = 'verification_expired', updated_at = now()
          FROM closed WHERE p.id = closed.new_phone_id AND p.tenant_id = closed.tenant_id AND p.status = 'pending_verification' AND ${canMoveToSql(CUSTOMER_PHONE, 'verification_expired', 'p')}
        RETURNING p.id
      )
      SELECT (SELECT count(*) FROM closed)::int AS n`.execute(this.db);
    return Number(r.rows?.[0]?.n ?? 0);
  }

  /**
   * The customer's number from BEFORE the status model existed (`customers.normalized_phone`, no customer_phones row)
   * becomes an active row, so a change can RETIRE it — and its booking verification — instead of leaving it as an
   * invisible second number. Verified if the legacy record says so. Idempotent (uq_customer_phones_one_active).
   */
  async adoptLegacyPhone(tenantId: string, customerId: string, derive: (e164: string) => { e164: string; hash: string; mask: string; display: string; country: string | null } | null) {
    if (!this.db) return null;
    const c: any = (await sql`SELECT normalized_phone, phone_verified_at FROM customers WHERE id = ${customerId} AND tenant_id = ${tenantId} LIMIT 1`
      .execute(this.db).catch(() => ({ rows: [] }))).rows?.[0];
    const d = c?.normalized_phone ? derive(String(c.normalized_phone)) : null;
    if (!d) return null;
    const status: PhoneStatus = c.phone_verified_at ? 'active_verified' : 'active_unverified';
    const r: any = await sql`
      INSERT INTO customer_phones (tenant_id, customer_id, normalized_phone, phone_display, phone_mask, phone_hash, country_code,
                                   status, verified_at, update_source, change_reason)
      VALUES (${tenantId}, ${customerId}, ${d.e164}, ${d.display}, ${d.mask}, ${d.hash}, ${d.country},
              ${status}, ${c.phone_verified_at ?? null}, 'import', 'adopted: customer record on file')
      ON CONFLICT (tenant_id, customer_id) WHERE status IN ('active_verified','active_unverified') DO NOTHING
      RETURNING id`.execute(this.db).catch(() => ({ rows: [] }));
    return r.rows?.[0]?.id ? { id: String(r.rows[0].id), mask: d.mask, status } : this.activePhone(tenantId, customerId);
  }

  /** What a screen shows: the active number (masked + readable for the salon), its proof, and any open change. */
  async phoneStatus(tenantId: string, customerId: string): Promise<PhoneStatusView | null> {
    if (!this.db) return null;
    const c: any = (await sql`SELECT id, record_version, normalized_phone, phone_display, phone_verified_at FROM customers WHERE id = ${customerId} AND tenant_id = ${tenantId}`
      .execute(this.db).catch(() => ({ rows: [] }))).rows?.[0];
    if (!c) return null;
    const a: any = (await sql`SELECT phone_mask, status, verification_provider, verified_at, update_source, effective_from FROM customer_phones
      WHERE tenant_id = ${tenantId} AND customer_id = ${customerId} AND status IN ('active_verified','active_unverified') LIMIT 1`
      .execute(this.db).catch(() => ({ rows: [] }))).rows?.[0];
    const open = await this.openSession(tenantId, customerId);
    const last: any = (await sql`SELECT id, state, completed_at FROM customer_phone_update_sessions
      WHERE tenant_id = ${tenantId} AND customer_id = ${customerId} ORDER BY created_at DESC LIMIT 1`
      .execute(this.db).catch(() => ({ rows: [] }))).rows?.[0];
    const verified = a ? a.status === 'active_verified' : !!c.phone_verified_at;
    return {
      customerId, recordVersion: Number(c.record_version ?? 1),
      phone: c.normalized_phone ? {
        // A number on file from before the phone table has no customer_phones row: derive its mask and readable form
        // from the number itself (the Phase 3 live proof found both empty or raw).
        display: c.phone_display && !/^\+\d+$/.test(String(c.phone_display)) ? c.phone_display : displayPhone(String(c.normalized_phone)),
        masked: a?.phone_mask ?? maskPhone(String(c.normalized_phone)),
        status: (a?.status ?? (c.phone_verified_at ? 'active_verified' : 'active_unverified')) as PhoneStatus,
        verified, label: verified ? 'Verified by SMS' : a?.verification_provider === 'staff_override' ? 'Manually confirmed — OTP not completed' : 'Not verified',
        verifiedAt: a?.verified_at ? new Date(a.verified_at).toISOString() : (c.phone_verified_at ? new Date(c.phone_verified_at).toISOString() : null),
        since: a?.effective_from ? new Date(a.effective_from).toISOString() : null,
      } : null,
      openChange: open ? { sessionId: open.id, state: open.state, maskedPhone: open.newPhoneMask, expired: !!open.expired, source: open.source } : null,
      sync: last?.state === 'synchronization_failed' ? 'retrying' : 'ok',
      lastChange: last ? { sessionId: String(last.id), state: String(last.state) as UpdateState, completedAt: last.completed_at ? new Date(last.completed_at).toISOString() : null } : null,
    };
  }

  /** Staff asked for the code pad on the customer display (only for a change whose code went out). */
  async markDisplayRequested(tenantId: string, sessionId: string): Promise<boolean> {
    if (!this.db) return false;
    const r: any = await sql`UPDATE customer_phone_update_sessions SET display_requested_at = now(), updated_at = now()
      WHERE id = ${sessionId} AND tenant_id = ${tenantId} AND completed_at IS NULL
        AND state IN ('verification_sent', 'verification_failed', 'verification_pending')
      RETURNING id`.execute(this.db).catch(() => ({ rows: [] }));
    return (r.rows?.length ?? 0) > 0;
  }

  /** The change whose code this customer should type on the display now (asked for within 15 minutes), or null. */
  async displayPromptSession(tenantId: string, customerId: string): Promise<{ sessionId: string; maskedPhone: string; requestedBy: string | null } | null> {
    if (!this.db) return null;
    const r: any = await sql`SELECT id, proposed_phone_mask, requested_by_user_id FROM customer_phone_update_sessions
      WHERE tenant_id = ${tenantId} AND customer_id = ${customerId} AND completed_at IS NULL
        AND display_requested_at > now() - interval '15 minutes'
        AND state IN ('verification_sent', 'verification_failed', 'verification_pending')
      LIMIT 1`.execute(this.db).catch(() => ({ rows: [] }));
    const x = r.rows?.[0];
    return x ? { sessionId: String(x.id), maskedPhone: String(x.proposed_phone_mask), requestedBy: x.requested_by_user_id ? String(x.requested_by_user_id) : null } : null;
  }

  async currentPhone(tenantId: string, customerId: string): Promise<string | null> {
    if (!this.db) return null;
    const r: any = await sql`SELECT normalized_phone FROM customers WHERE id = ${customerId} AND tenant_id = ${tenantId}`.execute(this.db).catch(() => ({ rows: [] }));
    return r.rows?.[0]?.normalized_phone ? String(r.rows[0].normalized_phone) : null;
  }

  async recentStarts(tenantId: string, customerId: string, userId: string): Promise<{ customer: number; actor: number }> {
    if (!this.db) return { customer: 0, actor: 0 };
    const r: any = await sql`
      SELECT count(*) FILTER (WHERE customer_id = ${customerId})::int AS customer,
             count(*) FILTER (WHERE requested_by_user_id = ${/^[0-9a-f-]{36}$/i.test(userId) ? userId : null}::uuid)::int AS actor
        FROM customer_phone_update_sessions
       WHERE tenant_id = ${tenantId} AND created_at > now() - interval '1 hour'`.execute(this.db).catch(() => ({ rows: [] }));
    return { customer: Number(r.rows?.[0]?.customer ?? 0), actor: Number(r.rows?.[0]?.actor ?? 0) };
  }

  async proposedPhone(tenantId: string, sessionId: string): Promise<string | null> {
    if (!this.db) return null;
    const r: any = await sql`SELECT p.normalized_phone FROM customer_phone_update_sessions s
      JOIN customer_phones p ON p.id = s.new_phone_id AND p.tenant_id = s.tenant_id
      WHERE s.id = ${sessionId} AND s.tenant_id = ${tenantId}`.execute(this.db).catch(() => ({ rows: [] }));
    return r.rows?.[0]?.normalized_phone ? String(r.rows[0].normalized_phone) : null;
  }

  /** Close ONE session if it is past its deadline and unproven (the queued expiry job). */
  async expireSession(tenantId: string, sessionId: string): Promise<boolean> {
    if (!this.db) return false;
    const s = await this.session(tenantId, sessionId);
    if (!s || s.closed || !s.expired) return false;
    if (['phone_verified', 'phone_activated', 'synchronization_failed', 'customer_records_synchronized'].includes(s.state)) return false;
    await this.closeSession(tenantId, sessionId, 'verification_expired', 'verification_expired');
    return true;
  }

  /** A failed synchronisation becomes a job: retried with backoff by the queue, dead-lettered after its attempts. */
  async scheduleSyncRetry(tenantId: string, sessionId: string): Promise<void> {
    if (!this.db) return;
    await enqueueJob(this.db, {
      jobClass: 'standard', jobType: PHONE_JOB.sync, tenantId, payload: { sessionId },
      idempotencyKey: `sync:${sessionId}`, maxAttempts: SYNC_MAX_ATTEMPTS, priority: 1,
    }).catch(() => undefined);
  }

  /** Sessions whose records still need synchronising (for the sweep to make sure each has a job). */
  async syncFailedSessions(limit = 200): Promise<{ tenantId: string; sessionId: string }[]> {
    if (!this.db) return [];
    const r: any = await sql`
      SELECT id, tenant_id FROM customer_phone_update_sessions
       WHERE state = 'synchronization_failed' AND completed_at IS NULL
       ORDER BY updated_at LIMIT ${Math.max(1, Math.min(1000, limit))}`.execute(this.db).catch(() => ({ rows: [] }));
    return (r.rows ?? []).map((x: any) => ({ tenantId: String(x.tenant_id), sessionId: String(x.id) }));
  }

  /** Run one session's synchronisation (the queued job). Throws to be retried; true when the session is done. */
  async runSync(tenantId: string, sessionId: string, sync: SyncPort): Promise<boolean> {
    if (!this.db) return false;
    const row: any = (await sql`
      SELECT s.state, s.customer_id, c.normalized_phone FROM customer_phone_update_sessions s
        JOIN customers c ON c.id = s.customer_id AND c.tenant_id = s.tenant_id
       WHERE s.id = ${sessionId} AND s.tenant_id = ${tenantId}`.execute(this.db)).rows?.[0];
    if (!row || row.state !== 'synchronization_failed') return true;     // nothing left to do
    const ok = await sync.synchronize({ tenantId, customerId: String(row.customer_id), normalizedPhone: String(row.normalized_phone ?? ''), phoneHash: '' });
    if (!ok) throw new Error('customer phone synchronisation failed — will retry');
    await this.db.transaction().execute(async (trx: any) => {
      await sql`UPDATE customer_phone_update_sessions SET state = 'customer_records_synchronized', completed_at = coalesce(completed_at, now()), updated_at = now()
                 WHERE id = ${sessionId} AND tenant_id = ${tenantId}`.execute(trx);
      await this.emit(trx, { type: DOMAIN_EVENTS.CUSTOMER_PHONE_SYNC_COMPLETED, tenantId, customerId: String(row.customer_id), sessionId, payload: { retried: true } });
    });
    return true;
  }

  async savePendingPhone(i: any): Promise<{ id: string }> {
    const r: any = await sql`
      INSERT INTO customer_phones
        (tenant_id, branch_id, customer_id, normalized_phone, phone_display, phone_mask, phone_hash, country_code,
         status, added_by_user_id, update_source, change_reason)
      VALUES
        (${i.tenantId}, ${i.branchId || null}, ${i.customerId}, ${i.normalizedPhone}, ${i.phoneDisplay ?? i.phoneMask}, ${i.phoneMask}, ${i.phoneHash}, ${i.countryCode ?? null},
         'pending_verification', ${i.userId}, ${i.source}, ${i.reason})
      -- ONE pending number per customer (uq_customer_phones_one_pending). A receptionist clicking Save twice, or
      -- two terminals at once, must not create two competing pending numbers -- whichever code arrived second
      -- would silently win. Re-saving the same proposal is a no-op, not an error.
      ON CONFLICT (tenant_id, customer_id) WHERE status = 'pending_verification'
      DO UPDATE SET
        normalized_phone = EXCLUDED.normalized_phone,
        phone_mask = EXCLUDED.phone_mask,
        phone_display = EXCLUDED.phone_display,
        phone_hash = EXCLUDED.phone_hash,
        country_code = EXCLUDED.country_code,
        added_by_user_id = EXCLUDED.added_by_user_id,
        update_source = EXCLUDED.update_source,
        change_reason = EXCLUDED.change_reason,
        updated_at = now()
      RETURNING id`.execute(this.db as any);
    return { id: String(r.rows?.[0]?.id ?? '') };
  }

  /**
   * THE transaction.
   *
   * Retire the old number, promote the new one, bump the customer — all or nothing, and only if the customer's
   * version has not moved. Half of this is a customer with two active numbers, or none.
   */
  async activate(i: any): Promise<boolean> {
    if (!this.db) return false;
    return this.db.transaction().execute(async (trx: any) => {
      // The GUARD. `record_version = expected` is the whole optimistic lock: if somebody else changed this customer
      // while we were verifying, this matches zero rows and we abort — rather than overwriting their change, which
      // may itself be a newer phone number.
      const bumped: any = await sql`
        UPDATE customers
        SET normalized_phone = ${i.normalizedPhone},
            -- The READABLE number. Audit E4: this wrote the mask, so the POS list showed "••••0199" and the AI
            -- receptionist's caller-ID matched nothing.
            phone_display = ${i.phoneDisplay ?? i.normalizedPhone},
            -- Derived from the proof, never carried over: an SMS-verified number is verified NOW; one set without
            -- an SMS (tenant policy, manager confirmation) was never proved, whatever the old number was (audit E7).
            phone_verified_at = ${i.status === 'active_verified' ? sql`now()` : sql`null`},
            record_version = record_version + 1,
            updated_at = now()
        WHERE id = ${i.customerId} AND tenant_id = ${i.tenantId}
          AND record_version = ${i.expectedVersion}
        RETURNING id`.execute(trx);

      if (!bumped.rows?.length) return false;         // stale — somebody else won

      // Retire the old number. NOT deleted: historical appointments and messages must keep their original contact
      // reference, and a deleted row makes an audit trail lie by omission.
      const retiredById: any = i.oldPhoneId ? await sql`
          UPDATE customer_phones
          SET status = 'replaced', replaced_by_phone_id = ${i.newPhoneId}, updated_at = now()
          WHERE id = ${i.oldPhoneId} AND tenant_id = ${i.tenantId} AND ${canMoveToSql(CUSTOMER_PHONE, 'replaced')}
          RETURNING phone_hash, normalized_phone`.execute(trx) : { rows: [] };
      // Any OTHER active row for this customer is retired too — belt and braces against a partial earlier write
      // leaving two actives, which `uq_customer_phones_one_active` would then refuse.
      const retired: any = await sql`
        UPDATE customer_phones
        SET status = 'replaced', replaced_by_phone_id = ${i.newPhoneId}, updated_at = now()
        WHERE tenant_id = ${i.tenantId} AND customer_id = ${i.customerId}
          AND id <> ${i.newPhoneId}
          AND status IN ('active_verified','active_unverified') AND ${canMoveToSql(CUSTOMER_PHONE, 'replaced')}
        RETURNING phone_hash, normalized_phone`.execute(trx);
      const oldHashes = [...new Set([...(retiredById.rows ?? []), ...(retired.rows ?? [])].map((x: any) => String(x.phone_hash)))]
        .filter((h) => h && h !== i.phoneHash);

      // SMS consent follows the PERSON in the safe direction only: a customer who texted STOP from the old number is
      // still opted out on the new one. Nothing is ever opted IN by a change, and the old number's own record stays.
      const oldNumbers = [...new Set([...(retiredById.rows ?? []), ...(retired.rows ?? [])].map((x: any) => String(x.normalized_phone ?? '')))]
        .filter((n) => n && n !== i.normalizedPhone);
      if (oldNumbers.length) {
        const carried = await sql`
          INSERT INTO notification_opt_outs (tenant_id, channel, address, reason)
          SELECT ${i.tenantId}, 'sms', ${i.normalizedPhone}, 'carried_from_previous_number'
           WHERE EXISTS (SELECT 1 FROM notification_opt_outs o WHERE o.tenant_id = ${i.tenantId} AND o.channel = 'sms' AND o.address = ANY(${oldNumbers}::text[]))
          ON CONFLICT DO NOTHING RETURNING address`.execute(trx);
        // 741 (Customer Notifications guide §07): the carried opt-out is part of the consent history too
        if ((carried.rows ?? []).length) await sql`INSERT INTO notification_consent_events (tenant_id, channel, address, action, source, reason)
          VALUES (${i.tenantId}, 'sms', ${i.normalizedPhone}, 'opt_out', 'phone_change', 'carried_from_previous_number')`.execute(trx);
      }

      // Audit E7: the OLD number's booking verification is revoked. Otherwise whoever holds that number next books as
      // this customer inside the trust window without a code. Revoked, not deleted — the history stays readable.
      if (oldHashes.length) {
        await sql`
          UPDATE booking_verified_phones
             SET revoked_at = now(), revoked_reason = 'customer_phone_replaced', updated_at = now()
           WHERE tenant_id = ${i.tenantId} AND phone_hash = ANY(${oldHashes}::text[]) AND revoked_at IS NULL`.execute(trx);
      }

      // Audit E8: future appointments carry a copy of the phone, and reminders read it. They move to the new number.
      await sql`
        UPDATE pos_tech_appointments
           SET customer_phone = ${i.normalizedPhone}, updated_at = now()
         WHERE tenant_id = ${i.tenantId} AND customer_id = ${i.customerId}
           -- "future" in the BRANCH's day (its time zone), never the database server's
           AND appt_date >= (now() AT TIME ZONE coalesce((SELECT b.timezone FROM branches b WHERE b.id = pos_tech_appointments.branch_id), 'UTC'))::date
           AND status IN ('booked', 'confirmed', 'arrived', 'checked_in', 'waiting')`.execute(trx);

      // The branch's live queue carries a copy too (the "your turn" call and text). Open entries follow the number;
      // finished ones are history and keep the number they were served on.
      await sql`
        UPDATE pos_queue_items SET customer_phone = ${i.normalizedPhone}, updated_at = now()
         WHERE tenant_id = ${i.tenantId} AND customer_id = ${i.customerId}
           AND status IN ('waiting', 'called', 'assigned', 'ready_for_tech', 'moved_to_tech_queue', 'in_service')`.execute(trx);
      await sql`
        UPDATE pos_tech_queue_tickets SET customer_phone = ${i.normalizedPhone}, updated_at = now()
         WHERE tenant_id = ${i.tenantId} AND customer_id = ${i.customerId}
           AND status IN ('assigned', 'waiting_for_acceptance', 'accepted', 'ready_to_start', 'in_service', 'paused', 'delayed')`.execute(trx);

      await this.emit(trx, i.event);

      // Promote. `method` decides the status: an SMS-verified number is `active_verified`; a manually confirmed one
      // is `active_unverified` — usable, and honest about never having been proven.
      // Phase 12 (#27): only a number the CUSTOMER_PHONE machine lets be promoted (pending / under review / already this
      // status) — an expired or replaced number is not revived; the whole swap rolls back (false = not promoted)
      const promoted: any = await sql`
        UPDATE customer_phones
        SET status = ${i.status},
            phone_display = coalesce(${i.phoneDisplay ?? null}, phone_display),
            verification_provider = ${i.method === 'sms_otp' ? 'twilio_verify' : 'staff_override'},
            verified_at = ${i.status === 'active_verified' ? sql`now()` : sql`null`},
            effective_from = now(),
            updated_at = now()
        WHERE id = ${i.newPhoneId} AND tenant_id = ${i.tenantId} AND ${canMoveToSql(CUSTOMER_PHONE, i.status)}`.execute(trx);
      if (!Number(promoted?.numAffectedRows ?? promoted?.numUpdatedRows ?? 0)) throw new Error('customer phone: not promotable');

      return true;
    }).catch(() => false);
  }
}

// ── synchronisation ──────────────────────────────────────────────────────────────────────────────────────
//
// Everything that must learn the new number. A failure here does NOT un-verify it — the customer answered the SMS,
// and that is banked. `synchronize` returns false to mean "retry me", and the caller moves the session to
// `synchronization_failed`, which a background job drains.
export class KyselySyncPort implements SyncPort {
  constructor(private readonly db: AppDatabase | null) {}

  async synchronize(i: { tenantId: string; customerId: string; normalizedPhone: string; phoneHash: string }): Promise<boolean> {
    if (!this.db) return false;
    try {
      await this.db.transaction().execute(async (trx: any) => {
        // 1. The tenant's customer record. (Already written by activate(); this is idempotent and covers a retry
        //    that arrives after a partial failure.)
        await sql`
          UPDATE customers SET normalized_phone = ${i.normalizedPhone}, updated_at = now()
          WHERE id = ${i.customerId} AND tenant_id = ${i.tenantId}`.execute(trx);

        // 2. The CENTRAL IDENTITY — but ONLY the link that belongs to this tenant, and ONLY the identity that is
        //    already linked to this customer.
        //
        //    This is the ownership rule the spec is emphatic about, and it is the sharpest edge in the module:
        //    `customer_identities.normalized_phone` is UNIQUE and it is the LOGIN CREDENTIAL. Writing it is
        //    changing how somebody signs in.
        //
        //    So we do NOT write it here. A receptionist at Tenant A pressing Save must not silently change a
        //    customer's PASSWORD-EQUIVALENT identity — that is an account-takeover primitive handed to whoever can
        //    talk their way past a front desk. The identity phone changes only through the customer's own
        //    reauthenticated, verified flow. This sync updates the tenant-side records; the identity is
        //    RECONCILED separately, and deliberately, and not by a receptionist.
        //
        //    What we DO update is the tenant-scoped user row the customer app reads for this salon.
        await sql`
          UPDATE users u
          SET normalized_phone = ${i.normalizedPhone}, updated_at = now()
          FROM customer_identity_links l
          WHERE l.tenant_id = ${i.tenantId}
            AND l.customer_id = ${i.customerId}
            AND u.id = l.user_id
            AND u.tenant_id = ${i.tenantId}
            AND u.role = 'CUSTOMER'`.execute(trx);
      });
      return true;
    } catch {
      // Retryable. The verification is not lost.
      return false;
    }
  }
}
