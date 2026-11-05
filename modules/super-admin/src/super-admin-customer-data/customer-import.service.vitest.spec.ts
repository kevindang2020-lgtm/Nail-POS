import { describe, it, expect } from 'vitest';
import { CustomerImportService } from './customer-import.service';
import { InMemoryImportRepo } from './customer-import.repository';
import type { RawImportRow } from './customer-import-core';

const rows: RawImportRow[] = [
  { rowNumber: 1, firstName: 'Emily', lastName: 'Johnson', phone: '+12125550101' },
  { rowNumber: 2, firstName: 'Bad', lastName: 'Phone', phone: '123' },          // invalid
  { rowNumber: 3, firstName: 'Nora', lastName: 'Patel', email: 'nora@example.com' },
];

const svc = () => new CustomerImportService(new InMemoryImportRepo());

describe('CustomerImportService', () => {
  it('stages a job as pending with a reconciled valid/invalid split', async () => {
    const r = await svc().createJob({ tenantId: 't1', rows }, { userId: 'admin1' });
    expect(r.ok).toBe(true);
    expect(r.job!.status).toBe('pending');
    expect(r.job!.totalRows).toBe(3);
    expect(r.job!.validRows).toBe(2);
    expect(r.job!.invalidRows).toBe(1);
  });

  it('rejects an empty job and a tenantless job', async () => {
    expect((await svc().createJob({ tenantId: 't1', rows: [] })).ok).toBe(false);
    expect((await svc().createJob({ rows })).ok).toBe(false);
  });

  it('approves a pending job (queues it) then the worker imports only the valid rows', async () => {
    const s = svc();
    const created = await s.createJob({ tenantId: 't1', rows });
    const approved = await s.approveJob(created.job!.id, { userId: 'admin1' });
    expect(approved.ok).toBe(true);
    expect(approved.job!.status).toBe('approved'); // enqueued, not imported synchronously — returns immediately
    // the background worker does the actual import
    const { processed } = await s.processPendingImportJobs();
    expect(processed).toBe(1);
    const done = (await s.listJobs({ tenantId: 't1' }))[0];
    expect(done.status).toBe('completed');
    expect(done.importedRows).toBe(2); // the 2 valid rows; the invalid one is not imported
  });

  it('the worker is a no-op when there are no queued jobs', async () => {
    const s = svc();
    expect((await s.processPendingImportJobs()).processed).toBe(0);
  });

  it('is idempotent: re-approving / retrying never re-imports an already-imported row', async () => {
    const s = svc();
    const created = await s.createJob({ tenantId: 't1', rows });
    await s.approveJob(created.job!.id);
    await s.processPendingImportJobs(); // worker imports the valid rows
    // a second approve is blocked (no longer pending), and a retry imports 0 new rows
    expect((await s.approveJob(created.job!.id)).ok).toBe(false);
    const retried = await s.retryJob(created.job!.id);
    expect(retried.ok).toBe(false); // nothing retryable — all valid rows already imported, rest invalid
  });

  it('rejects a pending job with a reason', async () => {
    const s = svc();
    const created = await s.createJob({ tenantId: 't1', rows });
    expect((await s.rejectJob(created.job!.id, '   ')).ok).toBe(false);
    const rej = await s.rejectJob(created.job!.id, 'duplicate upload');
    expect(rej.ok).toBe(true);
    expect(rej.job!.status).toBe('rejected');
  });

  it('overviewStats reports failed imports and success rate', async () => {
    const s = svc();
    const created = await s.createJob({ tenantId: 't1', rows });
    await s.approveJob(created.job!.id);
    await s.processPendingImportJobs(); // worker imports the valid rows
    const stats = await s.overviewStats({ tenantId: 't1' });
    expect(stats.failedImports).toBe(0);
    expect(stats.successRatePct).toBe(100); // 2 imported / 2 attempted
  });
});
