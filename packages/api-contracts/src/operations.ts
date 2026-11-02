// operations.ts — BUILD_PLAN Phase 12 (Constitution 5 §32–33): the ONE asynchronous operation contract.
//
// A long-running request (today: a large export) answers HTTP 202 with an `AsyncOperationAccepted` body and a
// `Location: <statusUrl>` header instead of holding the connection open. The client polls `statusUrl` (waiting
// `pollAfterMs` between polls, longer as it goes) until the status is terminal, then fetches `result.downloadUrl`.
//
//   • A client ASKS for it with `Prefer: respond-async` (RFC 7240) or `?async=1`; a server MAY also answer 202 on its own
//     when the export is larger than the route's synchronous limit — so every client of an async-capable route must
//     handle 202. A small export without the header keeps its old synchronous answer (no client breaks).
//   • `statusUrl` and `result.downloadUrl` are paths on the SAME API base the client already uses (no /api/v1 or
//     origin in front): pass them to the app's own client. `Location` carries the absolute path the request came in on.
//   • Each realm reads only its own operations: /pos/operations, /owner/operations, /tech/operations,
//     /super-admin/operations, /customer/operations. Another salon's operation is 404 — never 403 — so ids cannot be probed.
//   • A result lives 24 hours (`expiresAt`); after that the status is `expired` and the download is 410 OPERATION_EXPIRED.
// Browser-safe and dependency-free.

export const ASYNC_OPERATION_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'expired', 'canceled'] as const;
export type AsyncOperationState = (typeof ASYNC_OPERATION_STATUSES)[number];
export const TERMINAL_OPERATION_STATUSES: readonly AsyncOperationState[] = ['succeeded', 'failed', 'expired', 'canceled'];
export const isTerminalOperationStatus = (s: unknown): boolean => typeof s === 'string' && (TERMINAL_OPERATION_STATUSES as readonly string[]).includes(s);

/** The realms that have their own operations routes. */
export const OPERATION_REALMS = ['pos', 'owner', 'tech', 'super-admin', 'customer'] as const;
export type OperationRealm = (typeof OPERATION_REALMS)[number];

/** Body of the 202 answer. */
export interface AsyncOperationAccepted {
  operationId: string;
  status: 'queued';
  /** GET this (same API base) for an AsyncOperationStatus. */
  statusUrl: string;
  /** How long to wait before the first poll. */
  pollAfterMs: number;
}

export interface AsyncOperationResult {
  /** GET this (same API base, same session) for the file itself. */
  downloadUrl: string;
  /** ISO time after which the file is gone (410). */
  expiresAt: string;
  filename: string;
  contentType: string;
  bytes: number;
  rows?: number;
  /** How the route's SYNCHRONOUS answer wrapped this file, so a client can hand its screen exactly the shape it always got:
   *  the synchronous JSON was `{ ...fields, [contentField]: <the file as text, or base64> }`. Absent when the synchronous
   *  answer WAS the file (CSV text, a binary, or a JSON document). */
  body?: AsyncOperationBodyShape;
}

export interface AsyncOperationBodyShape {
  fields: Record<string, unknown>;
  contentField: string;
  encoding: 'utf8' | 'base64';
}

export interface AsyncOperationError { code: string; message: string }

export interface AsyncOperationStatus {
  operationId: string;
  /** What is being produced, e.g. 'pos.customers.export'. */
  kind: string;
  status: AsyncOperationState;
  /** 0–100 while running, when the producer reports it. */
  progress?: number;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  result?: AsyncOperationResult;
  error?: AsyncOperationError;
}

export interface AsyncOperationList { items: AsyncOperationStatus[] }
/** An operation's id in a route (`/…/operations/:id`, `/…/operations/:id/download` — the download answers the file itself). */
export type OperationId = string;

/** The header a client sends to ask for the asynchronous answer. */
export const PREFER_RESPOND_ASYNC = 'respond-async';
/** Does a `Prefer` header (or `?async=`) ask for the asynchronous answer? */
export function wantsAsync(prefer: unknown, asyncQuery?: unknown): boolean {
  const q = Array.isArray(asyncQuery) ? asyncQuery[0] : asyncQuery;
  if (q !== undefined && q !== null && /^(1|true|yes)$/i.test(String(q))) return true;
  const p = Array.isArray(prefer) ? prefer.join(',') : String(prefer ?? '');
  return p.split(',').some((t) => t.trim().split(';')[0].trim().toLowerCase() === PREFER_RESPOND_ASYNC);
}

/** The operations base path a realm reads its operations under (e.g. '/pos/operations'). */
export const operationsPath = (realm: OperationRealm): string => `/${realm}/operations`;
export const operationStatusPath = (realm: OperationRealm, id: string): string => `${operationsPath(realm)}/${encodeURIComponent(id)}`;
export const operationDownloadPath = (realm: OperationRealm, id: string): string => `${operationStatusPath(realm, id)}/download`;

/** Rebuild the synchronous answer from the downloaded file (see AsyncOperationResult.body). */
export function syncShapeFromFile(shape: AsyncOperationBodyShape, file: { text?: string; base64?: string }): Record<string, unknown> {
  const content = shape.encoding === 'base64' ? (file.base64 ?? '') : (file.text ?? '');
  return { ...shape.fields, [shape.contentField]: content };
}

/** The next poll delay: the server's hint first, then ×1.5 per poll, capped (default 10 s). */
export function nextPollDelayMs(previousMs: number | null | undefined, hintMs?: number | null, capMs = 10_000): number {
  const base = Number.isFinite(Number(hintMs)) && Number(hintMs) > 0 ? Number(hintMs) : 1_000;
  if (previousMs == null || !Number.isFinite(previousMs) || previousMs <= 0) return Math.min(capMs, base);
  return Math.min(capMs, Math.max(base, Math.round(previousMs * 1.5)));
}
