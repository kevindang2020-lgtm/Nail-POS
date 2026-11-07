// customer-payments.service.ts — saved payment methods CRUD + wallet top-up. Top-up charges the saved card through the
// tenant's real payment processor (PaymentGatewayResolver → authorizeAndCapture) as a durable INTENT (wallet_topup_intents,
// Oct 23 2026) and, only on an approved charge, posts an idempotent credit to the wallet ledger keyed on the intent id
// (so a retry, a Verify or the sweep can never double-credit).
//
// Fiserv master build §4 / §8D (P0, Nov 4 2026). Saving a card now requires, in order:
//   1. a signed-in customer OF THIS TENANT (no cross-tenant customer fallback);
//   2. explicit, separate consent to store the card for future customer-initiated payments (version recorded);
//   3. a CardSecure token from the salon's hosted iFrame tokenizer — never a card number (raw PANs are refused, and the
//      Customer App no longer has card-number / CVV fields at all);
//   4. the PROVIDER accepting that token for the effective merchant (CardPointe PUT /profile). A format check is never
//      proof: a fabricated "9…" string is rejected by the gateway and nothing is stored.
// Only then is the provider profile reference stored, bound to the merchant account that verified it. If the salon's
// gateway cannot verify tokens, card saving is unavailable — there is no fallback. Top-ups charge only such a card.
import type { TopUpResult } from '@aipowersalon/api-contracts/customer';
export type { TopUpResult };   // owned by packages/api-contracts (Constitution 13 §13)
import { PaymentGatewayResolver } from '../payments/payment-gateway.resolver';
import { WalletLedgerService } from '@aipowersalon/customers';
import type { CustomerPaymentMethodsPort, CustomerPaymentMethod, AddPaymentMethodInput } from './customer-payments.repository';

export interface PayCtx { tenantId: string; userId: string; branchId?: string | null }

export { looksLikeRawPan } from '../payments/card-data';   // the one PCI rule, shared with the hardware-plan card
import { looksLikeRawPan, isCardSecureToken } from '../payments/card-data';
import { withCode } from '@aipowersalon/api-contracts';
import { authorizeOutcome, type InquiryTransaction } from '../payments/payment-processor.port';
import { decideTopUp, topUpIntentIdFromOrder, InMemoryWalletTopupIntentStore, type TopUpIntent, type TopUpIntentStatus, type WalletTopupIntentStore } from './wallet-topup-intents';
export { KyselyWalletTopupIntentStore, InMemoryWalletTopupIntentStore, decideTopUp, topUpIntentIdFromOrder, type TopUpIntent, type WalletTopupIntentStore } from './wallet-topup-intents';
const UNCONFIRMED_TOP_UP = 'We could not confirm this top-up with the card processor. Please do not try again yet — the salon will confirm it.';

/** The consent text version the Customer App shows (bump when the wording changes). */
export const SAVED_CARD_CONSENT_VERSION = 'cit-2026-11-04';

export class SavedCardError extends Error {
  constructor(readonly code: string, message: string, readonly status = 400) { super(message); this.name = 'SavedCardError'; }
}

/** Structural slice of the resolver the saved-card flow needs (tests inject a fake). */
export type SavedCardMerchantResolver = Pick<PaymentGatewayResolver, 'effectiveMerchant'>;

export interface AddSavedCardBody extends AddPaymentMethodInput {
  /** Must be true: the customer ticked the (unchecked by default) "save this card for future payments" box. */
  consent?: boolean;
  consentVersion?: string;
}

export class CustomerPaymentMethodsService {
  constructor(private readonly repo: CustomerPaymentMethodsPort, private readonly merchants?: SavedCardMerchantResolver) {}
  private async customer(ctx: PayCtx) { return ctx?.tenantId ? this.repo.resolveCustomerId(ctx.tenantId, ctx.userId) : null; }

