// BUILD_PLAN Phase 12 (Constitution 5 §32–33): the client half of the async operation contract.
import { describe, it, expect } from 'vitest';
import { runAsyncExport, type RawResponse } from './async-operation';
import { nextPollDelayMs, wantsAsync, syncShapeFromFile, isTerminalOperationStatus } from '@aipowersalon/api-contracts';

const resp = (status: number, body: unknown, contentType = 'application/json'): RawResponse => {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    status, ok: status >= 200 && status < 300, headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? contentType : null) },
    json: async () => JSON.parse(text), text: async () => text, blob: async () => new Blob([text], { type: contentType }),
    arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer,
  };
};
const OP = '11111111-1111-4111-8111-111111111111';
const accepted = resp(202, { operationId: OP, status: 'queued', statusUrl: `/pos/operations/${OP}`, pollAfterMs: 500 });
function transport(script: Record<string, RawResponse[]>) {
  const calls: Array<{ path: string; init: any }> = [];
  const raw = async (path: string, init: any) => { calls.push({ path, init }); const q = script[path]; if (!q?.length) throw new Error('unexpected ' + path); return q.length > 1 ? q.shift()! : q[0]; };
  return { raw, calls };
}
const noSleep = async () => undefined;

describe('runAsyncExport', () => {
  it('asks with Prefer: respond-async, polls the status URL until done, downloads, and rebuilds the synchronous { csv } shape', async () => {
    const t = transport({
      '/pos/customers/export': [accepted],
      [`/pos/operations/${OP}`]: [resp(200, { operationId: OP, kind: 'k', status: 'queued', createdAt: 'x' }), resp(200, { operationId: OP, kind: 'k', status: 'running', createdAt: 'x', progress: 10 }),
        resp(200, { operationId: OP, kind: 'k', status: 'succeeded', createdAt: 'x', result: { downloadUrl: `/pos/operations/${OP}/download`, expiresAt: 'x', filename: 'pos-customers.csv', contentType: 'text/csv', bytes: 9, rows: 1,
          body: { fields: { format: 'csv', filename: 'pos-customers.csv' }, contentField: 'csv', encoding: 'utf8' } } })],
      [`/pos/operations/${OP}/download`]: [resp(200, 'Name\nAnn\n', 'text/csv')],
    });
    const seen: string[] = [];
    const out = await runAsyncExport(t.raw, '/pos/customers/export', { status: 'active' }, { sleep: noSleep, onStatus: (s) => seen.push(s.status) });
    expect(out).toEqual({ format: 'csv', filename: 'pos-customers.csv', csv: 'Name\nAnn\n' });
    expect(t.calls[0]).toEqual({ path: '/pos/customers/export', init: { query: { status: 'active' }, headers: { Prefer: 'respond-async' } } });
    expect(seen).toEqual(['queued', 'running', 'succeeded']);
    // the statusUrl / downloadUrl go back through the app's own transport as PATHS (its prefix, its session)
    expect(t.calls.slice(1).map((c) => c.path)).toEqual([`/pos/operations/${OP}`, `/pos/operations/${OP}`, `/pos/operations/${OP}`, `/pos/operations/${OP}/download`]);
  });
  it('a base64 envelope comes back base64; a bare file comes back by content type or as asked', async () => {
    const done = (body?: unknown, ct = 'application/pdf') => resp(200, { operationId: OP, kind: 'k', status: 'succeeded', createdAt: 'x', result: { downloadUrl: '/d', expiresAt: 'x', filename: 'f', contentType: ct, bytes: 4, ...(body ? { body } : {}) } });
    const b64 = transport({ '/x': [accepted], [`/pos/operations/${OP}`]: [done({ fields: { ok: true, encoding: 'base64' }, contentField: 'content', encoding: 'base64' })], '/d': [resp(200, 'PK!!', 'application/octet-stream')] });
    expect(await runAsyncExport(b64.raw, '/x', undefined, { sleep: noSleep })).toEqual({ ok: true, encoding: 'base64', content: btoa('PK!!') });
    const text = transport({ '/x': [accepted], [`/pos/operations/${OP}`]: [done(undefined, 'text/csv')], '/d': [resp(200, 'a,b\n', 'text/csv')] });
    expect(await runAsyncExport(text.raw, '/x', undefined, { sleep: noSleep })).toBe('a,b\n');
    const blob = transport({ '/x': [accepted], [`/pos/operations/${OP}`]: [done()], '/d': [resp(200, '%PDF', 'application/pdf')] });
    expect(await runAsyncExport(blob.raw, '/x', undefined, { sleep: noSleep, as: 'blob' })).toBeInstanceOf(Blob);
  });
  it('a synchronous 200 (small export, older server) is returned unchanged — and a 4xx throws the normalised error', async () => {
    const sync = transport({ '/x': [resp(200, { format: 'csv', csv: 'a' })] });
    expect(await runAsyncExport(sync.raw, '/x', undefined, { sleep: noSleep })).toEqual({ format: 'csv', csv: 'a' });
    const denied = transport({ '/x': [resp(403, { error: { code: 'PERMISSION_DENIED', message: 'Missing permission: pos.customers.export' } })] });
    await expect(runAsyncExport(denied.raw, '/x', undefined, { sleep: noSleep })).rejects.toMatchObject({ status: 403, code: 'PERMISSION_DENIED', action: 'CONTACT_MANAGER' });
  });
  it('a failed operation throws its error code; an expired one OPERATION_EXPIRED', async () => {
    const failed = transport({ '/x': [accepted], [`/pos/operations/${OP}`]: [resp(200, { operationId: OP, kind: 'k', status: 'failed', createdAt: 'x', error: { code: 'PERMISSION_DENIED', message: 'You no longer have permission to run this export.' } })] });
    await expect(runAsyncExport(failed.raw, '/x', undefined, { sleep: noSleep })).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403, message: 'You no longer have permission to run this export.' });
    const expired = transport({ '/x': [accepted], [`/pos/operations/${OP}`]: [resp(200, { operationId: OP, kind: 'k', status: 'expired', createdAt: 'x' })] });
    await expect(runAsyncExport(expired.raw, '/x', undefined, { sleep: noSleep })).rejects.toMatchObject({ code: 'OPERATION_EXPIRED', status: 410 });
  });
  it('waits pollAfterMs first, then backs off ×1.5 up to the cap', async () => {
    const waits: number[] = [];
    const t = transport({ '/x': [accepted], [`/pos/operations/${OP}`]: [...Array(6).fill(resp(200, { operationId: OP, kind: 'k', status: 'running', createdAt: 'x' })), resp(200, { operationId: OP, kind: 'k', status: 'canceled', createdAt: 'x' })] });
    await expect(runAsyncExport(t.raw, '/x', undefined, { sleep: async (ms) => { waits.push(ms); } })).rejects.toBeTruthy();
    expect(waits).toEqual([500, 750, 1125, 1688, 2532, 3798, 5697]);
    expect(nextPollDelayMs(9_000, 500)).toBe(10_000);
  });
});

describe('the wire helpers', () => {
  it('wantsAsync, terminal states, the synchronous shape', () => {
    expect(wantsAsync('respond-async')).toBe(true); expect(wantsAsync('wait=5')).toBe(false);
    expect(['succeeded', 'failed', 'expired', 'canceled'].every(isTerminalOperationStatus)).toBe(true);
    expect(isTerminalOperationStatus('running')).toBe(false);
    expect(syncShapeFromFile({ fields: { a: 1 }, contentField: 'csv', encoding: 'utf8' }, { text: 'x' })).toEqual({ a: 1, csv: 'x' });
  });
});
