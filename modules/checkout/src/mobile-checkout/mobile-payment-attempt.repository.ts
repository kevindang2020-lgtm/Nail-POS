// mobile-payment-attempt.repository.ts — persistence for the Owner & Manager Payment App's payment attempts (the mandate's
// PaymentIntent, §64–§66), on the CANONICAL payment_attempts table (migration 017 + 660). No new table: that table already
// has UNIQUE(tenant_id, idempotency_key) — giving idempotent create for free — and no CHECK on status, so the §69 state-
// machine values are valid. Mobile attempts use method 'tap_to_pay' so they are distinguishable from the checkout
// capture reservations that share the table (those use their own keys + statuses 'processing'/'settled'). The money a
// confirmed attempt produced is the payments row it links to (payment_id) — recorded by mobile-capture-recorder through
// the canonical checkout repository, never here.

import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DB } from '@aipowersalon/database';
import { transitionStatus, InvalidStateTransitionError } from '@aipowersalon/database';
import { PAYMENT_ATTEMPT } from '../checkout/payment-attempt-machine';
import type { Ctx } from '@aipowersalon/permissions';
import { isValidState, type PaymentAttemptState } from './payment-attempt-state';

export const MOBILE_ATTEMPT_METHOD = 'tap_to_pay';

export interface MobileAttemptView {
  id: string;
  ticketId: string;
  amountCents: number;
  method: string;
  status: string;            // a PaymentAttemptState; kept as string at the boundary (DB column is free TEXT)
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  // §65 PaymentIntent fields (migration 660)
  provider?: string | null;
  paymentSurface?: string | null;
  deviceId?: string | null;
  merchantAccountId?: string | null;
  currency?: string | null;
  checkoutVersion?: string | null;
  processorRef?: string | null;
  cardBrand?: string | null;
  cardLast4?: string | null;
  paymentId?: string | null;
  lastErrorCode?: string | null;
  expiresAt?: string | null;
  /** createOrGet only: true when THIS call inserted the row (false = an idempotent replay found it). Not persisted. */
  wasCreated?: boolean;
}

export interface CreateAttemptInput {
  ticketId: string;
  amountCents: number;
  idempotencyKey: string;
  method?: string;           // defaults to 'tap_to_pay'
  provider?: string | null;
  paymentSurface?: string | null;
  deviceId?: string | null;
  merchantAccountId?: string | null;
  currency?: string | null;
  checkoutVersion?: string | null;
  expiresAt?: string | null;
}

/** Safe metadata only (§80–§82): a processor reference, brand and last four — never a PAN, CVV or payload. */
export interface AttemptMetaPatch { processorRef?: string | null; cardBrand?: string | null; cardLast4?: string | null; paymentId?: string | null; lastErrorCode?: string | null }

export interface UnresolvedAttempt extends MobileAttemptView { tenantId: string; branchId: string | null }

export interface MobilePaymentAttemptPort {
  /** Idempotent create: insert a 'created' attempt, or return the existing one for this (tenant, idempotency_key). */
  createOrGet(ctx: Ctx, input: CreateAttemptInput): Promise<MobileAttemptView>;
  findByKey(tenantId: string, idempotencyKey: string): Promise<MobileAttemptView | null>;
  /** SD-21 (Oct 27 2026): the attempt by key as the CALLER may see it — this salon AND the caller's session location (or a
   *  salon-wide row with no location), the same predicate as the checkout repository's payments / tickets. */
  findByKeyInBranch(ctx: Ctx, idempotencyKey: string): Promise<MobileAttemptView | null>;
  updateStatus(tenantId: string, idempotencyKey: string, status: PaymentAttemptState): Promise<MobileAttemptView | null>;
  /** Advance the status only if the row is still in the expected status (optimistic concurrency for the capture bridge). */
  updateStatusIf(tenantId: string, idempotencyKey: string, expectedStatus: string, status: PaymentAttemptState): Promise<boolean>;
  /** Record safe result metadata on the attempt (processor ref, brand/last4, the payment it produced, the last error). */
  setMeta(tenantId: string, idempotencyKey: string, patch: AttemptMetaPatch): Promise<void>;
  /** Mobile (tap_to_pay) attempts for a ticket, newest first — feeds the ticket-level history. */
  listForTicket(ctx: Ctx, ticketId: string): Promise<MobileAttemptView[]>;
  /** Recent mobile (tap_to_pay) attempts across all tickets for the tenant, newest first — feeds the History screen. */
  listRecent(ctx: Ctx, limit: number): Promise<MobileAttemptView[]>;
  /** Mobile (tap_to_pay) attempts created at/after sinceIso — feeds the Reports aggregate. */
  listSince(ctx: Ctx, sinceIso: string): Promise<MobileAttemptView[]>;
  /** §78 recovery worker: unresolved mobile attempts (authorization_pending / authorized / confirmation_pending / timed_out /
   *  unknown / reconciliation_required) not touched since `cutoff`, across tenants, oldest first. */
  listUnresolved(cutoff: Date, limit: number): Promise<UnresolvedAttempt[]>;
  /** §132: unused created / ready attempts past their expiry — moved to canceled. Returns how many. */
  expireStale(now: Date, limit: number): Promise<number>;
  /** Mandate §120: this phone's mobile attempts in one branch whose status is one of `statuses` (newest first, a few). */
  listForDeviceInStates?(tenantId: string, branchId: string, deviceId: string, statuses: readonly string[]): Promise<MobileAttemptView[]>;
}

