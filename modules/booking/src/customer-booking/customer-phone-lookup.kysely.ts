// customer-phone-lookup.kysely.ts — the authenticated customer's OWN phone number.
//
// Exists so the CLIENT cannot choose which number a verification is for. A signed-in customer supplying a phone in
// the request body could verify a number they control and then book against somebody else's -- which is exactly
// the fraud the "changing the phone invalidates the verification" rule is there to stop, walking back in through a
// body field.
import { sql } from 'kysely';
import type { AppDatabase } from '@aipowersalon/database';
import type { CustomerPhoneLookup } from './booking-verification.controller';

export class KyselyCustomerPhoneLookup implements CustomerPhoneLookup {
  constructor(private readonly db: AppDatabase | null) {}

  async phoneFor(tenantId: string, customerId: string): Promise<string | null> {
    if (!this.db) return null;
    // TENANT-SCOPED. A customer id alone must never be enough to read a phone number out of another salon.
    // `normalized_phone` (E.164) is the one to verify -- `phone_display` is a formatted string for humans and is
    // not a number you can send an SMS to. There is no `phone` column at all; my first version selected one, and
    // `npm run check:sql` caught it before it ever ran. That is the third time today a query referenced a column
    // that does not exist, and the first time the check stopped it.
    const r: any = await sql`
      SELECT normalized_phone AS phone
      FROM customers
      WHERE id = ${customerId} AND tenant_id = ${tenantId}
      LIMIT 1`.execute(this.db as any).catch(() => ({ rows: [] }));
    const p = r.rows?.[0]?.phone;
    return p ? String(p) : null;
  }
}
