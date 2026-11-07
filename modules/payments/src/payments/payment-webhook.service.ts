// payment-webhook.service.ts — inbound payment-gateway webhook intake (Payment Gateway Isolation §14).
//
// Isolation guarantees enforced here:
//   • Tenant is resolved ONLY by the webhook's merchant id (resolveTenantByMerchantId); an unknown or ambiguous
//     merchant id is rejected and never touches any tenant's data.
//   • The signature is verified against THAT tenant's own webhook secret (HMAC-SHA256).
//   • Any payment mutation is scoped to `WHERE tenant_id = <resolved> AND processor_transaction_id = <txn>`, so a
//     webhook for tenant A can never update tenant B's payment — even if it references B's transaction id.
//   • Idempotent: an event_id already processed is skipped (no double-apply).
// Every event (accepted, rejected, or bad-signature) is recorded in payment_gateway_events as the audit trail.
//
// NOTE (honest): signature is verified over the JSON the app re-serializes. A production processor signs the RAW request
// bytes, so live verification needs raw-body capture + the processor's exact scheme/header — wire that when the real
// gateway sandbox is available. The tenant-isolation logic below is independent of that detail.
import { checkWebhookPayload, unknownFieldMode, webhookFamily } from './webhook-payload-schemas';   // Security Deep Scan §110
import { canMoveToSql } from '@aipowersalon/database';
import { PAYMENT, CHARGEBACK, MERCHANT_ONBOARDING, PAYMENT_REFUND } from '../payments-lifecycles';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { maskValueSecrets } from '@aipowersalon/observability';
import { sql, type Kysely, type RawBuilder, type SqlBool } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { PaymentGatewayResolver } from './payment-gateway.resolver';

export interface WebhookResult { status: number; body: Record<string, unknown>; }

const SENSITIVE = ['secret', 'password', 'cvv', 'account', 'pan', 'card', 'apikey', 'api_key'];

function pick(o: any, keys: string[]): string | null {
  for (const k of keys) { const v = o?.[k]; if (v != null && v !== '') return String(v); }
  return null;
}
function pickNum(o: any, keys: string[]): number | null {
  for (const k of keys) { const v = o?.[k]; if (v != null && v !== '' && !Number.isNaN(Number(v))) return Math.round(Number(v)); }
  return null;
}
/** CardPointe sends `amount` as a dollar string ("50.00"); a whole number with no point is taken as cents. */
function amountFromDollars(v: unknown): number | null {
  if (v == null || v === '') return null;
  const t = String(v).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return t.includes('.') ? Math.round(Number(t) * 100) : Number(t);
}
/** A money field from the processor in integer cents: an explicit `…Cents` key is cents; a plain `amount` / `gross` / `fee` /
 *  `net` is CardPointe's dollar string ("50.00" → 5000). It used to be Math.round(Number("50.00")) = 50 — refunds,
 *  settlements and chargebacks were stored 100× too small (guide audit Nov 3 2026). */
export function centsFrom(o: any, centsKeys: string[], dollarKeys: string[]): number | null {
  for (const k of centsKeys) { const v = o?.[k]; if (v != null && v !== '' && Number.isFinite(Number(v))) return Math.round(Number(v)); }
  for (const k of dollarKeys) { const c = amountFromDollars(o?.[k]); if (c != null) return c; }
  return null;
}
function isRefundEvent(e: string): boolean { return e.toLowerCase().includes('refund'); }
/** Settlements guide (Nov 4 2026): a refund event's OWN outcome — "refund.failed" / "refund_pending" used to be stored as
 *  refunded because the type merely contained "refund". The body's status wins over the event name. */
