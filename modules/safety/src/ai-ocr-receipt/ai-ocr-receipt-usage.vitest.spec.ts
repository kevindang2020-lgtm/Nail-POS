// ai-ocr-receipt-usage.vitest.spec.ts — usage metering and the AI entitlement gate on extraction.
//
// Extraction is the one BILLABLE step in this module: AWS Textract charges per page, and ai-catalog.ts sells the
// package as 500 `scans` included with 8c overage. Two things were missing, and each is a money bug in a
// different direction:
//
//   * nothing wrote to `ai_usage_logs`, so OCR spend was invisible on the tenant and Super Admin usage screens;
//   * nothing called `evaluateAiAccess()`, so an expired trial, a cancelled package, or a tenant 400 scans past
//     their limit would all have kept scanning — billed to us, free to them.
//
// The subtle one, and the reason this file exists: the tenant's unit is SCANS and the platform's cost unit is
// PAGES. The entitlement counter counts ROWS of successful usage against `includedUsageLimit`, so metering a
// 3-page receipt as `3` would burn a 500-scan allowance three times faster than the plan the tenant bought.
import { describe, it, expect } from 'vitest';
import { AiOcrReceiptService, OCR_PACKAGE_CODE, OCR_TASK_KEY, ocrCostMicroUsdPerPage } from './ai-ocr-receipt.service';
import { normalizeAnalyzeExpense } from './ai-ocr-receipt.textract';
import type { OcrProvider } from './ai-ocr-receipt-pipeline';
import { AiProviderTaskGateway, type AiAccessSnapshot } from '@aipowersalon/ai';

const CTX = { tenantId: 't1', branchId: 'b1', userId: 'u1', role: 'MANAGER', permissions: [] as string[] } as any;

const RESPONSE = (pages = 1) => ({
  ExpenseDocuments: [{
    SummaryFields: [
      { Type: { Text: 'VENDOR_NAME' }, ValueDetection: { Text: 'Beauty Supply Co', Confidence: 98 }, PageNumber: 1 },
      { Type: { Text: 'TOTAL' }, ValueDetection: { Text: '$142.75', Confidence: 99 }, PageNumber: pages },
    ],
    LineItemGroups: [],
  }],
});

const okProvider = (pages = 1): OcrProvider => ({
  key: 'aws-textract', connected: true, costRank: 1, supports: () => true,
  async extract() { return normalizeAnalyzeExpense(RESPONSE(pages), 'aws-textract'); },
});

const activeSnapshot = (over: Partial<AiAccessSnapshot> = {}): AiAccessSnapshot => ({
  tenantStatus: 'active', supportMode: false, packageEnabled: true,
  subscription: { status: 'active', trialEndsAt: null },
  usage: { used: 10, limit: 500, overageEnabled: false },
  hasPermission: true, pastDuePolicy: 'block',
  ...over,
} as AiAccessSnapshot);

function build(opts: { providers?: OcrProvider[]; snapshot?: AiAccessSnapshot | null } = {}) {
  const doc: any = {
    id: 'd1', tenantId: 't1', branchId: 'b1', pipelineState: 'extracting', documentType: 'unknown',
    vendor: null, totalCents: null, category: null, fileHash: 'H', perceptualHash: null,
    documentNumber: null, documentDate: null, postingVersion: 1,
    storageKey: 'tenants/t1/documents/d1/original.pdf',
  };
  const logged: any[] = [];
  const docs: any = { async get() { return { ...doc }; }, async patch(_c: any, _i: string, p: any) { Object.assign(doc, p); }, async dedupCandidates() { return []; } };
  const settings: any = { async load() { return []; } };
  const audit: any = { async record() { /* */ } };
  const usage: any = { async log(e: any) { logged.push(e); } };
  const access = opts.snapshot === null ? undefined : { async loadSnapshot() { return opts.snapshot ?? activeSnapshot(); } };
  const s = new AiOcrReceiptService(docs, settings, {} as any, {} as any, {} as any, audit, opts.providers ?? [], usage, access as any);
  return { s, doc, logged };
}

