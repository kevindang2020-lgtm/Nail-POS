// wallet-topup-intents.ts — Remaining-work mandate P1-1 / B-79 (Oct 23 2026): the durable wallet top-up INTENT (migration
// 679). A top-up is a row before it is a charge, so a lost or unknown processor answer always has an owner: the customer's
// retry (same client key), the stranded sweep and a staff / customer Verify all settle the SAME intent from the processor's
// record (inquireByOrderid with the intent id as the order id). Every settle is a conditional UPDATE from
// PROCESSING / UNKNOWN, so under a race exactly one caller moves the row; the ledger credit is keyed 'topup:<id>' and the
// ledger's unique (tenant_id, idempotency_key) index makes "credited exactly once" true whoever wins.
import { sql, type Kysely, type RawBuilder, type SqlBool } from 'kysely';
import { canMoveToSql, type DB } from '@aipowersalon/database';
import { WALLET_TOPUP_INTENT } from '../payments-lifecycles';
import type { InquiryTransaction } from '../payments/payment-processor.port';

export type TopUpIntentStatus = 'CREATED' | 'PROCESSING' | 'APPROVED' | 'DECLINED' | 'UNKNOWN' | 'FAILED' | 'CANCELED';
/** Settled = the processor's answer is known and recorded; nothing more will ever move the row. */
export const SETTLED_TOPUP: ReadonlySet<TopUpIntentStatus> = new Set<TopUpIntentStatus>(['APPROVED', 'DECLINED', 'FAILED', 'CANCELED']);
/** The states Verify / the sweep may settle from (a charge may be on the card). */
export const OPEN_TOPUP: readonly TopUpIntentStatus[] = ['PROCESSING', 'UNKNOWN'];

export interface TopUpIntent {
  id: string; tenantId: string; customerId: string; paymentMethodId: string | null; amountCents: number; currency: string;
  status: TopUpIntentStatus; clientKey: string | null; attempt: number; processor: string | null; processorTransactionId: string | null;
  respText: string | null; failureReason: string | null; settledBy: string | null; lastInquiredAt: string | null; settledAt: string | null;
  createdAt: string; updatedAt: string;
}
export interface SettlePatch {
  status: Exclude<TopUpIntentStatus, 'CREATED' | 'PROCESSING'>;
  processor?: string | null; processorTransactionId?: string | null; respText?: string | null; failureReason?: string | null;
  /** 'charge' (the live answer) | 'verify' | 'sweep' | 'webhook' */
  settledBy: string;
  /** the staff member whose Verify settled it (updated_by); absent for the customer's own tap and the sweep */
  actorUserId?: string | null;
}

export interface WalletTopupIntentStore {
  create(i: { tenantId: string; customerId: string; paymentMethodId: string | null; amountCents: number; clientKey: string | null; createdByUserId: string | null }): Promise<TopUpIntent>;
  get(tenantId: string, id: string): Promise<TopUpIntent | null>;
  findByClientKey(tenantId: string, customerId: string, clientKey: string): Promise<TopUpIntent | null>;
  listForCustomer(tenantId: string, customerId: string, limit: number): Promise<TopUpIntent[]>;
  /** CREATED | FAILED → PROCESSING, attempt + 1 — conditional: null when another caller holds it (or it is settled). */
  beginAttempt(tenantId: string, id: string, processor: string | null): Promise<TopUpIntent | null>;
  /** PROCESSING | UNKNOWN (or only `from`) → patch.status — conditional: false when someone else moved it first. */
  settle(tenantId: string, id: string, patch: SettlePatch, from?: readonly TopUpIntentStatus[]): Promise<boolean>;
  touchInquired(tenantId: string, id: string): Promise<void>;
  /** The sweep's population (every salon): PROCESSING / UNKNOWN intents older than the cutoff, oldest first. */
  stranded(cutoff: Date, limit: number): Promise<TopUpIntent[]>;
}

