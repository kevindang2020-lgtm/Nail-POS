// customer-payments.service.ts — saved payment methods + wallet top-up.
//
// Fiserv master build §4 / §8D (P0, Nov 4 2026). Saving a card now requires, in order:
//   1. a signed-in customer OF THIS TENANT (no cross-tenant customer fallback);
//   2. explicit, separate consent to store the card for future customer-initiated payments (version recorded);
//   3. a CardSecure token from the salon's hosted iFrame tokenizer — never a card number (raw PANs are refused, and the
//      Customer App no longer has card-number / CVV fields at all);
//   4. the PROVIDER accepting that token for the effective merchant (CardPointe PUT /profile). A format check is never
//      proof: a fabricated "9…" string is rejected by the gateway and nothing is stored.
// Only then is the provider profile reference stored, bound to the merchant account that verified it. If the salon's
// gateway cannot verify tokens, card saving is unavailable — there is no fallback.
// Top-up charges a saved card through the tenant's processor and credits the wallet only on an approved charge.
import type { TopUpResult } from '@aipowersalon/api-contracts/customer';
export type { TopUpResult };   // owned by packages/api-contracts (Constitution 13 §13)
import { PaymentGatewayResolver } from '../payments/payment-gateway.resolver';
import { WalletLedgerService } from '@aipowersalon/customers';
import type { CustomerPaymentMethodsPort, CustomerPaymentMethod, AddPaymentMethodInput } from './customer-payments.repository';

export interface PayCtx { tenantId: string; userId: string; branchId?: string | null }

export { looksLikeRawPan } from '../payments/card-data';   // the one PCI rule, shared with the hardware-plan card
import { looksLikeRawPan, isCardSecureToken } from '../payments/card-data';

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
    if (!id) throw new SavedCardError('not_customer', 'Not a customer account at this salon.', 403);
    if (input?.consent !== true) throw new SavedCardError('consent_required', 'Please agree to save this card for future payments.');
    if (input?.consentVersion !== SAVED_CARD_CONSENT_VERSION) throw new SavedCardError('consent_outdated', 'Please review the updated card-saving terms and try again.');
    const token = (input?.token || '').trim();
    if (!token) throw new SavedCardError('token_required', 'Add the card with the secure card form.');
    if (looksLikeRawPan(token)) throw new SavedCardError('raw_card_rejected', 'A card number cannot be saved directly. Add the card with the secure card form (it is tokenized by the salon\'s payment provider).');
    if (!isCardSecureToken(token)) throw new SavedCardError('token_invalid', 'That card could not be read by the secure card form. Please try again.');
    if (!this.merchants) throw new SavedCardError('card_saving_unavailable', 'Card saving is not available at this salon yet.', 503);
    const m = await this.merchants.effectiveMerchant(ctx.tenantId, ctx.branchId ?? null);
    if (!m.configured || !m.processor?.createStoredProfile || !m.merchantIdHash) throw new SavedCardError('card_saving_unavailable', 'Card saving is not available at this salon yet.', 503);
    const expiry = input.expMonth && input.expYear ? `${String(input.expMonth).padStart(2, '0')}${String(input.expYear).slice(-2)}` : undefined;
    let p;
    try { p = await m.processor.createStoredProfile({ account: token, expiry, postal: input.zipCode || undefined, name: input.cardholderName || undefined }); }
    catch { throw new SavedCardError('provider_unavailable', 'The salon\'s payment provider could not be reached. Your card was not saved.', 502); }
    if (!p.ok || !p.profileId) throw new SavedCardError('provider_rejected', 'The payment provider did not accept this card. It was not saved.');
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
      try { const m = await this.merchants.effectiveMerchant(ctx.tenantId, ctx.branchId ?? null); await m.processor?.deleteStoredProfile?.({ profileId: revoked.profileId, acctId: revoked.acctId ?? undefined }); } catch { /* audit-only */ }
    }
    return { ok: !!revoked };
  }
  async setDefault(ctx: PayCtx, methodId: string): Promise<{ ok: boolean }> {
    const id = await this.customer(ctx);
    return id ? { ok: await this.repo.setDefault(ctx.tenantId, id, methodId) } : { ok: false };
  }
}

export interface TopUpInput { amountCents: number; paymentMethodId: string; idempotencyKey?: string }

export class WalletTopupService {
  constructor(
    private readonly resolver: PaymentGatewayResolver,
    private readonly methods: CustomerPaymentMethodsPort,
    private readonly ledger: WalletLedgerService,
  ) {}

  async topUp(ctx: PayCtx, input: TopUpInput): Promise<TopUpResult> {
    if (!ctx?.tenantId) return { ok: false, message: 'Not a customer account.' };
    const customerId = await this.methods.resolveCustomerId(ctx.tenantId, ctx.userId);
    if (!customerId) return { ok: false, message: 'Not a customer account.' };
    const amountCents = Math.trunc(input?.amountCents ?? 0);
    if (!Number.isInteger(amountCents) || amountCents <= 0) return { ok: false, message: 'Enter a valid amount.' };
    const m = await this.resolver.effectiveMerchant(ctx.tenantId, ctx.branchId ?? null);
    if (!m.configured || !m.processor || !m.merchantIdHash) return { ok: false, message: 'Card payments are not set up for this salon yet.' };
    // only a provider-verified, consented card bound to THIS merchant
    const card = await this.methods.getToken(ctx.tenantId, customerId, input.paymentMethodId, m.merchantIdHash);
    if (!card) return { ok: false, message: 'Select a saved card.' };
    const expiry = card.expMonth && card.expYear ? `${String(card.expMonth).padStart(2, '0')}${String(card.expYear).slice(-2)}` : undefined;
    const idem = input.idempotencyKey && /^[A-Za-z0-9._:-]{8,100}$/.test(input.idempotencyKey) ? `topup-${customerId}-${input.idempotencyKey}` : `topup-${customerId}-${input.paymentMethodId}-${amountCents}-${Date.now()}`;
    const res = await m.processor.authorizeAndCapture({ account: card.token, expiry, amountCents, ecomind: 'E', cof: 'C', cofscheduled: 'N',   // a saved card the customer chose: card-not-present, cardholder-initiated, unscheduled
       orderId: idem.slice(0, 50), idempotencyKey: idem });
    if (!res.approved) return { ok: false, declined: res.declined, message: res.declined ? (res.respText || 'Your card was declined.') : 'We could not confirm this payment yet. Please do not try again — the salon will verify it.' };
    if (res.amountCents != null && res.amountCents !== amountCents + Math.max(0, res.surchargeCents ?? 0)) return { ok: false, message: 'We could not confirm this payment yet. Please do not try again — the salon will verify it.' };
    // Credit only after an approved charge; idempotent on the processor retref.
    await this.ledger.credit(ctx.tenantId, customerId, { amountCents, type: 'top_up', currency: 'USD', reference: res.retref ?? null, idempotencyKey: res.retref ?? undefined });
    const w = await this.ledger.getWallet(ctx.tenantId, customerId);
    return { ok: true, balanceCents: w.balanceCents };
  }
}
