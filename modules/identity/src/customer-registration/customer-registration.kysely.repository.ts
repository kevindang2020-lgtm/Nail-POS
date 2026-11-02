import type { Kysely } from 'kysely';
import type { DB } from '@aipowersalon/database';
import type { CustomerRegistrationDataPort } from './customer-registration.repository';
import type { RegisterInput, RegisterResult } from './customer-registration.dto';
import { hashPassword } from '@aipowersalon/auth';

// Creates a CUSTOMER user + linked customer record for the salon identified by tenant_code or tenant_slug. Password is
// scrypt-hashed with the same util the rest of auth uses; the new account can immediately sign in via the normal login.
export class KyselyCustomerRegistrationRepository implements CustomerRegistrationDataPort {
  constructor(private readonly db: Kysely<DB>) {}

  async register(input: RegisterInput): Promise<RegisterResult> {
    // The salon is CHOSEN, never guessed: a salon location from the list / nearby search (salonId = a branch), or a
    // salon code. Only an ACTIVE salon business takes new customers, and only a live, public location can be picked.
    const salonId = input.salonId?.trim(), salonCode = input.salonCode?.trim();
    if (!salonId && !salonCode) return { ok: false, message: 'Choose your salon.' };
    let tenantId: string, branchId: string;
    if (salonId) {
      if (!/^[0-9a-f-]{36}$/i.test(salonId)) return { ok: false, message: 'That salon isn’t available for sign-up.' };
      const b: any = await this.db.selectFrom('branches as b').innerJoin('tenants as t', 't.id', 'b.tenant_id').select(['b.id as id', 'b.tenant_id as tenant_id'])
        .where('b.id', '=', salonId).where('b.status', '=', 'active').where('b.deleted_at', 'is', null).where('b.is_public', '=', true).where('t.status', '=', 'active')
        .executeTakeFirst();
      if (!b) return { ok: false, message: 'That salon isn’t available for sign-up.' };
      tenantId = String(b.tenant_id); branchId = String(b.id);
    } else {
      const tenant = await this.db.selectFrom('tenants').select(['id'])
        .where((eb) => eb.or([eb('tenant_code', '=', salonCode!), eb('tenant_slug', '=', salonCode!)]))
        .where('status', '=', 'active')
        .executeTakeFirst();
      if (!tenant) return { ok: false, message: 'We couldn’t find a salon with that code.' };
      tenantId = tenant.id as string;
      const branch = await this.db.selectFrom('branches').select(['id']).where('tenant_id', '=', tenantId).orderBy('created_at', 'asc').executeTakeFirst();
      if (!branch) return { ok: false, message: 'That salon isn’t set up for booking yet.' };
      branchId = branch.id as string;
    }
    const existing = await this.db.selectFrom('users').select(['id']).where('tenant_id', '=', tenantId).where('email', '=', input.email).executeTakeFirst();
    if (existing) return { ok: false, message: 'An account with that email already exists. Try signing in.' };

    const password_hash = await hashPassword(input.password);
    const normalized_phone = input.phone ? input.phone.replace(/\D+/g, '') || null : null;
    return this.db.transaction().execute(async (trx) => {
      const u = await trx.insertInto('users').values({
        tenant_id: tenantId, branch_id: branchId, email: input.email, normalized_phone, password_hash, status: 'active', role: 'CUSTOMER',
        customer_default_at: new Date(),   // the salon chosen at sign-up is their default (changeable later)
      } as any).returning('id').executeTakeFirstOrThrow();
      const c = await trx.insertInto('customers').values({
        tenant_id: tenantId, branch_id: branchId, first_name: input.firstName, last_name: input.lastName, full_name: `${input.firstName} ${input.lastName}`.trim(),
        email: input.email, phone_display: input.phone || null, normalized_phone, user_id: (u as any).id, status: 'active',
      } as any).returning('id').executeTakeFirstOrThrow();
      // ids travel back so the service can link the global identity AFTER this transaction commits (§31: the
      // user+customer pair stays atomic; identity linking is a separate, best-effort step outside the tx).
      return { ok: true, tenantId, customerId: String(c.id) };
    });
  }
}