  async list(ctx: PayCtx): Promise<CustomerPaymentMethod[]> {
    const id = await this.customer(ctx);
    return id ? this.repo.list(ctx.tenantId, id) : [];
  }
  // POS staff view: a specific customer's saved cards (read-only, masked; card management stays customer-side).
  async listForCustomer(tenantId: string, customerId: string): Promise<CustomerPaymentMethod[]> {
    if (!tenantId || !customerId) return [];
    return this.repo.list(tenantId, customerId);
  }

  async add(ctx: PayCtx, input: AddSavedCardBody): Promise<CustomerPaymentMethod> {
    const id = await this.customer(ctx);
    if (!id) throw withCode(new SavedCardError('not_customer', 'Not a customer account at this salon.', 403), 'CUSTOMER_NOT_FOUND');
    if (input?.consent !== true) throw withCode(new SavedCardError('consent_required', 'Please agree to save this card for future payments.'), 'VALIDATION_FAILED', { field: 'consent' });
    if (input?.consentVersion !== SAVED_CARD_CONSENT_VERSION) throw withCode(new SavedCardError('consent_outdated', 'Please review the updated card-saving terms and try again.'), 'VALIDATION_FAILED', { field: 'consentVersion' });
    const token = (input?.token || '').trim();
    if (!token) throw withCode(new SavedCardError('token_required', 'Add the card with the secure card form.'), 'VALIDATION_FAILED', { field: 'token' });
    if (looksLikeRawPan(token)) throw withCode(new SavedCardError('raw_card_rejected', 'A card number cannot be saved directly. Add the card with the secure card form (it is tokenized by the salon\'s payment provider).'), 'CARD_NUMBER_NOT_ACCEPTED');
    if (!isCardSecureToken(token)) throw withCode(new SavedCardError('token_invalid', 'That card could not be read by the secure card form. Please try again.'), 'VALIDATION_FAILED', { field: 'token' });
    if (!this.merchants) throw withCode(new SavedCardError('card_saving_unavailable', 'Card saving is not available at this salon yet.', 503), 'FEATURE_UNAVAILABLE');
    const m = await this.merchants.effectiveMerchant(ctx.tenantId, ctx.branchId ?? null);
    if (!m.configured || !m.processor?.createStoredProfile || !m.merchantIdHash) throw withCode(new SavedCardError('card_saving_unavailable', 'Card saving is not available at this salon yet.', 503), 'FEATURE_UNAVAILABLE');
    const expiry = input.expMonth && input.expYear ? `${String(input.expMonth).padStart(2, '0')}${String(input.expYear).slice(-2)}` : undefined;
    let p;
    try { p = await m.processor.createStoredProfile({ account: token, expiry, postal: input.zipCode || undefined, name: input.cardholderName || undefined }); }
    catch { throw withCode(new SavedCardError('provider_unavailable', 'The salon\'s payment provider could not be reached. Your card was not saved.', 502), 'PROVIDER_UNAVAILABLE'); }
    if (!p.ok || !p.profileId) throw withCode(new SavedCardError('provider_rejected', 'The payment provider did not accept this card. It was not saved.'), 'VALIDATION_FAILED', { field: 'token' });
    const last4 = (input.last4 && /^\d{4}$/.test(input.last4) ? input.last4 : null) ?? (p.token ? p.token.slice(-4) : null);
    const exp = p.expiry && /^\d{4}$/.test(p.expiry) ? { expMonth: Number(p.expiry.slice(0, 2)), expYear: 2000 + Number(p.expiry.slice(2)) } : { expMonth: input.expMonth ?? null, expYear: input.expYear ?? null };
    return this.repo.add(ctx.tenantId, id, {
      ...input, token: p.token || token, last4, ...exp,
      binding: { merchantAccountId: m.merchantAccountId, merchantIdHash: m.merchantIdHash, profileId: p.profileId, acctId: p.acctId ?? null,
        consentVersion: SAVED_CARD_CONSENT_VERSION, consentScope: 'cit_unscheduled' },
    });
  }

