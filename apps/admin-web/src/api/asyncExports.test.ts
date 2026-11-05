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
const contentEnvelope = (fields: Record<string, unknown>) => ({ fields, contentField: 'content', encoding: 'utf8' });
const paths = () => calls.map((c) => c.url.replace(/^https?:\/\/[^/]+/, '').split('?')[0]);
/** Every call went to /api/v1 — the export (asking for async), its status, its download. */
function expectAsyncFlow(exportPath: string, realm: string) {
  expect(calls[0].prefer).toBe('respond-async');
  expect(paths()).toEqual([`/api/v1${exportPath}`, `/api/v1/${realm}/operations/${OP}`, `/api/v1/${realm}/operations/${OP}/download`]);
}
beforeEach(() => { calls = []; });
import { superAdminSettlementsApi } from './superAdminSettlementsApi';
import { superAdminQueueApi } from './superAdminQueueApi';
import { superAdminMerchantAccountsApi } from './superAdminMerchantAccountsApi';
import { superAdminApi } from './superAdminApi';
import { exportPayoutReports } from './superAdminRevenueResidualsApi';

describe('Super Admin export buttons on the async operation contract', () => {
  it('settlements CSV / XLSX: a Blob, as getBlob gave', async () => {
    serve('super-admin', { text: 'id,amount\n', contentType: 'text/csv' });
    const b = await superAdminSettlementsApi.exportCsv({});
    expect(b).toBeInstanceOf(Blob); expect((b as Blob).size).toBe('id,amount\n'.length);
    expectAsyncFlow('/super-admin/settlements/export', 'super-admin');
    calls = []; expect(await superAdminSettlementsApi.exportXlsx({})).toBeInstanceOf(Blob); expectAsyncFlow('/super-admin/settlements/export-xlsx', 'super-admin');
  });
  it('the live queue CSV: text, as getText gave', async () => {
    serve('super-admin', { text: 'q,c\n', contentType: 'text/csv' });
    expect(await superAdminQueueApi.exportCsv({})).toBe('q,c\n');
    expectAsyncFlow('/super-admin/queue/export', 'super-admin');
  });
  it('JSON envelopes (merchant accounts, users, branches) come back whole', async () => {
    serve('super-admin', { text: 'a,b\n', contentType: 'text/csv', body: csvEnvelope({ filename: 'users.csv', rowCount: 1, total: 1, truncated: false }) });
    expect(await superAdminApi.exportUsers({})).toEqual({ filename: 'users.csv', rowCount: 1, total: 1, truncated: false, csv: 'a,b\n' });
    expectAsyncFlow('/super-admin/platform/users/export', 'super-admin');
    calls = []; serve('super-admin', { text: 'x\n', contentType: 'text/csv', body: contentEnvelope({ filename: 'branches.csv', mime: 'text/csv', rowCount: 1 }) });
    expect(await superAdminApi.branchesExport({})).toEqual({ filename: 'branches.csv', mime: 'text/csv', rowCount: 1, content: 'x\n' });
    calls = []; serve('super-admin', { text: 'm\n', contentType: 'text/csv', body: csvEnvelope({ ok: true, filename: 'ma.csv' }) });
    expect(await superAdminMerchantAccountsApi.exportReport({} as any)).toMatchObject({ csv: 'm\n', filename: 'ma.csv' });
    expectAsyncFlow('/super-admin/merchant-accounts/export', 'super-admin');
  });
  it('revenue residual payout reports still report their filename / row count', async () => {
    serve('super-admin', { text: 'p\n', contentType: 'text/csv', body: contentEnvelope({ ok: true, filename: 'payouts.csv', mime: 'text/csv', rowCount: 3, encoding: 'utf8' }) });
    const out = await exportPayoutReports({ dataset: 'payouts' });
    expect(out).toMatchObject({ filename: 'payouts.csv', rowCount: 3 });
    expectAsyncFlow('/super-admin/revenue-residuals/export', 'super-admin');
  });
});
