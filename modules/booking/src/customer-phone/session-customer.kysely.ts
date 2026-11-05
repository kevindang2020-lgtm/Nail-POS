// session-customer.kysely.ts — the signed-in customer's own record.
//
// TENANT-SCOPED, and keyed off the SESSION's user id. There is no path here that takes a customer id from a
// request -- which is what makes "change my phone" mean *mine*.
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import type { SessionCustomerResolver } from './customer-phone-app.controller';

export class KyselySessionCustomer implements SessionCustomerResolver {
  constructor(private readonly db: AppDatabase | null) {}

  async resolveCustomerId(ctx: { tenantId: string; userId: string }): Promise<string | null> {
    if (!this.db || !ctx.userId) return null;
    const r: any = await sql`
      SELECT id FROM customers
      WHERE tenant_id = ${ctx.tenantId} AND user_id = ${ctx.userId}
      LIMIT 1`.execute(this.db as any).catch(() => ({ rows: [] }));
    return r.rows?.[0]?.id ? String(r.rows[0].id) : null;
  }
}