export type TopUpVerdict =
  | { action: 'approved'; retref: string | null; detail: string }
  | { action: 'declined'; retref: string | null; detail: string }
  | { action: 'release'; detail: string }        // the processor has no record of this order and the intent is old: nothing was charged
  | { action: 'wait'; detail: string }           // young, or the processor could not say
  | { action: 'review'; detail: string };        // more than one approved charge of this amount — a person must look

/** Pure. The processor's record of THIS intent (order id = intent id) decides; only an unambiguous record moves money.
 *  Transactions of another amount are ignored (never credit a different amount than the customer asked for). */
export function decideTopUp(intent: { amountCents: number; ageMs: number }, txns: readonly InquiryTransaction[] | null, strandedMs: number): TopUpVerdict {
  if (txns === null) return { action: 'wait', detail: 'the processor could not be asked' };
  const mine = txns.filter((t) => t.amountCents == null || t.amountCents === intent.amountCents);
  const approved = mine.filter((t) => t.approved);
  if (approved.length > 1) return { action: 'review', detail: `The processor holds ${approved.length} approved charges of this amount for one top-up.` };
  if (approved.length === 1) return { action: 'approved', retref: approved[0].retref ?? null, detail: 'The processor approved this top-up.' };
  if (mine.some((t) => t.declined)) return { action: 'declined', retref: mine.find((t) => t.declined)?.retref ?? null, detail: 'The processor declined this top-up.' };
  if (intent.ageMs < strandedMs) return { action: 'wait', detail: 'no record yet; the intent is younger than the stranded window' };
  return { action: 'release', detail: 'The processor has no record of this top-up: nothing was charged.' };
}

/** §15 (Oct 27 2026): the intent a processor order id names. A top-up is charged with orderId = intent id and the key
 *  'topup:<id>:<attempt>', so a webhook may carry either form; anything else (a ticket id, empty) is not a top-up. Pure. */
export function topUpIntentIdFromOrder(orderId: string | null | undefined): string | null {
  let v = String(orderId ?? '').trim();
  if (!v || v.length > 128) return null;
  if (/^topup:/i.test(v)) v = v.slice(6).split(':')[0];
  return /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (v: any) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));
type IntentRow = { [K in (typeof COLS)[number]]: unknown };
const row = (r: IntentRow | Record<string, any>): TopUpIntent => ({
  id: r.id, tenantId: r.tenant_id, customerId: r.customer_id, paymentMethodId: r.payment_method_id ?? null, amountCents: Number(r.amount_cents), currency: r.currency ?? 'USD',
  status: r.status, clientKey: r.client_key ?? null, attempt: Number(r.attempt ?? 0), processor: r.processor ?? null, processorTransactionId: r.processor_transaction_id ?? null,
  respText: r.resp_text ?? null, failureReason: r.failure_reason ?? null, settledBy: r.settled_by ?? null, lastInquiredAt: iso(r.last_inquired_at), settledAt: iso(r.settled_at),
  createdAt: iso(r.created_at)!, updatedAt: iso(r.updated_at)!,
});

/** The columns an intent view needs (never a payment token — the intent holds none, only the saved method's id). */
const COLS = ['id', 'tenant_id', 'customer_id', 'payment_method_id', 'amount_cents', 'currency', 'status', 'client_key', 'attempt', 'processor', 'processor_transaction_id',
  'resp_text', 'failure_reason', 'settled_by', 'last_inquired_at', 'settled_at', 'created_at', 'updated_at'] as const;

export class KyselyWalletTopupIntentStore implements WalletTopupIntentStore {
  constructor(private readonly db: Kysely<DB>) {}
  /** Tenant-scoped read of one salon's intents. */
  private t(tenantId: string) { return this.db.selectFrom('wallet_topup_intents').select(COLS).where('tenant_id', '=', tenantId); }

