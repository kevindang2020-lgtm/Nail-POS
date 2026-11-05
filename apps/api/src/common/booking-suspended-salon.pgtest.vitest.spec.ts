// Constitution 7 §19 on the real schema: a salon that is not ACTIVE takes no customer bookings or reschedules — the
// check reads the salon's current status, so a customer session opened before the suspension cannot book after it.
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'kysely';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyCustomerBookingRepository } from '@aipowersalon/booking';
import { seedRow } from '../events/pgtest-seed';

const T = '69696969-6969-4696-8696-696969696969';
let db: any;
beforeAll(async () => {
  const pg = await migratedPglite(); db = kyselyFor(pg);
  await seedRow(pg, 'tenants', { id: T, legal_name: 'S', display_name: 'Suspended Soon', tenant_slug: 'suspendedsoon', tenant_code: 'SUSO01', status: 'active' });
});
describe('customer booking vs salon status (§19)', () => {
  it('active → accepts; suspended (any cause) or closed → refuses', async () => {
    const repo = new KyselyCustomerBookingRepository(db);
    const ctx: any = { tenantId: T, userId: 'u', branchId: null };
    expect(await repo.salonAcceptsBookings(ctx)).toBe(true);
    await sql`update tenants set lifecycle_state = 'SUSPENDED', suspension_reason_code = 'BILLING' where id = ${T}`.execute(db);
    expect(await repo.salonAcceptsBookings(ctx)).toBe(false);
    await sql`update tenants set lifecycle_state = 'PAST_DUE' where id = ${T}`.execute(db);   // PAST_DUE keeps access
    expect(await repo.salonAcceptsBookings(ctx)).toBe(true);
    await sql`update tenants set lifecycle_state = 'CLOSED' where id = ${T}`.execute(db);
    expect(await repo.salonAcceptsBookings(ctx)).toBe(false);
  });
});