const nowIso = () => new Date().toISOString();

// ── In-memory (tests) ──────────────────────────────────────────────────────────────────────────────────────────────
interface MemRow extends MobileAttemptView { tenantId: string; branchId: string | null }
export class InMemoryMobilePaymentAttemptRepository implements MobilePaymentAttemptPort {
  private rows: MemRow[] = [];
  async createOrGet(ctx: Ctx, input: CreateAttemptInput): Promise<MobileAttemptView> {
    const existing = this.rows.find((r) => r.tenantId === ctx.tenantId && r.idempotencyKey === input.idempotencyKey);
    if (existing) return this.view(existing);
    const row: MemRow = {
      tenantId: ctx.tenantId, branchId: ctx.branchId ?? null, id: `att_${this.rows.length + 1}`,
      ticketId: input.ticketId, amountCents: input.amountCents, method: input.method ?? MOBILE_ATTEMPT_METHOD,
      status: 'created', idempotencyKey: input.idempotencyKey, createdAt: nowIso(), updatedAt: nowIso(),
      provider: input.provider ?? null, paymentSurface: input.paymentSurface ?? null, deviceId: input.deviceId ?? null,
      merchantAccountId: input.merchantAccountId ?? null, currency: input.currency ?? null, checkoutVersion: input.checkoutVersion ?? null,
      expiresAt: input.expiresAt ?? null, processorRef: null, cardBrand: null, cardLast4: null, paymentId: null, lastErrorCode: null,
    };
    this.rows.push(row);
    return { ...this.view(row), wasCreated: true };
  }
  async findByKey(tenantId: string, idempotencyKey: string): Promise<MobileAttemptView | null> {
    const r = this.rows.find((x) => x.tenantId === tenantId && x.idempotencyKey === idempotencyKey);
    return r ? this.view(r) : null;
  }
  async findByKeyInBranch(ctx: Ctx, idempotencyKey: string): Promise<MobileAttemptView | null> {
    const r = this.rows.find((x) => x.tenantId === ctx.tenantId && x.idempotencyKey === idempotencyKey && (!ctx.branchId || x.branchId === null || x.branchId === ctx.branchId));
    return r ? this.view(r) : null;
  }
  async updateStatus(tenantId: string, idempotencyKey: string, status: PaymentAttemptState): Promise<MobileAttemptView | null> {
    const r = this.rows.find((x) => x.tenantId === tenantId && x.idempotencyKey === idempotencyKey);
    if (!r) return null;
    r.status = status; r.updatedAt = nowIso();
    return this.view(r);
  }
  async updateStatusIf(tenantId: string, idempotencyKey: string, expectedStatus: string, status: PaymentAttemptState): Promise<boolean> {
    const r = this.rows.find((x) => x.tenantId === tenantId && x.idempotencyKey === idempotencyKey);
    if (!r || r.status !== expectedStatus) return false;
    r.status = status; r.updatedAt = nowIso();
    return true;
  }
  async setMeta(tenantId: string, idempotencyKey: string, patch: AttemptMetaPatch): Promise<void> {
    const r = this.rows.find((x) => x.tenantId === tenantId && x.idempotencyKey === idempotencyKey);
    if (!r) return;
    if (patch.processorRef !== undefined) r.processorRef = patch.processorRef;
    if (patch.cardBrand !== undefined) r.cardBrand = patch.cardBrand;
    if (patch.cardLast4 !== undefined) r.cardLast4 = patch.cardLast4 && /^[0-9]{4}$/.test(patch.cardLast4) ? patch.cardLast4 : null;
    if (patch.paymentId !== undefined) r.paymentId = patch.paymentId;
    if (patch.lastErrorCode !== undefined) r.lastErrorCode = patch.lastErrorCode;
    r.updatedAt = nowIso();
  }
  async listForTicket(ctx: Ctx, ticketId: string): Promise<MobileAttemptView[]> {
    return this.rows
      .filter((r) => r.tenantId === ctx.tenantId && r.ticketId === ticketId && r.method === MOBILE_ATTEMPT_METHOD)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((r) => this.view(r));
  }
  async listRecent(ctx: Ctx, limit: number): Promise<MobileAttemptView[]> {
    return this.rows
      .filter((r) => r.tenantId === ctx.tenantId && r.method === MOBILE_ATTEMPT_METHOD)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, Math.max(0, limit))
      .map((r) => this.view(r));
  }
  async listSince(ctx: Ctx, sinceIso: string): Promise<MobileAttemptView[]> {
    return this.rows
      .filter((r) => r.tenantId === ctx.tenantId && r.method === MOBILE_ATTEMPT_METHOD && r.createdAt >= sinceIso)
      .map((r) => this.view(r));
  }
  async listUnresolved(cutoff: Date, limit: number): Promise<UnresolvedAttempt[]> {
    return this.rows
      .filter((r) => r.method === MOBILE_ATTEMPT_METHOD && UNRESOLVED.includes(r.status as PaymentAttemptState) && Date.parse(r.updatedAt) <= cutoff.getTime())
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).slice(0, Math.max(0, limit))
      .map((r) => ({ ...this.view(r), tenantId: r.tenantId, branchId: r.branchId }));
  }
  async expireStale(now: Date, limit: number): Promise<number> {
    let n = 0;
    for (const r of this.rows) {
      if (n >= limit) break;
      if (r.method === MOBILE_ATTEMPT_METHOD && (r.status === 'created' || r.status === 'ready') && r.expiresAt && Date.parse(r.expiresAt) <= now.getTime()) { r.status = 'canceled'; r.lastErrorCode = 'PAYMENT_CANCELED'; r.updatedAt = nowIso(); n++; }
    }
    return n;
  }
  async listForDeviceInStates(tenantId: string, branchId: string, deviceId: string, statuses: readonly string[]): Promise<MobileAttemptView[]> {
    return this.rows
      .filter((r) => r.tenantId === tenantId && r.branchId === branchId && r.deviceId === deviceId && r.method === MOBILE_ATTEMPT_METHOD && statuses.includes(r.status))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20)
      .map((r) => this.view(r));
  }
  private view(r: MemRow): MobileAttemptView {
    const { tenantId: _t, branchId: _b, ...v } = r; void _t; void _b; return { ...v };
  }
}