  async remove(ctx: PayCtx, methodId: string): Promise<{ ok: boolean }> {
    const id = await this.customer(ctx);
    if (!id) return { ok: false };
    const revoked = await this.repo.remove(ctx.tenantId, id, methodId);
    // best-effort provider cleanup; the row is revoked (never chargeable again) whatever the provider answers
    if (revoked?.profileId && this.merchants) {
      try { const m = await this.merchants.effectiveMerchant(ctx.tenantId, ctx.branchId ?? null); await m.processor?.deleteStoredProfile?.({ profileId: revoked.profileId, acctId: revoked.acctId ?? undefined }); } catch (e) { console.warn('[saved-card] provider profile cleanup failed (the card row is already revoked):', (e as Error)?.message); }
    }
    return { ok: !!revoked };
  }
  async setDefault(ctx: PayCtx, methodId: string): Promise<{ ok: boolean }> {
    const id = await this.customer(ctx);
    return id ? { ok: await this.repo.setDefault(ctx.tenantId, id, methodId) } : { ok: false };
  }
}

export interface TopUpInput {
  amountCents: number; paymentMethodId: string;
  /** the app's key for this tap — a retry with the same key returns the same intent, never a second charge */
  clientKey?: string | null;
  /** Nov 4 2026 (developer tree): the same key under the name the Customer App sends; clientKey wins when both come */
  idempotencyKey?: string;
}

/** Who settles an open intent from the processor's record. */
export type TopUpSettler = 'verify' | 'sweep' | 'webhook';
export interface TopUpSweepReport { checked: number; approved: number; declined: number; released: number; waiting: number; review: number; errors: number }
const DEFAULT_STRANDED_MS = 15 * 60_000;
const settlerOf = (s: string | null): 'charge' | TopUpSettler => (s === 'charge' || s === 'sweep' || s === 'webhook' ? s : 'verify');

/** The one place a top-up charge is made and settled (Remaining-work mandate P1-1 / B-79, Oct 23 2026). Every top-up is a
 *  durable intent (wallet_topup_intents) BEFORE the card is charged; the processor is called with orderId = intent id and
 *  the stable key 'topup:<id>:<attempt>'; the credit is keyed 'topup:<id>'. A lost / unknown answer leaves the intent
 *  PROCESSING / UNKNOWN for the customer's Verify, the staff Verify and the stranded sweep — all of which settle the SAME
 *  row conditionally, so the card is charged at most once and the wallet credited exactly once. */
export class WalletTopupService {
  constructor(
    private readonly resolver: PaymentGatewayResolver,
    private readonly methods: CustomerPaymentMethodsPort,
    private readonly ledger: WalletLedgerService,
    private readonly intents: WalletTopupIntentStore = new InMemoryWalletTopupIntentStore(),
    private readonly opts: { strandedMs?: number; now?: () => Date; log?: (msg: string) => void } = {},
  ) {}
  private now() { return this.opts.now?.() ?? new Date(); }
  private strandedMs() { return this.opts.strandedMs ?? DEFAULT_STRANDED_MS; }

