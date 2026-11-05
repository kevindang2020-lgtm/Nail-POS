// BUILD_PLAN Phase 12 (Constitution 5 §32–33): this app's export buttons go through the ONE async operation contract —
// they ask with `Prefer: respond-async`, poll the status URL and download through THIS app's own client (base + /api/v1),
// and hand the screen exactly what the synchronous answer was. A recording fetch plays the server.
import { describe, it, expect, beforeEach, vi } from 'vitest';

type Call = { url: string; prefer: string | null };
let calls: Call[];
const OP = '11111111-1111-4111-8111-111111111111';
const res = (status: number, body: unknown, ct = 'application/json') => {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { status, ok: status < 300, headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? ct : null) }, json: async () => JSON.parse(text), text: async () => text,
    blob: async () => new Blob([text], { type: ct }), arrayBuffer: async () => new TextEncoder().encode(text).buffer } as any;
};
/** The server: the export answers 202 (realm `realm`), the status reads succeeded, the download is `file`. */
function serve(realm: string, file: { text: string; contentType: string; body?: unknown }) {
  globalThis.fetch = vi.fn(async (input: any, init?: any) => {
    const url = String(input); const h = init?.headers ?? {};
    calls.push({ url, prefer: h.Prefer ?? h.prefer ?? null });
    const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    if (path.endsWith(`/operations/${OP}/download`)) return res(200, file.text, file.contentType);
    if (path.endsWith(`/operations/${OP}`)) return res(200, { operationId: OP, kind: 'k', status: 'succeeded', createdAt: '2026-10-08T00:00:00Z',
      result: { downloadUrl: `/${realm}/operations/${OP}/download`, expiresAt: '2026-10-09T00:00:00Z', filename: 'f', contentType: file.contentType, bytes: file.text.length, ...(file.body ? { body: file.body } : {}) } });
    return res(202, { operationId: OP, status: 'queued', statusUrl: `/${realm}/operations/${OP}`, pollAfterMs: 1 });
  }) as any;
}
const csvEnvelope = (fields: Record<string, unknown>) => ({ fields, contentField: 'csv', encoding: 'utf8' });
const paths = () => calls.map((c) => c.url.replace(/^https?:\/\/[^/]+/, '').split('?')[0]);
/** Every call went to /api/v1 — the export (asking for async), its status, its download. */
function expectAsyncFlow(exportPath: string, realm: string) {
  expect(calls[0].prefer).toBe('respond-async');
  expect(paths()).toEqual([`/api/v1${exportPath}`, `/api/v1/${realm}/operations/${OP}`, `/api/v1/${realm}/operations/${OP}/download`]);
}
beforeEach(() => { calls = []; });
import { posCustomersApi } from './posCustomersApi';
import { posDealsApi } from './posDealsApi';
import { posMembershipsApi } from './posMembershipsApi';
import { posReportsApi } from './posReportsApi';
import { posDepositReconApi } from './posDepositReconApi';
import { posAiSchedulingOptimizerApi } from './posAiSchedulingOptimizerApi';
import { posAIQueueAssignmentApi } from './posAIQueueAssignmentApi';

describe('POS export buttons on the async operation contract', () => {
  it('customers: { format, filename, csv } as before, rebuilt around the downloaded CSV', async () => {
    serve('pos', { text: 'Name\nAnn\n', contentType: 'text/csv', body: csvEnvelope({ format: 'csv', filename: 'pos-customers.csv' }) });
    expect(await posCustomersApi.exportCsv({ segment: 'vip' })).toEqual({ format: 'csv', filename: 'pos-customers.csv', csv: 'Name\nAnn\n' });
    expectAsyncFlow('/pos/customers/export', 'pos');
    expect(calls[0].url).toContain('segment=vip');
  });
  it('deals, memberships, reports: the same JSON envelope', async () => {
    serve('pos', { text: 'a\n', contentType: 'text/csv', body: csvEnvelope({ format: 'csv', filename: 'deal-redemptions.csv' }) });
    expect(await posDealsApi.exportCsv(7)).toMatchObject({ csv: 'a\n', filename: 'deal-redemptions.csv' });
    expectAsyncFlow('/pos/deals/export', 'pos'); expect(calls[0].url).toContain('days=7');
    calls = []; await posMembershipsApi.exportMembers(); expectAsyncFlow('/pos/memberships/export/members', 'pos');
    calls = []; await posReportsApi.exportReport({ type: 'transactions' }); expectAsyncFlow('/pos/reports/export', 'pos');
  });
  it('the CSV-text exports (deposit reconciliation, AI scheduling) still resolve to the CSV text', async () => {
    serve('pos', { text: 'date,amount\n', contentType: 'text/csv; charset=utf-8' });
    expect(await posDepositReconApi.exportDaily()).toBe('date,amount\n');
    expectAsyncFlow('/pos/deposit-reconciliation/reports/daily/export', 'pos');
    calls = []; expect(await posAiSchedulingOptimizerApi.exportCsv('runs', '2026-10-01', '2026-10-08')).toBe('date,amount\n');
    expectAsyncFlow('/pos/ai-scheduling-optimizer/export', 'pos');
  });
  it('AI queue assignment: its JSON result', async () => {
    serve('pos', { text: JSON.stringify({ filename: 'aq.csv', csv: 'x' }), contentType: 'application/json' });
    expect(await posAIQueueAssignmentApi.exportCsv('decisions' as any, { from: '2026-10-01' })).toEqual({ filename: 'aq.csv', csv: 'x' });
    expectAsyncFlow('/pos/ai-queue-assignment/export', 'pos');
  });
  it('a small export the server answers synchronously (200) is returned unchanged', async () => {
    globalThis.fetch = vi.fn(async (u: any, init?: any) => { calls.push({ url: String(u), prefer: init?.headers?.Prefer ?? null }); return res(200, { format: 'csv', filename: 'pos-customers.csv', csv: 'Name\n' }); }) as any;
    expect(await posCustomersApi.exportCsv()).toEqual({ format: 'csv', filename: 'pos-customers.csv', csv: 'Name\n' });
    expect(calls).toHaveLength(1);
  });
});