export function mapRefundStatus(eventType: string, body: any): 'refunded' | 'failed' | 'pending' | 'cancelled' {
  const x = (String(body?.status ?? body?.refundStatus ?? '') + ' ' + eventType).toLowerCase();
  if (/fail|declin|reject|error/.test(x)) return 'failed';
  if (/cancel|void/.test(x)) return 'cancelled';
  if (/pend|process|initiat|creat|submit|queue/.test(x) && !/complet|succe|settl|approv|refunded/.test(x)) return 'pending';
  return 'refunded';
}
/** a settlement batch's outcome from the processor (failed / returned / pending batches are not money in the bank) */
export function mapSettlementStatus(eventType: string, body: any): 'settled' | 'failed' | 'returned' | 'pending' {
  const x = (String(body?.status ?? body?.batchStatus ?? '') + ' ' + eventType).toLowerCase();
  if (/fail|reject|declin|error/.test(x)) return 'failed';
  if (/return|revers/.test(x)) return 'returned';
  if (/pend|open|process|submit/.test(x) && !/settled|complet|funded|paid/.test(x)) return 'pending';
  return 'settled';
}
/** the processor's own settlement time (ISO / date / epoch seconds or ms), never the time the callback happened to arrive */
export function providerTime(body: any, keys: string[]): string | null {
  for (const k of keys) {
    const v = body?.[k]; if (v == null || v === '') continue;
    const n = typeof v === 'number' || /^\d{10,13}$/.test(String(v)) ? Number(v) : NaN;
    const d = Number.isFinite(n) ? new Date(n < 1e12 ? n * 1000 : n) : /^\d{8}$/.test(String(v)) ? new Date(String(v).replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3T12:00:00Z')) : new Date(String(v));
    if (!Number.isNaN(d.getTime()) && d.getUTCFullYear() > 2000 && d.getTime() < Date.now() + 2 * 86_400_000) return d.toISOString();
  }
  return null;
}
function isSettlementEvent(e: string): boolean { const x = e.toLowerCase(); return x.includes('settl') || x.includes('batch'); }
// Chargeback / dispute events land in the `chargebacks` table. Pure + exported so the classification can be unit-tested.
export function isChargebackEvent(e: string): boolean { const x = e.toLowerCase(); return x.includes('chargeback') || x.includes('dispute'); }
export function mapChargebackStatus(e: string): string {
  const x = e.toLowerCase();
  if (x.includes('won')) return 'won';
  if (x.includes('lost')) return 'lost';
  if (x.includes('refund') || x.includes('revers')) return 'refunded';
  if (x.includes('expire')) return 'expired';
  if (x.includes('review') || x.includes('respond') || x.includes('represent')) return 'under_review';
  return 'needs_response'; // created / opened / received / unknown → an OPEN alert
}
export const CHARGEBACK_RESOLVED = ['won', 'lost', 'refunded', 'expired'];
// Merchant-application / underwriting events drive tenant_payment_config.onboarding_status. Pure + exported for tests.
export function isOnboardingEvent(e: string): boolean { const x = e.toLowerCase(); return x.includes('underwriting') || x.includes('application') || x.includes('onboarding'); }
export function mapOnboardingStatus(e: string): string | null {
  const x = e.toLowerCase();
  if (x.includes('approv')) return 'approved';
  if (x.includes('declin') || x.includes('reject') || x.includes('denied')) return 'declined';
  if (x.includes('review') || x.includes('pending')) return 'under_review';
  if (x.includes('submit') || x.includes('received') || x.includes('created')) return 'submitted';
  return null; // unrelated phase → don't change the stored status
}
/** The transaction ids a settlement event covers: its own transaction id plus any list the processor sends
 *  (`transactionIds` / `txnIds` / `transactions[].transactionId|retref|id`). Strings only, deduplicated, capped at 5,000. */
export function settlementTxnIds(body: any, txnId: string | null | undefined): string[] {
  const out = new Set<string>();
  const add = (v: unknown) => { if (typeof v === 'string' && v.trim() && v.length <= 128) out.add(v.trim()); else if (typeof v === 'number' && Number.isFinite(v)) out.add(String(v)); };
  add(txnId);
  for (const k of ['transactionIds', 'txnIds', 'transaction_ids']) if (Array.isArray(body?.[k])) for (const v of body[k]) add(v);
  if (Array.isArray(body?.transactions)) for (const t of body.transactions) add(t?.transactionId ?? t?.processorTransactionId ?? t?.retref ?? t?.id);
  return [...out].slice(0, 5000);
}

/** Payment statuses a verified webhook may move FROM (all are provider-approved states). */
export const WEBHOOK_MOVABLE_FROM = ['approved', 'captured', 'completed', 'succeeded', 'partial', 'settled', 'partially_refunded'] as const;
function mapStatus(eventType: string): string | null {
  const e = eventType.toLowerCase();
  if (e.includes('void')) return 'voided';
  // A refund never moves the ORIGINAL tender's status: it is its own payment_refunds row (as the POS refund path does —
  // the original stays approved). Marking the original 'refunded' made a partial refund erase the whole sale from
  // Collections / Transactions while the refund was still deducted (guide audit Nov 3 2026).
  if (e.includes('refund')) return null;
  if (e.includes('settl') || e.includes('captur')) return 'settled';
  return null; // informational event → recorded, no payment status change
}
export function safePayload(p: any): unknown {
  if (Array.isArray(p)) return p.map((e) => safePayload(e));
  if (typeof p === 'string') return maskValueSecrets(p);
  if (!p || typeof p !== 'object') return p ?? null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) {
    if (SENSITIVE.some((s) => k.toLowerCase().includes(s))) continue; // never persist anything secret-looking, at any depth
    // Security Deep Scan §128: a free-text value can still carry a card number / key / bearer value — masked by VALUE too
    out[k] = (v && typeof v === 'object') ? safePayload(v) : typeof v === 'string' ? maskValueSecrets(v) : v;
  }
  return out;
}