  async topUp(ctx: PayCtx, input: TopUpInput): Promise<TopUpResult> {
    if (!ctx?.tenantId) return { ok: false, message: 'Not a customer account.' };
    const customerId = await this.methods.resolveCustomerId(ctx.tenantId, ctx.userId);
    if (!customerId) return { ok: false, message: 'Not a customer account.' };
    const amountCents = Math.trunc(input?.amountCents ?? 0);
    if (!Number.isInteger(amountCents) || amountCents <= 0) return { ok: false, message: 'Enter a valid amount.' };
    const rawKey = input.clientKey ?? input.idempotencyKey ?? null;
    const clientKey = rawKey ? String(rawKey).slice(0, 64) : null;
    // the retry of a tap: the SAME intent answers (approved → the balance; open → "being confirmed"); nothing is charged again
    let intent = clientKey ? await this.intents.findByClientKey(ctx.tenantId, customerId, clientKey) : null;
    if (intent && intent.status !== 'FAILED') return this.answerFor(ctx.tenantId, customerId, intent);
    // Fiserv master build §4 / §8D (Nov 4 2026): the EFFECTIVE merchant (the branch's own, else the salon's) — production
    // gates included — and only a provider-verified, consented card bound to THAT merchant is ever charged.
    const em = await this.resolver.effectiveMerchant(ctx.tenantId, ctx.branchId ?? null);
    if (!em.configured || !em.processor || !em.merchantIdHash) return { ok: false, message: 'Card payments are not set up for this salon yet.' };
    const m = await this.methods.getToken(ctx.tenantId, customerId, input.paymentMethodId, em.merchantIdHash);
    if (!m) return { ok: false, message: 'Select a saved card.' };
    const gw = { processor: em.processor };
    const expiry = m.expMonth && m.expYear ? `${String(m.expMonth).padStart(2, '0')}${String(m.expYear).slice(-2)}` : undefined;
    if (!intent) {
      try { intent = await this.intents.create({ tenantId: ctx.tenantId, customerId, paymentMethodId: input.paymentMethodId, amountCents, clientKey, createdByUserId: ctx.userId }); }
      catch (e: any) {
        // two taps with one key raced on the unique index: the other request owns the intent — answer from it
        if (clientKey && /uq_wallet_topup_intents_client_key|duplicate key/i.test(String(e?.message ?? e))) { const other = await this.intents.findByClientKey(ctx.tenantId, customerId, clientKey); if (other) return this.answerFor(ctx.tenantId, customerId, other); }
        throw e;
      }
    } else if (intent.amountCents !== amountCents) return { ok: false, intentId: intent.id, status: intent.status, message: 'This top-up was already started for a different amount. Start a new top-up.' };
    // one caller charges: CREATED | FAILED → PROCESSING (a FAILED intent = the host charged nothing, so it may be retried)
    const begun = await this.intents.beginAttempt(ctx.tenantId, intent.id, gw.processor.name);
    if (!begun) return this.answerFor(ctx.tenantId, customerId, (await this.intents.get(ctx.tenantId, intent.id)) ?? intent);
    intent = begun;
    // Deep-scan (Oct 22 2026): an unknown / lost answer is NOT a decline — the card may have been charged; nothing is
    // credited and the customer is told to wait, never "declined" (which invited a second top-up). Since Oct 23 the intent
    // records it (UNKNOWN) and Verify / the sweep settle it from the processor (inquireByOrderid on the intent id).
    let res: Awaited<ReturnType<typeof gw.processor.authorizeAndCapture>>;
    try {
      res = await gw.processor.authorizeAndCapture({ account: m.token, expiry, amountCents, orderId: intent.id, ecomind: 'E', cof: 'C', cofscheduled: 'N',   // a saved card the customer chose: card-not-present, cardholder-initiated, unscheduled
        idempotencyKey: `topup:${intent.id}:${intent.attempt}` });
    } catch (e: any) {
      await this.intents.settle(ctx.tenantId, intent.id, { status: 'UNKNOWN', failureReason: 'answer lost: ' + String(e?.message ?? e).slice(0, 200), settledBy: 'charge' }, ['PROCESSING']);
      return { ok: false, intentId: intent.id, status: 'UNKNOWN', message: UNCONFIRMED_TOP_UP };
    }
    const outcome = authorizeOutcome(res);
    if (outcome === 'retry') {
      await this.intents.settle(ctx.tenantId, intent.id, { status: 'FAILED', processorTransactionId: res.retref ?? null, respText: res.respText ?? null, failureReason: 'host could not process it (retry) — nothing charged', settledBy: 'charge' }, ['PROCESSING']);
      return { ok: false, intentId: intent.id, status: 'FAILED', message: 'The card processor is busy right now — nothing was charged. Please try again in a moment.' };
    }
    if (outcome === 'unknown') {
      await this.intents.settle(ctx.tenantId, intent.id, { status: 'UNKNOWN', processorTransactionId: res.retref ?? null, respText: res.respText ?? null, failureReason: 'processor answered without settling it', settledBy: 'charge' }, ['PROCESSING']);
      return { ok: false, intentId: intent.id, status: 'UNKNOWN', message: UNCONFIRMED_TOP_UP };
    }
    // Fiserv §7.3: an approval for another amount (beyond a provider-assessed surcharge) is not this top-up — hold it for
    // Verify / the salon, never credit it and never call it declined.
    if (res.approved && res.amountCents != null && res.amountCents !== amountCents + Math.max(0, res.surchargeCents ?? 0)) {
      await this.intents.settle(ctx.tenantId, intent.id, { status: 'UNKNOWN', processorTransactionId: res.retref ?? null, respText: res.respText ?? null, failureReason: `approved for ${res.amountCents} cents, expected ${amountCents}`, settledBy: 'charge' }, ['PROCESSING']);
      return { ok: false, intentId: intent.id, status: 'UNKNOWN', message: UNCONFIRMED_TOP_UP };
    }
    if (!res.approved) {
      await this.intents.settle(ctx.tenantId, intent.id, { status: 'DECLINED', processorTransactionId: res.retref ?? null, respText: res.respText ?? null, settledBy: 'charge' }, ['PROCESSING']);
      return { ok: false, intentId: intent.id, status: 'DECLINED', declined: res.declined, message: res.respText || 'Your card was declined.' };
    }
    return this.approve(ctx.tenantId, customerId, intent.id, res.retref ?? null, 'charge', res.respText ?? null);
  }

