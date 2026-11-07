// customer-payments.repository.ts — saved payment methods (tokens only). The token never leaves the backend; list/UI
// only ever see brand/last4/expiry. Port + in-memory adapter (tests / DB-less) + Postgres adapter.
import type { CustomerPaymentMethod } from '@aipowersalon/api-contracts/customer';
export type { CustomerPaymentMethod };   // owned by packages/api-contracts (Constitution 13 §13)
import { sql, type Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';

export interface AddPaymentMethodInput {
  token: string;
  brand?: string | null;
  last4?: string | null;
  expMonth?: number | null;
  expYear?: number | null;
  isDefault?: boolean;
  cardholderName?: string | null;
  zipCode?: string | null;
  cardType?: string | null;
  /** Set by the service ONLY after the provider accepted the token (never from a request body). */
  binding?: SavedCardBinding;
}
export interface SavedCardBinding { merchantAccountId: string | null; merchantIdHash: string; profileId: string; acctId: string | null; consentVersion: string; consentScope: 'cit_unscheduled' }
export interface PaymentMethodToken { token: string; expMonth: number | null; expYear: number | null }
export interface RevokedMethod { profileId: string | null; acctId: string | null }

export interface CustomerPaymentMethodsPort {
  resolveCustomerId(tenantId: string, userId: string): Promise<string | null>;
  list(tenantId: string, customerId: string): Promise<CustomerPaymentMethod[]>;
  add(tenantId: string, customerId: string, input: AddPaymentMethodInput): Promise<CustomerPaymentMethod>;
  /** Revokes the card (soft — kept for audit, never chargeable again). Returns the provider reference, or null. */
  remove(tenantId: string, customerId: string, id: string): Promise<RevokedMethod | null>;
  setDefault(tenantId: string, customerId: string, id: string): Promise<boolean>;
  /** Internal: the funding token for a saved method, for charging — only a provider-verified, consented, unrevoked card
   *  bound to the merchant identified by merchantIdHash. Never exposed over HTTP. */
  getToken(tenantId: string, customerId: string, id: string, merchantIdHash: string): Promise<PaymentMethodToken | null>;
}

const display = (r: any): CustomerPaymentMethod => ({ id: r.id, brand: r.brand ?? null, last4: r.last4 ?? null, expMonth: r.exp_month ?? null, expYear: r.exp_year ?? null, isDefault: !!r.is_default,
  cardholderName: r.cardholder_name ?? null, zipCode: r.zip_code ?? null, cardType: r.card_type ?? null });

export class InMemoryCustomerPaymentMethodsRepository implements CustomerPaymentMethodsPort {
  async resolveCustomerId(): Promise<string | null> { return null; }
  async list(): Promise<CustomerPaymentMethod[]> { return []; }
  async add(_t: string, _c: string, i: AddPaymentMethodInput): Promise<CustomerPaymentMethod> {
    return {
      id: 'mem',
      brand: i.brand ?? null,
      last4: i.last4 ?? null,
      expMonth: i.expMonth ?? null,
      expYear: i.expYear ?? null,
      isDefault: !!i.isDefault,
      cardholderName: i.cardholderName ?? null,
      zipCode: i.zipCode ?? null,
      cardType: i.cardType ?? null,
    };
  }
  async remove(): Promise<RevokedMethod | null> { return null; }
  async setDefault(): Promise<boolean> { return false; }
  async getToken(): Promise<PaymentMethodToken | null> { return null; }
}

export class KyselyCustomerPaymentMethodsRepository implements CustomerPaymentMethodsPort {
  constructor(private readonly db: Kysely<DB>) {}

  // Fiserv master build §8D (Nov 4 2026): EVERY statement is keyed by tenant_id. The former fallback that picked the
  // user's customer row in ANY tenant (and the list that dropped the tenant filter for a malformed tenant id) are gone —
  // one salon can never read, default, revoke or charge another salon's saved card.
  async resolveCustomerId(tenantId: string, userId: string): Promise<string | null> {
    if (!tenantId || !userId) return null;
    const row = await this.db.selectFrom('customers').select('id')
      .where('tenant_id', '=', tenantId).where('user_id', '=', userId).where('archived_at', 'is', null).executeTakeFirst();
    return (row)?.id ?? null;
  }
  private live(tenantId: string, customerId: string) {
    return this.db.selectFrom('customer_payment_methods').where('tenant_id', '=', tenantId).where('customer_id', '=', customerId).where('revoked_at', 'is', null);
  }
  async list(tenantId: string, customerId: string): Promise<CustomerPaymentMethod[]> {
    if (!tenantId) return [];
    const rows = await this.live(tenantId, customerId)
      .select(['id', 'brand', 'last4', 'exp_month', 'exp_year', 'is_default', 'cardholder_name', 'zip_code', 'card_type'])
      .orderBy('is_default', 'desc').orderBy('created_at', 'asc').execute();
    return rows.map(display);
  }
  async add(tenantId: string, customerId: string, input: AddPaymentMethodInput): Promise<CustomerPaymentMethod> {
    const b = input.binding;
    if (!tenantId || !b) throw new Error('A saved card must be provider-verified and merchant-bound before it is stored.');
    return this.db.transaction().execute(async (trx) => {
      if (input.isDefault) {
        await trx.updateTable('customer_payment_methods').set({ is_default: false }).where('tenant_id', '=', tenantId).where('customer_id', '=', customerId).execute();
      }
      const row = await trx.insertInto('customer_payment_methods').values({
        tenant_id: tenantId, customer_id: customerId, gateway: 'cardpointe', token: input.token, brand: input.brand ?? null,
        last4: input.last4 ?? null, exp_month: input.expMonth ?? null, exp_year: input.expYear ?? null, is_default: !!input.isDefault,
        cardholder_name: input.cardholderName ?? null, zip_code: input.zipCode ?? null, card_type: input.cardType ?? null,
        merchant_account_id: b.merchantAccountId, merchant_id_hash: b.merchantIdHash, provider_profile_id: b.profileId, provider_acct_id: b.acctId,
        token_source: 'hosted_iframe', verified_at: sql`now()`, consent_version: b.consentVersion, consent_scope: b.consentScope, consent_at: sql`now()`,
      }).returning(['id', 'brand', 'last4', 'exp_month', 'exp_year', 'is_default', 'cardholder_name', 'zip_code', 'card_type']).executeTakeFirstOrThrow();
      return display(row);
    });
  }
  async remove(tenantId: string, customerId: string, id: string): Promise<RevokedMethod | null> {
    if (!tenantId) return null;
    const row: any = await this.db.updateTable('customer_payment_methods').set({ revoked_at: sql`now()`, is_default: false })
      .where('tenant_id', '=', tenantId).where('customer_id', '=', customerId).where('id', '=', id).where('revoked_at', 'is', null)
      .returning(['provider_profile_id', 'provider_acct_id']).executeTakeFirst();
    return row ? { profileId: row.provider_profile_id ?? null, acctId: row.provider_acct_id ?? null } : null;
  }
  async setDefault(tenantId: string, customerId: string, id: string): Promise<boolean> {
    if (!tenantId) return false;
    return this.db.transaction().execute(async (trx) => {
      const exists = await trx.selectFrom('customer_payment_methods').select('id').where('tenant_id', '=', tenantId).where('customer_id', '=', customerId).where('id', '=', id).where('revoked_at', 'is', null).executeTakeFirst();
      if (!exists) return false;
      await trx.updateTable('customer_payment_methods').set({ is_default: false }).where('tenant_id', '=', tenantId).where('customer_id', '=', customerId).execute();
      await trx.updateTable('customer_payment_methods').set({ is_default: true }).where('tenant_id', '=', tenantId).where('customer_id', '=', customerId).where('id', '=', id).execute();
      return true;
    });
  }
  async getToken(tenantId: string, customerId: string, id: string, merchantIdHash: string): Promise<PaymentMethodToken | null> {
    if (!tenantId || !merchantIdHash) return null;
    const row = await this.live(tenantId, customerId).select(['token', 'exp_month', 'exp_year']).where('id', '=', id)
      .where('token_source', '=', 'hosted_iframe').where('verified_at', 'is not', null).where('consent_at', 'is not', null)
      .where('merchant_id_hash', '=', merchantIdHash).executeTakeFirst();
    return row ? { token: (row).token, expMonth: (row).exp_month ?? null, expYear: (row).exp_year ?? null } : null;
  }
}
