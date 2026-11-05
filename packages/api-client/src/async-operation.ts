// async-operation.ts — BUILD_PLAN Phase 12 (Constitution 5 §32–33): the client half of the ONE async operation contract.
//
// runAsyncExport(raw, path, query) asks an export route for the asynchronous answer (`Prefer: respond-async`):
//   • 202 → polls `statusUrl` (waiting `pollAfterMs`, then ×1.5 per poll, capped) until the operation is terminal, then
//     downloads `result.downloadUrl` and hands back EXACTLY what the synchronous answer would have been — the route's JSON
//     envelope rebuilt around the file when it had one (`result.body`), else the file as JSON / text / a Blob;
//   • 200 (a server that answers small exports synchronously, or one without the contract) → that answer, unchanged;
//   • a failed / expired / canceled operation, or an error status → throws the normalised error (code, message, action).
// `raw` is the app's OWN transport (its base, its /api/v1 prefix, its cookie): every path here — the export, statusUrl,
// downloadUrl — is passed to it as a path, never turned into a URL in this file.
import {
  isTerminalOperationStatus, nextPollDelayMs, syncShapeFromFile, PREFER_RESPOND_ASYNC,
  type AsyncOperationAccepted, type AsyncOperationStatus,
} from '@aipowersalon/api-contracts';
import { normalizeError, type NormalizedError } from './http-core';

/** What the app's transport returns: the parts of a fetch Response this helper reads. */
export interface RawResponse {
  status: number; ok: boolean;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>; text(): Promise<string>; blob(): Promise<Blob>; arrayBuffer(): Promise<ArrayBuffer>;
}
/** The app's own GET: (path, { query, headers }) → its fetch, on its base and prefix, with its session. */
export type AsyncTransport = (path: string, init: { query?: Record<string, unknown>; headers?: Record<string, string> }) => Promise<RawResponse>;
/** How the caller reads the answer: 'auto' (by content type: JSON → object, text/csv → string, else Blob), or forced. */
export type AsyncExportAs = 'auto' | 'json' | 'text' | 'blob';

export interface RunAsyncExportOptions {
  as?: AsyncExportAs;
  /** Give up waiting after this long (default 10 minutes) — the operation keeps running; its status says so. */
  maxWaitMs?: number;
  /** Called with each status read (a progress bar). */
  onStatus?: (s: AsyncOperationStatus) => void;
  /** Tests: the wait between polls. */
  sleep?: (ms: number) => Promise<void>;
}

const fail = (e: NormalizedError): never => { throw Object.assign(new Error(e.message), e); };
async function jsonOf(r: RawResponse): Promise<unknown> { try { return await r.json(); } catch { return null; } }
async function readAs(r: RawResponse, as: AsyncExportAs): Promise<unknown> {
  if (as === 'blob') return r.blob();
  if (as === 'text') return r.text();
  if (as === 'json') return r.json();
  const ct = String(r.headers.get('content-type') ?? '').toLowerCase();
  if (ct.includes('json')) return r.json();
  if (ct.startsWith('text/') || ct.includes('csv')) return r.text();
  return r.blob();
}
function base64Of(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return typeof btoa === 'function' ? btoa(bin) : (globalThis as any).Buffer.from(bin, 'binary').toString('base64');
}

export async function runAsyncExport<T = unknown>(raw: AsyncTransport, path: string, query?: Record<string, unknown>, opts: RunAsyncExportOptions = {}): Promise<T> {
  const as = opts.as ?? 'auto';
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const first = await raw(path, { query, headers: { Prefer: PREFER_RESPOND_ASYNC } });
  if (first.status !== 202) {
    if (!first.ok) fail(normalizeError(first.status, await jsonOf(first)));
    return (await readAs(first, as)) as T;
  }
  const accepted = (await first.json()) as AsyncOperationAccepted;
  if (!accepted?.statusUrl) fail(normalizeError(500, { code: 'INTERNAL_ERROR', message: 'The export was accepted without a status address.' }));
  const deadline = Date.now() + (opts.maxWaitMs ?? 10 * 60_000);
  let delay: number | null = null; let status: AsyncOperationStatus | null = null;
  for (;;) {
    delay = nextPollDelayMs(delay, accepted.pollAfterMs);
    await sleep(delay);
    const s = await raw(accepted.statusUrl, {});
    if (!s.ok) fail(normalizeError(s.status, await jsonOf(s)));
    status = (await s.json()) as AsyncOperationStatus;
    opts.onStatus?.(status);
    if (isTerminalOperationStatus(status.status)) break;
    if (Date.now() > deadline) fail(normalizeError(504, { code: 'OPERATION_NOT_READY', message: 'The export is still being prepared — check back in a moment.' }));
  }
  if (status!.status !== 'succeeded' || !status!.result) {
    const code = status!.error?.code ?? (status!.status === 'expired' ? 'OPERATION_EXPIRED' : 'INTERNAL_ERROR');
    fail(normalizeError(code === 'PERMISSION_DENIED' ? 403 : status!.status === 'expired' ? 410 : 500, { code, message: status!.error?.message ?? 'The export did not finish.' }));
  }
  const result = status!.result!;
  const d = await raw(result.downloadUrl, {});
  if (!d.ok) fail(normalizeError(d.status, await jsonOf(d)));
  if (result.body) {
    const file = result.body.encoding === 'base64' ? { base64: base64Of(await d.arrayBuffer()) } : { text: await d.text() };
    return syncShapeFromFile(result.body, file) as T;
  }
  return (await readAs(d, as)) as T;
}