  /** The approved charge becomes a credit: conditional settle (one winner), then the idempotent ledger post keyed on the
   *  intent — whoever settled it, the ledger's unique key makes the credit happen exactly once. */
  private async approve(tenantId: string, customerId: string, intentId: string, retref: string | null, by: 'charge' | TopUpSettler, respText: string | null = null, actorUserId: string | null = null): Promise<TopUpResult> {
    await this.intents.settle(tenantId, intentId, { status: 'APPROVED', processorTransactionId: retref, respText, settledBy: by, actorUserId });
    const row = await this.intents.get(tenantId, intentId);
    if (!row || row.status !== 'APPROVED') return this.answerFor(tenantId, customerId, row ?? { id: intentId, status: 'UNKNOWN' } as TopUpIntent);
    await this.ledger.credit(tenantId, customerId, { amountCents: row.amountCents, type: 'top_up', currency: row.currency, reference: row.processorTransactionId ?? retref ?? null, idempotencyKey: `topup:${intentId}` });
    const w = await this.ledger.getWallet(tenantId, customerId);
    return { ok: true, intentId, status: 'APPROVED', balanceCents: w.balanceCents };
  }

  /** What an existing intent means to the customer. An APPROVED intent re-posts its credit idempotently (if the credit
   *  itself failed after the settle, this is where it is caught up). */
  private async answerFor(tenantId: string, customerId: string, i: TopUpIntent): Promise<TopUpResult> {
    switch (i.status) {
      case 'APPROVED': return this.approve(tenantId, customerId, i.id, i.processorTransactionId, settlerOf(i.settledBy), i.respText);
      case 'DECLINED': return { ok: false, intentId: i.id, status: i.status, declined: true, message: i.respText || 'Your card was declined.' };
      case 'FAILED': return { ok: false, intentId: i.id, status: i.status, message: 'The card processor could not process this top-up — nothing was charged. Please try again.' };
      case 'CANCELED': return { ok: false, intentId: i.id, status: i.status, message: 'This top-up was canceled.' };
      default: return { ok: false, intentId: i.id, status: i.status, message: UNCONFIRMED_TOP_UP };
    }
  }

  /** My top-ups (the customer's own) — the app shows an open one with "Check status". */
  async myTopUps(ctx: PayCtx, limit = 20): Promise<TopUpIntent[]> {
    const customerId = await this.methods.resolveCustomerId(ctx.tenantId, ctx.userId);
    return customerId ? this.intents.listForCustomer(ctx.tenantId, customerId, Math.min(100, Math.max(1, limit))) : [];
  }
  /** A customer's top-ups, for the POS (staff view of a stuck top-up). */
  async topUpsForCustomer(tenantId: string, customerId: string, limit = 20): Promise<TopUpIntent[]> {
    return this.intents.listForCustomer(tenantId, customerId, Math.min(100, Math.max(1, limit)));
  }

