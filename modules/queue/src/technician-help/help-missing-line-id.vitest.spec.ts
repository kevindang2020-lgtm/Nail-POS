// help-missing-line-id.vitest.spec.ts — SW-21 (wave 4 sweep): technician help without ?serviceLineId= sent '' to
// PostgreSQL (a uuid column) and relied on the catch. A non-uuid id cannot be a line: answered "no such line" first.
import { describe, it, expect } from 'vitest';
import { KyselyHelpRepository } from './technician-help.kysely.repository';

describe('loadServiceLine', () => {
  it('an empty or temporary id is "no line" without a query', async () => {
    let queried = 0;
    const db: any = { selectFrom: () => { queried++; throw new Error('must not query'); } };
    const repo = new KyselyHelpRepository(db);
    const a: any = { tenantId: '11111111-1111-4111-8111-111111111111', branchId: '22222222-2222-4222-8222-222222222222' };
    expect(await repo.loadServiceLine(a, '33333333-3333-4333-8333-333333333333', '')).toBeNull();
    expect(await repo.loadServiceLine(a, '', '44444444-4444-4444-8444-444444444444')).toBeNull();
    expect(queried).toBe(0);
  });
});
