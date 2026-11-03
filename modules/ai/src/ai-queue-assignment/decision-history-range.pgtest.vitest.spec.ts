// decision-history-range.pgtest — Nov 3 audit (AI Queue): the decision log compared created_at <= 'YYYY-MM-DD' (midnight UTC),
// so the whole "to" day was dropped, and bare days were UTC days. They are now SALON days, the end day included whole.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyQueueAssignmentRepository } from './ai-queue-assignment.kysely.repository';

const T = 'a7d30000-0000-4000-8000-000000000001', B = 'a7d30000-0000-4000-8000-000000000002';
let pg: any; let repo: KyselyQueueAssignmentRepository;
beforeAll(async () => {
  pg = await migratedPglite(); await pg.exec(`SET TIME ZONE 'UTC'`);
  await pg.query(`insert into tenants (id, legal_name, display_name, tenant_slug, tenant_code, status) values ($1,'Q','Q','aq-dr','AQDR1','active')`, [T]);
  await pg.query(`insert into branches (id, tenant_id, name, timezone) values ($1,$2,'Main','America/New_York')`, [B, T]);
  const add = (at: string, n: number) => pg.query(`insert into queue_assignment_decisions (tenant_id, branch_id, queue_entry_id, decision, decided_by, created_at) values ($1,$2,$3,'accepted','u',$4)`,
    [T, B, `a7d30000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`, at]);
  await add('2026-10-01T03:30:00Z', 1);   // Sep 30, 11:30 pm in New York
  await add('2026-10-01T15:00:00Z', 2);   // Oct 1 afternoon
  await add('2026-10-02T02:00:00Z', 3);   // Oct 1, 10 pm in New York (Oct 2 in UTC)
  await add('2026-10-02T05:00:00Z', 4);   // Oct 2, 1 am in New York
  repo = new KyselyQueueAssignmentRepository(kyselyFor(pg));
}, 120_000);

describe('decision history date range', () => {
  it('from = to = Oct 1 returns the salon day of Oct 1, evening included, newest first', async () => {
    const r = await repo.queryDecisions({ tenantId: T, branchId: B } as any, { from: '2026-10-01', to: '2026-10-01' });
    expect(r.map((d) => d.queueEntryId.slice(-2))).toEqual(['03', '02']);
  });
});