  /** Customer Verify: only the customer's own intent. */
  async verifyMine(ctx: PayCtx, intentId: string): Promise<TopUpResult> {
    const customerId = await this.methods.resolveCustomerId(ctx.tenantId, ctx.userId);
    const i = customerId ? await this.intents.get(ctx.tenantId, intentId) : null;
    if (!i || i.customerId !== customerId) return { ok: false, message: 'Top-up not found.' };
    return this.verify(ctx.tenantId, i, 'verify');
  }
  /** Staff Verify (POS): the salon's intent for this customer. */
  async verifyForStaff(tenantId: string, customerId: string, intentId: string, staffUserId: string | null = null): Promise<TopUpResult> {
    const i = await this.intents.get(tenantId, intentId);
    if (!i || i.customerId !== customerId) return { ok: false, message: 'Top-up not found.' };
    return this.verify(tenantId, i, 'verify', staffUserId);
  }

  /** Settle an open intent from the processor's record (orderId = intent id). Never charges; never calls UNKNOWN a decline. */
  private async verify(tenantId: string, i: TopUpIntent, by: TopUpSettler, actorUserId: string | null = null): Promise<TopUpResult> {
    if (i.status !== 'PROCESSING' && i.status !== 'UNKNOWN') return this.answerFor(tenantId, i.customerId, i);
    const gw = await this.resolver.resolve(tenantId);
    if (!gw.processor) return { ok: false, intentId: i.id, status: i.status, message: 'The card processor is not connected for this salon; the top-up must be checked in the processor portal.' };
    if (!gw.processor.inquireByOrderId) return { ok: false, intentId: i.id, status: i.status, message: `${gw.processor.name} has no transaction inquiry — check the processor portal.` };
    let txns: InquiryTransaction[] | null;
    try { txns = (await gw.processor.inquireByOrderId(i.id)).transactions; }
    catch (e: any) { this.opts.log?.(`top-up ${i.id}: processor unreachable: ${String(e?.message ?? e).slice(0, 200)}`); txns = null; }
    await this.intents.touchInquired(tenantId, i.id);
    const verdict = decideTopUp({ amountCents: i.amountCents, ageMs: this.now().getTime() - Date.parse(i.createdAt) }, txns, this.strandedMs());
    switch (verdict.action) {
      case 'approved': return this.approve(tenantId, i.customerId, i.id, verdict.retref, by, null, actorUserId);
      case 'declined': await this.intents.settle(tenantId, i.id, { status: 'DECLINED', processorTransactionId: verdict.retref, failureReason: verdict.detail, settledBy: by, actorUserId }); break;
      case 'release': await this.intents.settle(tenantId, i.id, { status: 'FAILED', failureReason: verdict.detail, settledBy: by, actorUserId }); break;
      case 'review': this.opts.log?.(`top-up ${i.id} needs review: ${verdict.detail}`); return { ok: false, intentId: i.id, status: i.status, message: 'The processor shows more than one charge for this top-up; the salon will review it.' };
      case 'wait': return { ok: false, intentId: i.id, status: i.status, message: txns === null ? 'The processor could not be reached. Nothing was charged again; try again in a moment.' : UNCONFIRMED_TOP_UP };
    }
    return this.answerFor(tenantId, i.customerId, (await this.intents.get(tenantId, i.id)) ?? i);
  }