/**
 * Verify an HMAC-SHA256 webhook signature over the EXACT raw request bytes (hex digest, optional `sha256=` prefix),
 * with a timing-safe compare. CRITICAL: `rawBody` must be the bytes the processor actually signed — never a re-serialized
 * copy of the parsed JSON, because key order / whitespace differ and the HMAC won't match. Pure + exported so the security
 * property can be unit-tested directly (and so the raw-body capture in the controller is the only thing that varies).
 */
export function verifyWebhookSignature(rawBody: string, header: string, secret: string | null): boolean {
  if (!secret || !header) return false;
  const provided = header.replace(/^sha256=/i, '').trim();
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  const a = Buffer.from(expected, 'utf8'); const b = Buffer.from(provided, 'utf8');
  if (a.length !== b.length) return false;
  try { return timingSafeEqual(a, b); } catch { return false; }
}

// ---- Signature verification ------------------------------------------------------------------------------------------
// The platform's processors — Fiserv / CardConnect (CardPointe) and Clover — sign webhooks with a generic HMAC-SHA256 (hex)
// over the raw body, compared timing-safely. The exact header/scheme is confirmed against the processor sandbox later.
export type SigScheme = 'hmac_sha256_hex';
export interface SigVerifyInput {
  rawBody: string;
  secret: string | null;
  processor: string;
  headers?: Record<string, string | string[] | undefined>;
  fallbackHeader?: string;      // legacy single-header path
}
export interface SigVerifyResult { valid: boolean; scheme: SigScheme; reason?: string }

export function schemeForProcessor(_processor: string): SigScheme {
  return 'hmac_sha256_hex'; // Fiserv / CardConnect (CardPointe) and Clover all use generic HMAC-SHA256 hex
}

function headerStr(h: Record<string, string | string[] | undefined> | undefined, name: string): string {
  const v = h?.[name] ?? h?.[name.toLowerCase()];
  return Array.isArray(v) ? (v[0] || '') : (typeof v === 'string' ? v : '');
}

export function verifyProcessorSignature(input: SigVerifyInput): SigVerifyResult {
  const scheme = schemeForProcessor(input.processor);
  const secret = input.secret;
  if (!secret) return { valid: false, scheme, reason: 'no_secret' };
  const H = input.headers;
  // generic HMAC-SHA256 hex (also the legacy single-header fallback) — Fiserv / CardPointe / Clover
  const header = headerStr(H, 'x-webhook-signature') || headerStr(H, 'x-cardpointe-signature') || headerStr(H, 'x-signature') || (input.fallbackHeader || '');
  if (!header) return { valid: false, scheme, reason: 'missing_header' };
  const ok = verifyWebhookSignature(input.rawBody, header, secret);
  return { valid: ok, scheme, reason: ok ? undefined : 'signature_mismatch' };
}

/** Security Deep Scan E7: the processor FAMILY a webhook path or a tenant's configured processor belongs to. CardPointe /
 *  CardConnect / Bolt are Fiserv products and post to the same scheme; Clover is its own. Unknown names stay themselves. */
export function processorFamily(p: string | null | undefined): string {
  const v = String(p ?? '').trim().toLowerCase();
  if (['fiserv', 'cardpointe', 'cardconnect', 'bolt', 'commercehub'].includes(v)) return 'fiserv';
  return v;
}

/** §15 / §16 / §58 (Oct 27 2026): what a webhook says about a CHARGE (not a refund / void / dispute / batch / onboarding
 *  notice): approved, declined, or neither (pending / informational). CardPointe's respstat (A approved · C declined ·
 *  B retry) wins over the event name. Pure + exported for tests. */
export function chargeEventOutcome(eventType: string, body: any): { approved: boolean; declined: boolean } | null {
  const e = String(eventType ?? '').toLowerCase();
  if (isRefundEvent(e) || isChargebackEvent(e) || isOnboardingEvent(e) || e.includes('void') || isSettlementEvent(e)) return null;
  const rs = String(body?.respstat ?? body?.respStat ?? '').trim().toUpperCase();
  if (rs === 'A') return { approved: true, declined: false };
  if (rs === 'C') return { approved: false, declined: true };
  if (rs === 'B') return { approved: false, declined: false };
  const st = String(body?.status ?? body?.transactionState ?? '').toLowerCase();
  if (/declin/.test(e) || /declin/.test(st)) return { approved: false, declined: true };
  if (/approv|captur/.test(e) || /^(approved|captured)$/.test(st)) return { approved: true, declined: false };
  return { approved: false, declined: false };
}