/** §78: the states a durable worker watches — the attempt left 'ready' but no final answer was recorded. */
export const UNRESOLVED: readonly PaymentAttemptState[] = ['authorization_pending', 'authorized', 'confirmation_pending', 'timed_out', 'unknown', 'reconciliation_required'];

// ── Kysely (production) ────────────────────────────────────────────────────────────────────────────────────────────
function isUniqueViolation(e: any): boolean {
  return e && (e.code === '23505' || /duplicate key|unique/i.test(String(e?.message || '')));
}
const iso = (v: any) => (v ? new Date(v).toISOString() : null);
/** The columns mapRow reads — every payment_attempts read selects exactly these (no whole-row reads). */
const ATTEMPT_COLS = ['id', 'ticket_id', 'amount_cents', 'method', 'status', 'idempotency_key', 'created_at', 'updated_at', 'provider', 'payment_surface',
  'device_id', 'merchant_account_id', 'currency', 'checkout_version', 'processor_ref', 'card_brand', 'card_last4', 'payment_id', 'last_error_code', 'expires_at'] as const;

function mapRow(d: any): MobileAttemptView {
  const status = String(d.status);
  return {
    id: d.id, ticketId: d.ticket_id, amountCents: Number(d.amount_cents), method: d.method,
    status: isValidState(status) ? status : status, idempotencyKey: d.idempotency_key,
    createdAt: new Date(d.created_at).toISOString(), updatedAt: new Date(d.updated_at).toISOString(),
    provider: d.provider ?? null, paymentSurface: d.payment_surface ?? null, deviceId: d.device_id ?? null,
    merchantAccountId: d.merchant_account_id ?? null, currency: d.currency ?? null, checkoutVersion: d.checkout_version ?? null,
    processorRef: d.processor_ref ?? null, cardBrand: d.card_brand ?? null, cardLast4: d.card_last4 ?? null,
    paymentId: d.payment_id ?? null, lastErrorCode: d.last_error_code ?? null, expiresAt: iso(d.expires_at),
  };
}

