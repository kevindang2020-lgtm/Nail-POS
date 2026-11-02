// request-body-limits.ts — Security Deep Scan C9 / D3 (§40–§41, §90): the request body parsers, chosen per request.
//
// Before: ONE 25 MB JSON limit and a 25 MB urlencoded parser for every route — including ~120 routes a stranger can call
// without signing in (a cheap pre-auth memory/CPU DoS), and a urlencoded parser that let a plain cross-site <form> POST
// reach every JSON route. Now:
//   • a request WITHOUT credentials (no session cookie, no Authorization header) gets PUBLIC_BODY_LIMIT (256 KB default);
//   • a credentialed request keeps MAX_BODY_SIZE (25 MB default — CSV imports and base64 avatar/logo/evidence bodies);
//   • form-encoded bodies are parsed ONLY on the provider callback paths that need them (Twilio and other webhooks);
//     anywhere else a form body is simply not parsed (the validated-body pipe then refuses it).
// The raw bytes are kept as req.rawBody for signature verification (what Nest's rawBody:true did).
import express from 'express';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** Paths whose callers send application/x-www-form-urlencoded (provider callbacks). Prefix match on the path. */
export const FORM_BODY_PATHS: readonly RegExp[] = [
  // provider callbacks: Twilio messaging + booking verification (webhooks/twilio/*), payments/bank (webhooks/*),
  // Twilio voice for the AI receptionist and voice booking / transcription
  /^\/(api\/v1\/)?(webhooks|voice|voice-transcription|api\/ai-receptionist|public\/email\/unsubscribe)(\/|$|\?)/i,
];

export function hasCredentials(req: Pick<Request, 'headers'>): boolean {
  if (req.headers.authorization || req.headers['x-api-key']) return true;
  const c = String(req.headers.cookie ?? '');
  return /(^|;\s*)(aps_|__Host-aps|session|sid|access|refresh)[^=]*=/i.test(c);
}

export function isFormBodyPath(path: string): boolean { return FORM_BODY_PATHS.some((re) => re.test(path)); }

function keepRaw(req: IncomingMessage & { rawBody?: Buffer }, _res: ServerResponse, buf: Buffer): void { if (buf?.length) req.rawBody = Buffer.from(buf); }

export function bodyParsers(env: NodeJS.ProcessEnv = process.env): RequestHandler[] {
  const authed = env.MAX_BODY_SIZE || '25mb';
  const anon = env.PUBLIC_BODY_LIMIT || '256kb';
  const jsonAuthed = express.json({ limit: authed, verify: keepRaw });
  const jsonAnon = express.json({ limit: anon, verify: keepRaw });
  const form = express.urlencoded({ extended: false, limit: anon, verify: keepRaw });
  const rawText = express.text({ type: ['text/*'], limit: anon, verify: keepRaw });
  return [
    (req: Request, res: Response, next: NextFunction) => (hasCredentials(req) ? jsonAuthed : jsonAnon)(req, res, next),
    (req: Request, res: Response, next: NextFunction) => (isFormBodyPath(req.path) ? form(req, res, next) : next()),
    (req: Request, res: Response, next: NextFunction) => (isFormBodyPath(req.path) ? rawText(req, res, next) : next()),
  ];
}