describe('OCR usage metering', () => {
  it('writes exactly ONE usage row per extraction, in the tenant\u2019s billing unit', async () => {
    const { s, logged } = build({ providers: [okProvider(1)] });
    await s.runExtraction(CTX, 'd1');

    expect(logged).toHaveLength(1);
    const e = logged[0];
    expect(e.packageCode).toBe(OCR_PACKAGE_CODE);      // the same code the sidebar gates the screen on
    expect(e.action).toBe('extract');
    expect(e.usageUnit).toBe('scans');
    expect(e.usageAmount).toBe(1);
    expect(e.status).toBe('success');
  });

  it('meters a MULTI-PAGE receipt as ONE scan — not one per page', async () => {
    // This is the bug this test exists to prevent. The catalog sells 500 `scans`, and the entitlement counter
    // counts ROWS of successful usage. A 5-page invoice metered as 5 would consume a tenant's allowance five
    // times faster than the plan they bought — a silent overcharge.
    const { s, logged } = build({ providers: [okProvider(5)] });
    await s.runExtraction(CTX, 'd1');
    expect(logged).toHaveLength(1);
    expect(logged[0].usageAmount).toBe(1);
  });

  it('estimates PLATFORM cost per page, because that is how the provider bills', async () => {
    // Tenant unit (scans) and platform cost unit (pages) are different things. Conflating them is exactly what
    // would have gone wrong; keeping them separate is the point.
    const { s, logged } = build({ providers: [okProvider(5)] });
    await s.runExtraction(CTX, 'd1');
    expect(logged[0].costMicroUsd).toBe(5 * ocrCostMicroUsdPerPage());
  });

  it('does not invent token counts for a provider that has none', async () => {
    const { s, logged } = build({ providers: [okProvider()] });
    await s.runExtraction(CTX, 'd1');
    expect(logged[0].inputTokens).toBe(0);
    expect(logged[0].outputTokens).toBe(0);
    expect(logged[0].modelName).toBe('textract-analyze-expense');
  });

  it('records NO usage when no provider was ever called', async () => {
    // The default deployment. Nothing ran, nothing was billed — a zero-cost row would put phantom OCR activity
    // on the tenant's AI Usage screen for work that never happened.
    const { s, logged } = build({ providers: [] });
    const r = await s.runExtraction(CTX, 'd1');
    expect(r.unavailable).toBe(true);
    expect(logged).toHaveLength(0);
  });

  it('records a FAILED provider attempt — it may well have been billed — but not as usage', async () => {
    const dead: OcrProvider = { key: 'aws-textract', connected: true, costRank: 1, supports: () => true, async extract() { throw new Error('throttled'); } };
    const { s, logged } = build({ providers: [dead] });
    await s.runExtraction(CTX, 'd1');
    expect(logged).toHaveLength(1);
    expect(logged[0].status).toBe('provider_error');
    expect(logged[0].usageAmount).toBe(0);             // must NOT consume the tenant's scan allowance
  });

  it('a broken usage logger cannot fail an extraction that already succeeded', async () => {
    // A lost telemetry row is better than a lost receipt.
    const docs: any = { async get() { return { id: 'd1', tenantId: 't1', branchId: 'b1', pipelineState: 'extracting', fileHash: 'H', storageKey: 'tenants/t1/documents/d1/original.pdf', postingVersion: 1 }; }, async patch() { /* */ }, async dedupCandidates() { return []; } };
    const s = new AiOcrReceiptService(
      docs, { async load() { return []; } } as any, {} as any, {} as any, {} as any, { async record() { /* */ } } as any,
      [okProvider()], { async log() { throw new Error('usage table down'); } } as any, undefined,
    );
    const r = await s.runExtraction(CTX, 'd1');
    expect(r.pipelineState).toBe('review_required');
  });
});

describe('OCR AI entitlement gate', () => {
  it('allows extraction on an active subscription', async () => {
    const { s } = build({ providers: [okProvider()], snapshot: activeSnapshot() });
    expect((await s.runExtraction(CTX, 'd1')).unavailable).toBe(false);
  });

  it('BLOCKS a tenant past their usage limit — with a 429, not a generic denial', async () => {
    const { s, logged } = build({
      providers: [okProvider()],
      snapshot: activeSnapshot({ usage: { used: 500, limit: 500, overageEnabled: false } } as any),
    });
    await expect(s.runExtraction(CTX, 'd1')).rejects.toMatchObject({ code: 'AI_USAGE_LIMIT_REACHED', status: 429 });   // Decision 30's code
    expect(logged).toHaveLength(0);      // and it was blocked BEFORE Textract could charge us
  });

  it('BLOCKS an unsubscribed tenant', async () => {
    const { s } = build({ providers: [okProvider()], snapshot: activeSnapshot({ subscription: null } as any) });
    await expect(s.runExtraction(CTX, 'd1')).rejects.toMatchObject({ code: 'MODULE_DISABLED' });
  });

  it('BLOCKS a cancelled package and a suspended tenant', async () => {
    for (const snap of [
      activeSnapshot({ subscription: { status: 'cancelled', trialEndsAt: null } } as any),
      activeSnapshot({ tenantStatus: 'suspended' } as any),
    ]) {
      const { s } = build({ providers: [okProvider()], snapshot: snap });
      await expect(s.runExtraction(CTX, 'd1')).rejects.toMatchObject({ code: 'MODULE_DISABLED' });
    }
  });

  it('blocks BEFORE the provider is called — an unentitled tenant never costs us a Textract page', async () => {
    let called = false;
    const spy: OcrProvider = { key: 'aws-textract', connected: true, costRank: 1, supports: () => true, async extract() { called = true; return normalizeAnalyzeExpense(RESPONSE(), 'aws-textract'); } };
    const { s, doc } = build({ providers: [spy], snapshot: activeSnapshot({ subscription: null } as any) });
    await expect(s.runExtraction(CTX, 'd1')).rejects.toMatchObject({ code: 'MODULE_DISABLED' });
    expect(called).toBe(false);
    expect(doc.pipelineState).toBe('extracting');   // and the document is not lost — it waits
  });

  it('is not enforced when no access repo is bound, rather than silently allowing or denying', async () => {
    const { s } = build({ providers: [okProvider()], snapshot: null });
    expect((await s.runExtraction(CTX, 'd1')).unavailable).toBe(false);
  });
});