/** The wallet top-up settler the webhook hands a top-up order to (WalletTopupService.settleFromWebhook) — injected
 *  lazily so the webhook module does not own the wallet module. */
export interface TopUpWebhookSettler {
  settleFromWebhook(tenantId: string, orderId: string, evt: { approved: boolean; declined: boolean; retref: string | null; amountCents: number | null; respText?: string | null }): Promise<{ matched: boolean; intentId?: string; status?: string; settledByThis?: boolean }>;
}

export class PaymentWebhookService {
  constructor(private readonly db: Kysely<DB> | null, private readonly resolver: PaymentGatewayResolver, private readonly topUps: (() => TopUpWebhookSettler | null) | null = null) {}

  /** Phase 10 §19: stamp settlement_batch_id on this salon's payments the batch names (first link wins). Returns the count. */
  private async linkSettlementPayments(tenantId: string, settlementRowId: string, txnIds: string[]): Promise<number> {
    if (!this.db || !txnIds.length) return 0;
    const r: any = await this.db.updateTable('payments').set({ settlement_batch_id: settlementRowId, updated_at: sql`now()` })
      .where('tenant_id', '=', tenantId).where('processor_transaction_id', 'in', txnIds).where('settlement_batch_id', 'is', null)
      .executeTakeFirst();
    return Number(r?.numUpdatedRows ?? 0);
  }

  private async record(row: Record<string, unknown>): Promise<void> { await this.claim(row); }

  /** Insert one ledger row. For a PROCESSED row this is the event's claim: false = another delivery of the same
   *  (processor, event id) already holds it (Phase 14: the claim gates every effect below — a concurrent retry applies
   *  nothing). */
  private async claim(row: Record<string, unknown>): Promise<string | false> {
    if (!this.db) return false;
    // Phase 10 (538) / Phase 15 C (567/568): a processor event id is PROCESSED once PER SALON (uq_payment_gateway_events_tenant_processed
    // (tenant_id, processor_type, event_id) — another salon's event may carry the same id). A concurrent duplicate
    // delivery that slipped past the duplicate check loses the race here; it is a duplicate, not a failure (23505 only).
    return this.db.insertInto('payment_gateway_events').values({
      tenant_id: (row.tenant_id as string) ?? null,
      branch_id: (row.branch_id as string) ?? null,
      payment_gateway_id: (row.payment_gateway_id as string) ?? null,
      processor_type: row.processor_type as string,
      event_type: (row.event_type as string) ?? null,
      event_id: (row.event_id as string) ?? null,
      processor_transaction_id: (row.processor_transaction_id as string) ?? null,
      merchant_id_masked: (row.merchant_id_masked as string) ?? null,
      payload_json_safe: JSON.stringify(row.payload_json_safe ?? null),
      signature_valid: !!row.signature_valid,
      matched_payment_id: (row.matched_payment_id as string) ?? null,
      processed_at: row.processed_at ? sql`now()` : null,
      // §45: a re-delivery after a processing failure is attempt n+1 on a fresh claim (the failed row released its claim)
      processing_attempts: 1,
      ...(row.last_error ? { last_error: String(row.last_error).slice(0, 500) } : {}),   // §110: why a signed delivery was refused (field names only)
    }).returning('id').executeTakeFirst().then((r: any) => String(r?.id ?? 'claimed'), (e: any) => { if (e?.code === '23505' && row.processed_at) return false; throw e; });
  }

  /** §45 / §158: business processing failed AFTER the claim. The row keeps the delivery (payload, attempt count, the error)
   *  and RELEASES its claim (processed_at NULL) so the processor's retry can process it again; the counter is the
   *  observability signal (webhook_processing_failed). Nothing here throws. */
  private async failProcessing(tenantId: string, rowId: string, e: unknown): Promise<void> {
    if (!this.db) return;
    const msg = String((e as Error)?.message ?? e).slice(0, 500);
    await this.db.updateTable('payment_gateway_events').set({ processed_at: null, last_error: msg }).where('tenant_id', '=', tenantId).where('id', '=', rowId).execute().catch(() => undefined);
  }