  async create(i: { tenantId: string; customerId: string; paymentMethodId: string | null; amountCents: number; clientKey: string | null; createdByUserId: string | null }): Promise<TopUpIntent> {
    const r = await this.db.insertInto('wallet_topup_intents').values({ tenant_id: i.tenantId, customer_id: i.customerId, payment_method_id: i.paymentMethodId, amount_cents: i.amountCents,
      status: 'CREATED', client_key: i.clientKey, created_by_user_id: UUID.test(i.createdByUserId ?? '') ? i.createdByUserId : null }).returning(COLS).executeTakeFirstOrThrow();
    return row(r);
  }
  async get(tenantId: string, id: string): Promise<TopUpIntent | null> {
    if (!UUID.test(id)) return null;   // a webhook's order id may be anything; the column is a uuid
    const r = await this.t(tenantId).where('id', '=', id).executeTakeFirst();
    return r ? row(r) : null;
  }
  async findByClientKey(tenantId: string, customerId: string, clientKey: string): Promise<TopUpIntent | null> {
    const r = await this.t(tenantId).where('customer_id', '=', customerId).where('client_key', '=', clientKey).executeTakeFirst();
    return r ? row(r) : null;
  }
  async listForCustomer(tenantId: string, customerId: string, limit: number): Promise<TopUpIntent[]> {
    const rs = await this.t(tenantId).where('customer_id', '=', customerId).orderBy('created_at', 'desc').limit(limit).execute();
    return rs.map(row);
  }
  async beginAttempt(tenantId: string, id: string, processor: string | null): Promise<TopUpIntent | null> {
    const r = await this.db.updateTable('wallet_topup_intents').set({ status: 'PROCESSING', attempt: sql<number>`attempt + 1`, processor, failure_reason: null, updated_at: sql<Date>`now()` })
      .where('tenant_id', '=', tenantId).where('id', '=', id).where(canMoveToSql(WALLET_TOPUP_INTENT, 'PROCESSING') as RawBuilder<SqlBool>).returning(COLS).executeTakeFirst();   // CREATED | FAILED → PROCESSING
    return r ? row(r) : null;
  }
  async settle(tenantId: string, id: string, patch: SettlePatch, from: readonly TopUpIntentStatus[] = OPEN_TOPUP): Promise<boolean> {
    const r = await this.db.updateTable('wallet_topup_intents').set({
      status: patch.status, settled_by: patch.settledBy, updated_at: sql<Date>`now()`,
      updated_by: patch.actorUserId && UUID.test(patch.actorUserId) ? patch.actorUserId : null,
      ...(patch.processor !== undefined ? { processor: patch.processor } : {}),
      ...(patch.processorTransactionId !== undefined ? { processor_transaction_id: patch.processorTransactionId } : {}),
      ...(patch.respText !== undefined ? { resp_text: patch.respText == null ? null : String(patch.respText).slice(0, 200) } : {}),
      ...(patch.failureReason !== undefined ? { failure_reason: patch.failureReason == null ? null : String(patch.failureReason).slice(0, 500) } : {}),
      ...(SETTLED_TOPUP.has(patch.status) ? { settled_at: sql<Date>`now()` } : {}),
    }).where('tenant_id', '=', tenantId).where('id', '=', id).where('status', 'in', [...from]).where(canMoveToSql(WALLET_TOPUP_INTENT, patch.status) as RawBuilder<SqlBool>).returning('id').executeTakeFirst();   // the caller's from-set AND the machine
    return !!r;
  }
  async touchInquired(tenantId: string, id: string): Promise<void> {
    await this.db.updateTable('wallet_topup_intents').set({ last_inquired_at: sql<Date>`now()` }).where('tenant_id', '=', tenantId).where('id', '=', id).execute();
  }
  async stranded(cutoff: Date, limit: number): Promise<TopUpIntent[]> {
    // The stranded sweep's population is EVERY salon's open intents (one owner per tick, under the payments.stranded_attempts
    // lease); each row is then verified and settled under its own tenant id. Reviewed cross-tenant read (tenant-builder baseline).
    const rs = await this.db.selectFrom('wallet_topup_intents').select(COLS).where('status', 'in', [...OPEN_TOPUP]).where('created_at', '<', cutoff).orderBy('created_at', 'asc').limit(limit).execute();
    return rs.map(row);
  }
}