  /** §15 / §16 / §58 (Oct 27 2026): the processor's SIGNED webhook for a top-up order — the payment webhook
   *  (payment-webhook.service.ts) hands it here when its order id names one of this salon's intents (order id = intent id,
   *  also accepted as 'topup:<id>' or 'topup:<id>:<attempt>', the charge's idempotency key). It is the FOURTH settler of the
   *  same row and goes through the same conditional settle() and the same 'topup:<id>' ledger key as the live answer,
   *  Verify and the sweep, so whoever arrives first wins and the wallet is credited exactly once. An approved / declined
   *  event of THIS amount is decisive; anything else (another amount, a pending notice) only nudges a Verify — which asks
   *  the processor and never charges. A webhook never releases an intent (no record ≠ no charge from a notification). */
  async settleFromWebhook(tenantId: string, orderId: string, evt: { approved: boolean; declined: boolean; retref: string | null; amountCents: number | null; respText?: string | null }): Promise<{ matched: boolean; intentId?: string; status?: TopUpIntentStatus; settledByThis?: boolean }> {
    const id = topUpIntentIdFromOrder(orderId);
    if (!id) return { matched: false };
    const i = await this.intents.get(tenantId, id);
    if (!i) return { matched: false };
    if (i.status === 'CREATED') return { matched: true, intentId: i.id, status: i.status, settledByThis: false };   // no charge was sent for it yet
    if (i.status !== 'PROCESSING' && i.status !== 'UNKNOWN') {
      if (i.status === 'APPROVED') await this.answerFor(tenantId, i.customerId, i);   // catches up a credit that failed after the settle (idempotent)
      return { matched: true, intentId: i.id, status: i.status, settledByThis: false };
    }
    const txn: InquiryTransaction = { retref: evt.retref ?? undefined, approved: !!evt.approved, declined: !!evt.declined && !evt.approved, amountCents: evt.amountCents ?? undefined, respText: evt.respText ?? undefined };
    const verdict = decideTopUp({ amountCents: i.amountCents, ageMs: 0 }, [txn], this.strandedMs());
    if (verdict.action === 'approved') {
      const won = await this.intents.settle(tenantId, i.id, { status: 'APPROVED', processorTransactionId: verdict.retref, respText: evt.respText ?? null, settledBy: 'webhook' });
      const now = (await this.intents.get(tenantId, i.id)) ?? i;
      if (now.status === 'APPROVED') await this.answerFor(tenantId, i.customerId, now);   // the one ledger key: credited once whoever settled it
      return { matched: true, intentId: i.id, status: now.status, settledByThis: won };
    }
    if (verdict.action === 'declined') {
      const won = await this.intents.settle(tenantId, i.id, { status: 'DECLINED', processorTransactionId: verdict.retref, respText: evt.respText ?? null, failureReason: verdict.detail, settledBy: 'webhook' });
      return { matched: true, intentId: i.id, status: (await this.intents.get(tenantId, i.id))?.status ?? i.status, settledByThis: won };
    }
    // not decisive for this intent (a pending notice, another amount): ask the processor exactly as Verify does
    await this.verify(tenantId, i, 'webhook');
    const after = await this.intents.get(tenantId, i.id);
    return { matched: true, intentId: i.id, status: after?.status ?? i.status, settledByThis: after?.settledBy === 'webhook' };
  }

  /** The stranded sweep's step (run under the payments.stranded_attempts owner): every salon's PROCESSING / UNKNOWN
   *  top-up older than the stranded window is settled from its processor's record. Every write is conditional. */
  async sweepStranded(now: Date = this.now(), limit = 200): Promise<TopUpSweepReport> {
    const r: TopUpSweepReport = { checked: 0, approved: 0, declined: 0, released: 0, waiting: 0, review: 0, errors: 0 };
    const rows = await this.intents.stranded(new Date(now.getTime() - this.strandedMs()), limit);
    for (const i of rows) {
      r.checked++;
      try {
        const before = i.status;
        const out = await this.verify(i.tenantId, i, 'sweep');
        const after = (await this.intents.get(i.tenantId, i.id))?.status ?? before;
        if (after === 'APPROVED') r.approved++; else if (after === 'DECLINED') r.declined++; else if (after === 'FAILED') r.released++;
        else if (/more than one charge/.test(out.message ?? '')) r.review++; else r.waiting++;
      } catch (e: any) { r.errors++; this.opts.log?.(`top-up sweep ${i.id} failed: ${String(e?.message ?? e).slice(0, 200)}`); }
    }
    return r;
  }
}