  async handle(processorType: string, rawBody: string, body: any, signatureHeader: string, headers?: Record<string, string | string[] | undefined>): Promise<WebhookResult> {
    if (!this.db) return { status: 503, body: { ok: false, code: 'UNAVAILABLE', message: 'Webhooks require a database.' } };

    const merchantId = pick(body, ['merchantId', 'merchid', 'merchant_id', 'mid']);
    const eventType = pick(body, ['eventType', 'type', 'event', 'eventName']) || '';
    const txnId = pick(body, ['transactionId', 'retref', 'processorTransactionId', 'txnId', 'transaction_id']);
    // Security Deep Scan E7: an event with no id is keyed by its exact signed bytes, so a captured delivery replayed
    // verbatim is a duplicate (a genuine processor retry of the same bytes is one too — every effect is idempotent anyway).
    const eventId = pick(body, ['eventId', 'id', 'notificationId', 'event_id']) || (rawBody ? `body:${createHash('sha256').update(rawBody).digest('hex').slice(0, 40)}` : null);
    const payload = safePayload(body);

    // 1) Resolve tenant by merchant id — reject unknown/ambiguous merchants outright.
    const tenant = merchantId ? await this.resolver.resolveTenantByMerchantId(merchantId) : null;
    if (!tenant) {
      await this.record({ processor_type: processorType, event_type: eventType || null, event_id: eventId, processor_transaction_id: txnId, payload_json_safe: payload, signature_valid: false });
      return { status: 400, body: { ok: false, code: 'unknown_merchant' } };
    }

    // 2) Verify the signature against THIS tenant's webhook secret (generic HMAC-SHA256 hex — Fiserv/CardPointe/Clover).
    //    Invalid → 401, nothing applied.
    const sig = verifyProcessorSignature({
      rawBody, secret: tenant.webhookSecret, processor: processorType, headers, fallbackHeader: signatureHeader,
    });
    if (!sig.valid) {
      await this.record({ tenant_id: tenant.tenantId, payment_gateway_id: tenant.tenantId, processor_type: processorType, event_type: eventType || null, event_id: eventId, processor_transaction_id: txnId, merchant_id_masked: tenant.merchantIdMasked, payload_json_safe: payload, signature_valid: false });
      return { status: 401, body: { ok: false, code: 'invalid_signature', scheme: sig.scheme, reason: sig.reason } };
    }

    // Security Deep Scan E7: the path names the processor, but the merchant's CONFIGURED processor decides. A delivery
    // posted under another processor family's path is refused (it is a replay or a misconfiguration, never routine), and
    // the ledger / dedupe key uses the configured processor — so the same event re-posted under /fiserv and /cardpointe
    // is ONE event, not two.
    if (tenant.processorType && processorFamily(processorType) !== processorFamily(tenant.processorType)) {
      await this.record({ tenant_id: tenant.tenantId, payment_gateway_id: tenant.tenantId, processor_type: processorType, event_type: eventType || null, event_id: eventId, processor_transaction_id: txnId, merchant_id_masked: tenant.merchantIdMasked, payload_json_safe: payload, signature_valid: true });
      return { status: 400, body: { ok: false, code: 'processor_mismatch' } };
    }
    processorType = String(tenant.processorType || processorType);

    // Security Deep Scan §110: the signed body must be the configured processor's exact shape before anything reads it.
    // Refused deliveries are kept in the ledger (unprocessed — a corrected re-delivery still processes) with the
    // field NAMES that failed, never their values.
    const family = webhookFamily(processorType);
    let unknownFields: string[] = [];
    if (family) {
      const shape = checkWebhookPayload(family, body, { unknownFields: unknownFieldMode() });
      if (!shape.ok) {
        await this.record({ tenant_id: tenant.tenantId, payment_gateway_id: tenant.tenantId, processor_type: processorType, event_type: eventType || null, event_id: eventId, processor_transaction_id: txnId, merchant_id_masked: tenant.merchantIdMasked, payload_json_safe: payload, signature_valid: true, last_error: `invalid_payload: ${shape.errors.map((e) => `${e.field}:${e.rule}`).join(', ')}`.slice(0, 500) });
        return { status: 400, body: { ok: false, code: 'invalid_payload', errors: shape.errors } };
      }
      unknownFields = shape.unknownFields;
    }

    // 3) Idempotency — if this event_id was already processed, do not apply it again.
    if (eventId) {
      const dup = await this.db.selectFrom('payment_gateway_events').select(['id'])
        .where('tenant_id', '=', tenant.tenantId).where('processor_type', '=', processorType).where('event_id', '=', eventId).where('processed_at', 'is not', null).executeTakeFirst().catch(() => undefined);
      if (dup) return { status: 200, body: { ok: true, duplicate: true } };
    }

    // 4) Apply to a payment that belongs to THIS tenant only (cross-tenant txn ids simply don't match).
    let matchedPaymentId: string | null = null, branchId: string | null = null, statusApplied: string | null = null;
    if (txnId) {
      const pay = await this.db.selectFrom('payments').select(['id', 'branch_id', 'status'])
        .where('tenant_id', '=', tenant.tenantId).where('processor_transaction_id', '=', txnId).executeTakeFirst().catch(() => undefined);
      if (pay) { matchedPaymentId = pay.id; branchId = pay.branch_id; }
    }

    // 3b) Phase 14 (Constitution 12): the processed-ledger row is the event's CLAIM, written before any effect. Two
    // deliveries of the same event that both passed the check above race on uq_payment_gateway_events_tenant_processed; the
    // loser applies nothing and answers "duplicate".
    const claimed = await this.claim({ tenant_id: tenant.tenantId, branch_id: branchId, payment_gateway_id: tenant.tenantId, processor_type: processorType, event_type: eventType || null, event_id: eventId, processor_transaction_id: txnId, merchant_id_masked: tenant.merchantIdMasked, payload_json_safe: payload, signature_valid: true, matched_payment_id: matchedPaymentId, processed_at: true });
    if (eventId && !claimed) return { status: 200, body: { ok: true, duplicate: true } };

    try {
      const out = await this.applyEffects({ processorType, eventType, txnId, eventId, branchId, tenant, matchedPaymentId, body, payload });
      // §110 report mode: fields we do not know were kept (never read) — named back so an operator can review them
      return unknownFields.length && out.status === 200 ? { ...out, body: { ...(out.body as object), unknownFields } } : out;
    } catch (e) {
      // §45: the delivery is kept with its error and attempt count; the claim is released so the processor's retry can
      // run the effects again (every effect below is idempotent on its own key). 500 asks the processor to retry.
      if (typeof claimed === 'string') await this.failProcessing(tenant.tenantId, claimed, e);
      return { status: 500, body: { ok: false, code: 'processing_failed', message: 'The event was received and recorded; processing failed and will be retried.' } };
    }
  }

