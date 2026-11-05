// customer-payments.service.ts — saved payment methods CRUD + wallet top-up. Top-up charges the saved card through the
// tenant's real payment processor (PaymentGatewayResolver → authorizeAndCapture) and, only on an approved charge, posts
// an idempotent credit to the wallet ledger keyed on the processor retref (so a retry can never double-credit).
import type { TopUpResult } from '@aipowersalon/api-contracts/customer';
export type { TopUpResult };   // owned by packages/api-contracts (Constitution 13 §13)
import { PaymentGatewayResolver } from '../payments/payment-gateway.resolver';
import { WalletLedgerService } from '@aipowersalon/customers';
import type { CustomerPaymentMethodsPort, CustomerPaymentMethod, AddPaymentMethodInput } from './customer-payments.repository';

export interface PayCtx { tenantId: string; userId: string }
const onlyDigits = (s: string) => (s || '').replace(/\D+/g, '');

export { looksLikeRawPan } from '../payments/card-data';   // the one PCI rule, shared with the hardware-plan card
import { looksLikeRawPan } from '../payments/card-data';

export class CustomerPaymentMethodsService {
  constructor(private readonly repo: CustomerPaymentMethodsPort) {}
  private async customer(ctx: PayCtx) { return this.repo.resolveCustomerId(ctx.tenantId, ctx.userId); }

  async list(ctx: PayCtx): Promise<CustomerPaymentMethod[]> {
    const id = await this.customer(ctx);
    return id ? this.repo.list(ctx.tenantId, id) : [];
  }
  // POS staff view: a specific customer's saved cards (read-only; card management stays customer-side).
  async listForCustomer(tenantId: string, customerId: string): Promise<CustomerPaymentMethod[]> {
    if (!tenantId || !customerId) return [];
    return this.repo.list(tenantId, customerId);
  }
  async add(ctx: PayCtx, input: AddPaymentMethodInput): Promise<CustomerPaymentMethod> {
    const id = await this.customer(ctx);
    if (!id) throw new Error('not_customer');
    const token = (input?.token || '').trim();
    if (!token) throw new Error('A payment token is required.');
    if (looksLikeRawPan(token)) throw new Error('A card number cannot be saved directly. Add the card with the secure card form (it is tokenized by the salon\'s payment provider).');
    const last4 = input.last4 || onlyDigits(token).slice(-4) || null; // never store the PAN; last4 is display-only
    return this.repo.add(ctx.tenantId, id, { ...input, token, last4 });
  }
  async remove(ctx: PayCtx, methodId: string): Promise<{ ok: boolean }> {
    const id = await this.customer(ctx);
    return id ? { ok: await this.repo.remove(ctx.tenantId, id, methodId) } : { ok: false };
  }
  async setDefault(ctx: PayCtx, methodId: string): Promise<{ ok: boolean }> {
    const id = await this.customer(ctx);
    return id ? { ok: await this.repo.setDefault(ctx.tenantId, id, methodId) } : { ok: false };
  }
}

export interface TopUpInput { amountCents: number; paymentMethodId: string }

export class WalletTopupService {
  constructor(
    private readonly resolver: PaymentGatewayResolver,
    private readonly methods: CustomerPaymentMethodsPort,
    private readonly ledger: WalletLedgerService,
  ) {}

  async topUp(ctx: PayCtx, input: TopUpInput): Promise<TopUpResult> {
    const customerId = await this.methods.resolveCustomerId(ctx.tenantId, ctx.userId);
    if (!customerId) return { ok: false, message: 'Not a customer account.' };
    const amountCents = Math.trunc(input?.amountCents ?? 0);
    if (!Number.isInteger(amountCents) || amountCents <= 0) return { ok: false, message: 'Enter a valid amount.' };
    const m = await this.methods.getToken(ctx.tenantId, customerId, input.paymentMethodId);
    if (!m) return { ok: false, message: 'Select a saved card.' };
    const gw = await this.resolver.resolve(ctx.tenantId);
    if (!gw.processor) return { ok: false, message: gw.pausedByPlatform ? 'Card payments are temporarily paused. Please try again later.' : 'Card payments are not set up for this salon yet.' };
    const expiry = m.expMonth && m.expYear ? `${String(m.expMonth).padStart(2, '0')}${String(m.expYear).slice(-2)}` : undefined;
    const res = await gw.processor.authorizeAndCapture({ account: m.token, expiry, amountCents, ecomind: 'E', cof: 'C', cofscheduled: 'N',   // a saved card the customer chose: card-not-present, cardholder-initiated, unscheduled
       idempotencyKey: `topup-${customerId}-${amountCents}-${Date.now()}` });
    if (!res.approved) return { ok: false, declined: res.declined, message: res.respText || 'Your card was declined.' };
    // Credit only after an approved charge; idempotent on the processor retref.
    await this.ledger.credit(ctx.tenantId, customerId, { amountCents, type: 'top_up', currency: 'USD', reference: res.retref ?? null, idempotencyKey: res.retref ?? undefined });
    const w = await this.ledger.getWallet(ctx.tenantId, customerId);
    return { ok: true, balanceCents: w.balanceCents };
  }
}
