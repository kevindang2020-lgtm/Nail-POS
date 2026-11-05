// http-compression.ts — Smooth Refresh spec §88: normal HTTP compression for API responses, with the realtime streams
// explicitly excluded.
//
// Why the exclusion is the whole point: the compression middleware BUFFERS output until it has a worthwhile block to
// deflate. On a Server-Sent Events stream that means events sit in a buffer instead of reaching the POS — live updates
// would silently stall until enough of them piled up. So a response is never compressed when it is an event stream
// (by response Content-Type, or by an EventSource request's Accept header, checked BEFORE headers go out).
//
// Small responses (under 1 KB — e.g. a quiet 106-byte change-feed tick) are left alone: compressing them costs more
// CPU than the bytes it saves. A client can opt out per request with `x-no-compression`.
import compression from 'compression';
import type { Request, Response } from 'express';

export const COMPRESSION_THRESHOLD_BYTES = 1024;

export function isEventStream(req: Pick<Request, 'headers'>, res: Pick<Response, 'getHeader'>): boolean {
  const ct = String(res.getHeader('Content-Type') ?? '').toLowerCase();
  if (ct.includes('text/event-stream')) return true;
  const accept = String(req.headers?.accept ?? '').toLowerCase();
  return accept.includes('text/event-stream');
}

export function shouldCompress(req: Request, res: Response): boolean {
  if (req.headers['x-no-compression']) return false;
  if (isEventStream(req, res)) return false;
  return compression.filter(req, res);
}

export function apiCompression() {
  return compression({ threshold: COMPRESSION_THRESHOLD_BYTES, filter: shouldCompress });
}