  private async applyEffects(a: { processorType: string; eventType: string; txnId: string | null; eventId: string | null; branchId: string | null; tenant: NonNullable<Awaited<ReturnType<PaymentGatewayResolver['resolveTenantByMerchantId']>>>; matchedPaymentId: string | null; body: any; payload: unknown }): Promise<WebhookResult> {
    const { processorType, eventType, txnId, eventId, branchId, tenant, matchedPaymentId, body, payload } = a;
    if (!this.db) return { status: 503, body: { ok: false, code: 'UNAVAILABLE', message: 'Webhooks require a database.' } };
    let statusApplied: string | null = null;
    const newStatus = txnId && matchedPaymentId ? mapStatus(eventType) : null;
    if (newStatus) {
      // Phase 12 (#27): through the PAYMENT machine — a late "settled" callback never overwrites a refunded / voided
      // payment (the event is still recorded above; statusApplied says whether the row moved)
      // Fiserv master build §11 (Nov 4 2026): a webhook never settles a payment whose authorization we have not recorded.
      // An event may only move a payment that is ALREADY provider-approved (approved / captured / … / settled); a
      // 'processing' (unknown-outcome) row is resolved only by the authenticated provider inquiry (Verify with processor),
      // never by a pushed event.
      const moved: any = await this.db.updateTable('payments').set({ status: newStatus, updated_at: sql`now()` })
        .where('tenant_id', '=', tenant.tenantId).where('processor_transaction_id', '=', txnId).where(canMoveToSql(PAYMENT, newStatus) as RawBuilder<SqlBool>)
        .where('status', 'in', WEBHOOK_MOVABLE_FROM).executeTakeFirst();
      if (Number(moved?.numUpdatedRows ?? 0) > 0) statusApplied = newStatus;
    }

    // 4b) Land gateway-reported money movement in the tenant-scoped ledgers (idempotent). A refund is only recorded when
    // it matches THIS tenant's payment (so a cross-tenant txn produces no refund anywhere); settlements are batch-level
    // and belong to the resolved tenant/merchant.
    let recordedRefund = false, recordedSettlement = false, linkedPayments = 0;
    if (isRefundEvent(eventType) && matchedPaymentId) {
      const refundId = pick(body, ['refundId', 'refundReference', 'processorRefundId']) || txnId;
      const amountCents = centsFrom(body, ['amountCents', 'refundCents'], ['amount']) ?? 0;
      const refundStatus = mapRefundStatus(eventType, body);
      const dup = await this.db.selectFrom('payment_refunds').select(['id', 'status']).where('tenant_id', '=', tenant.tenantId).where('processor_refund_id', '=', refundId).executeTakeFirst();
      // the same refund reported again with its final outcome (pending → refunded / failed): the row moves on; a final row never moves back
      if (dup && ['pending', 'processing'].includes(String(dup.status)) && refundStatus !== 'pending')
        await this.db.updateTable('payment_refunds').set({ status: refundStatus }).where('tenant_id', '=', tenant.tenantId).where('id', '=', dup.id).where('status', 'in', ['pending', 'processing']).where(canMoveToSql(PAYMENT_REFUND, refundStatus) as RawBuilder<SqlBool>).execute();
      // the POS already recorded this refund (it stores its own reference, not the gateway's refund id): the same payment,
      // the same amount, not failed, recorded by the POS (no webhook event) — the callback confirms it, it is not a second refund
      // only a SUCCESSFUL refund confirms the POS's row; a failed / pending report is kept as its own row (never read as "confirmed")
      const posDup = dup || refundStatus !== 'refunded' ? undefined : await this.db.selectFrom('payment_refunds').select('id').where('tenant_id', '=', tenant.tenantId).where('payment_id', '=', matchedPaymentId)
        .where('amount_cents', '=', amountCents).where('event_id', 'is', null).where('status', 'not in', ['failed', 'cancelled', 'canceled', 'declined']).executeTakeFirst();
      if (!dup && !posDup) {
        // uq_payment_refunds_processor_refund (565): a concurrent duplicate of the same refund loses here — not an error
        recordedRefund = await this.db.insertInto('payment_refunds').values({ tenant_id: tenant.tenantId, branch_id: branchId, payment_id: matchedPaymentId, payment_gateway_id: tenant.tenantId, processor_type: processorType, amount_cents: amountCents, reason: pick(body, ['reason', 'refundReason']), status: refundStatus, processor_refund_id: refundId, event_id: eventId })
          .execute().then(() => true, (e: any) => { if (e?.code === '23505') return false; throw e; });
      }
    }
    if (isSettlementEvent(eventType)) {
      const settlementId = pick(body, ['settlementId', 'batchId', 'batch', 'settlement_id']) || eventId;
      const dup = await this.db.selectFrom('payment_settlements').select('id').where('tenant_id', '=', tenant.tenantId).where('settlement_id', '=', settlementId).executeTakeFirst().catch(() => undefined);
      let settlementRowId: string | null = dup ? String(dup.id) : null;
      if (!dup) {
        const gross = centsFrom(body, ['grossCents', 'amountCents'], ['gross', 'amount']) ?? 0;
        const fee = centsFrom(body, ['feeCents'], ['fee']) ?? 0;
        const net = centsFrom(body, ['netCents'], ['net']) ?? (gross - fee);
        const settleStatus = mapSettlementStatus(eventType, body);
        // uq_payment_settlements_settlement (565): a concurrent duplicate batch loses here and links to the winner's row
        const ins = await this.db.insertInto('payment_settlements').values({ tenant_id: tenant.tenantId, branch_id: branchId, payment_gateway_id: tenant.tenantId, processor_type: processorType, settlement_id: settlementId, gross_cents: gross, fee_cents: fee, net_cents: net, currency: 'USD', status: settleStatus, event_id: eventId, payload_json_safe: JSON.stringify(payload),
          settled_at: settleStatus === 'settled' ? (providerTime(body, ['settledAt', 'settled_at', 'settlementDate', 'settlement_date', 'batchDate', 'batch_date', 'fundedAt', 'date']) ?? sql`now()`) : null })
          .returning(['id']).executeTakeFirst().catch((e: any) => { if (e?.code === '23505') return null; throw e; });
        if (ins) { settlementRowId = ins.id ?? null; recordedSettlement = true; }
        else settlementRowId = ((await this.db.selectFrom('payment_settlements').select('id').where('tenant_id', '=', tenant.tenantId).where('settlement_id', '=', settlementId).executeTakeFirst()))?.id ?? null;
      }
      // BUILD_PLAN Phase 10 (Constitution 1 §19): link the payments this settlement batch covers. The processor names them
      // by transaction id (the event's own transaction id and/or a list in the body); only THIS salon's payments are
      // touched, and a payment already linked to a batch keeps its first link (a replayed event changes nothing).
      if (settlementRowId) linkedPayments = await this.linkSettlementPayments(tenant.tenantId, settlementRowId, settlementTxnIds(body, txnId));
    }
    // 4c) Chargebacks / disputes — recorded in the tenant-scoped `chargebacks` table, idempotent on the processor's case
    // id. A "created/received" event opens a needs-response alert; a later won/lost/refunded/expired event resolves the
    // same case (updates the existing row rather than inserting a duplicate). Drives the Super Admin Chargeback Alerts KPI.
    let recordedChargeback = false;
    if (isChargebackEvent(eventType)) {
      const cbId = pick(body, ['chargebackId', 'disputeId', 'caseId', 'chargeback_id', 'dispute_id', 'case_id']) || eventId || txnId;
      const cbStatus = mapChargebackStatus(eventType);
      const resolvedAt = CHARGEBACK_RESOLVED.includes(cbStatus) ? sql<Date>`now()` : null;
      const existing = cbId
        ? await this.db.selectFrom('chargebacks').select(['id']).where('tenant_id', '=', tenant.tenantId).where('chargeback_id', '=', cbId).executeTakeFirst().catch(() => undefined)
        : undefined;
      if (existing) {
        await this.db.updateTable('chargebacks').set({ status: cbStatus, payment_id: matchedPaymentId ?? undefined, resolved_at: resolvedAt, event_id: eventId ?? undefined, updated_at: sql`now()` })
          .where('tenant_id', '=', tenant.tenantId).where('id', '=', existing.id).where(canMoveToSql(CHARGEBACK, cbStatus) as RawBuilder<SqlBool>).execute();
      } else {
        // uq_chargebacks_tenant_case (096): a concurrent duplicate of the same case loses here — the winner opened it
        await this.db.insertInto('chargebacks').values({
          tenant_id: tenant.tenantId, branch_id: branchId, payment_gateway_id: tenant.tenantId, payment_id: matchedPaymentId,
          processor_type: processorType, chargeback_id: cbId, processor_transaction_id: txnId,
          reason_code: pick(body, ['reasonCode', 'reason_code']), reason: pick(body, ['reason', 'reasonDescription', 'reason_description']),
          amount_cents: centsFrom(body, ['amountCents', 'chargebackCents', 'disputeCents'], ['amount']) ?? 0, currency: 'USD',
          status: cbStatus, event_id: eventId, payload_json_safe: JSON.stringify(payload), opened_at: sql`now()`, resolved_at: resolvedAt,
        }).execute().catch((e: any) => { if (e?.code !== '23505') throw e; });
      }
      recordedChargeback = true;
    }
    // 4d) Merchant onboarding / underwriting status — driven by application/underwriting events for the resolved tenant.
    let recordedOnboarding = false;
    if (isOnboardingEvent(eventType)) {
      const onb = mapOnboardingStatus(eventType);
      if (onb) {
        await this.db.updateTable('tenant_payment_config').set({ onboarding_status: onb, updated_at: sql`now()` })
          .where('tenant_id', '=', tenant.tenantId).where(canMoveToSql(MERCHANT_ONBOARDING, onb) as RawBuilder<SqlBool>).execute();
        recordedOnboarding = true;
      }
    }
    // 4e) §15 / §16 / §58 (Oct 27 2026): a charge event for a WALLET TOP-UP order (order id = the intent id; no payment row
    // matches it) settles the intent through the top-up service's own conditional settle — the same row the live answer,
    // Verify and the sweep race for, the same 'topup:<id>' credit key — so the wallet is credited exactly once.
    let topUp: { intentId: string; status: string | undefined; settledByThis: boolean } | null = null;
    const orderId = pick(body, ['orderId', 'orderid', 'order_id']);
    const charge = orderId && !matchedPaymentId ? chargeEventOutcome(eventType, body) : null;
    const settler = charge ? this.topUps?.() ?? null : null;
    if (charge && settler && orderId) {
      const r = await settler.settleFromWebhook(tenant.tenantId, orderId, { ...charge, retref: txnId, amountCents: pickNum(body, ['amountCents', 'amount_cents']) ?? amountFromDollars(body?.amount), respText: pick(body, ['resptext', 'respText']) });
      if (r.matched && r.intentId) topUp = { intentId: r.intentId, status: r.status, settledByThis: !!r.settledByThis };
    }
    return { status: 200, body: { ok: true, tenantId: tenant.tenantId, matchedPaymentId, statusApplied, recordedRefund, recordedSettlement, linkedPayments, recordedChargeback, recordedOnboarding, ...(topUp ? { topUp } : {}) } };
  }
}