describe('ocrCostMicroUsdPerPage', () => {
  it('defaults to the published AnalyzeExpense list price', () => {
    expect(ocrCostMicroUsdPerPage({} as any)).toBe(10_000);   // USD 0.01/page
  });
  it('is overridable — negotiated pricing must not silently accrue a wrong number', () => {
    expect(ocrCostMicroUsdPerPage({ OCR_COST_MICRO_USD_PER_PAGE: '4200' } as any)).toBe(4200);
    expect(ocrCostMicroUsdPerPage({ OCR_COST_MICRO_USD_PER_PAGE: '0' } as any)).toBe(0);
  });
  it('falls back rather than accepting nonsense', () => {
    expect(ocrCostMicroUsdPerPage({ OCR_COST_MICRO_USD_PER_PAGE: 'free' } as any)).toBe(10_000);
    expect(ocrCostMicroUsdPerPage({ OCR_COST_MICRO_USD_PER_PAGE: '-5' } as any)).toBe(10_000);
  });
});

// §30 (Oct 27 2026): with the central AI gateway bound (the module binds it with a database), extraction is the registered
// task 'ocr.receipt_extract' — entitlement, safety switches, provider circuit breaker and the ledger are the PLATFORM's.
describe('§30 — extraction through the central AI gateway', () => {
  const withGateway = (opts: Parameters<typeof build>[0] & { suspended?: boolean } = {}) => {
    const b = build({ ...opts, snapshot: null });
    const access = { async loadSnapshot() { return opts.snapshot ?? activeSnapshot(); } };
    b.s.gateway = new AiProviderTaskGateway({ accessRepo: access as any, usage: { log: async (e: any) => { b.logged.push(e); } }, platformSafety: async () => (opts.suspended ? { suspendedTasks: [OCR_TASK_KEY] } : {}) });
    return b;
  };
  it('one success row through the gateway: action ocr.receipt_extract, ONE scan, the per-page platform cost; the module\'s own row is not written too', async () => {
    const { s, logged } = withGateway({ providers: [okProvider(3)] });
    await s.runExtraction(CTX, 'd1');
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ action: OCR_TASK_KEY, packageCode: OCR_PACKAGE_CODE, modelProvider: 'aws-textract', status: 'success', usageUnit: 'scans', usageAmount: 1, costMicroUsd: 3 * ocrCostMicroUsdPerPage() });
  });
  it('the gateway\'s quota refusal is the module\'s AI_USAGE_LIMIT_REACHED, before the provider is called', async () => {
    let called = 0;
    const p: OcrProvider = { ...okProvider(), async extract() { called++; return okProvider().extract({} as any); } };
    const { s, doc } = withGateway({ providers: [p], snapshot: activeSnapshot({ usage: { used: 500, limit: 500, overageEnabled: false } }) });
    await expect(s.runExtraction(CTX, 'd1')).rejects.toMatchObject({ code: 'AI_USAGE_LIMIT_REACHED' });
    expect(called).toBe(0);
    expect(doc.pipelineState).toBe('extracting');
  });
  it('a task suspended platform-wide is refused as MODULE_DISABLED; nothing is called', async () => {
    let called = 0;
    const p: OcrProvider = { ...okProvider(), async extract() { called++; return okProvider().extract({} as any); } };
    const { s } = withGateway({ providers: [p], suspended: true });
    await expect(s.runExtraction(CTX, 'd1')).rejects.toMatchObject({ code: 'MODULE_DISABLED' });
    expect(called).toBe(0);
  });
  it('a provider failure is ledgered once by the gateway (provider_error) and the document goes to manual entry', async () => {
    const bad: OcrProvider = { ...okProvider(), async extract() { throw new Error('textract 503'); } };
    const { s, logged, doc } = withGateway({ providers: [bad] });
    const r = await s.runExtraction(CTX, 'd1');
    expect(r.unavailable).toBe(true);
    expect(doc.pipelineState).toBe('manual_entry_required');
    expect(logged.map((e) => e.status)).toEqual(['provider_error']);
  });
});
