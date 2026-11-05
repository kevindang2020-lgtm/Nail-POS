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
}
export interface PaymentMethodToken { token: string; expMonth: number | null; expYear: number | null }

export interface CustomerPaymentMethodsPort {
  resolveCustomerId(tenantId: string, userId: string): Promise<string | null>;
  list(tenantId: string, customerId: string): Promise<CustomerPaymentMethod[]>;
  add(tenantId: string, customerId: string, input: AddPaymentMethodInput): Promise<CustomerPaymentMethod>;
  remove(tenantId: string, customerId: string, id: string): Promise<boolean>;
  setDefault(tenantId: string, customerId: string, id: string): Promise<boolean>;
  /** Internal: the funding token for a saved method, for charging. Never exposed over HTTP. */
  getToken(tenantId: string, customerId: string, id: string): Promise<PaymentMethodToken | null>;
}

const display = (r: any): CustomerPaymentMethod => ({
  id: r.id,
  brand: r.brand ?? null,
  last4: r.last4 ?? null,
  expMonth: r.exp_month ?? null,
  expYear: r.exp_year ?? null,
  isDefault: !!r.is_default,
  cardholderName: r.cardholder_name ?? null,
  zipCode: r.zip_code ?? null,
  cardType: r.card_type ?? null,
});

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
  async remove(): Promise<boolean> { return false; }
  async setDefault(): Promise<boolean> { return false; }
  async getToken(): Promise<PaymentMethodToken | null> { return null; }
}

export class KyselyCustomerPaymentMethodsRepository implements CustomerPaymentMethodsPort {
  constructor(private readonly db: Kysely<DB>) {}

  async resolveCustomerId(tenantId: string, userId: string): Promise<string | null> {
    if (tenantId) {
      const row = await this.db.selectFrom('customers').select('id')
        .where('tenant_id', '=', tenantId).where('user_id', '=', userId).where('archived_at', 'is', null).executeTakeFirst();
      if ((row as any)?.id) return (row as any).id;
    }
    const anyTenant = await this.db.selectFrom('customers').select('id')
      .where('user_id', '=', userId).where('archived_at', 'is', null).executeTakeFirst();
    return (anyTenant as any)?.id ?? null;
  }
  async list(tenantId: string, customerId: string): Promise<CustomerPaymentMethod[]> {
    let query = this.db.selectFrom('customer_payment_methods')
      .select(['id', 'brand', 'last4', 'exp_month', 'exp_year', 'is_default', 'cardholder_name', 'zip_code', 'card_type'] as any)
      .where('customer_id', '=', customerId);
    if (tenantId && tenantId.length === 36) {
      query = query.where('tenant_id', '=', tenantId);
    }
    const rows = await query.orderBy('is_default', 'desc').orderBy('created_at', 'asc').execute();
    return (rows as any[]).map(display);
  }
  async add(tenantId: string, customerId: string, input: AddPaymentMethodInput): Promise<CustomerPaymentMethod> {
    return this.db.transaction().execute(async (trx) => {
      let effectiveTenantId = tenantId;
      if (!effectiveTenantId || effectiveTenantId.length !== 36) {
        const cRow = await trx.selectFrom('customers').select('tenant_id').where('id', '=', customerId).executeTakeFirst();
        if ((cRow as any)?.tenant_id) effectiveTenantId = (cRow as any).tenant_id;
      }
      if (input.isDefault) {
        await trx.updateTable('customer_payment_methods').set({ is_default: false } as any).where('customer_id', '=', customerId).execute();
      }
      const row = await trx.insertInto('customer_payment_methods').values({
        tenant_id: effectiveTenantId, customer_id: customerId, gateway: 'cardpointe', token: input.token, brand: input.brand ?? null,
        last4: input.last4 ?? null, exp_month: input.expMonth ?? null, exp_year: input.expYear ?? null, is_default: !!input.isDefault,
        cardholder_name: input.cardholderName ?? null, zip_code: input.zipCode ?? null, card_type: input.cardType ?? null,
      } as any).returning(['id', 'brand', 'last4', 'exp_month', 'exp_year', 'is_default', 'cardholder_name', 'zip_code', 'card_type'] as any).executeTakeFirstOrThrow();
      return display(row);
    });
  }
  async remove(tenantId: string, customerId: string, id: string): Promise<boolean> {
    const res = await this.db.deleteFrom('customer_payment_methods').where('customer_id', '=', customerId).where('id', '=', id).executeTakeFirst();
    return Number((res as any)?.numDeletedRows ?? 0) > 0;
  }
  async setDefault(tenantId: string, customerId: string, id: string): Promise<boolean> {
    return this.db.transaction().execute(async (trx) => {
      const exists = await trx.selectFrom('customer_payment_methods').select('id').where('customer_id', '=', customerId).where('id', '=', id).executeTakeFirst();
      if (!exists) return false;
      await trx.updateTable('customer_payment_methods').set({ is_default: false } as any).where('customer_id', '=', customerId).execute();
      await trx.updateTable('customer_payment_methods').set({ is_default: true } as any).where('customer_id', '=', customerId).where('id', '=', id).execute();
      return true;
    });
  }
  async getToken(tenantId: string, customerId: string, id: string): Promise<PaymentMethodToken | null> {
    const row = await this.db.selectFrom('customer_payment_methods').select(['token', 'exp_month', 'exp_year'])
      .where('customer_id', '=', customerId).where('id', '=', id).executeTakeFirst();
    return row ? { token: (row as any).token, expMonth: (row as any).exp_month ?? null, expYear: (row as any).exp_year ?? null } : null;
  }
}
