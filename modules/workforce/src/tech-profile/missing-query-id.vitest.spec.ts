// missing-query-id.vitest.spec.ts — SW-21 (wave 4 sweep): a required query id left empty (?serviceId=, ?technicianId=)
// reached PostgreSQL as '' and failed there ("invalid input syntax for type uuid"); the 400 INVALID_ID it produced was
// right, the database round-trip and error log were not. The id is checked first; the answer is the same 400 INVALID_ID.
import { describe, it, expect } from 'vitest';
import { TechProfileService } from './tech-profile.service';

function stubDb() {
  const values: unknown[] = [];
  const chain: any = new Proxy({}, { get: (_t, k) => k === 'then' ? undefined : k === 'executeTakeFirst' ? async () => ({ id: 'cust-1', created_at: new Date().toISOString() }) : k === 'execute' ? async () => [] : (...a: unknown[]) => { values.push(...a); return chain; } });
  return { db: { selectFrom: () => chain } as any, values };
}
const ctx: any = { tenantId: '11111111-1111-4111-8111-111111111111', branchId: '22222222-2222-4222-8222-222222222222', userId: 'u1', role: 'CUSTOMER', permissions: [] };
const svcWith = (db: any) => new (TechProfileService as any)(db, null) as TechProfileService;

describe('a missing query id never reaches PostgreSQL', () => {
  it('service technicians without ?serviceId= → 400 INVALID_ID, no services lookup with ""', async () => {
    const { db, values } = stubDb();
    await expect(svcWith(db).posServiceTechnicians(ctx, '')).rejects.toMatchObject({ status: 400, code: 'INVALID_ID' });
    expect(values).not.toContain('');
  });
  it('my technician rating without ?technicianId= → 400 INVALID_ID, no reviews lookup with ""', async () => {
    const { db, values } = stubDb();
    await expect(svcWith(db).customerMyTechRating(ctx, '33333333-3333-4333-8333-333333333333', '')).rejects.toMatchObject({ status: 400, code: 'INVALID_ID' });
    expect(values).not.toContain('');
  });
});