export class KyselyMobilePaymentAttemptRepository implements MobilePaymentAttemptPort {
  constructor(private readonly db: Kysely<DB>) {}

  async findByKey(tenantId: string, idempotencyKey: string): Promise<MobileAttemptView | null> {
    const r: any = await this.db.selectFrom('payment_attempts')
      .select([...ATTEMPT_COLS]).where('tenant_id', '=', tenantId).where('idempotency_key', '=', idempotencyKey)
      .executeTakeFirst();
    return r ? mapRow(r) : null;
  }

  async findByKeyInBranch(ctx: Ctx, idempotencyKey: string): Promise<MobileAttemptView | null> {
    let q = this.db.selectFrom('payment_attempts').select([...ATTEMPT_COLS]).where('tenant_id', '=', ctx.tenantId).where('idempotency_key', '=', idempotencyKey);
    const branchId = ctx.branchId;
    if (branchId) q = q.where((eb) => eb.or([eb('branch_id', '=', branchId), eb('branch_id', 'is', null)]));
    const r = await q.executeTakeFirst();
    return r ? mapRow(r) : null;
  }

  async createOrGet(ctx: Ctx, input: CreateAttemptInput): Promise<MobileAttemptView> {
    try {
      const r: any = await this.db.insertInto('payment_attempts').values({
        tenant_id: ctx.tenantId, branch_id: ctx.branchId ?? null, ticket_id: input.ticketId,
        amount_cents: input.amountCents, method: input.method ?? MOBILE_ATTEMPT_METHOD,
        status: 'created', idempotency_key: input.idempotencyKey,
        provider: input.provider ?? null, payment_surface: input.paymentSurface ?? null, device_id: input.deviceId ?? null,
        merchant_account_id: input.merchantAccountId ?? null, currency: input.currency ?? null, checkout_version: input.checkoutVersion ?? null,
        expires_at: input.expiresAt ? new Date(input.expiresAt) : null,
      }).returningAll().executeTakeFirst();
      if (r) return { ...mapRow(r), wasCreated: true };
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
    // UNIQUE(tenant, idempotency_key) rejected the insert → return the existing attempt (idempotent).
    const existing = await this.findByKey(ctx.tenantId, input.idempotencyKey);
    if (existing) return existing;
    throw new Error('payment attempt create failed and no existing row found');
  }

  /** Phase 12 (#27): through the payment_attempt machine — only from a state the target may be reached from (a concurrent
   *  move is refused with 409 INVALID_STATE_TRANSITION, not overwritten). */
  async updateStatus(tenantId: string, idempotencyKey: string, status: PaymentAttemptState): Promise<MobileAttemptView | null> {
    const moved = await transitionStatus(this.db, PAYMENT_ATTEMPT, { where: { tenant_id: tenantId, idempotency_key: idempotencyKey }, to: status, set: { updated_at: sql`now()` } });
    return moved ? this.findByKey(tenantId, idempotencyKey) : null;
  }

  async updateStatusIf(tenantId: string, idempotencyKey: string, expectedStatus: string, status: PaymentAttemptState): Promise<boolean> {
    try { return (await transitionStatus(this.db, PAYMENT_ATTEMPT, { where: { tenant_id: tenantId, idempotency_key: idempotencyKey }, from: expectedStatus, to: status, set: { updated_at: sql`now()` } })) !== null; }
    catch (e) { if (e instanceof InvalidStateTransitionError) return false; throw e; }
  }

  async setMeta(tenantId: string, idempotencyKey: string, patch: AttemptMetaPatch): Promise<void> {
    const set: Record<string, unknown> = { updated_at: sql`now()` };
    if (patch.processorRef !== undefined) set.processor_ref = patch.processorRef;
    if (patch.cardBrand !== undefined) set.card_brand = patch.cardBrand ? String(patch.cardBrand).slice(0, 32) : null;
    if (patch.cardLast4 !== undefined) set.card_last4 = patch.cardLast4 && /^[0-9]{4}$/.test(patch.cardLast4) ? patch.cardLast4 : null;
    if (patch.paymentId !== undefined) set.payment_id = patch.paymentId;
    if (patch.lastErrorCode !== undefined) set.last_error_code = patch.lastErrorCode ? String(patch.lastErrorCode).slice(0, 64) : null;
    await this.db.updateTable('payment_attempts').set(set).where('tenant_id', '=', tenantId).where('idempotency_key', '=', idempotencyKey).execute();
  }

  async listForTicket(ctx: Ctx, ticketId: string): Promise<MobileAttemptView[]> {
    const rows: any[] = await this.db.selectFrom('payment_attempts')
      .select([...ATTEMPT_COLS]).where('tenant_id', '=', ctx.tenantId).where('ticket_id', '=', ticketId)
      .where('method', '=', MOBILE_ATTEMPT_METHOD).orderBy('created_at', 'desc')
      .execute();
    return rows.map(mapRow);
  }

  async listRecent(ctx: Ctx, limit: number): Promise<MobileAttemptView[]> {
    const rows: any[] = await this.db.selectFrom('payment_attempts')
      .select([...ATTEMPT_COLS]).where('tenant_id', '=', ctx.tenantId)
      .where('method', '=', MOBILE_ATTEMPT_METHOD).orderBy('created_at', 'desc')
      .limit(Math.max(1, Math.min(200, limit))).execute();
    return rows.map(mapRow);
  }

  async listSince(ctx: Ctx, sinceIso: string): Promise<MobileAttemptView[]> {
    const rows: any[] = await this.db.selectFrom('payment_attempts')
      .select([...ATTEMPT_COLS]).where('tenant_id', '=', ctx.tenantId)
      .where('method', '=', MOBILE_ATTEMPT_METHOD).where('created_at', '>=', new Date(sinceIso))
      .orderBy('created_at', 'desc').limit(2000).execute();
    return rows.map(mapRow);
  }

  async listUnresolved(cutoff: Date, limit: number): Promise<UnresolvedAttempt[]> {
    const rows: any[] = await this.db.selectFrom('payment_attempts')
      // the recovery worker's scan is CROSS-TENANT by design (a system scheduler, no request tenant): each row carries its
      // own tenant_id / branch_id and every follow-up read / write is made under THAT tenant (mobile-attempt-recovery.ts)
      .select([...ATTEMPT_COLS, 'tenant_id', 'branch_id']).where('method', '=', MOBILE_ATTEMPT_METHOD).where('status', 'in', [...UNRESOLVED]).where('updated_at', '<=', cutoff)
      .orderBy('updated_at', 'asc').limit(Math.max(1, Math.min(500, limit))).execute();
    return rows.map((r) => ({ ...mapRow(r), tenantId: String(r.tenant_id), branchId: r.branch_id ? String(r.branch_id) : null }));
  }

  async listForDeviceInStates(tenantId: string, branchId: string, deviceId: string, statuses: readonly string[]): Promise<MobileAttemptView[]> {
    if (!statuses.length) return [];
    const rows: any[] = await this.db.selectFrom('payment_attempts')
      .select([...ATTEMPT_COLS]).where('tenant_id', '=', tenantId).where('branch_id', '=', branchId).where('device_id', '=', deviceId)
      .where('method', '=', MOBILE_ATTEMPT_METHOD).where('status', 'in', [...statuses])
      .orderBy('created_at', 'desc').limit(20).execute();
    return rows.map(mapRow);
  }

  async expireStale(now: Date, limit: number): Promise<number> {
    const rows: any[] = await this.db.selectFrom('payment_attempts').select(['tenant_id', 'idempotency_key', 'status'])
      .where('method', '=', MOBILE_ATTEMPT_METHOD).where('status', 'in', ['created', 'ready']).where('expires_at', 'is not', null).where('expires_at', '<=', now)
      .limit(Math.max(1, Math.min(500, limit))).execute();
    let n = 0;
    for (const r of rows) {
      // through the machine: only a row still created/ready moves (a tap that started meanwhile is left alone)
      const ok = await transitionStatus(this.db, PAYMENT_ATTEMPT, { where: { tenant_id: r.tenant_id, idempotency_key: r.idempotency_key }, from: r.status, to: 'canceled', set: { updated_at: sql`now()`, last_error_code: 'PAYMENT_CANCELED' } }).catch(() => null);
      if (ok) n++;
    }
    return n;
  }
}
