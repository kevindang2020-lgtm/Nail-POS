// billing-export-job-actor.pgtest — B-14 remainder (Oct 20 2026): the export worker acts as the ONE system-context shape
// (systemContext). It used to hand-build `{ userId: undefined, role: 'system' }`; the audit row now keeps no user, the role
// SYSTEM and names the job — and a non-UUID actor id never reaches the uuid column.
import { describe, it, expect, beforeAll } from 'vitest';
import { migratedPglite, kyselyFor } from '@aipowersalon/testing';
import { KyselyBillingRepository } from './billing.kysely.repository';

const U = 'a9a9a9a9-0000-4000-8000-0000000000aa';
let pg: any; let repo: KyselyBillingRepository;
const q = async (s: string, p: unknown[] = []) => (await pg.query(s, p)).rows as any[];

beforeAll(async () => {
  pg = await migratedPglite();
  repo = new KyselyBillingRepository(kyselyFor(pg) as never);
}, 120000);

describe('who exported: the worker is a system job, a Super Admin is a person', () => {
  it('a queued export processed by the worker → billing.export.created audited with no user, role SYSTEM, systemActor billing-export', async () => {
    const { jobId } = await repo.createExportJob({ userId: U, role: 'SUPER_ADMIN' }, { report: 'invoices', format: 'csv' });
    expect((await repo.processPendingExportJobs(5)).processed).toBe(1);
    const created = await q(`select user_id, role, metadata_json from audit_logs where action_type = 'billing.export.created' order by created_at`);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ user_id: null, role: 'SYSTEM' });
    expect(created[0].metadata_json.systemActor).toBe('billing-export');
    const queued = await q(`select user_id, role from audit_logs where action_type = 'billing.export.job_created' and entity_id = $1`, [jobId]);
    expect(queued[0]).toMatchObject({ user_id: U, role: 'SUPER_ADMIN' });   // the person who asked keeps their id
  });
});
