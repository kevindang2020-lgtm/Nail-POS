// check-in-temp-id.vitest.spec.ts — SW-19 (wave 4 sweep): every walk-in check-in looked its temporary 'ci_<n>' id up in
// pos_queue_items (a uuid column) → PostgreSQL "invalid input syntax for type uuid", swallowed, on every check-in. An id
// that is not a uuid cannot be a queue row: the lookup is skipped and the check-in goes straight to the insert.
import { describe, it, expect } from 'vitest';
import { KyselyCheckInRepository } from './check-in.kysely.repository';

function stubDb() {
  const looked: string[] = [];
  const chain: any = { where: (_c: any, _o: any, v: any) => { if (typeof v === 'string') looked.push(v); return chain; }, select: () => chain, executeTakeFirst: async () => undefined };
  const db: any = { selectFrom: () => chain, transaction: () => ({ execute: async () => 'queue-new' }) };
  return { db, looked };
}
const ctx: any = { tenantId: '11111111-1111-4111-8111-111111111111', branchId: '22222222-2222-4222-8222-222222222222', userId: 'u1' };

describe('enqueue never sends a temporary check-in id to PostgreSQL', () => {
  it("a 'ci_<n>' id is not looked up (it cannot be a queue row)", async () => {
    const { db, looked } = stubDb();
    const id = await new KyselyCheckInRepository(db).enqueue(ctx, { checkInId: 'ci_123456', customerName: 'Walk In', source: 'walk_in', services: [] } as any);
    expect(id).toBe('queue-new');
    expect(looked).not.toContain('ci_123456');
  });
  it('a uuid id is still looked up (moveToQueue reuses the existing row)', async () => {
    const { db, looked } = stubDb();
    const U = '33333333-3333-4333-8333-333333333333';
    await new KyselyCheckInRepository(db).enqueue(ctx, { checkInId: U, customerName: 'Walk In', source: 'walk_in', services: [] } as any);
    expect(looked).toContain(U);
  });
});
