// B-93 + R-5 (Oct 28 2026): the OCR store's writes fail loudly; its history rows are best effort but logged; an OCR
// audit row says which request / job wrote it.
import { describe, it, expect, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { PostgresQueryCompiler } from 'kysely';
import { runWithContext, contextForJob, type TelemetryContext } from '@aipowersalon/observability';
import { KyselyDocStore, KyselyOcrAuditSink, KyselyPostingIdempotency, auditTraceIds } from './ai-ocr-receipt.kysely';

const T = '11111111-1111-4111-8111-111111111111';
const DOC = '22222222-2222-4222-8222-222222222222';
const ctx = { tenantId: T, branchId: null, userId: '33333333-3333-4333-8333-333333333333', role: 'OWNER', permissions: [] };
/** a database whose every statement fails, the way a dropped connection does */
const downDb = () => ({ getExecutor: () => { throw new Error('db down'); } }) as any;
/** a database that records each statement's parameters and answers with no rows */
const recordingDb = () => {
  const params: unknown[][] = [];
  const executor = {
    transformQuery: (n: unknown) => n,
    compileQuery: (n: any, id?: any) => new PostgresQueryCompiler().compileQuery(n, id),
    executeQuery: async (c: { parameters: readonly unknown[] }) => { params.push([...c.parameters]); return { rows: [] }; },
    adapter: { supportsReturning: true },
  };
  return { params, db: { getExecutor: () => executor } as any };
};
const captureWarnings = () => {
  const logged: string[] = [];
  const spy = vi.spyOn(Logger.prototype, 'warn').mockImplementation((m: any) => { logged.push(String(m)); });
  return { logged, restore: () => spy.mockRestore() };
};

describe('B-93 a failed OCR store WRITE fails loudly', () => {
  it('a document state transition, the extraction ladder and the retention mark reject instead of "succeeding"', async () => {
    const store = new KyselyDocStore(downDb());
    await expect(store.patch(ctx, DOC, { pipelineState: 'in_review' } as any)).rejects.toThrow(/db down/);
    await expect(store.recordExtractionAttempt(ctx, DOC, { attempts: 2, nextAt: null, error: 'x' })).rejects.toThrow(/db down/);
    await expect(store.markRetentionArchived(ctx, DOC)).rejects.toThrow(/db down/);
  });
  it('reads still degrade to empty (a sweep with no database finds nothing to do)', async () => {
    const store = new KyselyDocStore(downDb());
    await expect(store.retryDue(new Date(), 10)).resolves.toEqual([]);
  });
});

describe('B-93 history rows written after the fact are best effort — and logged, never silent', () => {
  it('a failed OCR audit row does not fail the action it describes, and says so', async () => {
    const w = captureWarnings();
    try {
      await expect(new KyselyOcrAuditSink(downDb()).record(ctx, 'document.uploaded', DOC, {})).resolves.toBeUndefined();
      expect(w.logged.some((m) => /OCR audit row document\.uploaded/.test(m) && /db down/.test(m))).toBe(true);
    } finally { w.restore(); }
  });
});

describe('R-5 (§191) an OCR audit row names the request / job that wrote it', () => {
  const requestCtx: TelemetryContext = { requestId: 'req_abc', correlationId: 'corr-1', traceId: 't', service: 'api' };
  it('in a request: its correlation and request ids, no job id', () => {
    expect(runWithContext(requestCtx, () => auditTraceIds())).toEqual({ correlationId: 'corr-1', requestId: 'req_abc' });
  });
  it('in the extraction job: the uploading request\'s correlation id, and the job id', () => {
    const job = contextForJob({ jobType: 'ocr.receipt_extract', jobId: 'job-42', correlationId: 'corr-1', tenantId: T });
    expect(runWithContext(job, () => auditTraceIds())).toEqual({ correlationId: 'corr-1', requestId: 'job_job-42', jobId: 'job-42' });
  });
  it('outside any context: nothing invented', () => {
    expect(auditTraceIds(undefined)).toEqual({});
  });
  it('the ids land in the row\'s metadata_json, after the caller\'s keys (a caller cannot overwrite them)', async () => {
    const { params, db } = recordingDb();
    await runWithContext(requestCtx, () => new KyselyOcrAuditSink(db).record(ctx, 'document.uploaded', DOC, { disposition: 'accepted', correlationId: 'spoofed' }));
    const json = params[0].find((p) => typeof p === 'string' && p.startsWith('{')) as string;
    expect(JSON.parse(json)).toEqual({ disposition: 'accepted', correlationId: 'corr-1', requestId: 'req_abc' });
  });
});

describe('B-93 posting history', () => {
  it('a posting attempt row that cannot be written is logged — the posting row itself already recorded the outcome', async () => {
    const w = captureWarnings();
    // the posting upsert answers a row; the attempt insert after it fails
    let n = 0;
    const executor = {
      transformQuery: (x: unknown) => x,
      compileQuery: (x: any, id?: any) => new PostgresQueryCompiler().compileQuery(x, id),
      executeQuery: async () => { n++; if (n === 1) return { rows: [] }; if (n === 2) return { rows: [{ id: 'p1' }] }; throw new Error('attempts table locked'); },
      adapter: { supportsReturning: true },
    };
    try {
      await new KyselyPostingIdempotency({ getExecutor: () => executor } as any).record(T, { idempotencyKey: `ocr:${DOC}:expense:1`, status: 'posted', externalRef: 'e1' } as any);
      expect(w.logged.some((m) => /OCR posting attempt/.test(m) && /attempts table locked/.test(m))).toBe(true);
    } finally { w.restore(); }
  });
});