/** Tests / DB-less development. Same conditional semantics as the SQL store. */
export class InMemoryWalletTopupIntentStore implements WalletTopupIntentStore {
  readonly rows: TopUpIntent[] = [];
  private n = 0;
  async create(i: { tenantId: string; customerId: string; paymentMethodId: string | null; amountCents: number; clientKey: string | null; createdByUserId: string | null }): Promise<TopUpIntent> {
    if (i.clientKey && this.rows.some((r) => r.tenantId === i.tenantId && r.customerId === i.customerId && r.clientKey === i.clientKey)) throw new Error('duplicate key value violates unique constraint "uq_wallet_topup_intents_client_key"');
    const now = new Date().toISOString();
    const r: TopUpIntent = { id: `tui-${++this.n}`, tenantId: i.tenantId, customerId: i.customerId, paymentMethodId: i.paymentMethodId, amountCents: i.amountCents, currency: 'USD', status: 'CREATED', clientKey: i.clientKey,
      attempt: 0, processor: null, processorTransactionId: null, respText: null, failureReason: null, settledBy: null, lastInquiredAt: null, settledAt: null, createdAt: now, updatedAt: now };
    this.rows.push(r); return { ...r };
  }
  async get(tenantId: string, id: string) { const r = this.rows.find((x) => x.tenantId === tenantId && x.id === id); return r ? { ...r } : null; }
  async findByClientKey(tenantId: string, customerId: string, clientKey: string) { const r = this.rows.find((x) => x.tenantId === tenantId && x.customerId === customerId && x.clientKey === clientKey); return r ? { ...r } : null; }
  async listForCustomer(tenantId: string, customerId: string, limit: number) { return this.rows.filter((x) => x.tenantId === tenantId && x.customerId === customerId).slice(-limit).reverse().map((x) => ({ ...x })); }
  async beginAttempt(tenantId: string, id: string, processor: string | null) {
    const r = this.rows.find((x) => x.tenantId === tenantId && x.id === id && WALLET_TOPUP_INTENT.sourcesOf('PROCESSING').includes(x.status));
    if (!r) return null;
    r.status = 'PROCESSING'; r.attempt += 1; r.processor = processor; r.failureReason = null; r.updatedAt = new Date().toISOString();
    return { ...r };
  }
  async settle(tenantId: string, id: string, patch: SettlePatch, from: readonly TopUpIntentStatus[] = OPEN_TOPUP) {
    const r = this.rows.find((x) => x.tenantId === tenantId && x.id === id && from.includes(x.status) && WALLET_TOPUP_INTENT.sourcesOf(patch.status).includes(x.status));
    if (!r) return false;
    r.status = patch.status; r.settledBy = patch.settledBy; r.updatedAt = new Date().toISOString();
    if (patch.processor !== undefined) r.processor = patch.processor ?? null;
    if (patch.processorTransactionId !== undefined) r.processorTransactionId = patch.processorTransactionId ?? null;
    if (patch.respText !== undefined) r.respText = patch.respText ?? null;
    if (patch.failureReason !== undefined) r.failureReason = patch.failureReason ?? null;
    if (SETTLED_TOPUP.has(patch.status)) r.settledAt = r.updatedAt;
    return true;
  }
  async touchInquired(tenantId: string, id: string) { const r = this.rows.find((x) => x.tenantId === tenantId && x.id === id); if (r) r.lastInquiredAt = new Date().toISOString(); }
  async stranded(cutoff: Date, limit: number) { return this.rows.filter((x) => OPEN_TOPUP.includes(x.status) && Date.parse(x.createdAt) < cutoff.getTime()).slice(0, limit).map((x) => ({ ...x })); }
}
