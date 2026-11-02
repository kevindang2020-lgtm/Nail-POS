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
const paths = () => calls.map((c) => c.url.replace(/^https?:\/\/[^/]+/, '').split('?')[0]);
/** Every call went to /api/v1 — the export (asking for async), its status, its download. */
function expectAsyncFlow(exportPath: string, realm: string) {
  expect(calls[0].prefer).toBe('respond-async');
  expect(paths()).toEqual([`/api/v1${exportPath}`, `/api/v1/${realm}/operations/${OP}`, `/api/v1/${realm}/operations/${OP}/download`]);
}
beforeEach(() => { calls = []; });
import { customerApi } from './customerApi';

describe('Customer export on the async operation contract', () => {
  it('the privacy export: the JSON document, via /customer/operations', async () => {
    serve('customer', { text: JSON.stringify({ profile: { id: 'c1' } }), contentType: 'application/json' });
    expect(await customerApi.privacyExport()).toEqual({ profile: { id: 'c1' } });
    expectAsyncFlow('/customer/me/privacy-export', 'customer');
  });
});
